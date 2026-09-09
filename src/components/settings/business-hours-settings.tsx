'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  HORARIO_VACIO,
  parseHorario,
  type DiaSemana,
  type HorarioSemanal,
} from '@/lib/outbound/business-hours';

/**
 * Orden de lectura humano: la semana empieza en lunes, no en domingo.
 * `Date.getDay()` numera desde el domingo y por eso el tipo los guarda
 * así, pero nadie lee su horario en ese orden.
 */
const ORDEN: DiaSemana[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const FRANJA_POR_DEFECTO: [string, string] = ['08:00', '18:00'];

export function BusinessHoursSettings() {
  const t = useTranslations('Settings.businessHours');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [festivos, setFestivos] = useState(false);
  const [hours, setHours] = useState<HorarioSemanal>(HORARIO_VACIO);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/account');
        const json = await res.json();
        if (res.ok) {
          const a = json.account ?? {};
          setEnabled(!!a.quiet_hours_enabled);
          setFestivos(a.holiday_calendar === 'CO');
          // El mismo parser que usa el motor de envío: lo que se ve acá
          // es exactamente lo que el sistema va a obedecer.
          setHours(parseHorario(a.business_hours));
        }
      } catch {
        // noop — se muestran los valores por defecto.
      }
      setLoading(false);
    })();
  }, []);

  function setDia(dia: DiaSemana, franja: [string, string] | null) {
    setHours((prev) => ({ ...prev, [dia]: franja }));
  }

  function validar(): string | null {
    if (!enabled) return null;
    const abiertos = ORDEN.filter((d) => hours[d]);
    if (abiertos.length === 0) return t('noDays');
    for (const d of abiertos) {
      const [desde, hasta] = hours[d]!;
      if (hasta <= desde) return t('invalidRange');
    }
    return null;
  }

  async function save() {
    // Se valida antes de mandar porque el servidor, con su parser
    // tolerante, convertiría un día mal escrito en un día CERRADO sin
    // avisar — y el administrador se iría creyendo que lo guardó.
    const error = validar();
    if (error) {
      toast.error(error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quiet_hours_enabled: enabled,
          business_hours: hours,
          holiday_calendar: festivos ? 'CO' : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t('saveFailed'));
      toast.success(t('saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">…</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/*
        Lo primero que se lee es qué NO hace este ajuste. Sin esto, el
        nombre «horario de atención» se entiende como «el bot se calla
        de noche», y alguien lo apagaría por miedo a dejar clientes sin
        respuesta — que es justo lo contrario de lo que hace.
      */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('ruleTitle')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t('rule')}</p>
          </div>
        </div>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-border"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">
            {t('enable')}
          </span>
          <span className="block text-sm text-muted-foreground">
            {t('enableHint')}
          </span>
        </span>
      </label>

      <fieldset
        disabled={!enabled}
        className="space-y-2 transition-opacity disabled:opacity-50"
      >
        {ORDEN.map((dia) => {
          const franja = hours[dia];
          const abierto = franja !== null;
          return (
            <div
              key={dia}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <label className="flex min-w-[9rem] items-center gap-2">
                <input
                  type="checkbox"
                  checked={abierto}
                  onChange={(e) =>
                    setDia(dia, e.target.checked ? FRANJA_POR_DEFECTO : null)
                  }
                  className="h-4 w-4 rounded border-border"
                />
                <span className="text-sm font-medium text-foreground">
                  {t(`days.${dia}`)}
                </span>
              </label>

              {abierto ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={franja[0]}
                    onChange={(e) => setDia(dia, [e.target.value, franja[1]])}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                    aria-label={`${t('from')} — ${t(`days.${dia}`)}`}
                  />
                  <span className="text-sm text-muted-foreground">–</span>
                  <input
                    type="time"
                    value={franja[1]}
                    onChange={(e) => setDia(dia, [franja[0], e.target.value])}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                    aria-label={`${t('to')} — ${t(`days.${dia}`)}`}
                  />
                </div>
              ) : (
                <span className="text-sm italic text-muted-foreground">
                  {t('closed')}
                </span>
              )}
            </div>
          );
        })}

        <label className="flex items-start gap-3 pt-2">
          <input
            type="checkbox"
            checked={festivos}
            onChange={(e) => setFestivos(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              {t('holidays')}
            </span>
            <span className="block text-sm text-muted-foreground">
              {t('holidaysHint')}
            </span>
          </span>
        </label>
      </fieldset>

      <p className="text-sm text-muted-foreground">{t('humanNote')}</p>

      <Button onClick={save} disabled={saving}>
        {saving ? t('saving') : t('save')}
      </Button>
    </div>
  );
}
