'use client';

import Link from 'next/link';
import { UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Ruta de la ficha completa de un contacto. */
export function contactProfileHref(contactId: string): string {
  return `/contacts/${contactId}`;
}

/**
 * Enlace a la ficha (hoja de vida) de un contacto, para los módulos que
 * muestran uno: Inventario, Agenda, avisos. Sin contacto no pinta nada.
 */
export function ContactProfileLink({
  contactId,
  label,
  className,
}: {
  contactId: string | null | undefined;
  label: string;
  className?: string;
}) {
  if (!contactId) return null;
  return (
    <Link
      href={contactProfileHref(contactId)}
      className={cn('text-primary inline-flex items-center gap-1 text-xs hover:underline', className)}
    >
      <UserRound className="size-3" />
      {label}
    </Link>
  );
}
