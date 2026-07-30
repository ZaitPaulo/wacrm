import { type ProviderResult } from '../types'
import { generateOpenAiCompatible } from './openai-compatible'
import { type ProviderArgs } from './shared'

// Google exposes an OpenAI-compatible surface alongside the native
// `generativelanguage` API, which lets Gemini reuse the shared adapter
// instead of needing its own wire format. It's the documented
// integration path for OpenAI-shaped clients.
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

/**
 * Call Gemini through its OpenAI-compatible endpoint with the caller's
 * own AI Studio key. `model` is a bare Gemini id (`gemini-2.5-flash`),
 * no vendor prefix — that form belongs to OpenRouter.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  return generateOpenAiCompatible(args, {
    url: GEMINI_URL,
    label: 'Gemini',
    // The compatibility layer maps `max_tokens`; unrecognised params are
    // silently dropped, so sending OpenAI's newer name would uncap the
    // response length instead of erroring.
    maxTokensField: 'max_tokens',
  })
}
