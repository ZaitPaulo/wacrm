'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import type { Message } from '@/types';
import { MessageBubble } from '@/components/inbox/message-bubble';
import { ChannelBadge } from '@/components/inbox/channel-badge';
import type { MessageChannel } from '@/lib/contacts/channel-identity';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface ThreadInfo {
  id: string;
  channel?: MessageChannel;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
}

interface ContactThreadViewerProps {
  contactId: string;
  conversationId: string | null;
  onClose: () => void;
}

/**
 * Un hilo del contacto en SOLO LECTURA, abierto desde la hoja de vida.
 * Sin compositor ni acciones sobre los mensajes: ver el hilo de otro
 * asesor no es atenderlo. Al asignado se le ofrece saltar a la bandeja,
 * donde sí puede responder.
 */
export function ContactThreadViewer({ contactId, conversationId, onClose }: ContactThreadViewerProps) {
  const t = useTranslations('Contacts.thread');
  const { user } = useAuth();
  const [thread, setThread] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const fetchPage = useCallback(
    async (before: string | null) => {
      const qs = new URLSearchParams({ conversation_id: conversationId ?? '' });
      if (before) qs.set('before', before);
      const res = await fetch(`/api/contacts/${contactId}/messages?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { conversation: ThreadInfo; messages: Message[]; has_more: boolean };
    },
    [contactId, conversationId]
  );

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setMessages([]);
    fetchPage(null)
      .then((page) => {
        if (cancelled) return;
        setThread(page.conversation);
        setMessages(page.messages);
        setHasMore(page.has_more);
      })
      .catch(() => !cancelled && toast.error(t('loadFailed')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [conversationId, fetchPage, t]);

  async function loadOlder() {
    if (messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(messages[0].created_at);
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.has_more);
    } catch {
      toast.error(t('loadFailed'));
    }
    setLoadingOlder(false);
  }

  const isMine = !!user && !!thread?.assigned_agent_id && thread.assigned_agent_id === user.id;

  return (
    <Sheet open={!!conversationId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="bg-popover border-border flex w-full flex-col p-0 sm:max-w-lg">
        <SheetHeader className="border-border/50 border-b p-4">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" />
            {t('title')}
            {thread?.channel && <ChannelBadge channel={thread.channel} />}
          </SheetTitle>
          <SheetDescription>
            {thread?.assigned_agent_name
              ? t('attendedBy', { name: thread.assigned_agent_name })
              : t('notAssigned')}
            {' · '}
            {t('readOnly')}
          </SheetDescription>
          {isMine && (
            <Link
              href={`/inbox?c=${thread?.id}`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-8 w-fit items-center rounded-md px-3 text-xs font-medium"
            >
              {t('openInInbox')}
            </Link>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={loadOlder}
                    disabled={loadingOlder}
                    className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    {loadingOlder && <Loader2 className="size-3 animate-spin" />}
                    {t('loadOlder')}
                  </button>
                </div>
              )}
              {messages.length === 0 ? (
                <p className="text-muted-foreground py-10 text-center text-sm">{t('empty')}</p>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
