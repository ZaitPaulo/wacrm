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

/**
 * Used when the catalogue can't be read at all. Spanish because this
 * install is a Colombian dealership; the catalogue is the real source
 * and this only covers a broken deployment.
 */
const FALLBACK =
  'Te asignamos un asesor comercial. Se comunicará contigo muy pronto. 🙌'

/**
 * Read the notice from the install's catalogue.
 *
 * Deliberately NOT `getTranslations()` from next-intl/server: these
 * calls happen inside the webhook's `after()` block, outside the
 * request scope that provides it. Resolving the locale from the
 * environment mirrors what `src/i18n/request.ts` does and works
 * anywhere.
 */
async function notice(): Promise<string> {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en'
  try {
    const messages = (await import(`../../../messages/${locale}.json`)).default
    return messages?.Handoff?.customerNotice || FALLBACK
  } catch {
    return FALLBACK
  }
}

export async function notifyCustomerOfHandoff(args: {
  accountId: string
  /** Audit column on the outbound message; the flow / config owner. */
  userId: string
  conversationId: string | null
  contactId: string | null
}): Promise<void> {
  if (!args.conversationId || !args.contactId) return
  try {
    await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: await notice(),
    })
  } catch (err) {
    console.error('[handoff] customer notice failed:', err)
  }
}
