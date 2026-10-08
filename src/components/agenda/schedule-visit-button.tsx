'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canWriteAppointments } from '@/lib/appointments/status';
import type { Contact, Conversation } from '@/types';
import { AppointmentDialog } from './appointment-dialog';
import { useAgendaBase } from './use-agenda-base';

interface ScheduleVisitButtonProps {
  conversation: Pick<Conversation, 'id' | 'assigned_agent_id'>;
  contact: Pick<Contact, 'id'>;
}

/**
 * «Agendar visita» en la cabecera de la conversación. El formulario
 * llega con el cliente, la conversación y su asesor puestos. El viewer
 * no lo ve: la base le negaría el guardado.
 */
export function ScheduleVisitButton({ conversation, contact }: ScheduleVisitButtonProps) {
  const t = useTranslations('Agenda');
  const { accountRole } = useAuth();
  const [open, setOpen] = useState(false);

  if (!canWriteAppointments(accountRole)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('scheduleVisit')}
        className="border-border hover:bg-muted text-foreground inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md whitespace-nowrap border px-2.5 text-xs font-medium transition-colors lg:h-7"
      >
        <CalendarPlus className="h-4 w-4" />
        <span className="max-sm:sr-only">{t('scheduleVisit')}</span>
      </button>
      {/* El diálogo (y sus lecturas) solo existe mientras está abierto. */}
      {open && (
        <ScheduleVisitDialog
          conversationId={conversation.id}
          agentId={conversation.assigned_agent_id ?? null}
          contactId={contact.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ScheduleVisitDialog({
  conversationId,
  agentId,
  contactId,
  onClose,
}: {
  conversationId: string;
  agentId: string | null;
  contactId: string;
  onClose: () => void;
}) {
  const base = useAgendaBase();
  const [prefill] = useState(() => ({ contactId, conversationId, agentId, startsAt: null }));
  if (base.loading) return null;
  return (
    <AppointmentDialog
      open
      onOpenChange={(o) => !o && onClose()}
      base={base}
      prefill={prefill}
      onSaved={onClose}
    />
  );
}
