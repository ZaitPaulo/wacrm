import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Auditoría QA: el cierre de la visita depende de qué claves trae el
// catálogo de la instalación. Una instalación con el catálogo viejo (sin
// `customerVisitClosingLater`) no puede perder la invitación, y los
// catálogos en/ko también tienen que componer bien con la frase de tiempo.

const h = vi.hoisted(() => ({
  engineSendText: vi.fn(),
  /** Si no es null, reemplaza la sección `Handoff` del catálogo real. */
  handoffOverride: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            quiet_hours_enabled: true,
            business_hours: {
              sun: null,
              mon: ['08:00', '18:00'],
              tue: ['08:00', '18:00'],
              wed: ['08:00', '18:00'],
              thu: ['08:00', '18:00'],
              fri: ['08:00', '18:00'],
              sat: ['08:00', '14:00'],
            },
            holiday_calendar: 'CO',
          },
          error: null,
        }),
    }
    return { from: () => chain }
  },
}))
vi.mock('@/lib/i18n/server-catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/i18n/server-catalog')>()
  return {
    ...real,
    loadCatalogSection: async (section: string) => {
      const value = await real.loadCatalogSection(section)
      return section === 'Handoff' && h.handoffOverride ? h.handoffOverride : value
    },
  }
})

import es from '../../../messages/es.json'
import { notifyCustomerOfHandoff } from './notify-customer'

const VISITA = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  agentName: 'Juan',
  agentFullName: 'Juan Arias',
  visit: true,
}

const NOCHE = '2026-09-08T23:00:00' // fuera de horario: "mañana"
const EN_HORARIO = '2026-09-08T10:00:00' // "en los próximos minutos"

/** Copia de la sección sin las claves dadas (un catálogo más viejo). */
function without(section: Record<string, unknown>, ...keys: string[]) {
  return Object.fromEntries(Object.entries(section).filter(([k]) => !keys.includes(k)))
}

const sent = () => h.engineSendText.mock.calls[0][0].text as string

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'es')
  h.engineSendText.mockReset().mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.handoffOverride = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('notifyCustomerOfHandoff — catálogo sin la clave nueva', () => {
  it('fuera de horario y sin `customerVisitClosingLater`: cae al cierre de siempre', async () => {
    h.handoffOverride = without(es.Handoff, 'customerVisitClosingLater')
    vi.useFakeTimers({ now: new Date(NOCHE), toFake: ['Date'] })
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(
      'Te asignamos un asesor comercial que se comunicará contigo. 🙌 ' +
        'Te escribe mañana desde las 8:00 a. m. ' +
        'Ya puedes acercarte al concesionario y recuerda preguntar por tu asesor Juan Arias.',
    )
  })

  it('sin ninguna clave de cierre: el aviso con el primer nombre, sin invitación', async () => {
    h.handoffOverride = without(es.Handoff, 'customerVisitClosingLater', 'customerVisitClosing')
    vi.useFakeTimers({ now: new Date(NOCHE), toFake: ['Date'] })
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(
      'Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Juan. ' +
        'Te escribe mañana desde las 8:00 a. m.',
    )
  })
})

describe.each(['en', 'ko'])('notifyCustomerOfHandoff — visita en el catálogo %s', (locale) => {
  it.each([
    ['fuera de horario', NOCHE, 'customerVisitClosingLater'],
    ['en horario', EN_HORARIO, 'customerVisitClosing'],
  ] as const)('%s: cierra con su clave, nombre completo y sin dobles', async (_caso, now, key) => {
    vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', locale)
    const catalog = (await import(`../../../messages/${locale}.json`)).default as {
      Handoff: Record<string, string>
    }
    vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] })
    await notifyCustomerOfHandoff(VISITA)
    const text = sent()
    expect(text.startsWith(catalog.Handoff.customerNotice)).toBe(true)
    expect(text.endsWith(catalog.Handoff[key].replace('{name}', 'Juan Arias'))).toBe(true)
    expect(text).not.toMatch(/\.\.|\s{2}/)
  })
})
