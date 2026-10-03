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

// Traspaso para visitar el concesionario: el cliente tiene que saber por
// quién preguntar al llegar, con el nombre completo (así lo buscan en la
// recepción), y la invitación cierra el aviso.
describe('notifyCustomerOfHandoff — traspaso por visita', () => {
  const VISITA = { ...ARGS, agentFullName: 'Juan Arias', visit: true }

  it('con asesor: invita a acercarse y nombra al asesor completo, al final', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T10:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(
      'Te asignamos un asesor comercial que se comunicará contigo. 🙌 Te escribe en los próximos minutos. ' +
        'Ya puedes acercarte al concesionario y recuerda preguntar por tu asesor Juan Arias.',
    )
  })

  it('sin horario configurado: el aviso y la invitación, sin frase de tiempo', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(
      'Te asignamos un asesor comercial que se comunicará contigo. 🙌 ' +
        'Ya puedes acercarte al concesionario y recuerda preguntar por tu asesor Juan Arias.',
    )
  })

  it('sin asesor: el aviso anónimo de siempre, sin un nombre inventado', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff({ ...VISITA, agentName: null, agentFullName: null })
    expect(sent()).toBe('Te asignamos un asesor comercial que se comunicará contigo. 🙌')
  })

  it('otro motivo con asesor: el aviso de siempre, con el primer nombre y sin invitación', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff({ ...VISITA, visit: false })
    expect(sent()).toBe('Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Juan.')
  })
})

// Auditoría QA: la invitación de la visita compuesta con cada frase de
// horario. La hora en español termina en "a. m." y la plantilla pone su
// propio punto: no puede quedar "a. m.." ni espacios dobles en el medio.
//
// Fuera de horario el cierre cambia: "Ya puedes acercarte" justo después
// de "Te escribe mañana desde las 8:00 a. m." se contradecía (¿voy ya o
// espero?). Con el asesor para más tarde, la invitación queda para
// cuando el cliente venga, sin decirle que ya puede.
describe('notifyCustomerOfHandoff — visita con cada frase de horario', () => {
  const VISITA = { ...ARGS, agentFullName: 'Juan Arias', visit: true }
  const BASE = 'Te asignamos un asesor comercial que se comunicará contigo. 🙌'
  const CIERRE = 'Ya puedes acercarte al concesionario y recuerda preguntar por tu asesor Juan Arias.'
  const CIERRE_LUEGO = 'Cuando vengas al concesionario, recuerda preguntar por tu asesor Juan Arias.'

  it.each([
    ['madrugada (hoy)', '2026-09-08T06:00:00', 'Te escribe hoy desde las 8:00 a. m.'],
    ['de noche (mañana)', '2026-09-08T23:00:00', 'Te escribe mañana desde las 8:00 a. m.'],
    ['sábado por la tarde (día de semana)', '2026-09-12T15:00:00', 'Te escribe el lunes desde las 8:00 a. m.'],
  ])('%s: base, tiempo y cierre para después, sin doble punto ni espacios dobles', async (_caso, now, when) => {
    vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] })
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(`${BASE} ${when} ${CIERRE_LUEGO}`)
    expect(sent()).not.toContain('Ya puedes acercarte')
    expect(sent()).not.toMatch(/\.\.|\s{2}/)
  })

  it('en horario (en los próximos minutos): el cierre de siempre, "ya puedes acercarte"', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T10:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(`${BASE} Te escribe en los próximos minutos. ${CIERRE}`)
  })

  it('sin horario configurado: el cierre de siempre', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff(VISITA)
    expect(sent()).toBe(`${BASE} ${CIERRE}`)
  })

  it('fuera de horario con "$&" en el nombre: aparece literal en el cierre para después', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-08T23:00:00'), toFake: ['Date'] })
    await notifyCustomerOfHandoff({ ...VISITA, agentFullName: "Juan $& $` $' Arias" })
    expect(sent()).toBe(
      `${BASE} Te escribe mañana desde las 8:00 a. m. ` +
        "Cuando vengas al concesionario, recuerda preguntar por tu asesor Juan $& $` $' Arias.",
    )
  })

  it('nombre completo con espacios alrededor: se recorta', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff({ ...VISITA, agentFullName: '  Juan Arias  ' })
    expect(sent()).toBe(`${BASE} ${CIERRE}`)
  })

  // Auditoría QA: `replace` con un string interpreta $&, $` y $'
  // dentro del reemplazo; un nombre así no puede reescribir el aviso.
  it('nombre completo con "$&": aparece literal en el cierre', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff({ ...VISITA, agentFullName: "Juan $& $` $' Arias" })
    expect(sent()).toBe(
      `${BASE} Ya puedes acercarte al concesionario y recuerda preguntar por tu asesor Juan $& $\` $' Arias.`,
    )
  })

  it('primer nombre con "$&": aparece literal en el aviso con nombre', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    await notifyCustomerOfHandoff({ ...ARGS, agentName: 'Ju$&an' })
    expect(sent()).toBe('Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Ju$&an.')
  })

  it('nombre completo vacío o solo espacios: aviso anónimo, sin invitación', async () => {
    h.account = { ...LORAMOTORS, quiet_hours_enabled: false }
    // Así llega desde handOffToHuman: primerNombre('   ') es null.
    await notifyCustomerOfHandoff({ ...VISITA, agentName: null, agentFullName: '   ' })
    expect(sent()).toBe(BASE)
  })
})
