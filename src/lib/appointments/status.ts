// ============================================================
// Qué se puede hacer con una cita según su estado y el rol de quien
// mira. Es el espejo en la interfaz de las reglas que la base hace
// cumplir (trigger `appointments_before_write` y la RLS de la 548): la
// pantalla no ofrece lo que la base va a negar.
// ============================================================

import type { AccountRole } from '@/lib/auth/roles';
import { hasMinRole } from '@/lib/auth/roles';
import { isActiveStatus, type AppointmentStatus } from './types';

export type AppointmentAction =
  | 'confirm'
  | 'attended'
  | 'no_show'
  | 'cancel'
  | 'reschedule'
  | 'reassign'
  | 'reopen';

/** Estado al que lleva cada acción que cambia el estado. */
export const ACTION_TARGET_STATUS: Partial<Record<AppointmentAction, AppointmentStatus>> = {
  confirm: 'confirmed',
  attended: 'attended',
  no_show: 'no_show',
  cancel: 'cancelled',
  reopen: 'scheduled',
};

export function canWriteAppointments(role: AccountRole | null | undefined): boolean {
  return !!role && hasMinRole(role, 'agent');
}

export function canManageAllAppointments(role: AccountRole | null | undefined): boolean {
  return !!role && hasMinRole(role, 'admin');
}

export function availableActions(
  status: AppointmentStatus,
  role: AccountRole | null | undefined
): AppointmentAction[] {
  if (!canWriteAppointments(role)) return [];
  const admin = canManageAllAppointments(role);

  if (!isActiveStatus(status)) {
    // Salir de un estado final es una corrección de admin.
    return admin ? ['reopen'] : [];
  }

  const actions: AppointmentAction[] = [];
  if (status === 'scheduled') actions.push('confirm');
  actions.push('attended', 'no_show', 'reschedule', 'cancel');
  if (admin) actions.push('reassign');
  return actions;
}

/** Solo las citas activas se arrastran, y solo quien puede editarlas. */
export function canDragAppointment(
  status: AppointmentStatus,
  role: AccountRole | null | undefined
): boolean {
  return canWriteAppointments(role) && isActiveStatus(status);
}
