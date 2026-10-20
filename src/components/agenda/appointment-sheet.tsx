'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, Car, MessageSquare, StickyNote, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { formatAppointmentTime, formatAppointmentWhen } from '@/lib/appointments/format';
import {
  contactLabel,
  setAppointmentStatus,
  vehicleLabels,
  type AgendaAppointment,
} from '@/lib/appointments/queries';
import {
  ACTION_TARGET_STATUS,
  availableActions,
  type AppointmentAction,
} from '@/lib/appointments/status';
import type { AppointmentEvent } from '@/lib/appointments/types';
import { StatusBadge } from './appointment-card';
import { ContactProfileLink } from '@/components/contacts/contact-profile-link';

interface AppointmentSheetProps {
  appointment: AgendaAppointment | null;
  agentName: (id: string | null) => string;
  onClose: () => void;
  /** Reagendar y reasignar abren el formulario de edición. */
  onEdit: (a: AgendaAppointment) => void;
  onChanged: () => void;
}

const ACTION_VARIANT: Partial<Record<AppointmentAction, 'default' | 'outline' | 'destructive'>> = {
  confirm: 'default',
  attended: 'default',
  cancel: 'destructive',
};

export function AppointmentSheet({ appointment: a, agentName, onClose, onEdit, onChanged }: AppointmentSheetProps) {
  const t = useTranslations('Agenda');
  const { accountRole } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [busy, setBusy] = useState<AppointmentAction | null>(null);

  useEffect(() => {
    if (!a) return;
    let cancelled = false;
    supabase
      .from('appointment_events')
      .select('*')
      .eq('appointment_id', a.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('[agenda] historial:', error.message);
        setEvents((data ?? []) as AppointmentEvent[]);
      });
    return () => {
      cancelled = true;
    };
    // `updated_at` recarga el historial cuando la cita cambia en vivo.
  }, [a?.id, a?.updated_at, supabase, a]);

  async function run(action: AppointmentAction) {
    if (!a) return;
    if (action === 'reschedule' || action === 'reassign') {
      onEdit(a);
      return;
    }
    const target = ACTION_TARGET_STATUS[action];
    if (!target) return;
    setBusy(action);
    const result = await setAppointmentStatus(supabase, a.id, target);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.reason === 'overlap' ? t('errors.overlap') : t('errors.saveFailed'));
      return;
    }
    toast.success(t(`actions.done.${action}`));
    onChanged();
  }

  const actions = a ? availableActions(a.status, accountRole) : [];

  return (
    <Sheet open={!!a} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {a && (
          <>
            <SheetHeader>
              <SheetTitle>{contactLabel(a)}</SheetTitle>
              <ContactProfileLink contactId={a.contact_id} label={t('sheet.viewProfile')} />
              <SheetDescription className="flex items-center gap-2">
                <StatusBadge status={a.status} />
                {formatAppointmentWhen(a.starts_at)}
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-4 px-4 pb-6 text-sm">
              {a.customer_response === 'change_requested' && a.status !== 'cancelled' && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t('sheet.changeRequested')}
                </div>
              )}
              {a.customer_response === 'confirmed' && (
                <p className="text-emerald-700 dark:text-emerald-400">{t('sheet.customerConfirmed')}</p>
              )}

              <dl className="grid gap-3">
                <Row icon={UserRound} label={t('fields.agent')}>
                  {agentName(a.assigned_agent_id)}
                </Row>
                <Row icon={CalendarClock} label={t('sheet.when')}>
                  {formatAppointmentWhen(a.starts_at)} – {formatAppointmentTime(a.ends_at)}
                  <span className="text-muted-foreground"> · {t(`purpose.${a.purpose}`)}</span>
                </Row>
                {a.vehicles.length > 0 && (
                  <Row icon={Car} label={t('fields.vehicles')}>
                    <ul className="space-y-0.5">
                      {a.vehicles.map((v, i) => (
                        <li key={v.id}>
                          {vehicleLabels(a)[i]}
                          {v.status && v.status !== 'available' && (
                            <span
                              className={
                                v.status === 'reserved'
                                  ? 'ml-1.5 rounded bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400'
                                  : 'ml-1.5 rounded bg-rose-500/15 px-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400'
                              }
                            >
                              {t(`vehicleStatus.${v.status}`)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Row>
                )}
                {a.notes && (
                  <Row icon={StickyNote} label={t('fields.notes')}>
                    <span className="whitespace-pre-wrap">{a.notes}</span>
                  </Row>
                )}
                {a.conversation_id && (
                  <Row icon={MessageSquare} label={t('sheet.conversation')}>
                    <Link href={`/inbox?c=${a.conversation_id}`} className="text-primary underline-offset-2 hover:underline">
                      {t('sheet.openConversation')}
                    </Link>
                  </Row>
                )}
              </dl>

              {actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={ACTION_VARIANT[action] ?? 'outline'}
                      disabled={busy !== null}
                      onClick={() => run(action)}
                    >
                      {t(`actions.${action}`)}
                    </Button>
                  ))}
                </div>
              )}

              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('sheet.history')}
                </h3>
                <ol className="grid gap-2">
                  {events.map((e) => (
                    <li key={e.id} className="border-border border-l-2 pl-3">
                      <span className="block">{describeEvent(e, t, agentName)}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatAppointmentWhen(e.created_at)}
                        {e.actor_user_id ? ` · ${agentName(e.actor_user_id)}` : ` · ${t('history.system')}`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

function describeEvent(
  e: AppointmentEvent,
  t: ReturnType<typeof useTranslations>,
  agentName: (id: string | null) => string
): string {
  const d = e.data as Record<string, string | undefined>;
  switch (e.kind) {
    case 'rescheduled':
      return t('history.rescheduled', {
        from: d.from ? formatAppointmentWhen(d.from) : '—',
        to: d.to ? formatAppointmentWhen(d.to) : '—',
      });
    case 'reassigned':
      return t('history.reassigned', { from: agentName(d.from ?? null), to: agentName(d.to ?? null) });
    case 'status_changed':
      return t('history.status_changed', {
        to: d.to ? t(`status.${d.to}`) : '—',
      });
    default:
      return t(`history.${e.kind}`);
  }
}
