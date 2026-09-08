import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    embeddingsProvider: 'openai',
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: null,
      usage: null,
    })
  })

  it('parses a full sentinel and strips it from the text', () => {
    const raw =
      'Ya te paso con un asesor. [[HANDOFF nombre=Carlos | presupuesto=30000000 | interes=Kia Sportage 2019 | credito=si | motivo=credito]]'
    expect(parseGeneration(raw)).toEqual({
      text: 'Ya te paso con un asesor.',
      handoff: {
        nombre: 'Carlos',
        presupuesto: '30000000',
        interes: 'Kia Sportage 2019',
        credito: true,
        motivo: 'credito',
      },
      usage: null,
    })
  })

  // `?` is how the model says "I didn't get this". It has to survive as
  // null and never as the literal string, because the gate counts nulls.
  it('reads ? as a missing field', () => {
    const { handoff } = parseGeneration(
      '[[HANDOFF nombre=Ana | presupuesto=? | interes=? | credito=no | motivo=visita]]',
    )
    expect(handoff).toEqual({
      nombre: 'Ana',
      presupuesto: null,
      interes: null,
      credito: false,
      motivo: 'visita',
    })
  })

  it('accepts fields in any order, with sloppy spacing', () => {
    const { handoff } = parseGeneration(
      '[[HANDOFF   motivo=permuta|nombre=Luis   |credito=?|  interes=camioneta | presupuesto=80 millones  ]]',
    )
    expect(handoff).toEqual({
      nombre: 'Luis',
      presupuesto: '80 millones',
      interes: 'camioneta',
      credito: null,
      motivo: 'permuta',
    })
  })

  // The bare marker is what a model trained on the old prompt emits, and
  // what one that forgets the format falls back to. It must parse as a
  // request with nothing in it — the gate refuses that on its own.
  it('parses a bare sentinel as a request with every field missing', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: {
        nombre: null,
        presupuesto: null,
        interes: null,
        credito: null,
        motivo: 'otro',
      },
      usage: null,
    })
  })

  it('falls back to otro for a reason it does not know', () => {
    const { handoff } = parseGeneration('[[HANDOFF nombre=Ana | motivo=el cliente quiere rebaja]]')
    expect(handoff?.motivo).toBe('otro')
    expect(handoff?.nombre).toBe('Ana')
  })

  it('ignores junk fields instead of failing the whole parse', () => {
    const { handoff } = parseGeneration(
      '[[HANDOFF nombre=Ana | color=rojo | presupuesto=50000000 | motivo=reclamo]]',
    )
    expect(handoff?.nombre).toBe('Ana')
    expect(handoff?.presupuesto).toBe('50000000')
    expect(handoff?.motivo).toBe('reclamo')
  })

  it('treats an unterminated sentinel as plain text, not a handoff', () => {
    expect(parseGeneration('Te paso con alguien [[HANDOFF nombre=Ana')).toEqual({
      text: 'Te paso con alguien [[HANDOFF nombre=Ana',
      handoff: null,
      usage: null,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: null,
      usage,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: null,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: null,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          content: [
            {
              type: 'text',
              text: '[[HANDOFF nombre=Ana | presupuesto=? | interes=? | credito=? | motivo=pide_humano]]',
            },
          ],
        }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toMatchObject({ nombre: 'Ana', motivo: 'pide_humano' })
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})

describe('generateReply — OpenRouter', () => {
  it('calls the OpenRouter endpoint with the bearer key and parses the completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Claro, con gusto.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({
        provider: 'openrouter',
        apiKey: 'sk-or-v1-x',
        model: 'google/gemini-2.5-flash',
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hola' }],
    })

    expect(res).toEqual({
      text: 'Claro, con gusto.',
      handoff: null,
      usage: { promptTokens: 11, completionTokens: 4, totalTokens: 15 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('openrouter.ai')
    expect(opts.headers.Authorization).toBe('Bearer sk-or-v1-x')
    // The namespaced id must reach the wire untouched.
    expect(JSON.parse(opts.body).model).toBe('google/gemini-2.5-flash')
  })

  it('sends attribution headers only when the site URL is configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    await generateReply({
      config: config({ provider: 'openrouter' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(fetchMock.mock.calls[0][1].headers['HTTP-Referer']).toBeUndefined()

    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/')
    await generateReply({
      config: config({ provider: 'openrouter' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    // Trailing slash trimmed.
    expect(fetchMock.mock.calls[1][1].headers['HTTP-Referer']).toBe(
      'https://crm.example.com',
    )
  })

  it('maps a 401 to an invalid_key AiError naming OpenRouter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errResponse(401, { error: { message: 'No auth' } })),
    )
    await expect(
      generateReply({
        config: config({ provider: 'openrouter' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })
})

describe('generateReply — Gemini', () => {
  it('calls the OpenAI-compatible endpoint and parses the completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Hola!' } }],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({
        provider: 'gemini',
        apiKey: 'AIza-x',
        model: 'gemini-2.5-flash',
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hola' }],
    })

    expect(res.text).toBe('Hola!')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(opts.headers.Authorization).toBe('Bearer AIza-x')
  })

  it('caps output with max_tokens, the only name Gemini honours', async () => {
    // Gemini's compatibility layer silently ignores parameters it does
    // not recognise, so sending OpenAI's `max_completion_tokens` here
    // would uncap spend on the account's key instead of erroring.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'gemini' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.max_completion_tokens).toBeUndefined()
  })
})

describe('generateReply — unsupported provider', () => {
  it('rejects a provider with no adapter instead of calling out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateReply({
        // Simulates a row written by a newer deployment than this code.
        config: config({ provider: 'mistral' as never }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported_provider', status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
