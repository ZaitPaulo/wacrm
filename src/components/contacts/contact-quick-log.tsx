'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { INTERACTION_OUTCOMES, type InteractionOutcome } from '@/lib/contacts/interactions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type QuickKind = 'note' | 'call' | 'walkIn';
const QUICK_KINDS: QuickKind[] = ['note', 'call', 'walkIn'];

interface ContactQuickLogProps {
  contactId: string;
  onSaved: () => void;
  /** Abre el diálogo completo (llamada entrante, otra fecha, duración). */
  onMoreDetails: () => void;
}

/**
 * Lo que pasó, en un solo lugar encima de la hoja de vida: una nota, una
 * llamada saliente con su resultado o una visita sin cita, con fecha de
 * ahora. Las notas van a `contact_notes` (cualquier asesor, a su nombre,
 * 553) y las llamadas y visitas a `POST /api/contacts/[id]/interactions`.
 * Lo que no cabe aquí (entrante, fecha pasada, minutos) va por "Más
 * detalles", que abre el diálogo de siempre.
 */
export function ContactQuickLog({ contactId, onSaved, onMoreDetails }: ContactQuickLogProps) {
  const t = useTranslations('Contacts.quickLog');
  const tl = useTranslations('Contacts.timeline');
  const tDetail = useTranslations('Contacts.detailView');
  const ti = useTranslations('Contacts.interactions');
  const { accountId, user } = useAuth();

  const [kind, setKind] = useState<QuickKind>('note');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<InteractionOutcome | null>(null);
  const [saving, setSaving] = useState(false);

  // Una nota sin texto no dice nada; una llamada sí: "no contestó" basta.
  const canSave = kind === 'note' ? !!text.trim() : kind === 'call' ? !!outcome || !!text.trim() : true;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    let ok = false;
    if (kind === 'note') {
      if (!user || !accountId) {
        toast.error(tDetail('toastNotAuthenticated'));
        setSaving(false);
        return;
      }
      const { error } = await createClient().from('contact_notes').insert({
        contact_id: contactId,
        account_id: accountId,
        user_id: user.id,
        note_text: text.trim(),
      });
      ok = !error;
    } else {
      const res = await fetch(`/api/contacts/${contactId}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: kind === 'call' ? 'call_outbound' : 'walk_in',
          outcome: kind === 'call' ? outcome : null,
          duration_seconds: null,
          occurred_at: new Date().toISOString(),
          note: text.trim() || null,
        }),
      });
      ok = res.ok;
    }
    setSaving(false);

    if (!ok) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(kind === 'note' ? tDetail('toastNoteAdded') : ti('saved'));
    setText('');
    setOutcome(null);
    onSaved();
  }

  const placeholder =
    kind === 'note' ? t('notePlaceholder') : kind === 'call' ? t('callPlaceholder') : t('walkInPlaceholder');

  return (
    <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-3">
      <div role="group" aria-label={t('label')} className="flex flex-wrap gap-1.5">
        {QUICK_KINDS.map((k) => (
          <Chip
            key={k}
            active={kind === k}
            onClick={() => {
              setKind(k);
              if (k !== 'call') setOutcome(null);
            }}
          >
            {t(k)}
          </Chip>
        ))}
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="bg-background min-h-[64px] resize-y text-sm"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {kind === 'call' && (
            <div role="group" aria-label={t('outcome')} className="flex flex-wrap gap-1.5">
              {INTERACTION_OUTCOMES.map((o) => (
                <Chip key={o} active={outcome === o} onClick={() => setOutcome(outcome === o ? null : o)}>
                  {tl(`outcomes.${o}`)}
                </Chip>
              ))}
            </div>
          )}
          {kind !== 'note' && (
            <button
              type="button"
              onClick={onMoreDetails}
              className="text-primary px-1 text-xs font-medium hover:underline"
            >
              {t('moreDetails')}
            </button>
          )}
        </div>
        <Button size="sm" onClick={save} disabled={!canSave || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

function Chip({
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
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}
