/**
 * Tell the customer a human is taking over.
 *
 * Both engines hand conversations to an agent, and until now neither
 * told the person waiting. The flow runner parked the thread and
 * assigned it; the AI assistant did the same and simply went quiet
 * mid-conversation. From the customer's side the difference between
 * "an agent is coming" and "they stopped answering" was invisible.
 *
 * Assigning already notifies the AGENT — that's what the
 * `conversation_assigned` trigger is for. This is the other half: the
 * notice the customer gets.
 *
 * Shared so the two paths cannot drift into saying different things.
 *
 * Best-effort by design. The handoff itself — parking the thread and
 * routing it — is what matters; a failed courtesy message must never
 * undo it or bubble into the webhook.
 */

import { engineSendText } from '@/lib/flows/meta-send'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { loadCatalogSection } from '@/lib/i18n/server-catalog'
import { leerHorarioCuenta } from '@/lib/outbound/gate'
import { formatOpeningTime, handoffWhen, type HandoffWhen } from './when'

/**
 * Used when the catalogue can't be read at all. Spanish because this
 * install is a Colombian dealership; the catalogue is the real source
 * and this only covers a broken deployment.
 */
const FALLBACK =
  'Te asignamos un asesor comercial. Se comunicará contigo muy pronto. 🙌'

/**
 * Read the notice from the install's catalogue (`Handoff.*`) and add the
 * sentence that says when the agent will write, if there is one.
 *
 * Con nombre se usa la forma que lo nombra, que es una frase aparte y no
 * el texto anónimo con el nombre pegado: cada idioma decide dónde va el
 * nombre dentro de la oración. Lo mismo la frase de tiempo, que va
 * después como oración propia.
 */
async function notice(agentName: string | null, when: HandoffWhen | null): Promise<string> {
  const handoff = await loadCatalogSection('Handoff')
  if (!handoff) return FALLBACK

  const base =
    agentName && typeof handoff.customerNoticeNamed === 'string'
      ? handoff.customerNoticeNamed.replace('{name}', agentName)
      : typeof handoff.customerNotice === 'string'
        ? handoff.customerNotice
        : FALLBACK

  const sentence = whenSentence(handoff, when)
  return sentence ? `${base} ${sentence}` : base
}

/** "…las 8:00 a. m.." → "…las 8:00 a. m.": la hora en español ya termina
 *  en punto y la plantilla pone el suyo. */
function oneFinalPeriod(text: string): string {
  return text.replace(/\.\.$/, '.')
}

function whenSentence(handoff: Record<string, unknown>, when: HandoffWhen | null): string | null {
  const sentence = rawWhenSentence(handoff, when)
  return sentence ? oneFinalPeriod(sentence) : null
}

function rawWhenSentence(handoff: Record<string, unknown>, when: HandoffWhen | null): string | null {
  if (!when) return null
  const pick = (key: string) => (typeof handoff[key] === 'string' ? (handoff[key] as string) : null)
  if (when.kind === 'soon') return pick('whenSoon')

  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en'
  const time = formatOpeningTime(when.opensAt, locale)
  if (when.kind !== 'weekday') {
    const key = when.kind === 'today' ? 'whenToday' : 'whenTomorrow'
    return pick(key)?.replace('{time}', time) ?? null
  }

  const weekdays = handoff.weekdays as Record<string, unknown> | undefined
  const day = weekdays?.[String(when.weekday)]
  const template = pick('whenWeekday')
  if (!template || typeof day !== 'string') return null
  return template.replace('{day}', day).replace('{time}', time)
}

/**
 * La frase de tiempo sola ("Te escribe mañana desde las 8:00 a. m."),
 * para que el bot en espera del asesor pueda decírsela al cliente que
 * pregunta (bot-fase-2). `null` si no hay nada honesto que decir.
 */
export async function handoffWhenSentence(accountId: string): Promise<string | null> {
  const [handoff, when] = await Promise.all([
    loadCatalogSection('Handoff'),
    whenForAccount(accountId),
  ])
  return handoff ? whenSentence(handoff, when) : null
}

/**
 * Cuándo escribe el asesor, según el horario de la cuenta. Cualquier
 * fallo leyendo el horario deja el aviso sin tiempo, como era antes: la
 * frase es una cortesía, no puede costar el aviso.
 */
async function whenForAccount(accountId: string): Promise<HandoffWhen | null> {
  try {
    const config = await leerHorarioCuenta(supabaseAdmin(), accountId)
    return config ? handoffWhen(config) : null
  } catch (err) {
    console.warn('[handoff] no se pudo leer el horario para el aviso:', err)
    return null
  }
}

export async function notifyCustomerOfHandoff(args: {
  accountId: string
  /** Audit column on the outbound message; the flow / config owner. */
  userId: string
  conversationId: string | null
  contactId: string | null
  /** Primer nombre del asesor que recibio el hilo. Cuando falta —no hay
   *  asesor asignable, o la derivacion vino de un flujo— el aviso
   *  vuelve a la forma anonima: nunca se promete un nombre inexistente. */
  agentName?: string | null
}): Promise<void> {
  if (!args.conversationId || !args.contactId) return
  try {
    await engineSendText({
      initiative: 'reply',
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: await notice(args.agentName ?? null, await whenForAccount(args.accountId)),
    })
  } catch (err) {
    console.error('[handoff] customer notice failed:', err)
  }
}
