import { describe, expect, it } from 'vitest';

import { agendaAgents } from './agents';

const PERFILES = [
  { user_id: 'owner-1', full_name: 'Zait Paulo', account_role: 'owner' as const },
  { user_id: 'admin-1', full_name: 'Angélica', account_role: 'admin' as const },
  { user_id: 'agent-1', full_name: 'Juan', account_role: 'agent' as const },
  { user_id: 'viewer-1', full_name: 'Visor', account_role: 'viewer' as const },
];

describe('agendaAgents', () => {
  // El owner administra el CRM, no atiende visitas (2026-10-09).
  it('deja fuera al owner y a los viewer', () => {
    const ids = agendaAgents(PERFILES, { userId: 'admin-1', role: 'admin' }).map((a) => a.userId);
    expect(ids).toEqual(['admin-1', 'agent-1']);
  });

  it('tampoco lo muestra cuando quien mira es el propio owner', () => {
    const ids = agendaAgents(PERFILES, { userId: 'owner-1', role: 'owner' }).map((a) => a.userId);
    expect(ids).not.toContain('owner-1');
  });

  it('un agent solo se ve a sí mismo', () => {
    const ids = agendaAgents(PERFILES, { userId: 'agent-1', role: 'agent' }).map((a) => a.userId);
    expect(ids).toEqual(['agent-1']);
  });
});
