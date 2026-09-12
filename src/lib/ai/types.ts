import type { EmbeddingsProvider } from './embeddings'

// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// which vendor the account is on.
// ============================================================

/**
 * Vendors an account can point its own key at. `openrouter` is a broker
 * that fronts hundreds of third-party models behind one key, so picking
 * it makes `model` a namespaced id (`google/gemini-2.5-flash`); the rest
 * take that vendor's own bare model names.
 *
 * Persisted as text in `ai_configs.provider` / `ai_usage_log.provider`
 * — adding a value here needs a migration to widen their CHECK.
 */
export type AiProvider = 'openai' | 'anthropic' | 'openrouter' | 'gemini'

/** Every provider, in the order the settings picker lists them. Single
 *  source of truth for runtime validation of untrusted input. */
export const AI_PROVIDERS: readonly AiProvider[] = [
  'openai',
  'anthropic',
  'openrouter',
  'gemini',
] as const

/** Type guard for request bodies / DB rows carrying an unvalidated provider. */
export function isAiProvider(value: unknown): value is AiProvider {
  return (
    typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
  )
}

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Clave para embeddings. Con ella el knowledge base se embebe y la
   *  recuperacion semantica se enciende; sin ella se cae a busqueda
   *  lexica. Con proveedor Gemini vale la misma clave del chat, asi que
   *  no hay que configurar nada aparte. */
  embeddingsApiKey: string | null
  /** Quien embebe. Se deriva del proveedor de la cuenta y no se
   *  configura: Gemini embebe con Gemini, todo lo demas con OpenAI. */
  embeddingsProvider: EmbeddingsProvider
}

/** A photo attached to a turn, already downloaded and reduced
 *  (see `photos.ts`). */
export interface ChatImage {
  mimeType: string
  /** The bytes in base64, without a `data:` prefix. */
  base64: string
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Fotos del turno. Solo las leen los adaptadores de proveedor; todo
   *  lo demas —resumen del traspaso, busqueda en el knowledge base— lee
   *  `content` y no tiene por que enterarse de que existen. */
  images?: ChatImage[]
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/**
 * Why the model wants a human on the thread. Declared by the model in
 * the handoff sentinel; anything it makes up falls back to `otro`.
 *
 * Two of these are urgent, and urgency is the whole reason this is an
 * enum instead of free text: a customer who is complaining or who
 * asked for a person outright must not be held back while the bot
 * collects sales data.
 */
export type HandoffReason =
  | 'reclamo'
  | 'pide_humano'
  | 'negociacion'
  | 'permuta'
  | 'credito'
  | 'visita'
  | 'papeles'
  | 'otro'

/** Every reason the parser accepts. Single source of truth for both the
 *  prompt instructions and the runtime validation of model output. */
export const HANDOFF_REASONS: readonly HandoffReason[] = [
  'reclamo',
  'pide_humano',
  'negociacion',
  'permuta',
  'credito',
  'visita',
  'papeles',
  'otro',
] as const

/** Reasons that skip the full data gate: only the name is required, and
 *  even that gives way on the second attempt. */
export const URGENT_HANDOFF_REASONS: readonly HandoffReason[] = [
  'reclamo',
  'pide_humano',
] as const

/** True when the reason means "a human is needed now", not "a human is
 *  needed to close this sale". */
export function isUrgentHandoff(reason: HandoffReason): boolean {
  return (URGENT_HANDOFF_REASONS as readonly string[]).includes(reason)
}

/**
 * What the model declares when it asks to hand the thread to an agent.
 *
 * Every field is what the model says it collected, NOT verified fact —
 * the gate checks that the data is *there*, not that it's true. A field
 * the model couldn't get is null (it writes `?` in the sentinel), which
 * is the difference between "no budget given" and a made-up number.
 */
export interface HandoffRequest {
  /** What the customer is called. WhatsApp's profile name doesn't count
   *  — the model must have it from the conversation. */
  nombre: string | null
  /** Budget as the customer expressed it ("30 millones", "30000000").
   *  Kept verbatim: normalizing it is reporting work, not gate work. */
  presupuesto: string | null
  /** Which vehicle, or at least which kind, the customer is after. */
  interes: string | null
  /** Whether they need financing. Null when the model didn't ask. */
  credito: boolean | null
  motivo: HandoffReason
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /**
   * The handoff the model asked for, or null when it didn't ask.
   *
   * Non-null is a *request*, never a decision: `evaluateHandoffGate`
   * decides whether it goes through. A bare `[[HANDOFF]]` parses to a
   * request with every field null, which is exactly a request that
   * can't be granted.
   */
  handoff: HandoffRequest | null
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
