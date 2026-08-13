'use client';

import { MessageCircle, Camera, MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { MessageChannel } from '@/lib/contacts/channel-identity';

/**
 * Insignia del canal por el que existe una conversación.
 *
 * Un contacto puede tener un hilo de WhatsApp y otro de Instagram, y de
 * cuál esté abierto depende por dónde sale la respuesta. Sin este
 * indicador, dos hilos de la misma persona se ven idénticos en la lista.
 */
const CHANNEL_STYLE: Record<
  MessageChannel,
  { icon: typeof MessageCircle; className: string }
> = {
  whatsapp: {
    icon: MessageCircle,
    className: 'text-emerald-500',
  },
  instagram: {
    icon: Camera,
    className: 'text-pink-500',
  },
  messenger: {
    icon: MessagesSquare,
    className: 'text-sky-500',
  },
};

export function ChannelBadge({
  channel,
  withLabel = false,
  className,
}: {
  channel: MessageChannel;
  /** Muestra el nombre además del icono. Para la cabecera del hilo. */
  withLabel?: boolean;
  className?: string;
}) {
  const t = useTranslations('Inbox');
  const style = CHANNEL_STYLE[channel];
  if (!style) return null;

  const Icon = style.icon;
  const label = t(`channels.${channel}`);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        style.className,
        className
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" />
      {withLabel && <span className="text-xs">{label}</span>}
    </span>
  );
}
