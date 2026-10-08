'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { AgentColor } from '@/lib/appointments/agents';
import { formatAppointmentTime } from '@/lib/appointments/format';
import { contactLabel, vehicleLabels, type AgendaAppointment } from '@/lib/appointments/queries';
import type { AppointmentStatus } from '@/lib/appointments/types';

/** Colores de la etiqueta de estado. Clases literales para Tailwind. */
export const STATUS_BADGE: Record<AppointmentStatus, string> = {
  scheduled: 'bg-muted text-muted-foreground',
  confirmed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  attended: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  no_show: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const t = useTranslations('Agenda');
  return (
    <span className={cn('inline-block rounded-full px-1.5 py-px text-[10px] font-semibold', STATUS_BADGE[status])}>
      {t(`status.${status}`)}
    </span>
  );
}

interface AppointmentCardProps {
  appointment: AgendaAppointment;
  color?: AgentColor;
  /** Tarjeta de una sola franja: solo nombre y hora. */
  compact?: boolean;
  /** En la vista Semana conviven varios asesores en la columna. */
  showAgent?: boolean;
  onOpen: () => void;
}

export function AppointmentCard({ appointment: a, color, compact, onOpen }: AppointmentCardProps) {
  const t = useTranslations('Agenda');
  const cancelled = a.status === 'cancelled';
  const detail = vehicleLabels(a)[0] ?? t(`purpose.${a.purpose}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'h-full w-full overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight',
        color?.card ?? 'border-primary bg-primary/10',
        cancelled && 'opacity-50',
        a.customer_response === 'change_requested' && a.status !== 'cancelled' && 'ring-1 ring-amber-500'
      )}
    >
      <span className={cn('block truncate text-xs font-semibold', cancelled && 'line-through')}>
        {contactLabel(a)}
      </span>
      {compact ? (
        <span className="text-muted-foreground block truncate">{formatAppointmentTime(a.starts_at)}</span>
      ) : (
        <>
          <span className="text-muted-foreground block truncate">
            {formatAppointmentTime(a.starts_at)} · {detail}
          </span>
          <span className="mt-0.5 block">
            <StatusBadge status={a.status} />
          </span>
        </>
      )}
    </button>
  );
}
