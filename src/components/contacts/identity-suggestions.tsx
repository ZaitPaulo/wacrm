'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link2, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { ChannelBadge } from '@/components/inbox/channel-badge';
import type { MessageChannel } from '@/lib/contacts/channel-identity';

/**
 * Fichas que podrían ser la misma persona.
 *
 * Se presenta como SUGERENCIA y nada se une hasta que alguien lo pida.
 * Unir mal mezcla el historial, los documentos y las operaciones de dos
 * clientes distintos, y ese daño es mayor y más difícil de revertir que
 * mantener dos fichas separadas.
 *
 * Por eso también se puede descartar: una sugerencia que no se puede
 * sacar de la vista se vuelve ruido, y una lista de ruido no se lee.
 * El descarte es local a la sesión — la sugerencia volverá a aparecer,
 * porque el dato que la produjo sigue ahí.
 */
interface SuggestionContact {
  id: string;
  name: string | null;
  channels: MessageChannel[];
}

interface Suggestion {
  contact_ids: [string, string];
  matched_on: string;
  contacts: SuggestionContact[];
}

export function IdentitySuggestions({
  onLinked,
}: {
  /** Para que la lista de contactos se recargue tras unir. */
  onLinked?: () => void;
}) {
  const t = useTranslations('Contacts');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts/identity-links');
      if (res.ok) {
        const json = await res.json();
        setSuggestions(json.suggestions ?? []);
      }
    } catch {
      // noop — sin sugerencias no se muestra nada.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const key = (s: Suggestion) => s.contact_ids.join(':');
  const visibles = suggestions.filter((s) => !dismissed.includes(key(s)));

  if (loading || visibles.length === 0) return null;

  async function link(s: Suggestion) {
    setBusy(key(s));
    try {
      const res = await fetch('/api/contacts/identity-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // La primera es la que queda. Es la más antigua, que suele
          // ser la que tiene más historia y datos cargados a mano.
          surviving_contact_id: s.contact_ids[0],
          merged_contact_id: s.contact_ids[1],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('suggestions.linkFailed'));
        return;
      }
      toast.success(t('suggestions.linked'));
      setDismissed((prev) => [...prev, key(s)]);
      await load();
      onLinked?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-4 space-y-2">
      {visibles.map((s) => {
        const k = key(s);
        const [a, b] = s.contacts;

        return (
          <div
            key={k}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            <Link2 className="h-4 w-4 shrink-0 text-amber-500" />

            <span className="flex-1">
              {t('suggestions.maybeSame', { name: a?.name ?? '' })}
              <span className="text-muted-foreground ml-2 inline-flex items-center gap-2">
                {[a, b].map(
                  (c) =>
                    c && (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1"
                      >
                        {c.channels.map((ch) => (
                          <ChannelBadge key={ch} channel={ch} />
                        ))}
                      </span>
                    )
                )}
              </span>
            </span>

            <span className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => link(s)} disabled={busy === k}>
                {busy === k && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                {t('suggestions.link')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed((prev) => [...prev, k])}
                disabled={busy === k}
                aria-label={t('suggestions.dismiss')}
              >
                <X className="h-3 w-3" />
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
