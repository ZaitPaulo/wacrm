import { APP_NAME } from '@/lib/brand'
import { type ProviderResult } from '../types'
import { generateOpenAiCompatible } from './openai-compatible'
import { type ProviderArgs } from './shared'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Optional attribution headers. OpenRouter uses them only to credit the
 * calling app on its public leaderboards — they don't affect auth or
 * routing, so they're sent when `NEXT_PUBLIC_SITE_URL` is configured and
 * quietly skipped otherwise. Read from the env (not `getBaseUrl()`) on
 * purpose: this adapter also runs from the auto-reply path, outside any
 * request scope where `next/headers` would be available.
 */
function attributionHeaders(): Record<string, string> {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  return site ? { 'HTTP-Referer': site, 'X-Title': APP_NAME } : {}
}

/**
 * Call OpenRouter's Chat Completions endpoint with the caller's own key.
 * OpenRouter proxies hundreds of models behind one OpenAI-compatible
 * schema, so `model` here is a namespaced id (`google/gemini-2.5-flash`,
 * `meta-llama/llama-4-70b-instruct`, …) rather than a bare model name.
 */
export async function generateOpenRouter(args: ProviderArgs): Promise<ProviderResult> {
  return generateOpenAiCompatible(args, {
    url: OPENROUTER_URL,
    label: 'OpenRouter',
    // OpenRouter documents max_tokens and max_completion_tokens as
    // equivalent; we send the newer name for consistency with OpenAI.
    maxTokensField: 'max_completion_tokens',
    headers: attributionHeaders(),
  })
}
