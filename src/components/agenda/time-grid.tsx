'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { layoutColumn } from '@/lib/appointments/layout';
import { SLOT_STEP_MINUTES } from '@/lib/appointments/slots';
import type { AgendaAppointment } from '@/lib/appointments/queries';
import { AppointmentCard } from './appointment-card';
import type { AgentColor } from '@/lib/appointments/agents';

/** Alto en píxeles de una franja de 30 minutos. */
const SLOT_PX = 40;
const MINUTE_PX = SLOT_PX / SLOT_STEP_MINUTES;

export interface GridColumn {
  key: string;
  header: ReactNode;
  /** Medianoche del día de la columna. */
  day: Date;
  /** Asesor de la columna (vista Día); en Semana, cada cita conserva el suyo. */
  agentId: string | null;
  /** Minutos de apertura y cierre de ese día; null = cerrado. */
  open: { from: number; to: number } | null;
  appointments: AgendaAppointment[];
  /** Si se pueden soltar citas o crear en esta columna. */
  writable: boolean;
}

interface TimeGridProps {
  columns: GridColumn[];
  /** Rango horario que se dibuja, en minutos desde la medianoche. */
  fromMinute: number;
  toMinute: number;
  colors: Map<string, AgentColor>;
  showAgent: boolean;
  canDrag: (a: AgendaAppointment) => boolean;
  onOpen: (a: AgendaAppointment) => void;
  onCreateAt: (start: Date, agentId: string | null) => void;
  onMoveRequest: (a: AgendaAppointment, start: Date, agentId: string) => void;
}

function hourLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00`;
}

/**
 * Cuadrícula de franjas de 30 minutos con una columna por asesor (Día) o
 * por día (Semana). Toda la tarjeta de la cita se arrastra, sin asa; un
 * clic sin mover la abre. Soltar NO guarda: pide confirmación arriba.
 */
export function TimeGrid({
  columns,
  fromMinute,
  toMinute,
  colors,
  showAgent,
  canDrag,
  onOpen,
  onCreateAt,
  onMoveRequest,
}: TimeGridProps) {
  // Un movimiento de 6 px separa el arrastre del clic; en el celular
  // hay que mantener presionado, para no robarle el scroll a la página.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  const slots = useMemo(() => {
    const out: number[] = [];
    for (let m = fromMinute; m < toMinute; m += SLOT_STEP_MINUTES) out.push(m);
    return out;
  }, [fromMinute, toMinute]);

  const byId = useMemo(() => {
    const m = new Map<string, AgendaAppointment>();
    for (const c of columns) for (const a of c.appointments) m.set(a.id, a);
    return m;
  }, [columns]);

  // Hora actual, para la línea roja. Se refresca cada minuto.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  function handleDragEnd(e: DragEndEvent) {
    const appointment = byId.get(String(e.active.id));
    const target = e.over?.data.current as { start: number; agentId: string | null } | undefined;
    if (!appointment || !target) return;
    const agentId = target.agentId ?? appointment.assigned_agent_id;
    const start = new Date(target.start);
    if (
      start.getTime() === new Date(appointment.starts_at).getTime() &&
      agentId === appointment.assigned_agent_id
    ) {
      return;
    }
    onMoveRequest(appointment, start, agentId);
  }

  const height = slots.length * SLOT_PX;
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="border-border bg-card overflow-x-auto rounded-lg border">
        <div className="flex min-w-fit">
          {/* Columna de horas */}
          <div className="border-border w-14 shrink-0 border-r">
            <div className="border-border h-12 border-b" />
            <div className="relative" style={{ height }}>
              {slots
                .filter((m) => m % 60 === 0)
                .map((m) => (
                  <div
                    key={m}
                    className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px]"
                    style={{ top: (m - fromMinute) * MINUTE_PX }}
                  >
                    {hourLabel(m)}
                  </div>
                ))}
            </div>
          </div>

          {columns.map((col) => {
            const layout = layoutColumn(col.appointments);
            const isToday = col.day.toDateString() === now.toDateString();
            return (
              <div key={col.key} className="border-border min-w-[150px] flex-1 border-r last:border-r-0">
                <div className="border-border flex h-12 items-center border-b px-2">{col.header}</div>
                <div className="relative" style={{ height }}>
                  {slots.map((m) => {
                    const start = new Date(
                      col.day.getFullYear(),
                      col.day.getMonth(),
                      col.day.getDate(),
                      0,
                      m
                    );
                    const closed = !col.open || m < col.open.from || m >= col.open.to;
                    return (
                      <SlotCell
                        key={m}
                        id={`${col.key}|${m}`}
                        start={start.getTime()}
                        agentId={col.agentId}
                        top={(m - fromMinute) * MINUTE_PX}
                        closed={closed}
                        hourLine={m % 60 === 0}
                        enabled={col.writable && !closed}
                        onClick={() => onCreateAt(start, col.agentId)}
                      />
                    );
                  })}

                  {isToday && nowMinute >= fromMinute && nowMinute < toMinute && (
                    <div
                      className="pointer-events-none absolute right-0 left-0 z-20 h-0.5 bg-rose-500"
                      style={{ top: (nowMinute - fromMinute) * MINUTE_PX }}
                    >
                      <span className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                    </div>
                  )}

                  {col.appointments.map((a) => {
                    const start = new Date(a.starts_at);
                    const startMinute = start.getHours() * 60 + start.getMinutes();
                    const slot = layout.get(a.id) ?? { lane: 0, lanes: 1 };
                    const top = Math.max(0, (startMinute - fromMinute) * MINUTE_PX);
                    const cardHeight = Math.max(SLOT_PX - 2, a.duration_minutes * MINUTE_PX - 2);
                    return (
                      <DraggableCard
                        key={a.id}
                        appointment={a}
                        disabled={!canDrag(a)}
                        style={{
                          top,
                          height: cardHeight,
                          left: `calc(${(slot.lane / slot.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / slot.lanes}% - 4px)`,
                        }}
                      >
                        <AppointmentCard
                          appointment={a}
                          color={colors.get(a.assigned_agent_id)}
                          compact={cardHeight < 44}
                          showAgent={showAgent}
                          onOpen={() => onOpen(a)}
                        />
                      </DraggableCard>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

function SlotCell({
  id,
  start,
  agentId,
  top,
  closed,
  hourLine,
  enabled,
  onClick,
}: {
  id: string;
  start: number;
  agentId: string | null;
  top: number;
  closed: boolean;
  hourLine: boolean;
  enabled: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { start, agentId }, disabled: !enabled });
  return (
    <div
      ref={setNodeRef}
      onClick={enabled ? onClick : undefined}
      className={cn(
        'absolute right-0 left-0 border-t',
        hourLine ? 'border-border' : 'border-border/40 border-dashed',
        closed && 'bg-muted/50',
        enabled && 'hover:bg-primary/5 cursor-pointer',
        isOver && 'bg-primary/15'
      )}
      style={{ top, height: SLOT_PX }}
    />
  );
}

function DraggableCard({
  appointment,
  disabled,
  style,
  children,
}: {
  appointment: AgendaAppointment;
  disabled: boolean;
  style: React.CSSProperties;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'absolute z-10 touch-manipulation',
        // Toda la superficie es el asa: manito al pasar, puño al arrastrar.
        !disabled && 'cursor-grab active:cursor-grabbing',
        isDragging && 'z-30 opacity-80 shadow-lg'
      )}
      style={{
        ...style,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      {children}
    </div>
  );
}
