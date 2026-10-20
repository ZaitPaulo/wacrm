'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import {
  INTERACTION_KINDS,
  INTERACTION_OUTCOMES,
  isCallKind,
  type InteractionKind,
  type InteractionOutcome,
} from '@/lib/contacts/interactions';
import type { TimelineEvent } from '@/lib/contacts/timeline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Valor de un `<input type="datetime-local">` en hora local. */
function toLocalInput(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

interface InteractionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  /** Interacción a corregir; sin ella se registra una nueva. */
  editing?: TimelineEvent | null;
  onSaved: () => void;
}

/**
 * "Registrar interacción": llamada saliente o entrante, visita sin cita
 * u otra. La fecha puede ser pasada (se registra después) pero no futura:
 * las visitas futuras se agendan en la Agenda. El resultado solo aplica
 * a llamadas. Al corregir, el tipo no cambia.
 */
export function InteractionDialog(props: InteractionDialogProps) {
  // El formulario se monta de nuevo en cada apertura, con los valores del
  // evento a corregir o los de una interacción nueva.
  if (!props.open) return null;
  return <InteractionForm {...props} />;
}

function InteractionForm({ open, onOpenChange, contactId, editing, onSaved }: InteractionDialogProps) {
  const t = useTranslations('Contacts.interactions');
  const tl = useTranslations('Contacts.timeline');
  const d = editing?.data ?? {};

  const [kind, setKind] = useState<InteractionKind>(
    (d.interaction_kind as InteractionKind) ?? 'call_outbound'
  );
  const [outcome, setOutcome] = useState<InteractionOutcome | ''>(
    (d.outcome as InteractionOutcome) ?? ''
  );
  const [minutes, setMinutes] = useState(
    typeof d.duration_seconds === 'number' ? String(Math.round(d.duration_seconds / 60)) : ''
  );
  const [when, setWhen] = useState(() =>
    toLocalInput(editing ? new Date(editing.occurred_at) : new Date())
  );
  const [note, setNote] = useState(typeof d.note === 'string' ? d.note : '');
  const [saving, setSaving] = useState(false);
  // "Ahora" se fija al abrir: el formulario vive segundos, y así el render
  // no depende del reloj.
  const [openedAt] = useState(() => Date.now());

  const isCall = isCallKind(kind);
  const whenDate = new Date(when);
  const isFuture = !Number.isNaN(whenDate.getTime()) && whenDate.getTime() > openedAt + 60_000;

  async function save() {
    if (Number.isNaN(whenDate.getTime())) {
      toast.error(t('errors.invalid_date'));
      return;
    }
    if (isFuture) {
      toast.error(t('errors.future_date'));
      return;
    }
    const mins = minutes.trim() === '' ? null : Number(minutes);
    if (mins !== null && (!Number.isInteger(mins) || mins < 0)) {
      toast.error(t('errors.invalid_duration'));
      return;
    }
    const payload = {
      outcome: isCall && outcome ? outcome : null,
      duration_seconds: mins === null ? null : mins * 60,
      occurred_at: whenDate.toISOString(),
      note: note.trim() || null,
    };

    setSaving(true);
    const res = editing
      ? await fetch(`/api/contacts/${contactId}/interactions/${editing.source_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch(`/api/contacts/${contactId}/interactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, ...payload }),
        });
    setSaving(false);

    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      const known = ['invalid_date', 'future_date', 'invalid_duration', 'outcome_not_call'];
      toast.error(json.error && known.includes(json.error) ? t(`errors.${json.error}`) : t('errors.saveFailed'));
      return;
    }
    toast.success(editing ? t('updated') : t('saved'));
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle') : t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t('fields.kind')}</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as InteractionKind);
                if (!isCallKind(v as InteractionKind)) setOutcome('');
              }}
              disabled={!!editing}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: InteractionKind) => tl(`interactionKinds.${v}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {INTERACTION_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {tl(`interactionKinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="interaction-when">{t('fields.when')}</Label>
            <Input
              id="interaction-when"
              type="datetime-local"
              value={when}
              max={toLocalInput(new Date(openedAt))}
              onChange={(e) => setWhen(e.target.value)}
            />
            {isFuture && <p className="text-xs text-red-400">{t('errors.future_date')}</p>}
          </div>

          {isCall && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>{t('fields.outcome')}</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as InteractionOutcome)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: InteractionOutcome | '') => (v ? tl(`outcomes.${v}`) : t('fields.outcomePlaceholder'))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {INTERACTION_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {tl(`outcomes.${o}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="interaction-minutes">{t('fields.minutes')}</Label>
                <Input
                  id="interaction-minutes"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="interaction-note">{t('fields.note')}</Label>
            <Textarea
              id="interaction-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('fields.notePlaceholder')}
              className="min-h-[70px] resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving || isFuture}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
