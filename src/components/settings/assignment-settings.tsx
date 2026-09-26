'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertCircle, ArrowLeftRight, Bot, Loader2, PieChart, Scale, Timer, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { assignmentSettingsErrorKey } from '@/lib/assignment/settings';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip } from './settings-chip';
import {
  DEFAULT_REACTIVATE_DAYS,
  DEFAULT_STALE_HOURS,
  buildAssignmentPayload,
  evenSplit,
  formFromResponse,
  hasErrors,
  serverErrorField,
  sumPercents,
  validateAssignmentForm,
  type AssignmentForm,
  type AssignmentFormErrors,
  type AssignmentSettingsResponse,
  type ErrorField,
} from './assignment-settings-model';

/**
 * Ajustes → Asignación de asesores (cambio `sticky-weighted-assignment`).
 *
 * Cuatro ajustes de la cuenta sobre `GET/PUT /api/assignment/settings`:
 * el reparto por porcentajes de los leads nuevos, la asignación de
 * conversaciones que se quedan sin asesor (en horas), la reactivación
 * del bot para el cliente que vuelve (en días) y quién recibe siempre las
 * ventas y permutas (cambio `asesor-ventas-y-permutas`).
 *
 * Contenedor (`AssignmentSettings`: red y estado) separado de la vista
 * (`AssignmentSettingsView`: pura, probada con el catálogo real). Las
 * reglas —validación, cuerpo parcial, a qué campo va cada error— viven
 * en `assignment-settings-model.ts`.
 */

export interface AssignmentSettingsViewProps {
  status: 'loading' | 'error' | 'ready';
  canEdit: boolean;
  form: AssignmentForm | null;
  /** Errores de la validación local (en vivo). */
  errors: AssignmentFormErrors;
  /** El último error del servidor, ya traducido y ubicado. */
  serverError: { field: ErrorField; message: string } | null;
  dirty: boolean;
  saving: boolean;
  /** Fecha ya formateada en que se activó la regla de horas. */
  staleActiveSince: string | null;
  /** Candidatos a asesor de ventas y permutas: owner, admin y agent. */
  members: { user_id: string; full_name: string; role: string }[];
  onRetry: () => void;
  onPercentChange: (userId: string, value: string) => void;
  onEvenSplit: () => void;
  onRemove: (userId: string) => void;
  onStaleToggle: (on: boolean) => void;
  onStaleHoursChange: (value: string) => void;
  onReactivateToggle: (on: boolean) => void;
  onReactivateDaysChange: (value: string) => void;
  /** '' = nadie (orden normal). */
  onTradeInChange: (userId: string) => void;
  onSave: () => void;
}

const IDS = {
  weightsError: 'assignment-weights-error',
  weightsSum: 'assignment-weights-sum',
  staleHours: 'assignment-stale-hours',
  staleHelp: 'assignment-stale-help',
  staleError: 'assignment-stale-error',
  reactivateDays: 'assignment-reactivate-days',
  reactivateHelp: 'assignment-reactivate-help',
  reactivateError: 'assignment-reactivate-error',
  tradeIn: 'assignment-trade-in',
  tradeInHelp: 'assignment-trade-in-help',
  tradeInError: 'assignment-trade-in-error',
  generalError: 'assignment-general-error',
} as const;

/** Valor del Select para "nadie": Base UI no admite un item con ''. */
const NADIE = '__none';

/** Mensaje de error bajo un campo. `role="alert"` solo para el del
 *  servidor (llega una vez, tras guardar); el de validación local cambia
 *  con cada tecla y va por la región `polite` para no interrumpir. */
function FieldError({
  id,
  message,
  assertive,
}: {
  id: string;
  message: string | null;
  assertive: boolean;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      role={assertive ? 'alert' : undefined}
      aria-live={assertive ? undefined : 'polite'}
      className="flex items-start gap-1.5 text-sm font-medium text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/** Tarjeta de sección a todo el ancho: título con icono y cuerpo. */
function SectionCard({
  icon,
  title,
  titleId,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  titleId: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 p-4 sm:p-5" role="group" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3
          id={titleId}
          className="flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-4">
            {icon}
          </span>
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </Card>
  );
}

/**
 * Una regla con interruptor + número. En móvil el número baja debajo del
 * interruptor; desde `sm` se alinea a la derecha en la misma fila. La
 * ayuda ocupa siempre el ancho completo: es la frase que evita malos
 * entendidos y no debe partirse en una columna angosta.
 */
function RuleRow({
  toggleLabel,
  enabled,
  onToggle,
  inputId,
  inputLabel,
  unit,
  value,
  onChange,
  helpId,
  help,
  offText,
  errorId,
  error,
  errorAssertive,
  extra,
  disabled,
}: {
  toggleLabel: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  inputId: string;
  inputLabel: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  helpId: string;
  help: string;
  offText: string;
  errorId: string;
  error: string | null;
  errorAssertive: boolean;
  extra?: ReactNode;
  disabled: boolean;
}) {
  const describedBy = [helpId, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* El interruptor dentro de su <label>: nombre accesible y área de
            toque que incluye el texto. */}
        <label className="flex min-h-9 cursor-pointer items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(on) => onToggle(on)}
            disabled={disabled}
            aria-describedby={helpId}
          />
          <span className="text-sm font-medium text-foreground">{toggleLabel}</span>
        </label>

        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="text-sm text-muted-foreground">
            {inputLabel}
          </label>
          <Input
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || !enabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="h-9 w-20 text-right tabular-nums"
          />
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            {unit}
          </span>
        </div>
      </div>
      <p id={helpId} className="text-sm text-muted-foreground">
        {help}
      </p>
      {enabled ? extra : <p className="text-sm text-muted-foreground italic">{offText}</p>}
      <FieldError id={errorId} message={error} assertive={errorAssertive} />
    </>
  );
}

export function AssignmentSettingsView(props: AssignmentSettingsViewProps) {
  const t = useTranslations('Settings.assignment.ui');
  const tRoles = useTranslations('Settings.roles');
  const { status, canEdit, form, errors, serverError, dirty, saving } = props;

  const head = <SettingsPanelHead title={t('title')} description={t('description')} />;

  if (!canEdit) {
    return (
      <section>
        {head}
        <Card className="p-4 text-sm text-muted-foreground">{t('adminOnly')}</Card>
      </section>
    );
  }

  if (status === 'loading' || (status === 'ready' && !form)) {
    return (
      <section aria-busy="true">
        {head}
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t('loading')}
        </div>
      </section>
    );
  }

  if (status === 'error' || !form) {
    return (
      <section>
        {head}
        <Card className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            {t('loadFailed')}
          </p>
          <Button variant="outline" onClick={props.onRetry}>
            {t('retry')}
          </Button>
        </Card>
      </section>
    );
  }

  const serverMsg = (field: ErrorField) =>
    serverError && serverError.field === field ? serverError.message : null;

  // Error visible por campo: el del servidor manda (es el que acaba de
  // pasar); si no hay, el de la validación en vivo.
  const weightsError = serverMsg('weights') ?? (errors.weights ? t(`validation.${errors.weights}`) : null);
  const staleError = serverMsg('stale') ?? (errors.stale ? t(`validation.${errors.stale}`) : null);
  const reactivateError =
    serverMsg('reactivate') ?? (errors.reactivate ? t(`validation.${errors.reactivate}`) : null);
  const tradeInError = serverMsg('tradeIn');

  // Lo guardado puede ser alguien que ya dejó la cuenta: se muestra así
  // para que el admin lo cambie, y la base ya lo ignora.
  const tradeInMember = props.members.find((m) => m.user_id === form.tradeInAgentId);
  const tradeInLabel = !form.tradeInAgentId
    ? t('tradeIn.none')
    : tradeInMember
      ? tradeInMember.full_name.trim() || t('weights.unnamed')
      : t('tradeIn.notMember');

  const sum = sumPercents(form.weights);
  const sumText =
    sum === 100
      ? t('weights.sumOk')
      : sum < 100
        ? t('weights.sumMissing', { sum, diff: 100 - sum })
        : t('weights.sumOver', { sum, diff: sum - 100 });
  const sumBad = errors.weights === 'weightsSum' || errors.weights === 'weightsEmpty';

  const invalid = hasErrors(errors);
  const canSave = dirty && !invalid && !saving;
  const hayAsesores = form.weights.length > 0;

  return (
    <section className="animate-in fade-in-50 duration-200">
      {head}

      <div className="space-y-4">
        {/* 1. Reparto por porcentajes */}
        <SectionCard
          icon={<PieChart />}
          title={t('weights.title')}
          titleId="assignment-weights-title"
          action={
            hayAsesores ? (
              <Button
                variant="outline"
                size="sm"
                onClick={props.onEvenSplit}
                disabled={saving}
              >
                <Scale aria-hidden="true" />
                {t('weights.evenSplit')}
              </Button>
            ) : null
          }
        >
          <p className="text-sm text-muted-foreground">{t('weights.explainer')}</p>

          {!hayAsesores ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('weights.noAgents')}
            </p>
          ) : (
            <>
              {form.usingDefaultSplit ? (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  {t('weights.defaultNote')}
                </p>
              ) : null}

              {/* Lista, no tabla: a 360 px cada asesor es una fila con su
                  nombre, su campo y una barra de su parte del 100. */}
              <ul className="divide-y divide-border rounded-lg border border-border">
                {form.weights.map((w) => {
                  const name = w.full_name.trim() || t('weights.unnamed');
                  const n = Number(w.percent);
                  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
                  const rowInvalid =
                    !/^\d+$/.test(w.percent.trim()) || Number(w.percent) > 100;
                  return (
                    <li key={w.user_id} className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'truncate text-sm font-medium',
                              w.eligible ? 'text-foreground' : 'text-muted-foreground line-through',
                            )}
                            title={name}
                          >
                            {name}
                          </p>
                          {!w.eligible ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <SettingsChip variant="warn">{t('weights.ineligible')}</SettingsChip>
                              <span className="text-xs text-muted-foreground">
                                {t('weights.ineligibleHint')}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        {w.eligible ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              value={w.percent}
                              onChange={(e) => props.onPercentChange(w.user_id, e.target.value)}
                              disabled={saving}
                              aria-label={t('weights.percentLabel', { name })}
                              aria-invalid={rowInvalid || sumBad ? true : undefined}
                              aria-describedby={
                                weightsError ? `${IDS.weightsSum} ${IDS.weightsError}` : IDS.weightsSum
                              }
                              className="h-9 w-16 text-right tabular-nums"
                            />
                            <span className="text-sm text-muted-foreground" aria-hidden="true">
                              %
                            </span>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => props.onRemove(w.user_id)}
                            disabled={saving}
                            aria-label={t('weights.removeLabel', { name })}
                          >
                            <X aria-hidden="true" />
                            {t('weights.remove')}
                          </Button>
                        )}
                      </div>

                      {w.eligible ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-200"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p id={IDS.weightsSum} aria-live="polite" className="text-sm">
                  <span className="text-muted-foreground">{t('weights.sumLabel')}: </span>
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      sum === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                    )}
                  >
                    {sumText}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{t('weights.zeroHint')}</p>
              </div>

              <FieldError
                id={IDS.weightsError}
                message={weightsError}
                assertive={!!serverMsg('weights')}
              />
              <p className="text-xs text-muted-foreground">{t('weights.resetNote')}</p>
            </>
          )}
        </SectionCard>

        {/* 2. Conversaciones que se quedan sin asesor */}
        <SectionCard icon={<Timer />} title={t('stale.title')} titleId="assignment-stale-title">
          <RuleRow
            toggleLabel={t('stale.toggle')}
            enabled={form.staleEnabled}
            onToggle={props.onStaleToggle}
            inputId={IDS.staleHours}
            inputLabel={t('stale.hoursLabel')}
            unit={t('stale.unit')}
            value={form.staleHours}
            onChange={props.onStaleHoursChange}
            helpId={IDS.staleHelp}
            help={t('stale.help')}
            offText={t('stale.off')}
            errorId={IDS.staleError}
            error={staleError}
            errorAssertive={!!serverMsg('stale')}
            disabled={saving}
            extra={
              props.staleActiveSince ? (
                <p className="text-sm text-muted-foreground">
                  {t('stale.activeSince', { date: props.staleActiveSince })}
                </p>
              ) : null
            }
          />
        </SectionCard>

        {/* 3. El bot retoma al cliente que vuelve */}
        <SectionCard icon={<Bot />} title={t('reactivate.title')} titleId="assignment-reactivate-title">
          <RuleRow
            toggleLabel={t('reactivate.toggle')}
            enabled={form.reactivateEnabled}
            onToggle={props.onReactivateToggle}
            inputId={IDS.reactivateDays}
            inputLabel={t('reactivate.daysLabel')}
            unit={t('reactivate.unit')}
            value={form.reactivateDays}
            onChange={props.onReactivateDaysChange}
            helpId={IDS.reactivateHelp}
            help={t('reactivate.help')}
            offText={t('reactivate.off')}
            errorId={IDS.reactivateError}
            error={reactivateError}
            errorAssertive={!!serverMsg('reactivate')}
            disabled={saving}
          />
        </SectionCard>

        {/* 4. Ventas y permutas: siempre a una persona */}
        <SectionCard icon={<ArrowLeftRight />} title={t('tradeIn.title')} titleId="assignment-trade-in-title">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor={IDS.tradeIn} className="text-sm font-medium text-foreground">
              {t('tradeIn.label')}
            </label>
            <Select
              value={form.tradeInAgentId || NADIE}
              onValueChange={(v) => props.onTradeInChange(!v || v === NADIE ? '' : String(v))}
              disabled={saving}
            >
              <SelectTrigger
                id={IDS.tradeIn}
                className="w-full sm:w-64"
                aria-describedby={tradeInError ? `${IDS.tradeInHelp} ${IDS.tradeInError}` : IDS.tradeInHelp}
                aria-invalid={tradeInError ? true : undefined}
              >
                <SelectValue>{tradeInLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NADIE}>{t('tradeIn.none')}</SelectItem>
                {props.members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {`${m.full_name.trim() || t('weights.unnamed')} · ${tRoles(m.role)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p id={IDS.tradeInHelp} className="text-sm text-muted-foreground">
            {t('tradeIn.help')}
          </p>
          <FieldError id={IDS.tradeInError} message={tradeInError} assertive={!!tradeInError} />
        </SectionCard>
      </div>

      {/* Barra de guardado pegada al borde inferior del área que se
          desplaza: en el celular el botón queda a mano sin volver arriba. */}
      <div className="sticky bottom-0 z-10 mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {!dirty ? t('noChanges') : invalid ? t('fixErrors') : t('unsaved')}
          </p>
          <FieldError
            id={IDS.generalError}
            message={serverMsg('general')}
            assertive
          />
        </div>
        <Button onClick={props.onSave} disabled={!canSave} className="w-full sm:w-auto">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t('saving')}
            </>
          ) : (
            t('save')
          )}
        </Button>
      </div>
    </section>
  );
}

/** Contenedor: carga, edición en memoria y guardado parcial. */
export function AssignmentSettings() {
  const t = useTranslations('Settings.assignment');
  const format = useFormatter();
  const canEdit = useCan('edit-settings');
  const { profileLoading, accountId } = useAuth();

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [saved, setSaved] = useState<AssignmentSettingsResponse | null>(null);
  const [initial, setInitial] = useState<AssignmentForm | null>(null);
  const [form, setForm] = useState<AssignmentForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ field: ErrorField; message: string } | null>(
    null,
  );

  const apply = useCallback((res: AssignmentSettingsResponse) => {
    const f = formFromResponse(res);
    setSaved(res);
    setInitial(f);
    setForm(structuredClone(f));
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setServerError(null);
    try {
      const res = await fetch('/api/assignment/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      apply((await res.json()) as AssignmentSettingsResponse);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [apply]);

  useEffect(() => {
    if (profileLoading || !canEdit || !accountId) return;
    void load();
  }, [profileLoading, canEdit, accountId, load]);

  const errors = useMemo(() => (form ? validateAssignmentForm(form) : {}), [form]);
  const payload = useMemo(
    () => (form && initial ? buildAssignmentPayload(form, initial) : {}),
    [form, initial],
  );
  const dirty = Object.keys(payload).length > 0;

  // Cada edición limpia el error del servidor: ya no describe lo que hay
  // en pantalla.
  const edit = (fn: (f: AssignmentForm) => AssignmentForm) => {
    setServerError(null);
    setForm((prev) => (prev ? fn(prev) : prev));
  };

  async function save() {
    if (!form || !dirty || hasErrors(errors)) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch('/api/assignment/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 429/403/401 no traen `code`: caen al genérico junto al botón.
        const code = (json as { code?: unknown }).code;
        setServerError({
          field: serverErrorField(code),
          message: t(`errors.${assignmentSettingsErrorKey(code)}`),
        });
        return;
      }
      apply(json as AssignmentSettingsResponse);
      toast.success(t('ui.saved'));
    } catch {
      setServerError({ field: 'general', message: t('errors.save_failed') });
    } finally {
      setSaving(false);
    }
  }

  const staleActiveSince =
    saved?.stale_assign_enabled_at && form?.staleEnabled
      ? format.dateTime(new Date(saved.stale_assign_enabled_at), {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;

  return (
    <AssignmentSettingsView
      status={profileLoading ? 'loading' : status}
      canEdit={profileLoading || canEdit}
      form={form}
      errors={errors}
      serverError={serverError}
      dirty={dirty}
      saving={saving}
      staleActiveSince={staleActiveSince}
      members={saved?.members ?? []}
      onRetry={() => void load()}
      onPercentChange={(userId, value) =>
        edit((f) => ({
          ...f,
          weights: f.weights.map((w) => (w.user_id === userId ? { ...w, percent: value } : w)),
        }))
      }
      onEvenSplit={() =>
        edit((f) => {
          // Parejo entre quienes siguen siendo asesores; quien ya no lo es
          // se queda en su fila para que el admin lo quite a conciencia.
          const elegibles = f.weights.filter((w) => w.eligible);
          const parejo = evenSplit(elegibles.length);
          let i = 0;
          return {
            ...f,
            weights: f.weights.map((w) => (w.eligible ? { ...w, percent: String(parejo[i++]) } : w)),
          };
        })
      }
      onRemove={(userId) =>
        edit((f) => ({ ...f, weights: f.weights.filter((w) => w.user_id !== userId) }))
      }
      onStaleToggle={(on) =>
        edit((f) => ({
          ...f,
          staleEnabled: on,
          staleHours: on && !f.staleHours.trim() ? String(DEFAULT_STALE_HOURS) : f.staleHours,
        }))
      }
      onStaleHoursChange={(v) => edit((f) => ({ ...f, staleHours: v }))}
      onReactivateToggle={(on) =>
        edit((f) => ({
          ...f,
          reactivateEnabled: on,
          reactivateDays:
            on && !f.reactivateDays.trim() ? String(DEFAULT_REACTIVATE_DAYS) : f.reactivateDays,
        }))
      }
      onReactivateDaysChange={(v) => edit((f) => ({ ...f, reactivateDays: v }))}
      onTradeInChange={(userId) => edit((f) => ({ ...f, tradeInAgentId: userId }))}
      onSave={() => void save()}
    />
  );
}
