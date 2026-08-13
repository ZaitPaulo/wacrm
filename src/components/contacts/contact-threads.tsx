'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';

import { cn } from '@/lib/utils';
import { dateLocale } from '@/lib/date-locale';
import { ChannelBadge } from '@/components/inbox/channel-badge';
import type { MessageChannel } from '@/lib/contacts/channel-identity';

/**
 * Los hilos de un contacto, uno por canal, con el estado de su ventana.
 *
 * NO HAY SELECTOR DE CANAL, y no es un olvido: el canal de una respuesta
 * se lee de la conversación y no se elige. Lo que se elige es el hilo, y
 * esta lista es donde se elige.
 *
 * El indicador de ventana está porque sin él la única forma de saber si
 * se puede escribir por un canal es intentarlo y que falle. Meta solo
 * deja responder por donde la persona escribió y dentro de su plazo, así
 * que "por Instagram le puedes escribir hasta mañana, por Messenger ya
 * no" es la información que decide a cuál hilo entrar.
 */
interface Thread {
  conversation_id: string;
  channel: MessageChannel;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number;
  window: {
    open: boolean;
    closes_at: string | null;
    alternative: 'template' | 'human_agent' | 'none';
  };
}

export function ContactThreads({ contactId }: { contactId: string }) {
  const t = useTranslations('Contacts');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contacts/${contactId}/threads`);
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setThreads(json.threads ?? []);
        }
      } catch {
        // noop — se muestra la lista vacía.
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('threads.loading')}
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-sm">{t('threads.empty')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <Link
          key={thread.conversation_id}
          href={`/inbox?conversation=${thread.conversation_id}`}
          className="hover:bg-muted/50 block rounded-lg border p-3 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <ChannelBadge channel={thread.channel} withLabel />
            <WindowPill window={thread.window} />
          </div>

          <p className="text-muted-foreground mt-1 truncate text-xs">
            {thread.last_message_text || t('threads.noMessages')}
          </p>

          {thread.last_message_at && (
            <p className="text-muted-foreground mt-0.5 text-[10px]">
              {formatDistanceToNow(new Date(thread.last_message_at), {
                addSuffix: true,
                locale: dateLocale(),
              })}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}

/**
 * El estado de la ventana, en una línea.
 *
 * Cerrada NO siempre significa "no puedes escribir": en WhatsApp queda
 * la plantilla aprobada. Por eso el rótulo distingue entre "solo con
 * plantilla" y "ya no se puede", que son dos situaciones distintas para
 * quien tiene que decidir qué hacer.
 */
function WindowPill({ window }: { window: Thread['window'] }) {
  const t = useTranslations('Contacts');

  if (window.open) {
    const closes = window.closes_at
      ? formatDistanceToNow(new Date(window.closes_at), {
          addSuffix: true,
          locale: dateLocale(),
        })
      : null;

    return (
      <span
        className={cn(
          'rounded-full border px-2 py-0.5 text-[10px]',
          'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
        )}
      >
        {closes
          ? t('threads.windowOpenUntil', { when: closes })
          : t('threads.windowOpen')}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px]',
        'border-amber-500/40 bg-amber-500/10 text-amber-500'
      )}
    >
      {window.alternative === 'template'
        ? t('threads.windowTemplateOnly')
        : t('threads.windowClosed')}
    </span>
  );
}
