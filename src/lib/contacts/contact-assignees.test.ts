import { describe, it, expect } from 'vitest'
import { assigneesByContact } from './contact-assignees'

const conv = (
  contact_id: string,
  assigned_agent_id: string | null,
  last_message_at: string | null,
) => ({ contact_id, assigned_agent_id, last_message_at })

describe('assigneesByContact', () => {
  it('da el asesor de la conversación del contacto', () => {
    const m = assigneesByContact([conv('c1', 'u-brayan', '2026-09-18T10:00:00Z')])
    expect(m.get('c1')).toEqual({ hasConversation: true, agentIds: ['u-brayan'] })
  })

  it('marca como sin asignar al contacto con conversación pero sin asesor', () => {
    const m = assigneesByContact([conv('c1', null, '2026-09-18T10:00:00Z')])
    expect(m.get('c1')).toEqual({ hasConversation: true, agentIds: [] })
  })

  it('no trae entrada para un contacto sin conversaciones', () => {
    expect(assigneesByContact([]).get('c1')).toBeUndefined()
  })

  // Un contacto puede tener una conversación por canal.
  it('junta los asesores de varios canales, el más reciente primero y sin repetir', () => {
    const m = assigneesByContact([
      conv('c1', 'u-juan', '2026-09-10T10:00:00Z'),
      conv('c1', 'u-brayan', '2026-09-18T10:00:00Z'),
      conv('c1', 'u-juan', '2026-09-12T10:00:00Z'),
      conv('c1', null, '2026-09-17T10:00:00Z'),
    ])
    expect(m.get('c1')?.agentIds).toEqual(['u-brayan', 'u-juan'])
  })

  it('una conversación sin mensajes va al final', () => {
    const m = assigneesByContact([
      conv('c1', 'u-juan', null),
      conv('c1', 'u-brayan', '2026-09-18T10:00:00Z'),
    ])
    expect(m.get('c1')?.agentIds).toEqual(['u-brayan', 'u-juan'])
  })

  it('separa los contactos', () => {
    const m = assigneesByContact([
      conv('c1', 'u-juan', '2026-09-18T10:00:00Z'),
      conv('c2', 'u-brayan', '2026-09-18T10:00:00Z'),
    ])
    expect(m.get('c1')?.agentIds).toEqual(['u-juan'])
    expect(m.get('c2')?.agentIds).toEqual(['u-brayan'])
  })
})
