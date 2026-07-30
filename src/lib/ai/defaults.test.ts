import { describe, it, expect, afterEach, vi } from 'vitest'
import { aiReplyDebounceMs } from './defaults'

afterEach(() => vi.unstubAllEnvs())

describe('aiReplyDebounceMs', () => {
  it('defaults to 8000ms', () => {
    vi.stubEnv('AI_REPLY_DEBOUNCE_MS', '')
    expect(aiReplyDebounceMs()).toBe(8000)
  })

  it('honours a valid override', () => {
    vi.stubEnv('AI_REPLY_DEBOUNCE_MS', '3000')
    expect(aiReplyDebounceMs()).toBe(3000)
  })

  it('falls back to the default on a non-numeric value', () => {
    vi.stubEnv('AI_REPLY_DEBOUNCE_MS', 'abc')
    expect(aiReplyDebounceMs()).toBe(8000)
  })

  it('falls back to the default on a negative value', () => {
    vi.stubEnv('AI_REPLY_DEBOUNCE_MS', '-5')
    expect(aiReplyDebounceMs()).toBe(8000)
  })

  // 0 is a supported value, not a fallback trigger: it turns the wait off
  // without a code change, which is the documented rollback path.
  it('allows 0 to disable the wait', () => {
    vi.stubEnv('AI_REPLY_DEBOUNCE_MS', '0')
    expect(aiReplyDebounceMs()).toBe(0)
  })
})
