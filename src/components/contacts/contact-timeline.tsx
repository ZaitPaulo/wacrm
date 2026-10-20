'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  BadgeDollarSign,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Car,
  CarFront,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Phone,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Trophy,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { dateLocale } from '@/lib/date-locale';
import { formatCurrency } from '@/lib/currency';
import { toDayKey } from '@/lib/appointments/format';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import {
  TIMELINE_FILTER_KEYS,
  TIMELINE_PAGE_SIZE,
  durationMinutes,
  eventText,
  kindsForFilters,
  nextPageParams,
  vehicleLabel,
  type TimelineEvent,
  type TimelineFilter,
  type TimelineKind,
} from '@/lib/contacts/timeline';

const ICONS: Record<TimelineKind, ComponentType<{ className?: string }>> = {
  first_contact: Sparkles,
  conversation: MessageSquare,
  assignment: ArrowRightLeft,
  appointment: CalendarDays,
  appointment_event: CalendarClock,
  deal_created: Briefcase,
  deal_stage: Briefcase,
  deal_closed: Trophy,
  inquiry: Search,
  sale: BadgeDollarSign,
  consignment: Car,
  acquisition: CarFront,
  document: FileText,
  note: StickyNote,
  interaction: Phone,
};

interface ContactTimelineProps {
  contactId: string;
  /** Cambia para pedir la hoja de vida de nuevo (nota o interacción nueva). */
  reloadKey: number;
  /** Quien mira atiende al contacto (`contact_visible`): borra notas. */
  canEdit: boolean;
  onOpenThread: (conversationId: string) => void;
  onEditInteraction: (event: TimelineEvent) => void;
}

/**
 * La hoja de vida: todo lo que pasó con el contacto, de lo más reciente
 * a lo más antiguo, con filtros por tipo y "Cargar más". Los datos los
 * arma `get_contact_timeline` (migración 555); aquí solo se ponen en
 * palabras con next-intl.
 */
export function ContactTimeline({
  contactId,
  reloadKey,
  canEdit,
  onOpenThread,
  onEditInteraction,
}: ContactTimelineProps) {
  const t = useTranslations('Contacts.timeline');
  const { user, accountRole, defaultCurrency } = useAuth();
  const isAdmin = !!accountRole && hasMinRole(accountRole, 'admin');

  const [filters, setFilters] = useState<TimelineFilter[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<{ before: string; before_key: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (after: { before: string; before_key: string } | null) => {
      const qs = new URLSearchParams({ limit: String(TIMELINE_PAGE_SIZE) });
      const kinds = kindsForFilters(filters);
      if (kinds) qs.set('kinds', kinds.join(','));
      if (after) {
        qs.set('before', after.before);
        qs.set('before_key', after.before_key);
      }
      const res = await fetch(`/api/contacts/${contactId}/timeline?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { events: TimelineEvent[] };
      return json.events;
    },
    [contactId, filters]
  );

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchPage(null)
      .then((page) => {
        if (cancelled) return;
        setEvents(page);
        setCursor(nextPageParams(page, TIMELINE_PAGE_SIZE));
      })
      .catch(() => !cancelled && toast.error(t('loadFailed')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, reloadKey, t]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      setEvents((prev) => [...prev, ...page]);
      setCursor(nextPageParams(page, TIMELINE_PAGE_SIZE));
    } catch {
      toast.error(t('loadFailed'));
    }
    setLoadingMore(false);
  }

  async function deleteEvent(e: TimelineEvent) {
    const url =
      e.kind === 'interaction'
        ? `/api/contacts/${contactId}/interactions/${e.source_id}`
        : null;
    let ok = false;
    if (url) {
      ok = (await fetch(url, { method: 'DELETE' })).ok;
    } else {
      const { data } = await createClient()
        .from('contact_notes')
        .delete()
        .eq('id', e.source_id)
        .select('id');
      ok = !!data && data.length > 0;
    }
    if (ok) {
      setEvents((prev) => prev.filter((x) => x.sort_key !== e.sort_key));
      toast.success(t('deleted'));
    } else {
      toast.error(t('deleteFailed'));
    }
  }

  function toggleFilter(f: TimelineFilter) {
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={filters.length === 0} onClick={() => setFilters([])}>
          {t('filters.all')}
        </FilterChip>
        {TIMELINE_FILTER_KEYS.map((f) => (
          <FilterChip key={f} active={filters.includes(f)} onClick={() => toggleFilter(f)}>
            {t(`filters.${f}`)}
          </FilterChip>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          {filters.length > 0 ? t('emptyFiltered') : t('empty')}
        </p>
      ) : (
        <ol className="border-border relative space-y-4 border-l pl-5">
          {events.map((e) => (
            <TimelineRow
              key={e.sort_key}
              event={e}
              isAdmin={isAdmin}
              isMine={!!user && e.actor_user_id === user.id}
              myUserId={user?.id ?? null}
              canEdit={canEdit}
              currency={defaultCurrency}
              onOpenThread={onOpenThread}
              onEditInteraction={onEditInteraction}
              onDelete={deleteEvent}
            />
          ))}
        </ol>
      )}

      {cursor && !loading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="border-border hover:bg-muted text-foreground inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm"
          >
            {loadingMore && <Loader2 className="size-4 animate-spin" />}
            {t('loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

function TimelineRow({
  event: e,
  isAdmin,
  isMine,
  myUserId,
  canEdit,
  currency,
  onOpenThread,
  onEditInteraction,
  onDelete,
}: {
  event: TimelineEvent;
  isAdmin: boolean;
  isMine: boolean;
  myUserId: string | null;
  canEdit: boolean;
  currency: string;
  onOpenThread: (conversationId: string) => void;
  onEditInteraction: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => void;
}) {
  const t = useTranslations('Contacts.timeline');
  const tChannel = useTranslations('Inbox.channels');
  const tAgenda = useTranslations('Agenda');
  const Icon = ICONS[e.kind];
  const d = e.data;

  // Los valores que son códigos (canal, motivo, estado, tipo) se traducen
  // antes de entrar al mensaje.
  const { key, values } = eventText(e);
  const translated: Record<string, string | number> = { ...values };
  if (typeof values.channel === 'string' && values.channel) translated.channel = tChannel(values.channel);
  if (typeof values.purpose === 'string' && values.purpose) translated.purpose = tAgenda(`purpose.${values.purpose}`);
  if (typeof values.status === 'string' && values.status) translated.status = tAgenda(`status.${values.status}`);
  if (e.kind === 'interaction') translated.kind = t(`interactionKinds.${values.kind}`);
  for (const k of ['from', 'to'] as const) {
    if (translated[k] === '') translated[k] = t('unassigned');
  }

  const when = format(new Date(e.occurred_at), "d MMM yyyy, h:mm a", { locale: dateLocale() });
  const details: string[] = [];
  const conversationId = typeof e.link?.conversation_id === 'string' ? e.link.conversation_id : null;

  switch (e.kind) {
    case 'conversation':
      if (d.first_at) {
        details.push(
          t('details.conversationRange', {
            from: format(new Date(String(d.first_at)), 'd MMM yyyy', { locale: dateLocale() }),
            to: format(new Date(String(d.last_at)), 'd MMM yyyy', { locale: dateLocale() }),
          })
        );
      }
      details.push(
        d.assigned_agent_name
          ? t('details.attendedBy', { name: String(d.assigned_agent_name) })
          : t('details.botOnly')
      );
      break;
    case 'appointment': {
      if (d.assigned_agent_name) details.push(t('details.attendedBy', { name: String(d.assigned_agent_name) }));
      const vehicles = Array.isArray(d.vehicles) ? d.vehicles.map(vehicleLabel).filter(Boolean) : [];
      if (vehicles.length > 0) details.push(vehicles.join(', '));
      break;
    }
    case 'deal_created':
    case 'deal_stage':
    case 'deal_closed':
      if (typeof d.value === 'number' || typeof d.value === 'string') {
        details.push(formatCurrency(Number(d.value), (d.currency as string) || currency));
      }
      break;
    case 'sale':
      if (d.sold_price !== null && d.sold_price !== undefined) {
        details.push(t('details.price', { price: formatCurrency(Number(d.sold_price), currency) }));
      }
      break;
    case 'acquisition':
      // Solo llega para admin: la función de la base no lo manda a los demás.
      if (d.purchase_cost !== null && d.purchase_cost !== undefined) {
        details.push(t('details.cost', { price: formatCurrency(Number(d.purchase_cost), currency) }));
      }
      break;
    case 'interaction': {
      if (d.outcome) details.push(t(`outcomes.${String(d.outcome)}`));
      const minutes = durationMinutes(d.duration_seconds);
      if (minutes !== null) details.push(t('details.minutes', { count: minutes }));
      break;
    }
  }

  const body =
    e.kind === 'note' ? String(d.text ?? '') : e.kind === 'interaction' && d.note ? String(d.note) : null;

  // La Agenda muestra la cita solo a su asesor y a admin (RLS sin cambios).
  const appointmentId = typeof e.link?.appointment_id === 'string' ? e.link.appointment_id : null;
  const canOpenAppointment =
    !!appointmentId && (isAdmin || (!!myUserId && d.assigned_agent_id === myUserId));
  const canFixInteraction = e.kind === 'interaction' && (isMine || isAdmin);
  const canDeleteNote = e.kind === 'note' && canEdit;

  return (
    <li className="relative">
      <span className="bg-card border-border absolute top-0.5 -left-[31px] flex size-6 items-center justify-center rounded-full border">
        <Icon className="text-muted-foreground size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium break-words">{t(`events.${key}`, translated)}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {when}
          {e.actor_name && ` · ${e.actor_name}`}
          {details.length > 0 && ` · ${details.join(' · ')}`}
        </p>
        {body && (
          <p className="bg-muted/50 border-border/50 text-foreground mt-1.5 rounded-lg border p-2.5 text-sm whitespace-pre-wrap">
            {body}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {conversationId && (e.kind === 'conversation' || e.kind === 'assignment') && (
            <button type="button" onClick={() => onOpenThread(conversationId)} className="text-primary hover:underline">
              {t('actions.viewThread')}
            </button>
          )}
          {canOpenAppointment && (
            <Link
              href={`/agenda?vista=dia&fecha=${toDayKey(String(e.link?.starts_at))}&cita=${appointmentId}`}
              className="text-primary hover:underline"
            >
              {t('actions.openAppointment')}
            </Link>
          )}
          {e.kind === 'document' && (
            <Link href="/documents" className="text-primary hover:underline">
              {t('actions.openDocuments')}
            </Link>
          )}
          {canFixInteraction && (
            <button
              type="button"
              onClick={() => onEditInteraction(e)}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Pencil className="size-3" />
              {t('actions.edit')}
            </button>
          )}
          {(canFixInteraction || canDeleteNote) && (
            <button
              type="button"
              onClick={() => onDelete(e)}
              className="text-muted-foreground inline-flex items-center gap-1 hover:text-red-400"
            >
              <Trash2 className="size-3" />
              {t('actions.delete')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
