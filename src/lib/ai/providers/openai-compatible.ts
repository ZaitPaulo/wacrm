import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

// ============================================================
// Shared Chat-Completions adapter.
//
// OpenAI, OpenRouter and Gemini all speak the same `/chat/completions`
// shape, so the transport lives here once and each provider module just
// supplies its endpoint + quirks. Anthropic keeps its own adapter — its
// wire format genuinely differs (top-level `system`, `content` blocks).
// ============================================================

export interface OpenAiCompatibleOptions {
  /** Absolute chat-completions endpoint. */
  url: string
  /** Provider name used in error messages ("OpenRouter rejected the API key"). */
  label: string
  /**
   * Field carrying the output-token cap. OpenAI's newer models require
   * `max_completion_tokens` and reject `max_tokens`; Gemini's
   * compatibility layer only understands `max_tokens` and — per its own
   * docs — *silently ignores* parameters it doesn't recognise, which
   * would quietly uncap spend on the account's key. So each provider
   * names it explicitly rather than inheriting a default.
   */
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
  /** Extra headers merged into the request (OpenRouter attribution). */
  headers?: Record<string, string>
}

/**
 * One turn on the wire. A text-only turn keeps the plain-string
 * `content` it always had; only a turn with photos becomes the parts
 * array, text first and then one `image_url` per photo as a data URI —
 * the shape OpenAI, OpenRouter and Gemini's compatibility layer all
 * accept.
 */
function toWireMessage(m: ChatMessage) {
  if (!m.images?.length) return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.content },
      ...m.images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      })),
    ],
  }
}

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * POST one chat completion and return the raw assistant text + token
 * usage (handoff parsing happens in `generateReply`). Throws `AiError`
 * on network failure, a non-2xx response, or an empty completion.
 */
export async function generateOpenAiCompatible(
  args: ProviderArgs,
  opts: OpenAiCompatibleOptions,
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const { url, label, maxTokensField, headers } = opts

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages).map(toWireMessage),
        ],
        [maxTokensField]: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(label, res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${label} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
