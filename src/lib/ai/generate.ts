import {
  AiError,
  HANDOFF_REASONS,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
  type HandoffReason,
  type HandoffRequest,
} from './types'
import { aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenRouter } from './providers/openrouter'
import { generateGemini } from './providers/gemini'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'openrouter':
      result = await generateOpenRouter(providerArgs)
      break
    case 'gemini':
      result = await generateGemini(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Matches the sentinel with or without a field list: `[[HANDOFF]]` and
 * `[[HANDOFF a=1 | b=2]]` both hit, and the fields land in group 1.
 *
 * Deliberately forgiving, because the alternative to a tolerant parser
 * isn't a stricter model — it's a complaint that never reaches a human
 * because of a stray space. It is NOT forgiving about the closing
 * `]]`: an unterminated marker is text the model was still writing when
 * the token cap cut it off, and reading that as a handoff would hand
 * over threads on truncation alone.
 */
const HANDOFF_PATTERN = /\[\[HANDOFF\b([^\]]*)\]\]/i

/** `si` / `no` as the model writes them, accents and case included. */
function parseCredito(value: string): boolean | null {
  const v = value.toLowerCase()
  if (v === 'si' || v === 'sí' || v === 'true') return true
  if (v === 'no' || v === 'false') return false
  return null
}

/** A declared value, or null when the model wrote `?` / left it empty. */
function fieldValue(raw: string | undefined): string | null {
  const v = raw?.trim() ?? ''
  return v === '' || v === '?' ? null : v
}

/**
 * Pull the declared fields out of a sentinel body. Unknown keys are
 * dropped rather than failing the parse: a model that adds `color=rojo`
 * has still told us everything the gate needs.
 */
function parseHandoffFields(body: string): HandoffRequest {
  const declared = new Map<string, string>()
  for (const part of body.split('|')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    declared.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim())
  }

  const motivo = (declared.get('motivo') ?? '').trim().toLowerCase()

  return {
    nombre: fieldValue(declared.get('nombre')),
    presupuesto: fieldValue(declared.get('presupuesto')),
    interes: fieldValue(declared.get('interes')),
    credito: parseCredito(declared.get('credito') ?? ''),
    // An invented reason degrades to `otro`, which is non-urgent. That
    // direction is the safe one: a made-up reason can't buy the model a
    // shortcut past the data gate.
    motivo: (HANDOFF_REASONS as readonly string[]).includes(motivo)
      ? (motivo as HandoffReason)
      : 'otro',
  }
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way the
 * marker is stripped from the text that goes to the customer, and what
 * the model declared inside it comes back as a `HandoffRequest`.
 *
 * A request is not a transfer — `evaluateHandoffGate` decides. `usage`
 * is passed straight through (null when the provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const match = raw.match(HANDOFF_PATTERN)
  const handoff = match ? parseHandoffFields(match[1] ?? '') : null
  const text = match ? raw.replace(HANDOFF_PATTERN, '').trim() : raw.trim()
  return { text, handoff, usage }
}
