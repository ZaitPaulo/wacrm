// ============================================================
// Citas de visita al concesionario (migración 548, cambio agenda-citas).
//
// Los nombres de estados y motivos son los valores de los CHECK de la
// tabla `appointments`: cambiarlos aquí exige una migración.
// ============================================================

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Ocupan la franja del asesor y reciben confirmación y recordatorio. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'confirmed'];
/** Ya no cambian de hora; solo un admin los corrige. */
export const FINAL_STATUSES: readonly AppointmentStatus[] = ['attended', 'no_show', 'cancelled'];

export function isActiveStatus(status: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export const APPOINTMENT_PURPOSES = [
  'view_vehicle',
  'test_drive',
  'appraisal',
  'signing',
  'delivery',
] as const;
export type AppointmentPurpose = (typeof APPOINTMENT_PURPOSES)[number];

export type ConfirmationStatus = 'none' | 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';
export type ReminderStatus = 'sending' | 'sent' | 'skipped' | 'failed';
export type CustomerResponse = 'confirmed' | 'change_requested';

export interface Appointment {
  id: string;
  account_id: string;
  contact_id: string;
  conversation_id: string | null;
  assigned_agent_id: string;
  starts_at: string;
  duration_minutes: number;
  ends_at: string;
  purpose: AppointmentPurpose;
  notes: string | null;
  status: AppointmentStatus;
  scheduled_at: string;
  confirmation_status: ConfirmationStatus;
  confirmation_sent_at: string | null;
  reminder_status: ReminderStatus | null;
  reminder_sent_at: string | null;
  customer_response: CustomerResponse | null;
  customer_responded_at: string | null;
  /** Columnas del cron de avisos (549). */
  pre_visit_alerted_at?: string | null;
  attendance_reminded_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AppointmentEventKind =
  | 'created'
  | 'rescheduled'
  | 'reassigned'
  | 'status_changed'
  | 'customer_confirmed'
  | 'customer_change_requested'
  | 'confirmation_sent'
  | 'confirmation_skipped'
  | 'confirmation_failed'
  | 'reminder_sent'
  | 'reminder_skipped'
  | 'reminder_failed';

export interface AppointmentEvent {
  id: string;
  appointment_id: string;
  kind: AppointmentEventKind;
  actor_user_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface AppointmentSettings {
  account_id: string;
  customer_messages_enabled: boolean;
  confirmation_template_id: string | null;
  reminder_template_id: string | null;
  /** "HH:MM:SS", como lo devuelve Postgres para `time`. */
  reminder_time: string;
  digest_time: string;
  default_duration_minutes: number;
  /** Minutos antes de la cita para el aviso de visita próxima; null = apagado (549). */
  pre_visit_alert_minutes: number | null;
}

/** Lo que vale cuando la cuenta todavía no guardó su configuración. */
export const DEFAULT_APPOINTMENT_SETTINGS: Omit<AppointmentSettings, 'account_id'> = {
  customer_messages_enabled: false,
  confirmation_template_id: null,
  reminder_template_id: null,
  reminder_time: '10:00:00',
  digest_time: '07:30:00',
  default_duration_minutes: 30,
  pre_visit_alert_minutes: 60,
};

/** Código de Postgres de la restricción `appointments_no_overlap`. */
export const OVERLAP_ERROR_CODE = '23P01';
