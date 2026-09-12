import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

/**
 * Media whose text reaches the model, and the label that says what the
 * text came with. The model can't see the attachment, so a bare caption
 * would read as if it were the whole message; `[Foto] ¿y este?` tells it
 * there is a photo it has to ask about instead of pretending to know.
 *
 * Must stay in step with the AI dispatch in `src/lib/inbound/core.ts`,
 * which wakes the bot for ANY inbound that carries text. A type that
 * dispatches but is missing here wakes the bot for a message it then
 * can't see: that is what sent a customer's question to a human on
 * 2026-09-12 as a "provider failure".
 */
const MEDIA_LABELS: Record<string, string> = {
  image: 'Foto',
  video: 'Video',
  document: 'Documento',
  location: 'Ubicación',
}

const CONTEXT_TYPES = ['text', ...Object.keys(MEDIA_LABELS)]

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
}

/**
 * Fetch the last N messages of a conversation that carry text — typed
 * messages plus media captions and locations — and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Messages with nothing to read
 * (audio, captionless photos, templates, interactive) are excluded.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text')
    .eq('conversation_id', conversationId)
    .in('content_type', CONTEXT_TYPES)
    // In the query, not after it: a captionless photo that took one of
    // the `limit` slots would hand the model fewer turns than asked.
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => {
      const text = m.content_text!.trim()
      const label = MEDIA_LABELS[m.content_type]
      return {
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: label ? `[${label}] ${text}` : text,
      }
    })
}
