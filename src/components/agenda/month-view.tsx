'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { AgentColor } from '@/lib/appointments/agents';
import type { AgendaAppointment } from '@/lib/appointments/queries';
import { isActiveStatus } from '@/lib/appointments/types';
import { toDayKey } from '@/lib/appointments/format';

interface MonthViewProps {
  /** Primer día de la cuadrícula (lunes). */
  gridStart: Date;
  /** Mes que se está mirando (0–11), para atenuar los días de otros meses. */
  month: number;
  appointments: AgendaAppointment[];
  colors: Map<string, AgentColor>;
  onPickDay: (day: Date) => void;
}

/** Seis semanas de lunes a domingo, con cuántas citas activas tiene cada día. */
export function MonthView({ gridStart, month, appointments, colors, onPickDay }: MonthViewProps) {
  const t = useTranslations('Agenda');
  const today = toDayKey(new Date());

  const byDay = new Map<string, AgendaAppointment[]>();
  for (const a of appointments) {
    if (!isActiveStatus(a.status)) continue;
    const key = toDayKey(a.starts_at);
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }

  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border text-muted-foreground grid grid-cols-7 border-b text-center text-xs">
        {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((d) => (
          <div key={d} className="py-2">
            {t(`weekdaysShort.${d}`)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = toDayKey(d);
          const list = byDay.get(key) ?? [];
          const agents = [...new Set(list.map((a) => a.assigned_agent_id))];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickDay(d)}
              className={cn(
                'border-border hover:bg-muted/60 flex min-h-20 flex-col items-start gap-1 border-r border-b p-2 text-left transition-colors [&:nth-child(7n)]:border-r-0',
                d.getMonth() !== month && 'text-muted-foreground/60'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                  key === today && 'bg-primary text-primary-foreground font-semibold'
                )}
              >
                {d.getDate()}
              </span>
              {list.length > 0 && (
                <>
                  <span className="text-xs font-semibold">{t('month.count', { count: list.length })}</span>
                  <span className="flex flex-wrap gap-1">
                    {agents.map((id) => (
                      <span key={id} className={cn('h-2 w-2 rounded-full', colors.get(id)?.dot ?? 'bg-primary')} />
                    ))}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
