import { supabaseAdmin } from '@/lib/ai/admin-client'
import { configuredBaseUrl } from '@/lib/showcase/site-url'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'

// ============================================================
// Sincronización Inventario -> Knowledge Base (RAG).
//
// Cada vehículo 'available' se refleja como UN documento del knowledge
// base de la cuenta (ai_knowledge_documents) y se (re)indexa con el
// mismo pipeline que la KB manual: ingestDocument() trocea y —si la
// cuenta tiene una embeddings key— embebe. Así el bot lo recupera igual
// que cualquier otro conocimiento (semántico si hay key; si no, léxico/FTS).
//
// El enlace vehículo<->documento vive en inventory_vehicles.kb_document_id.
//
// Corre con el cliente SERVICE-ROLE (supabaseAdmin): la RLS del KB exige
// rol 'admin' para escribir, pero quien edita inventario es 'agent'. Es
// el mismo patrón que documenta la ruta de ingest ("service-role for
// ingest routes"). Cada consulta se acota por account_id a mano.
// ============================================================

interface VehicleForKb {
  id: string
  public_ref: string | null
  brand: string
  model: string
  year: number
  price: number
  mileage: number | null
  color: string | null
  body_type: string | null
  fuel_type: string | null
  transmission: string | null
  engine_displacement: string | null
  plate_city: string | null
  condition: string | null
  features: unknown
}

/**
 * Aplana el JSONB `features` a una sola línea de texto para el KB.
 * Soporta arreglo de etiquetas, objeto atributo→valor (o atributo→true)
 * y string suelto; cualquier otro valor se convierte con String().
 */
function featuresToText(features: unknown): string {
  if (!features) return ''
  if (Array.isArray(features)) {
    return features.map((f) => String(f)).filter(Boolean).join(', ')
  }
  if (typeof features === 'object') {
    return Object.entries(features as Record<string, unknown>)
      .map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`))
      .join(', ')
  }
  return String(features)
}

/** Etiquetas en español de los códigos de `specs.ts`, para que el
 *  documento se lea como lo diría un vendedor y no como un enum. */
const KB_TRANSMISSION: Record<string, string> = {
  manual: 'mecánica',
  automatic: 'automática',
  cvt: 'CVT',
  other: 'otra',
}
const KB_CONDITION: Record<string, string> = { new: 'nuevo', used: 'usado' }

/**
 * Carrocería como la nombra el cliente, no como la nombra el enum.
 *
 * A las tres que en Colombia se llaman "camioneta" —SUV, pick-up y van,
 * el mismo grupo que decide el recargo de la garantía en `specs.ts`— se
 * les añade esa palabra al texto. Es la que la gente escribe: quien pide
 * "una camioneta" no escribe "SUV", y la búsqueda del knowledge base es
 * léxica, así que la palabra tiene que estar ahí para poder encontrarse.
 */
const KB_BODY: Record<string, string> = {
  suv: 'SUV (camioneta)',
  pickup: 'pick-up (camioneta)',
  van: 'van (camioneta)',
  sedan: 'sedán',
  hatchback: 'hatchback',
  coupe: 'coupé',
  wagon: 'station wagon',
  convertible: 'convertible',
  other: 'otra',
}

const KB_FUEL: Record<string, string> = {
  gasoline: 'gasolina',
  diesel: 'diésel',
  hybrid: 'híbrido',
  electric: 'eléctrico',
  lpg: 'gas',
  other: 'otro',
}

/**
 * Título + cuerpo en texto plano para el documento del KB del vehículo.
 *
 * SOLO LLEVA LO QUE SE LE DIRÍA A UN CLIENTE. `internal_notes` queda
 * deliberadamente fuera: ahí viven el asesor, el banco de la prenda, el
 * dueño anterior y observaciones como "2 reclamaciones de menor
 * cuantía", y este texto alimenta respuestas que salen solas por
 * WhatsApp cuando `auto_reply_enabled` está activo. El prompt instruye
 * al modelo a preferir estos extractos para cualquier dato concreto, así
 * que todo lo que entre aquí es, en la práctica, decible al cliente.
 *
 * El VIN tampoco entra: identifica al vehículo ante terceros y no le
 * sirve a nadie que esté preguntando por un carro en WhatsApp.
 */
export function formatVehicleForKb(
  v: VehicleForKb,
  baseUrl?: string | null,
): {
  title: string
  content: string
} {
  const title = `Vehículo: ${v.brand} ${v.model} ${v.year}`
  const parts: string[] = [`Vehículo disponible: ${v.brand} ${v.model} ${v.year}.`]
  parts.push(`Precio: ${v.price}.`)
  if (v.mileage != null) parts.push(`Kilometraje: ${v.mileage} km.`)
  if (v.color) parts.push(`Color: ${v.color}.`)
  if (v.body_type) parts.push(`Carrocería: ${KB_BODY[v.body_type] ?? v.body_type}.`)
  if (v.fuel_type) parts.push(`Combustible: ${KB_FUEL[v.fuel_type] ?? v.fuel_type}.`)
  if (v.transmission) {
    parts.push(`Transmisión: ${KB_TRANSMISSION[v.transmission] ?? v.transmission}.`)
  }
  if (v.engine_displacement) parts.push(`Motor: ${v.engine_displacement}.`)
  if (v.plate_city) parts.push(`Placa de ${v.plate_city}.`)
  if (v.condition) parts.push(`Estado: ${KB_CONDITION[v.condition] ?? v.condition}.`)
  const feats = featuresToText(v.features)
  if (feats) parts.push(`Detalles: ${feats}.`)
  // El enlace a la ficha publica, para que el bot pueda mandarlo. Si no
  // hay base configurada se omite: media URL no le sirve a nadie, y un
  // enlace roto en WhatsApp es peor que no mandar ninguno.
  if (baseUrl) {
    parts.push(`Ficha con fotos: ${baseUrl.replace(/\/+$/, '')}/vehiculo/${v.id}.`)
  }
  if (v.public_ref) parts.push(`Código: ${v.public_ref.toUpperCase()}.`)
  return { title, content: parts.join(' ') }
}

/**
 * (Re)sincroniza un vehículo con el knowledge base de su cuenta.
 *
 *   - status 'available'                 -> crea/actualiza el documento y
 *                                           lo (re)indexa (chunk + embed).
 *   - otro status (sold/reserved/hidden) -> borra el documento del KB
 *                                           (los chunks caen por cascade)
 *                                           y limpia kb_document_id.
 *
 * Lanza si algo del KB falla; el llamador (la API route) lo captura y
 * degrada a warning para no tumbar el guardado del vehículo.
 */
export async function syncVehicleKnowledge(
  accountId: string,
  vehicleId: string,
): Promise<void> {
  const admin = supabaseAdmin()

  const { data: v, error } = await admin
    .from('inventory_vehicles')
    .select(
      'id, public_ref, brand, model, year, price, mileage, color, body_type, fuel_type, transmission, engine_displacement, plate_city, condition, features, status, kb_document_id',
    )
    .eq('account_id', accountId)
    .eq('id', vehicleId)
    .maybeSingle()
  if (error) throw error
  if (!v) return

  // No disponible -> fuera del KB.
  if (v.status !== 'available') {
    if (v.kb_document_id) {
      await admin
        .from('ai_knowledge_documents')
        .delete()
        .eq('account_id', accountId)
        .eq('id', v.kb_document_id)
      await admin
        .from('inventory_vehicles')
        .update({ kb_document_id: null })
        .eq('id', v.id)
    }
    return
  }

  const { title, content } = formatVehicleForKb(
    v as VehicleForKb,
    configuredBaseUrl()?.origin ?? null,
  )

  let documentId: string | null = v.kb_document_id
  if (documentId) {
    await admin
      .from('ai_knowledge_documents')
      .update({ title, content })
      .eq('account_id', accountId)
      .eq('id', documentId)
  } else {
    const { data: doc, error: insErr } = await admin
      .from('ai_knowledge_documents')
      .insert({ account_id: accountId, title, content })
      .select('id')
      .single()
    if (insErr || !doc) {
      throw insErr ?? new Error('No se pudo crear el documento de KB del vehículo')
    }
    documentId = doc.id
    await admin
      .from('inventory_vehicles')
      .update({ kb_document_id: documentId })
      .eq('id', v.id)
  }

  if (!documentId) {
    throw new Error('No se pudo resolver el documento de KB del vehículo')
  }

  const { key: embeddingsApiKey } = await loadEmbeddingsKey(admin, accountId)
  await ingestDocument(admin, accountId, { embeddingsApiKey }, documentId, content)
}

/**
 * Borra el documento del KB de un vehículo que se está eliminando. Se
 * llama desde el handler DELETE (donde la fila del vehículo ya no puede
 * darnos el kb_document_id después de borrarla).
 */
export async function deleteVehicleKnowledge(
  accountId: string,
  kbDocumentId: string | null,
): Promise<void> {
  if (!kbDocumentId) return
  const admin = supabaseAdmin()
  await admin
    .from('ai_knowledge_documents')
    .delete()
    .eq('account_id', accountId)
    .eq('id', kbDocumentId)
}
