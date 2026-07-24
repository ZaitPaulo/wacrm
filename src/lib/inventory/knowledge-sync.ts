import { supabaseAdmin } from '@/lib/ai/admin-client'
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
  brand: string
  model: string
  year: number
  price: number
  mileage: number | null
  vin: string | null
  features: unknown
  internal_notes: string | null
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

/** Título + cuerpo en texto plano para el documento del KB del vehículo. */
export function formatVehicleForKb(v: VehicleForKb): {
  title: string
  content: string
} {
  const title = `Vehículo: ${v.brand} ${v.model} ${v.year}`
  const parts: string[] = [`Vehículo disponible: ${v.brand} ${v.model} ${v.year}.`]
  parts.push(`Precio: ${v.price}.`)
  if (v.mileage != null) parts.push(`Kilometraje: ${v.mileage} km.`)
  const feats = featuresToText(v.features)
  if (feats) parts.push(`Detalles: ${feats}.`)
  if (v.internal_notes) parts.push(`Notas: ${v.internal_notes}.`)
  if (v.vin) parts.push(`VIN: ${v.vin}.`)
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
      'id, brand, model, year, price, mileage, vin, features, internal_notes, status, kb_document_id',
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

  const { title, content } = formatVehicleForKb(v as VehicleForKb)

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
