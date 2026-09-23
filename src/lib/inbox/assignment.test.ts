import { describe, it, expect } from 'vitest'
import {
  administra,
  destinatarioValido,
  esDevolucionAlBot,
  escribeConServiceRole,
  puedeCambiarAsignacion,
  puedeDejarSinAsignar,
} from './assignment'

describe('administra', () => {
  it('owner y admin administran; agent y viewer no', () => {
    expect(administra('owner')).toBe(true)
    expect(administra('admin')).toBe(true)
    expect(administra('agent')).toBe(false)
    expect(administra('viewer')).toBe(false)
  })
})

describe('puedeCambiarAsignacion', () => {
  it('el asesor manda sobre el hilo que tiene asignado', () => {
    expect(
      puedeCambiarAsignacion({
        role: 'agent',
        userId: 'u-juan',
        currentAssigneeId: 'u-juan',
      }),
    ).toBe(true)
  })

  // Es la cartera del compañero: la 520 la esconde en la bandeja y acá no
  // se puede abrir por la puerta de atrás.
  it('el asesor NO manda sobre el hilo de otro', () => {
    expect(
      puedeCambiarAsignacion({
        role: 'agent',
        userId: 'u-juan',
        currentAssigneeId: 'u-brayan',
      }),
    ).toBe(false)
  })

  // Lo no asignado es responsabilidad del admin, que lo reparte a mano.
  // Que un asesor no pueda tomarlo es la regla de la 520, no un olvido.
  it('el asesor NO puede tomar un hilo sin asignar', () => {
    expect(
      puedeCambiarAsignacion({
        role: 'agent',
        userId: 'u-juan',
        currentAssigneeId: null,
      }),
    ).toBe(false)
  })

  it('admin y owner mandan sobre cualquiera, asignado o no', () => {
    for (const role of ['admin', 'owner'] as const) {
      expect(
        puedeCambiarAsignacion({ role, userId: 'u-x', currentAssigneeId: null }),
      ).toBe(true)
      expect(
        puedeCambiarAsignacion({ role, userId: 'u-x', currentAssigneeId: 'u-juan' }),
      ).toBe(true)
    }
  })

  // `viewer` es supervisión de solo lectura: ve la cartera entera y no
  // toca nada. Si esto devolviera true, un supervisor podría reasignar.
  it('viewer no pasa nunca, ni sobre lo suyo', () => {
    expect(
      puedeCambiarAsignacion({
        role: 'viewer',
        userId: 'u-v',
        currentAssigneeId: 'u-v',
      }),
    ).toBe(false)
  })
})

describe('puedeDejarSinAsignar', () => {
  // La regla del trigger de la 520, reescrita para el camino de
  // service-role: pasar sí, soltar no.
  it('el asesor no puede soltar el hilo', () => {
    expect(puedeDejarSinAsignar({ role: 'agent', devolverAlBot: false })).toBe(false)
  })

  // La excepción de devolución al bot: el cliente no queda sin nadie,
  // queda con el bot, que lo atiende y lo vuelve a traspasar si hace falta.
  it('el asesor sí puede devolvérselo al bot', () => {
    expect(puedeDejarSinAsignar({ role: 'agent', devolverAlBot: true })).toBe(true)
  })

  it('admin y owner pueden soltar sin excepción que invocar', () => {
    expect(puedeDejarSinAsignar({ role: 'admin', devolverAlBot: false })).toBe(true)
    expect(puedeDejarSinAsignar({ role: 'owner', devolverAlBot: false })).toBe(true)
  })
})

describe('esDevolucionAlBot', () => {
  // La condición mira la TRANSICIÓN: solo es devolver al bot la
  // operación que reactiva una IA que estaba pausada.
  it('reactivar una IA pausada es devolver el hilo al bot', () => {
    expect(esDevolucionAlBot({ iaPausadaAntes: true, iaPausadaDespues: false })).toBe(true)
  })

  // El defecto que QA encontró: con la IA ya activa, `paused: false`
  // solo quita el asesor. Eso es soltar el hilo, no devolverlo.
  it('con la IA ya activa no hay nada que devolver: es soltar', () => {
    expect(esDevolucionAlBot({ iaPausadaAntes: false, iaPausadaDespues: false })).toBe(false)
  })

  it('pausar nunca es devolver al bot', () => {
    expect(esDevolucionAlBot({ iaPausadaAntes: true, iaPausadaDespues: true })).toBe(false)
    expect(esDevolucionAlBot({ iaPausadaAntes: false, iaPausadaDespues: true })).toBe(false)
  })

  // Ante la duda, del lado seguro: un estado previo desconocido no se
  // toma por pausado.
  it('un estado previo desconocido no cuenta como pausado', () => {
    expect(esDevolucionAlBot({ iaPausadaAntes: null, iaPausadaDespues: false })).toBe(false)
  })

  it('combinada con puedeDejarSinAsignar: el asesor solo suelta al reactivar', () => {
    const suelta = (iaPausadaAntes: boolean) =>
      puedeDejarSinAsignar({
        role: 'agent',
        devolverAlBot: esDevolucionAlBot({ iaPausadaAntes, iaPausadaDespues: false }),
      })
    expect(suelta(true)).toBe(true)
    expect(suelta(false)).toBe(false)
  })
})

describe('escribeConServiceRole', () => {
  // La pregunta real es si la fila resultante le sigue siendo visible a
  // quien escribe. Al soltar o al pasar el hilo, un `agent` se lo deja
  // invisible a sí mismo y la RLS aborta.
  it('el asesor necesita service-role para soltar o para pasar el hilo', () => {
    expect(
      escribeConServiceRole({ role: 'agent', userId: 'u-juan', nuevoAsignado: null }),
    ).toBe(true)
    expect(
      escribeConServiceRole({
        role: 'agent',
        userId: 'u-juan',
        nuevoAsignado: 'u-brayan',
      }),
    ).toBe(true)
  })

  // Tomar el hilo para sí no lo esconde: ahí la sesión basta, y se
  // conserva la RLS como segunda barrera.
  it('el asesor que se queda el hilo escribe con su sesión', () => {
    expect(
      escribeConServiceRole({
        role: 'agent',
        userId: 'u-juan',
        nuevoAsignado: 'u-juan',
      }),
    ).toBe(false)
  })

  // LA RAZÓN DE QUE ESTA FUNCIÓN EXISTA en vez de usar service-role
  // siempre: `notify_conversation_assigned` nombra a quien reasignó
  // leyendo `auth.uid()`, que con service-role es NULL. Un admin
  // reasignando por su sesión produce "Angélica te asignó…"; por
  // service-role produciría "Se te asignó…", perdiendo información que
  // los admin tienen hoy.
  it('admin y owner escriben siempre con su sesión, para conservar el actor del aviso', () => {
    for (const role of ['admin', 'owner'] as const) {
      expect(escribeConServiceRole({ role, userId: 'u-x', nuevoAsignado: null })).toBe(
        false,
      )
      expect(
        escribeConServiceRole({ role, userId: 'u-x', nuevoAsignado: 'u-juan' }),
      ).toBe(false)
      expect(escribeConServiceRole({ role, userId: 'u-x', nuevoAsignado: 'u-x' })).toBe(
        false,
      )
    }
  })

  // No llega hasta acá —`puedeCambiarAsignacion` lo rechaza antes— pero
  // si llegara se trata como un agent, que es el lado seguro.
  it('viewer cae del lado seguro', () => {
    expect(
      escribeConServiceRole({ role: 'viewer', userId: 'u-v', nuevoAsignado: null }),
    ).toBe(true)
  })
})

describe('destinatarioValido', () => {
  const miembros = ['u-juan', 'u-brayan', 'u-ange']

  it('acepta a un miembro de la cuenta', () => {
    expect(destinatarioValido({ targetUserId: 'u-brayan', miembros })).toBe(true)
  })

  // `conversations.assigned_agent_id` NO tiene clave ajena. Sin esta
  // comprobación, y con la RLS apagada por el service-role, un asesor
  // podría asignarle la conversación a un UUID cualquiera y el hilo
  // quedaría a nombre de nadie sin que la base dijera una palabra.
  it('rechaza a quien no es miembro', () => {
    expect(destinatarioValido({ targetUserId: 'u-de-otra-cuenta', miembros })).toBe(
      false,
    )
    expect(
      destinatarioValido({
        targetUserId: '00000000-0000-0000-0000-000000000000',
        miembros,
      }),
    ).toBe(false)
  })

  // Soltar es válido como destino; QUIÉN puede hacerlo lo decide
  // `puedeDejarSinAsignar`, que es otra pregunta.
  it('null es un destino válido: la decisión es de otra función', () => {
    expect(destinatarioValido({ targetUserId: null, miembros })).toBe(true)
    expect(destinatarioValido({ targetUserId: null, miembros: [] })).toBe(true)
  })

  it('una cuenta sin miembros no acepta a nadie', () => {
    expect(destinatarioValido({ targetUserId: 'u-juan', miembros: [] })).toBe(false)
  })
})
