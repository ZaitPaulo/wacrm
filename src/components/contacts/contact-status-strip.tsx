'use client';

import Link from 'next/link';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { dateLocale } from '@/lib/date-locale';
import { formatCurrency } from '@/lib/currency';
import { toDayKey } from '@/lib/appointments/format';
import { vehicleLabel } from '@/lib/contacts/timeline';
import type { ContactSummary } from '@/lib/contacts/summary';

interface ContactStatusStripProps {
  summary: ContactSummary;
  myUserId: string | null;
  isAdmin: boolean;
  currency: string;
}

/**
 * "Cómo va": lo que el asesor necesita saber antes de escribir o llamar
 * (migración 558). El pendiente solo aparece cuando lo hay, y va primero
 * y en naranja: es lo único de la ficha que pide hacer algo ya.
 */
export function ContactStatusStrip({ summary, myUserId, isAdmin, currency }: ContactStatusStripProps) {
  const t = useTranslations('Contacts.profile.status');
  const tChannel = useTranslations('Inbox.channels');
  const tAgenda = useTranslations('Agenda');
  const tTimeline = useTranslations('Contacts.timeline');
  const locale = dateLocale();

  const { awaiting_reply: awaiting, next_appointment: appt, open_deal: deal, last_contact: last } = summary;

  // La Agenda muestra la cita solo a su asesor y a admin (RLS sin cambios).
  const canOpenAppt = !!appt && (isAdmin || (!!myUserId && appt.assigned_agent_id === myUserId));
  const apptVehicle = appt?.vehicle ? vehicleLabel(appt.vehicle) : '';

  let lastLine = t('noContact');
  if (last) {
    lastLine =
      last.source === 'interaction' && last.interaction_kind
        ? [
            tTimeline(`interactionKinds.${last.interaction_kind}`),
            last.outcome ? tTimeline(`outcomes.${last.outcome}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : t('lastMessage');
  }

  return (
    <section aria-label={t('label')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {awaiting && (
        <Tile tone="alert" label={t('pending')}>
          <strong className="text-foreground text-base font-semibold">
            {t('awaitingReply', { channel: tChannel(awaiting.channel) })}
          </strong>
          <span className="text-muted-foreground text-sm">
            {t('awaitingSince', { ago: formatDistanceToNowStrict(new Date(awaiting.since), { addSuffix: true, locale }) })}
          </span>
          <Link
            href={`/inbox?c=${awaiting.conversation_id}`}
            className="text-primary mt-1 text-sm font-semibold hover:underline"
          >
            {t('replyNow')}
          </Link>
        </Tile>
      )}

      <Tile label={t('nextAppointment')}>
        {appt ? (
          <>
            <strong className="text-foreground text-base font-semibold first-letter:uppercase">
              {format(new Date(appt.starts_at), "EEE d MMM · h:mm a", { locale })}
            </strong>
            <span className="text-muted-foreground text-sm">
              {[tAgenda(`purpose.${appt.purpose}`), apptVehicle].filter(Boolean).join(' · ')}
            </span>
            {appt.status === 'confirmed' && (
              <span className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t('confirmed')}</span>
            )}
            {canOpenAppt && (
              <Link
                href={`/agenda?vista=dia&fecha=${toDayKey(appt.starts_at)}&cita=${appt.id}`}
                className="text-primary mt-1 text-sm font-medium hover:underline"
              >
                {tTimeline('actions.openAppointment')}
              </Link>
            )}
          </>
        ) : (
          <span className="text-muted-foreground text-sm">{t('noAppointment')}</span>
        )}
      </Tile>

      <Tile label={t('openDeal')}>
        {deal ? (
          <>
            <strong className="text-foreground truncate text-base font-semibold">{deal.title}</strong>
            <span className="text-muted-foreground text-sm">
              {formatCurrency(Number(deal.value), deal.currency || currency)}
            </span>
            {deal.stage_count > 0 && (
              <>
                <div className="mt-1.5 flex gap-1" aria-hidden>
                  {Array.from({ length: deal.stage_count }, (_, i) => (
                    <span
                      key={i}
                      className={cn('h-1.5 flex-1 rounded-full', i < deal.stage_index ? 'bg-primary' : 'bg-muted')}
                    />
                  ))}
                </div>
                <span className="text-muted-foreground text-xs">
                  {t('stageProgress', { index: deal.stage_index, count: deal.stage_count, stage: deal.stage_name })}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="text-muted-foreground text-sm">{t('noDeal')}</span>
        )}
      </Tile>

      <Tile label={t('lastContact')}>
        {last && (
          <strong className="text-foreground text-base font-semibold first-letter:uppercase">
            {formatDistanceToNowStrict(new Date(last.occurred_at), { addSuffix: true, locale })}
          </strong>
        )}
        <span className="text-muted-foreground text-sm">{lastLine}</span>
        {summary.client_since && (
          <span className="text-muted-foreground mt-1 text-xs">
            {t('clientSince', { date: format(new Date(summary.client_since), 'd MMM yyyy', { locale }) })}
          </span>
        )}
      </Tile>
    </section>
  );
}

function Tile({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'alert';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-xl border p-4',
        tone === 'alert'
          ? 'border-orange-300 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10'
          : 'border-border bg-card'
      )}
    >
      <span
        className={cn(
          'text-xs font-medium',
          tone === 'alert' ? 'text-orange-800 dark:text-orange-300' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
