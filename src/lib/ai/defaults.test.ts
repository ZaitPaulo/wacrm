import { describe, it, expect, afterEach, vi } from 'vitest'
import { aiReplyDebounceMs, buildSystemPrompt } from './defaults'
import { HANDOFF_REASONS } from './types'

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

describe('buildSystemPrompt — handoff instructions', () => {
  it('teaches the field format and every valid reason in auto-reply mode', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })

    expect(prompt).toContain('[[HANDOFF nombre=')
    expect(prompt).toContain('presupuesto=')
    expect(prompt).toContain('interes=')
    expect(prompt).toContain('credito=')
    for (const reason of HANDOFF_REASONS) {
      expect(prompt).toContain(reason)
    }
  })

  it('tells the model to write ? rather than invent a field', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(prompt).toContain('Write ? for any field')
    expect(prompt).toMatch(/[Nn]ever guess one/)
  })

  // The old scaffold said "Prefer handing off over guessing", which is
  // part of why the model bailed out two turns into a sale.
  it('no longer nudges the model toward handing off', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(prompt).not.toContain('Prefer handing off')
  })

  it('spells out the urgent exception', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(prompt).toContain('motivo=reclamo')
    expect(prompt).toContain('motivo=pide_humano')
  })

  it('says nothing about handoffs in draft mode', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'draft' })
    expect(prompt).not.toContain('HANDOFF')
  })
})
