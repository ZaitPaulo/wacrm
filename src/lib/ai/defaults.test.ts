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

describe('buildSystemPrompt — inventario', () => {
  const index = {
    text: 'ABC · RENAULT SANDERO GT 2010 · $22M · 179k kms · mecánica · hatchback',
    total: 1,
    truncated: false,
  }

  it('mete el índice y declara que está completo', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', inventory: index })
    expect(prompt).toContain('RENAULT SANDERO GT 2010')
    expect(prompt).toContain('COMPLETE list')
  })

  // Lo que arregla el caso real: el bot dijo "no queda nada en 25
  // millones" teniendo un Sandero de 22. Sin este permiso explícito
  // seguiría sin saber si puede fiarse de lo que ve.
  it('le permite afirmar que algo no hay, pero solo mirando la lista', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', inventory: index })
    expect(prompt).toMatch(/Never claim a vehicle or a price range does not exist/)
  })

  it('avisa cuando la lista viene recortada y retira ese permiso', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      inventory: { text: 'A · KIA PICANTO 2016 · $33M', total: 900, truncated: true },
    })
    expect(prompt).toContain('PARTIAL list')
    expect(prompt).toContain('900 vehicles are available')
    expect(prompt).not.toContain('COMPLETE list')
  })

  it('no cambia nada cuando no hay inventario', () => {
    const conIndice = buildSystemPrompt({ userPrompt: null, mode: 'draft', inventory: null })
    const sinNada = buildSystemPrompt({ userPrompt: null, mode: 'draft' })
    expect(conIndice).toBe(sinNada)
    expect(sinNada).not.toContain('Current inventory')
  })

  it('también llega en modo borrador', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'draft', inventory: index })
    expect(prompt).toContain('Current inventory')
  })
})
