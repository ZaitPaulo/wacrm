import type { SupabaseClient } from '@supabase/supabase-js'

import { pickDefaultPipeline } from '@/lib/pipelines/deal-vehicle'
import type { HandoffRequest } from './types'

/**
 * El negocio que nace cuando la IA transfiere la conversación a un
 * asesor.
 *
 * Por qué acá y no en una automatización: la de alta de prospecto lleva
 * apagada desde el 2026-09-14 y `deals` está vacía —0 filas, histórico
 * incluido—, así que la columna de etapas del embudo en el tablero de
 * rendimiento no tenía nada que mostrar. El traspaso es el momento en
 * que el lead pasa a ser trabajo de una persona; es ahí donde debe
 * existir la tarjeta.
 *
 * Tres reglas mandan sobre este archivo:
 *
 *   1. NO PUEDE COSTAR EL TRASPASO. Perder una tarjeta del embudo es
 *      preferible a dejar a un cliente esperando, así que nada de acá
 *      lanza: todo error se registra y se sigue.
 *   2. NO DUPLICA, Y NO POR UN SELECT PREVIO. La unicidad la impone el
 *      índice parcial `idx_deals_one_open_per_conversation` (migración
 *      532) y acá solo se lee la violación 23505 como "ya existe". Dos
 *      traspasos casi simultáneos pasarían los dos un SELECT.
 *   3. NO INVENTA DATOS. Lo que el bot no averiguó queda marcado como
 *      faltante en la nota, no relleno con un valor que se lea como
 *      real.
 */

/** Violación de unicidad de Postgres: acá significa "ya había uno abierto". */
const UNIQUE_VIOLATION = '23505'

export interface HandoffDealArgs {
  accountId: string
  conversationId: string
  contactId: string
  /**
   * Dueño de la fila para `deals.user_id`, que es NOT NULL y no admite
   * "lo creó el sistema". Se usa el mismo usuario que ya firma los
   * envíos del bot (el dueño de la configuración de WhatsApp), igual
   * que hace el paso `create_deal` del motor de automatizaciones.
   */
  ownerUserId: string
  /**
   * `profiles.id` del asesor que recibe —OJO: no su `user_id`, que es
   * lo que guarda `conversations.assigned_agent_id`—. Null cuando el
   * traspaso quedó en la cola compartida.
   */
  assignedProfileId: string | null
  /** Lo que el bot declaró haber recolectado. Ausente en el traspaso
   *  por fallo del proveedor, donde no hay petición que leer. */
  request?: HandoffRequest | null
  /** La nota interna del traspaso, tal cual la lee el asesor. */
  summary: string
}

/**
 * Resultado de `createHandoffDeal`. Nunca se lanza: el traspaso decide
 * qué hacer con cada caso, y `already_open` no es un error sino la
 * deduplicación del índice único haciendo su trabajo.
 */
export type HandoffDealOutcome =
  | { status: 'created'; dealId: string }
  | { status: 'already_open' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

/**
 * Título de la tarjeta: el nombre del cliente y el vehículo que pidió,
 * que es lo que el asesor necesita leer en el tablero sin abrir nada.
 *
 * Solo se arman con lo que el bot SÍ obtuvo. Un traspaso urgente puede
 * traer apenas el nombre, y entonces el título es el nombre: meterle un
 * "Sin vehículo" lo convertiría en un dato, y no lo es. Cuando no hay
 * ninguno de los dos —el traspaso por fallo técnico— se dice de dónde
 * vino la tarjeta y se deja que el contacto vinculado ponga el nombre.
 */
export function buildHandoffDealTitle(request?: HandoffRequest | null): string {
  const partes = [request?.nombre, request?.interes]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)

  return partes.length > 0 ? partes.join(' — ') : 'Traspaso del asistente'
}

/**
 * Crea el negocio del traspaso. Nunca lanza.
 *
 * El embudo y la etapa se eligen con el MISMO criterio que la creación
 * a mano desde la bandeja (`pickDefaultPipeline`): el llamado "Ventas"
 * sin distinguir mayúsculas ni espacios, o el más antiguo si no hay, y
 * la etapa de menor `position`. Que un negocio nacido del bot y uno
 * creado a mano caigan en el mismo sitio no es cosmético: si cayeran en
 * columnas distintas, el desglose por etapas del tablero de rendimiento
 * mezclaría dos cosas.
 */
export async function createHandoffDeal(
  db: SupabaseClient,
  args: HandoffDealArgs,
): Promise<HandoffDealOutcome> {
  try {
    const { data: embudos, error: embudosErr } = await db
      .from('pipelines')
      .select('id, name, created_at')
      .eq('account_id', args.accountId)

    if (embudosErr) return fallo('no se pudieron leer los embudos', embudosErr)

    const embudo = pickDefaultPipeline(
      (embudos ?? []) as { id: string; name: string; created_at: string }[],
    )
    // Una cuenta sin embudos no es un error de este camino: es una
    // cuenta sin configurar. No hay dónde poner la tarjeta y el
    // traspaso sigue su curso.
    if (!embudo) return { status: 'skipped', reason: 'la cuenta no tiene embudos' }

    const { data: etapa, error: etapaErr } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', embudo.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (etapaErr) return fallo('no se pudieron leer las etapas', etapaErr)
    if (!etapa) return { status: 'skipped', reason: 'el embudo no tiene etapas' }

    // Una cuenta tiene una sola moneda; se lee de la cuenta en vez de
    // dejar el default estático de la columna, por lo mismo que lo hace
    // el motor de automatizaciones.
    const { data: cuenta } = await db
      .from('accounts')
      .select('default_currency')
      .eq('id', args.accountId)
      .maybeSingle()

    const { data: creado, error: insertErr } = await db
      .from('deals')
      .insert({
        account_id: args.accountId,
        user_id: args.ownerUserId,
        pipeline_id: embudo.id,
        stage_id: (etapa as { id: string }).id,
        contact_id: args.contactId,
        conversation_id: args.conversationId,
        title: buildHandoffDealTitle(args.request),
        // Cero y no el presupuesto: `presupuesto` es texto libre tal
        // como lo dijo el cliente ("30 millones", "unos 30 palos") y
        // convertirlo a un número sería inventarle una cifra al
        // negocio. El dato sigue entero en la nota.
        value: 0,
        currency:
          (cuenta as { default_currency: string } | null)?.default_currency ?? 'USD',
        status: 'open',
        // El negocio nace con el mismo dueño que la conversación: si
        // naciera sin asignar, el asesor tendría el chat pero no la
        // tarjeta.
        assigned_to: args.assignedProfileId,
        // La nota del traspaso entera, con los "(falta)" incluidos: es
        // lo que evita que el asesor tenga que releer la conversación.
        notes: args.summary,
      })
      .select('id')
      .single()

    if (insertErr) {
      if (insertErr.code === UNIQUE_VIOLATION) {
        // Lo esperado cuando un hilo se devuelve al bot y este lo vuelve
        // a transferir: ya hay tarjeta y se conserva la que estaba, con
        // lo que el asesor haya anotado y la etapa a la que la haya
        // movido. No es un error.
        return { status: 'already_open' }
      }
      return fallo('no se pudo crear el negocio', insertErr)
    }

    return { status: 'created', dealId: (creado as { id: string }).id }
  } catch (err) {
    return fallo('fallo inesperado creando el negocio', err)
  }
}

/** Registra el error con contexto y lo devuelve como resultado, no como excepción. */
function fallo(motivo: string, err: unknown): HandoffDealOutcome {
  console.error(`[ai handoff-deal] ${motivo}:`, err)
  return { status: 'failed', reason: motivo }
}
