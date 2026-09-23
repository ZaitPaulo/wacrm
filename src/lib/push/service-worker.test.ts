import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// Se prueba el archivo REAL que sirve el navegador (`public/sw.js`),
// ejecutado en un contexto aislado con `self`, `clients` y
// `registration` falsos. Así no hay una copia "testeable" que pueda
// divergir del service worker de verdad.
const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

interface FakeClient {
  url: string
  visibilityState: 'visible' | 'hidden'
  focus: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

function client(url: string, visibilityState: 'visible' | 'hidden' = 'hidden'): FakeClient {
  const c: FakeClient = {
    url: `https://crm.example${url}`,
    visibilityState,
    focus: vi.fn(async () => c),
    postMessage: vi.fn(),
  }
  return c
}

function load(opts: { ua?: string; windows?: FakeClient[] } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const showNotification = vi.fn(async () => {})
  const openWindow = vi.fn(async () => null)
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn
    },
    skipWaiting: vi.fn(),
    navigator: { userAgent: opts.ua ?? CHROME_ANDROID },
    location: { origin: 'https://crm.example' },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => opts.windows ?? []),
      openWindow,
      claim: vi.fn(async () => {}),
    },
  }
  vm.runInNewContext(SOURCE, { self, URL, console })
  return { handlers, showNotification, openWindow, self }
}

async function push(h: ReturnType<typeof load>, data: unknown) {
  let done: Promise<unknown> = Promise.resolve()
  h.handlers.push({
    data: { json: () => data, text: () => JSON.stringify(data) },
    waitUntil: (p: Promise<unknown>) => {
      done = p
    },
  })
  await done
}

async function click(h: ReturnType<typeof load>, data: unknown) {
  let done: Promise<unknown> = Promise.resolve()
  const close = vi.fn()
  h.handlers.notificationclick({
    notification: { data, close },
    waitUntil: (p: Promise<unknown>) => {
      done = p
    },
  })
  await done
  return close
}

const PAYLOAD = {
  title: 'Mensaje de Juan',
  body: 'Hola',
  tag: 'conversation-abc',
  renotify: true,
  url: '/inbox?c=abc',
  notificationId: 'n1',
  type: 'new_message',
  test: false,
}

describe('sw.js — push', () => {
  it('con el CRM cerrado muestra el aviso con tag, renotify y la URL', async () => {
    const h = load()
    await push(h, PAYLOAD)
    expect(h.showNotification).toHaveBeenCalledTimes(1)
    const [title, options] = h.showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(title).toBe('Mensaje de Juan')
    expect(options).toMatchObject({
      body: 'Hola',
      tag: 'conversation-abc',
      renotify: true,
      data: { url: '/inbox?c=abc' },
    })
  })

  it('con una pestaña del CRM visible en Chrome no duplica el aviso', async () => {
    const h = load({ windows: [client('/inbox', 'visible')] })
    await push(h, PAYLOAD)
    expect(h.showNotification).not.toHaveBeenCalled()
  })

  it('con la pestaña oculta sí lo muestra', async () => {
    const h = load({ windows: [client('/inbox', 'hidden')] })
    await push(h, PAYLOAD)
    expect(h.showNotification).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['iPhone', IPHONE],
    ['Safari de Mac', SAFARI_MAC],
  ])('en %s lo muestra siempre (Apple revoca la suscripción si no)', async (_n, ua) => {
    const h = load({ ua, windows: [client('/inbox', 'visible')] })
    await push(h, PAYLOAD)
    expect(h.showNotification).toHaveBeenCalledTimes(1)
  })

  it('el aviso de prueba se muestra aunque la pestaña esté visible', async () => {
    const h = load({ windows: [client('/notifications', 'visible')] })
    await push(h, { ...PAYLOAD, test: true, tag: 'push-test' })
    expect(h.showNotification).toHaveBeenCalledTimes(1)
  })

  it('un payload ilegible igual muestra algo (Chrome exige un aviso por push)', async () => {
    const h = load()
    let done: Promise<unknown> = Promise.resolve()
    h.handlers.push({
      data: {
        json: () => {
          throw new Error('no json')
        },
        text: () => 'texto plano',
      },
      waitUntil: (p: Promise<unknown>) => {
        done = p
      },
    })
    await done
    expect(h.showNotification).toHaveBeenCalledTimes(1)
  })
})

describe('sw.js — notificationclick', () => {
  it('enfoca la pestaña del CRM abierta y le pide navegar, sin abrir otra', async () => {
    const tab = client('/dashboard')
    const h = load({ windows: [tab] })
    const close = await click(h, { url: '/inbox?c=abc' })
    expect(close).toHaveBeenCalled()
    expect(tab.focus).toHaveBeenCalled()
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '/inbox?c=abc' })
    expect(h.openWindow).not.toHaveBeenCalled()
  })

  it('sin pestaña del CRM abre una nueva en la conversación', async () => {
    const h = load({ windows: [client('/autos/mazda-3')] })
    await click(h, { url: '/inbox?c=abc' })
    expect(h.openWindow).toHaveBeenCalledWith('https://crm.example/inbox?c=abc')
  })

  it('ignora URLs de otro origen', async () => {
    const h = load()
    await click(h, { url: 'https://evil.example/phish' })
    expect(h.openWindow).toHaveBeenCalledWith('https://crm.example/inbox')
  })
})
