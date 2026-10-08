// ============================================================
// Lecturas y escrituras de citas desde el navegador, bajo la RLS de la
// migración 548. No hay ruta de API para el CRUD: la base ya decide
// quién ve y quién escribe qué (mismo patrón que contactos y negocios).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatVehicleLabel } from '@/lib/pipelines/deal-vehicle';
import { OVERLAP_ERROR_CODE, type Appointment, type AppointmentPurpose } from './types';

export interface AgendaVehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  license_plate: string | null;
  /** Estado en el inventario: la cita avisa si dejó de estar disponible. */
  status?: 'available' | 'reserved' | 'sold' | 'hidden';
}

/** Una cita con lo que la Agenda muestra de ella. */
export interface AgendaAppointment extends Appointment {
  contact: { id: string; name: string | null; phone: string | null } | null;
  vehicles: AgendaVehicle[];
}

export const AGENDA_SELECT =
  '*, contact:contacts(id, name, phone), appointment_vehicles(vehicle:inventory_vehicles(id, brand, model, year, license_plate, status))';

type RawRow = Appointment & {
  contact: AgendaAppointment['contact'];
  appointment_vehicles?: { vehicle: AgendaVehicle | null }[] | null;
};

export function normalizeAgendaRow(row: RawRow): AgendaAppointment {
  const { appointment_vehicles, ...rest } = row;
  return {
    ...rest,
    vehicles: (appointment_vehicles ?? [])
      .map((av) => av.vehicle)
      .filter((v): v is AgendaVehicle => !!v),
  };
}

export function contactLabel(a: Pick<AgendaAppointment, 'contact'>): string {
  return a.contact?.name?.trim() || a.contact?.phone || '—';
}

export function vehicleLabels(a: Pick<AgendaAppointment, 'vehicles'>): string[] {
  return a.vehicles.map((v) => formatVehicleLabel(v));
}

/** Citas que EMPIEZAN en [from, to), con contacto y vehículos. */
export async function fetchAppointmentsInRange(
  db: SupabaseClient,
  accountId: string,
  from: Date,
  to: Date
): Promise<AgendaAppointment[]> {
  const { data, error } = await db
    .from('appointments')
    .select(AGENDA_SELECT)
    .eq('account_id', accountId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at');
  if (error) throw error;
  return ((data ?? []) as RawRow[]).map(normalizeAgendaRow);
}

/** Citas activas de un asesor en un día: lo que ocupa sus franjas. */
export async function fetchAgentBusy(
  db: SupabaseClient,
  agentId: string,
  dayStart: Date,
  dayEnd: Date
): Promise<Pick<Appointment, 'id' | 'starts_at' | 'ends_at'>[]> {
  const { data, error } = await db
    .from('appointments')
    .select('id, starts_at, ends_at')
    .eq('assigned_agent_id', agentId)
    .in('status', ['scheduled', 'confirmed'])
    .lt('starts_at', dayEnd.toISOString())
    .gt('ends_at', dayStart.toISOString());
  if (error) throw error;
  return data ?? [];
}

export interface AppointmentInput {
  accountId: string;
  contactId: string;
  conversationId: string | null;
  agentId: string;
  startsAt: Date;
  durationMinutes: number;
  purpose: AppointmentPurpose;
  notes: string;
  vehicleIds: string[];
  /** Encolar la confirmación al cliente (`confirmation_status = 'pending'`). */
  notifyCustomer: boolean;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'overlap' | 'forbidden' | 'error'; message?: string };

function mapError(error: { code?: string; message?: string }): SaveResult {
  if (error.code === OVERLAP_ERROR_CODE) return { ok: false, reason: 'overlap' };
  if (error.code === '42501') return { ok: false, reason: 'forbidden', message: error.message };
  return { ok: false, reason: 'error', message: error.message };
}

async function syncVehicles(
  db: SupabaseClient,
  appointmentId: string,
  vehicleIds: string[],
  previous: string[]
): Promise<{ code?: string; message?: string } | null> {
  const toRemove = previous.filter((id) => !vehicleIds.includes(id));
  const toAdd = vehicleIds.filter((id) => !previous.includes(id));
  if (toRemove.length) {
    const { error } = await db
      .from('appointment_vehicles')
      .delete()
      .eq('appointment_id', appointmentId)
      .in('vehicle_id', toRemove);
    if (error) return error;
  }
  if (toAdd.length) {
    const { error } = await db
      .from('appointment_vehicles')
      .insert(toAdd.map((vehicle_id) => ({ appointment_id: appointmentId, vehicle_id })));
    if (error) return error;
  }
  return null;
}

export async function createAppointment(
  db: SupabaseClient,
  input: AppointmentInput
): Promise<SaveResult> {
  const { data, error } = await db
    .from('appointments')
    .insert({
      account_id: input.accountId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      assigned_agent_id: input.agentId,
      starts_at: input.startsAt.toISOString(),
      duration_minutes: input.durationMinutes,
      purpose: input.purpose,
      notes: input.notes.trim() || null,
      confirmation_status: input.notifyCustomer ? 'pending' : 'none',
    })
    .select('id')
    .single();
  if (error) return mapError(error);
  const vehicleError = await syncVehicles(db, data.id, input.vehicleIds, []);
  if (vehicleError) return mapError(vehicleError);
  return { ok: true, id: data.id };
}

export async function updateAppointment(
  db: SupabaseClient,
  current: Pick<AgendaAppointment, 'id' | 'starts_at' | 'duration_minutes' | 'vehicles'>,
  input: AppointmentInput
): Promise<SaveResult> {
  const moved =
    new Date(current.starts_at).getTime() !== input.startsAt.getTime() ||
    current.duration_minutes !== input.durationMinutes;
  const { error } = await db
    .from('appointments')
    .update({
      assigned_agent_id: input.agentId,
      starts_at: input.startsAt.toISOString(),
      duration_minutes: input.durationMinutes,
      purpose: input.purpose,
      notes: input.notes.trim() || null,
      // Solo un cambio de hora vuelve a avisar al cliente.
      ...(moved && input.notifyCustomer ? { confirmation_status: 'pending' } : {}),
    })
    .eq('id', current.id);
  if (error) return mapError(error);
  const vehicleError = await syncVehicles(
    db,
    current.id,
    input.vehicleIds,
    current.vehicles.map((v) => v.id)
  );
  if (vehicleError) return mapError(vehicleError);
  return { ok: true, id: current.id };
}

/** Mover arrastrando: hora y, para admin, asesor. */
export async function moveAppointment(
  db: SupabaseClient,
  id: string,
  startsAt: Date,
  agentId: string,
  notifyCustomer: boolean
): Promise<SaveResult> {
  const { error } = await db
    .from('appointments')
    .update({
      starts_at: startsAt.toISOString(),
      assigned_agent_id: agentId,
      ...(notifyCustomer ? { confirmation_status: 'pending' } : {}),
    })
    .eq('id', id);
  if (error) return mapError(error);
  return { ok: true, id };
}

export async function setAppointmentStatus(
  db: SupabaseClient,
  id: string,
  status: Appointment['status']
): Promise<SaveResult> {
  const { error } = await db.from('appointments').update({ status }).eq('id', id);
  if (error) return mapError(error);
  return { ok: true, id };
}
