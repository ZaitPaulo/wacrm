import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  engineSendText: vi.fn(),
  account: null as Record<string, unknown> | null,
  accountError: null as { message: string } | null,
}))

vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: h.account, error: h.accountError }),
    }
    return { from: () => chain }
  },
}))

import { handoffWhenSentence, notifyCustomerOfHandoff } from './notify-customer'

const ARGS = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  agentName: 'Juan',
}

const LORAMOTORS = {
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
}

const sent = () => h.engineSendText.mock.calls[0][0].text as string

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'es')
  h.engineSendText.mockReset().mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.account = LORAMOTORS
  h.accountError = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('notifyCustomerOfHandoff — cuándo lo contactan', () => {
  it('en horario: nombra al asesor y dice que escribe en minutos', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T10:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff(ARGS)
    expect(sent()).toBe(
      'Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Juan. Te escribe en los próximos minutos.',
    )
  })

  it('de noche: mañana desde la hora de apertura', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T23:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff(ARGS)
    expect(sent().endsWith('Te escribe mañana desde las 8:00 a. m.')).toBe(true)
  })

  it('sábado por la tarde: el lunes', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-12T15:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff(ARGS)
    expect(sent().endsWith('Te escribe el lunes desde las 8:00 a. m.')).toBe(true)
  })

  it('sin horario configurado: el aviso de siempre', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff(ARGS)
    expect(sent()).toBe('Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Juan.')
  })

  it('si no se puede leer el horario, el aviso sale igual, sin tiempo', async () => {
    h.accountError = { message: 'db down' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await notifyCustomerOfHandoff(ARGS)
    expect(sent()).toBe('Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Juan.')
  })

  it('sin asesor: la forma anónima, también con el tiempo', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T23:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff({ ...ARGS, agentName: null })
    expect(sent()).toMatch(/^Te asignamos un asesor comercial que se comunicará contigo. 🙌 Te escribe mañana/)
  })
})

describe('handoffWhenSentence', () => {
  it('da solo la frase de tiempo', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T23:00:00'), toFake: ['Date'] })
    expect(await handoffWhenSentence('acct-1')).toBe('Te escribe mañana desde las 8:00 a. m.')
  })

  it('sin horario: null', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    expect(await handoffWhenSentence('acct-1')).toBeNull()
  })
})
