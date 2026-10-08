// ============================================================
// Quiénes aparecen en la Agenda y con qué color.
// ============================================================

import type { AccountRole } from '@/lib/auth/roles';

export interface AgendaAgent {
  userId: string;
  fullName: string;
  role: AccountRole;
}

/**
 * Colores de los asesores. Clases completas y literales para que
 * Tailwind las encuentre al compilar: armarlas con plantillas las
 * dejaría fuera del CSS.
 */
export const AGENT_COLORS = [
  { dot: 'bg-violet-500', card: 'border-violet-500 bg-violet-500/10', avatar: 'bg-violet-500' },
  { dot: 'bg-emerald-500', card: 'border-emerald-500 bg-emerald-500/10', avatar: 'bg-emerald-500' },
  { dot: 'bg-amber-500', card: 'border-amber-500 bg-amber-500/10', avatar: 'bg-amber-500' },
  { dot: 'bg-sky-500', card: 'border-sky-500 bg-sky-500/10', avatar: 'bg-sky-500' },
  { dot: 'bg-rose-500', card: 'border-rose-500 bg-rose-500/10', avatar: 'bg-rose-500' },
  { dot: 'bg-teal-500', card: 'border-teal-500 bg-teal-500/10', avatar: 'bg-teal-500' },
  { dot: 'bg-orange-500', card: 'border-orange-500 bg-orange-500/10', avatar: 'bg-orange-500' },
  { dot: 'bg-fuchsia-500', card: 'border-fuchsia-500 bg-fuchsia-500/10', avatar: 'bg-fuchsia-500' },
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

/**
 * Los asesores que pueden tener citas, ordenados por nombre. Los viewer
 * no atienden visitas. Un `agent` solo se ve a sí mismo: la RLS ya no
 * le devuelve citas ajenas, y una columna vacía de un compañero solo
 * confundiría.
 */
export function agendaAgents(
  profiles: { user_id: string; full_name: string | null; account_role: AccountRole | null }[],
  me: { userId: string | null; role: AccountRole | null }
): AgendaAgent[] {
  const list = profiles
    .filter((p) => p.account_role && p.account_role !== 'viewer')
    .map((p) => ({
      userId: p.user_id,
      fullName: p.full_name?.trim() || '—',
      role: p.account_role as AccountRole,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  if (me.role === 'agent') return list.filter((a) => a.userId === me.userId);
  return list;
}

/** Color estable por asesor: el índice en la lista completa ordenada. */
export function agentColorMap(agents: AgendaAgent[]): Map<string, AgentColor> {
  const map = new Map<string, AgentColor>();
  agents.forEach((a, i) => map.set(a.userId, AGENT_COLORS[i % AGENT_COLORS.length]));
  return map;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
