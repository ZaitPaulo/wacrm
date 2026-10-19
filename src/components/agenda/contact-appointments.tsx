'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatAppointmentWhen } from '@/lib/appointments/format';
import type { Appointment } from '@/lib/appointments/types';
import { isActiveStatus } from '@/lib/appointments/types';
import { StatusBadge } from './appointment-card';

type Row = Pick<Appointment, 'id' | 'starts_at' | 'status' | 'assigned_agent_id'>;

/**
 * Citas del contacto en su ficha de la bandeja: la próxima activa
 * destacada y las anteriores debajo, cada una con enlace a la Agenda.
 * La RLS ya recorta a las que quien mira puede ver.
 */
export function ContactAppointments({ contactId }: { contactId: string }) {
  const t = useTranslations('Agenda');
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  // Momento de referencia para "próxima": el de cuando se montó la ficha.
  const [now] = useState(() => Date.now());
  const instanceId = useId();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      supabase
        .from('appointments')
        .select('id, starts_at, status, assigned_agent_id')
        .eq('contact_id', contactId)
        .order('starts_at', { ascending: false })
        .limit(20)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) console.error('[agenda] citas del contacto:', error.message);
          setRows((data ?? []) as Row[]);
        });
    load();
    // El nombre del canal lleva `instanceId`: en el teléfono la ficha
    // vive dos veces a la vez (el panel de escritorio, oculto por CSS
    // pero montado, y la hoja de móvil). Con el mismo nombre, supabase
    // devuelve el canal ya suscrito y `.on()` lanza, tumbando la página.
    const channel = supabase
      .channel(`contact-appointments-${contactId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `contact_id=eq.${contactId}` },
        () => load()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [contactId, instanceId, supabase]);

  if (!rows || rows.length === 0) return null;

  const upcoming = rows
    .filter((r) => isActiveStatus(r.status) && new Date(r.starts_at).getTime() >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const others = rows.filter((r) => r.id !== upcoming?.id);

  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <CalendarDays className="h-3.5 w-3.5" />
        {t('contact.title')}
      </h4>
      {upcoming && (
        <Link
          href={`/agenda?cita=${upcoming.id}`}
          className="border-primary/40 bg-primary/5 hover:bg-primary/10 block rounded-md border p-2 text-sm"
        >
          <span className="text-muted-foreground block text-[11px]">{t('contact.next')}</span>
          <span className="block font-medium">{formatAppointmentWhen(upcoming.starts_at)}</span>
          <StatusBadge status={upcoming.status} />
        </Link>
      )}
      {others.length > 0 && (
        <ul className="space-y-1">
          {others.slice(0, 5).map((r) => (
            <li key={r.id}>
              <Link
                href={`/agenda?cita=${r.id}`}
                className="hover:bg-muted flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs"
              >
                <span className="truncate">{formatAppointmentWhen(r.starts_at)}</span>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
