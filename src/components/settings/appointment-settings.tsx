'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { MessageTemplate } from '@/types';
import {
  checkAppointmentTemplate,
  type AppointmentTemplateKind,
} from '@/lib/appointments/templates';
import { DEFAULT_APPOINTMENT_SETTINGS } from '@/lib/appointments/types';

const DURATIONS = [15, 30, 45, 60, 90, 120];
/** Anticipación del aviso de visita próxima; 'off' lo apaga (NULL en la base). */
const PRE_VISIT_OPTIONS = ['off', '15', '30', '60', '90', '120', '240'] as const;
const NONE = '__none__';

/** "10:00:00" → "10:00", para el `<input type="time">`. */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

/**
 * Ajustes → Agenda: mensajes al cliente (apagados por defecto), las dos
 * plantillas, las horas del recordatorio y del resumen, y la duración
 * por defecto de las citas. Escribe directo en `appointment_settings`
 * bajo la RLS de la 548, que solo deja escribir a admin y owner.
 *
 * Las plantillas se validan al elegirlas con el mismo contrato que usa
 * el cron (`checkAppointmentTemplate`): una que no se pueda enviar falla
 * acá, a la vista, y no días después cuando salga el recordatorio.
 */
export function AppointmentSettings() {
  const t = useTranslations('Settings.appointments');
  const { accountId } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [enabled, setEnabled] = useState(DEFAULT_APPOINTMENT_SETTINGS.customer_messages_enabled);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [reminderTime, setReminderTime] = useState(hhmm(DEFAULT_APPOINTMENT_SETTINGS.reminder_time));
  const [digestTime, setDigestTime] = useState(hhmm(DEFAULT_APPOINTMENT_SETTINGS.digest_time));
  const [duration, setDuration] = useState(DEFAULT_APPOINTMENT_SETTINGS.default_duration_minutes);
  const [preVisit, setPreVisit] = useState<number | null>(DEFAULT_APPOINTMENT_SETTINGS.pre_visit_alert_minutes);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const [s, tpl] = await Promise.all([
        supabase.from('appointment_settings').select('*').eq('account_id', accountId).maybeSingle(),
        supabase.from('message_templates').select('*').eq('account_id', accountId).order('name'),
      ]);
      if (cancelled) return;
      if (s.data) {
        setEnabled(s.data.customer_messages_enabled);
        setConfirmationId(s.data.confirmation_template_id);
        setReminderId(s.data.reminder_template_id);
        setReminderTime(hhmm(s.data.reminder_time));
        setDigestTime(hhmm(s.data.digest_time));
        setDuration(s.data.default_duration_minutes);
        setPreVisit(s.data.pre_visit_alert_minutes ?? null);
      }
      setTemplates((tpl.data ?? []) as MessageTemplate[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const problemOf = (id: string | null, kind: AppointmentTemplateKind): string | null => {
    if (!id) return null;
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return t('problems.missing');
    const check = checkAppointmentTemplate(tpl, kind);
    return check.ok ? null : t(`problems.${check.problem}`);
  };
  const confirmationProblem = problemOf(confirmationId, 'confirmation');
  const reminderProblem = problemOf(reminderId, 'reminder');

  async function save() {
    if (!accountId) return;
    if (enabled && (!confirmationId || !reminderId)) {
      toast.error(t('needTemplates'));
      return;
    }
    if (enabled && (confirmationProblem || reminderProblem)) {
      toast.error(t('invalidTemplates'));
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('appointment_settings').upsert(
      {
        account_id: accountId,
        customer_messages_enabled: enabled,
        confirmation_template_id: confirmationId,
        reminder_template_id: reminderId,
        reminder_time: reminderTime,
        digest_time: digestTime,
        default_duration_minutes: duration,
        pre_visit_alert_minutes: preVisit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );
    setSaving(false);
    if (error) {
      console.error('[settings] agenda:', error.message);
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(t('saved'));
  }

  if (loading) return <div className="text-sm text-muted-foreground">…</div>;

  const templatePicker = (
    kind: AppointmentTemplateKind,
    value: string | null,
    onChange: (id: string | null) => void,
    problem: string | null
  ) => (
    <div className="space-y-1.5">
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : String(v))}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {(v: string) => (v === NONE ? t('noTemplate') : templates.find((x) => x.id === v)?.name ?? '—')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('noTemplate')}</SelectItem>
          {templates.map((tpl) => {
            const check = checkAppointmentTemplate(tpl, kind);
            return (
              <SelectItem key={tpl.id} value={tpl.id} disabled={!check.ok}>
                {tpl.name}
                {tpl.language ? ` · ${tpl.language}` : ''}
                {!check.ok ? ` — ${t(`problems.${check.problem}`)}` : ''}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('duration')}</p>
        <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue>{(v: string) => t('minutes', { count: Number(v) })}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DURATIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {t('minutes', { count: d })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t('preVisit')}</p>
        <p className="text-sm text-muted-foreground">{t('preVisitHint')}</p>
        <Select
          value={preVisit === null ? 'off' : String(preVisit)}
          onValueChange={(v) => setPreVisit(v === 'off' ? null : Number(v))}
        >
          <SelectTrigger className="w-48">
            <SelectValue>
              {(v: string) => (v === 'off' ? t('preVisitOff') : t('preVisitBefore', { count: Number(v) }))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRE_VISIT_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {o === 'off' ? t('preVisitOff') : t('preVisitBefore', { count: Number(o) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor="digest-time">
          {t('digestTime')}
        </label>
        <p className="text-sm text-muted-foreground">{t('digestTimeHint')}</p>
        <input
          id="digest-time"
          type="time"
          value={digestTime}
          onChange={(e) => setDigestTime(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('contractTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('contract')}</p>
          </div>
        </div>
      </div>

      <label className="flex items-start gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium text-foreground">{t('enable')}</span>
          <span className="block text-sm text-muted-foreground">{t('enableHint')}</span>
        </span>
      </label>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('confirmationTemplate')}</p>
          <p className="text-sm text-muted-foreground">{t('confirmationHint')}</p>
          {templatePicker('confirmation', confirmationId, setConfirmationId, confirmationProblem)}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('reminderTemplate')}</p>
          <p className="text-sm text-muted-foreground">{t('reminderHint')}</p>
          {templatePicker('reminder', reminderId, setReminderId, reminderProblem)}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="reminder-time">
            {t('reminderTime')}
          </label>
          <p className="text-sm text-muted-foreground">{t('reminderTimeHint')}</p>
          <input
            id="reminder-time"
            type="time"
            value={reminderTime}
            onChange={(e) => setReminderTime(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </div>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? t('saving') : t('save')}
      </Button>
    </div>
  );
}
