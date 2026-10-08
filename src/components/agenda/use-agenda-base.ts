'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { AccountRole } from '@/lib/auth/roles';
import { agendaAgents, agentColorMap, type AgendaAgent, type AgentColor } from '@/lib/appointments/agents';
import { resolveAgendaHours, type AgendaHours } from '@/lib/appointments/slots';
import {
  DEFAULT_APPOINTMENT_SETTINGS,
  type AppointmentSettings,
} from '@/lib/appointments/types';

export interface AgendaBase {
  loading: boolean;
  agents: AgendaAgent[];
  /** Todos los miembros que pueden tener citas, para nombres y colores. */
  allAgents: AgendaAgent[];
  colors: Map<string, AgentColor>;
  agenda: AgendaHours;
  settings: Omit<AppointmentSettings, 'account_id'>;
  /** Dirección y nombre público, para el texto de confirmación. */
  business: { name: string | null; address: string | null };
}

/**
 * Lo que toda pantalla de citas necesita antes de dibujar: asesores,
 * horario de la cuenta y configuración de la Agenda. Una lectura por
 * montaje; nada de esto cambia mientras se usa la Agenda.
 */
export function useAgendaBase(): AgendaBase {
  const { accountId, accountRole, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<
    { user_id: string; full_name: string | null; account_role: AccountRole | null }[]
  >([]);
  const [account, setAccount] = useState<{
    business_hours: unknown;
    holiday_calendar: string | null;
    public_name: string | null;
    public_address: string | null;
  } | null>(null);
  const [settings, setSettings] = useState<Omit<AppointmentSettings, 'account_id'>>(
    DEFAULT_APPOINTMENT_SETTINGS
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const [p, a, s] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name, account_role').order('full_name'),
        supabase
          .from('accounts')
          .select('business_hours, holiday_calendar, public_name, public_address')
          .eq('id', accountId)
          .maybeSingle(),
        supabase.from('appointment_settings').select('*').eq('account_id', accountId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (p.error) console.error('[agenda] perfiles:', p.error.message);
      if (a.error) console.error('[agenda] cuenta:', a.error.message);
      if (s.error) console.error('[agenda] configuración:', s.error.message);
      setProfiles(p.data ?? []);
      setAccount(a.data ?? null);
      if (s.data) setSettings({ ...DEFAULT_APPOINTMENT_SETTINGS, ...s.data });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return useMemo(() => {
    const allAgents = agendaAgents(profiles, { userId: null, role: null });
    const agents = agendaAgents(profiles, { userId: user?.id ?? null, role: accountRole });
    return {
      loading: loading || !accountId,
      agents,
      allAgents,
      colors: agentColorMap(allAgents),
      agenda: resolveAgendaHours(account),
      settings,
      business: {
        name: account?.public_name ?? null,
        address: account?.public_address ?? null,
      },
    };
  }, [profiles, account, settings, loading, accountId, accountRole, user?.id]);
}
