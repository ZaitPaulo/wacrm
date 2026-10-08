'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/appointments/agents';
import {
  formatAppointmentDay,
  fromDayKey,
  toDayKey,
} from '@/lib/appointments/format';
import {
  AGENDA_SELECT,
  fetchAppointmentsInRange,
  moveAppointment,
  normalizeAgendaRow,
  type AgendaAppointment,
} from '@/lib/appointments/queries';
import { openingOf } from '@/lib/appointments/slots';
import {
  canDragAppointment,
  canManageAllAppointments,
  canWriteAppointments,
} from '@/lib/appointments/status';
import { isActiveStatus } from '@/lib/appointments/types';
import { useAgendaBase } from './use-agenda-base';
import { TimeGrid, type GridColumn } from './time-grid';
import { MonthView } from './month-view';
import { AppointmentDialog, type AppointmentPrefill } from './appointment-dialog';
import { AppointmentSheet } from './appointment-sheet';
import { MoveConfirmDialog, type PendingMove } from './move-confirm-dialog';

type View = 'dia' | 'semana' | 'mes';
const VIEWS: View[] = ['dia', 'semana', 'mes'];

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Lunes de la semana de `d`. */
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** Rango que carga cada vista: [desde, hasta). */
function rangeOf(view: View, day: Date): { from: Date; to: Date } {
  if (view === 'dia') return { from: day, to: addDays(day, 1) };
  if (view === 'semana') {
    const from = mondayOf(day);
    return { from, to: addDays(from, 7) };
  }
  const from = mondayOf(new Date(day.getFullYear(), day.getMonth(), 1));
  return { from, to: addDays(from, 42) };
}

/**
 * La Agenda: vistas Día (una columna por asesor), Semana y Mes.
 *
 * Todo el estado de la vista vive en la URL (`vista`, `fecha`, `asesor`,
 * `cita`) para que un aviso pueda llevar exactamente a una cita y que
 * recargar la página no pierda dónde se estaba.
 */
export function AgendaView() {
  const t = useTranslations('Agenda');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { accountId, accountRole } = useAuth();
  const base = useAgendaBase();
  const supabase = useMemo(() => createClient(), []);

  const view: View = VIEWS.includes(params.get('vista') as View) ? (params.get('vista') as View) : 'dia';
  const dayKey = params.get('fecha') ?? toDayKey(new Date());
  const day = useMemo(() => fromDayKey(dayKey) ?? fromDayKey(toDayKey(new Date()))!, [dayKey]);
  const agentFilter = params.get('asesor') ?? '';
  const openId = params.get('cita');

  const canWrite = canWriteAppointments(accountRole);
  const isAdmin = canManageAllAppointments(accountRole);
  const showFilter = accountRole !== 'agent';

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  // ---------------- Datos ----------------
  const [appointments, setAppointments] = useState<AgendaAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => rangeOf(view, day), [view, day]);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      setAppointments(await fetchAppointmentsInRange(supabase, accountId, range.from, range.to));
    } catch (err) {
      console.error('[agenda] cargar:', err);
      toast.error(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase, range, t]);

  useEffect(() => {
    load();
  }, [load]);

  // En vivo: cualquier cambio visible recarga el rango (agrupando ráfagas).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    let timer: number | undefined;
    const channel = supabase
      .channel('agenda-appointments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => loadRef.current(), 300);
      })
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Cita abierta por URL (un aviso, un enlace desde la ficha). Puede
  // estar fuera del rango cargado: se pide aparte y se salta a su día.
  const [opened, setOpened] = useState<AgendaAppointment | null>(null);
  useEffect(() => {
    if (!openId) {
      setOpened(null);
      return;
    }
    const inRange = appointments.find((a) => a.id === openId);
    if (inRange) {
      setOpened(inRange);
      return;
    }
    let cancelled = false;
    supabase
      .from('appointments')
      .select(AGENDA_SELECT)
      .eq('id', openId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) {
          toast.error(t('errors.notFound'));
          setParams({ cita: null });
          return;
        }
        const row = normalizeAgendaRow(data as Parameters<typeof normalizeAgendaRow>[0]);
        const key = toDayKey(row.starts_at);
        if (key !== dayKey || !params.get('vista')) setParams({ fecha: key, vista: params.get('vista') ?? 'dia' });
        setOpened(row);
      });
    return () => {
      cancelled = true;
    };
  }, [openId, appointments, supabase, dayKey, params, setParams, t]);

  // ---------------- Diálogos ----------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AgendaAppointment | null>(null);
  const [prefill, setPrefill] = useState<AppointmentPrefill | undefined>(undefined);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const agentName = useCallback(
    (id: string | null) => (id ? base.allAgents.find((a) => a.userId === id)?.fullName ?? '—' : '—'),
    [base.allAgents]
  );

  function openCreate(start: Date | null, agentId: string | null) {
    setEditing(null);
    setPrefill({ startsAt: start, agentId });
    setDialogOpen(true);
  }

  async function confirmMove(notifyCustomer: boolean) {
    if (!pendingMove) return;
    const result = await moveAppointment(
      supabase,
      pendingMove.appointment.id,
      pendingMove.start,
      pendingMove.agentId,
      notifyCustomer
    );
    if (!result.ok) {
      toast.error(result.reason === 'overlap' ? t('errors.overlap') : t('errors.saveFailed'));
      return;
    }
    toast.success(t('move.done'));
    setPendingMove(null);
    load();
  }

  // ---------------- Columnas ----------------
  const visible = useMemo(
    () => appointments.filter((a) => !agentFilter || a.assigned_agent_id === agentFilter),
    [appointments, agentFilter]
  );
  const columnAgents = useMemo(
    () => base.agents.filter((a) => !agentFilter || a.userId === agentFilter),
    [base.agents, agentFilter]
  );

  const { columns, fromMinute, toMinute } = useMemo(() => {
    const days = view === 'dia' ? [day] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
    const openings = days.map((d) => {
      const o = openingOf(d, base.agenda);
      return o
        ? {
            from: o.start.getHours() * 60 + o.start.getMinutes(),
            to: o.end.getHours() * 60 + o.end.getMinutes(),
          }
        : null;
    });
    // El rango dibujado abarca el horario de todos los días y cualquier
    // cita que haya quedado fuera de él.
    let from = Math.min(...openings.filter(Boolean).map((o) => o!.from), 8 * 60);
    let to = Math.max(...openings.filter(Boolean).map((o) => o!.to), 18 * 60);
    for (const a of visible) {
      const s = new Date(a.starts_at);
      const e = new Date(a.ends_at);
      from = Math.min(from, s.getHours() * 60);
      to = Math.max(to, e.getHours() * 60 + (e.getMinutes() > 0 ? 60 : 0));
    }
    from = Math.floor(from / 60) * 60;
    to = Math.min(24 * 60, Math.ceil(to / 60) * 60);

    let cols: GridColumn[];
    if (view === 'dia') {
      cols = columnAgents.map((agent) => {
        const color = base.colors.get(agent.userId);
        const count = visible.filter((a) => a.assigned_agent_id === agent.userId && isActiveStatus(a.status)).length;
        return {
          key: agent.userId,
          day,
          agentId: agent.userId,
          open: openings[0],
          // Un asesor solo tiene su propia columna; admin escribe en todas.
          writable: canWrite,
          appointments: visible.filter((a) => a.assigned_agent_id === agent.userId),
          header: (
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white',
                  color?.avatar ?? 'bg-primary'
                )}
              >
                {initials(agent.fullName)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{agent.fullName}</span>
                <span className="text-muted-foreground block text-[11px]">{t('day.count', { count })}</span>
              </span>
            </div>
          ),
        };
      });
    } else {
      const today = toDayKey(new Date());
      cols = days.map((d, i) => ({
        key: toDayKey(d),
        day: d,
        agentId: null,
        open: openings[i],
        writable: canWrite,
        appointments: visible.filter((a) => toDayKey(a.starts_at) === toDayKey(d)),
        header: (
          <button
            type="button"
            onClick={() => setParams({ vista: 'dia', fecha: toDayKey(d) })}
            className="hover:text-primary flex w-full items-center justify-center gap-1.5 text-sm"
          >
            <span className="text-muted-foreground">{t(`weekdaysShort.${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]}`)}</span>
            <span
              className={cn(
                'flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-semibold',
                toDayKey(d) === today && 'bg-primary text-primary-foreground'
              )}
            >
              {d.getDate()}
            </span>
          </button>
        ),
      }));
    }
    return { columns: cols, fromMinute: from, toMinute: to };
  }, [view, day, range.from, base.agenda, base.colors, visible, columnAgents, canWrite, setParams, t]);

  // En Semana se crea con el asesor filtrado o, para un asesor, él mismo.
  function handleCreateAt(start: Date, agentId: string | null) {
    openCreate(start, agentId ?? (agentFilter || null));
  }

  // ---------------- Encabezado ----------------
  const step = view === 'dia' ? 1 : view === 'semana' ? 7 : 0;
  function shift(dir: -1 | 1) {
    const next =
      view === 'mes'
        ? new Date(day.getFullYear(), day.getMonth() + dir, 1)
        : addDays(day, dir * step);
    setParams({ fecha: toDayKey(next) });
  }

  const title =
    view === 'dia'
      ? formatAppointmentDay(day).replace(/^./, (c) => c.toUpperCase())
      : view === 'semana'
        ? t('week.range', {
            from: range.from.getDate(),
            to: addDays(range.to, -1).getDate(),
            month: MONTHS[addDays(range.to, -1).getMonth()],
            year: addDays(range.to, -1).getFullYear(),
          })
        : `${MONTHS[day.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${day.getFullYear()}`;

  const weekCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of visible) {
      if (isActiveStatus(a.status)) m.set(a.assigned_agent_id, (m.get(a.assigned_agent_id) ?? 0) + 1);
    }
    return m;
  }, [visible]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="border-border flex overflow-hidden rounded-lg border">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setParams({ vista: v })}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                view === v ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {showFilter && (
            <Select value={agentFilter || 'all'} onValueChange={(v) => setParams({ asesor: v === 'all' ? null : String(v) })}>
              <SelectTrigger className="w-48">
                <SelectValue>{(v: string) => (v === 'all' ? t('filter.all') : agentName(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filter.all')}</SelectItem>
                {base.agents.map((a) => (
                  <SelectItem key={a.userId} value={a.userId}>
                    {a.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canWrite && (
            <Button onClick={() => openCreate(null, agentFilter || null)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newAppointment')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('nav.previous')} onClick={() => shift(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={() => setParams({ fecha: null })}>
          {t('nav.today')}
        </Button>
        <Button variant="outline" size="icon" aria-label={t('nav.next')} onClick={() => shift(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-base font-semibold">{title}</span>
        {loading && <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />}
        {view === 'semana' && (
          <div className="ml-auto flex flex-wrap gap-2">
            {columnAgents.map((a) => (
              <span key={a.userId} className="border-border inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs">
                <span className={cn('h-2 w-2 rounded-full', base.colors.get(a.userId)?.dot ?? 'bg-primary')} />
                {a.fullName} · {weekCounts.get(a.userId) ?? 0}
              </span>
            ))}
          </div>
        )}
      </div>

      {base.loading ? null : view === 'mes' ? (
        <MonthView
          gridStart={range.from}
          month={day.getMonth()}
          appointments={visible}
          colors={base.colors}
          onPickDay={(d) => setParams({ vista: 'dia', fecha: toDayKey(d) })}
        />
      ) : columns.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty.noAgents')}</p>
      ) : (
        <TimeGrid
          columns={columns}
          fromMinute={fromMinute}
          toMinute={toMinute}
          colors={base.colors}
          showAgent={view === 'semana'}
          canDrag={(a) => canDragAppointment(a.status, accountRole)}
          onOpen={(a) => setParams({ cita: a.id })}
          onCreateAt={handleCreateAt}
          onMoveRequest={(appointment, start, agentId) => {
            // Un asesor no puede pasarle su cita a otro: la base lo
            // negaría igual.
            if (!isAdmin && agentId !== appointment.assigned_agent_id) return;
            setPendingMove({ appointment, start, agentId });
          }}
        />
      )}

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        base={base}
        appointment={editing}
        prefill={prefill}
        onSaved={() => load()}
      />

      <AppointmentSheet
        appointment={opened}
        agentName={agentName}
        onClose={() => setParams({ cita: null })}
        onEdit={(a) => {
          setParams({ cita: null });
          setEditing(a);
          setPrefill(undefined);
          setDialogOpen(true);
        }}
        onChanged={() => load()}
      />

      <MoveConfirmDialog
        move={pendingMove}
        agentName={(id) => agentName(id)}
        canNotify={base.settings.customer_messages_enabled}
        onCancel={() => setPendingMove(null)}
        onConfirm={confirmMove}
      />
    </div>
  );
}
