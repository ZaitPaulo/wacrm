'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatAppointmentWhen } from '@/lib/appointments/format';
import { contactLabel, type AgendaAppointment } from '@/lib/appointments/queries';

export interface PendingMove {
  appointment: AgendaAppointment;
  start: Date;
  agentId: string;
}

interface MoveConfirmDialogProps {
  move: PendingMove | null;
  agentName: (id: string) => string;
  /** Si la cuenta tiene activos los mensajes al cliente. */
  canNotify: boolean;
  onCancel: () => void;
  onConfirm: (notifyCustomer: boolean) => Promise<void>;
}

/** Soltar una cita nunca guarda directo: se confirma acá, para no moverla sin querer. */
export function MoveConfirmDialog({ move, agentName, canNotify, onCancel, onConfirm }: MoveConfirmDialogProps) {
  const t = useTranslations('Agenda');
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (move) setNotify(true);
  }, [move]);

  if (!move) return null;
  const changedTime = move.start.getTime() !== new Date(move.appointment.starts_at).getTime();
  const changedAgent = move.agentId !== move.appointment.assigned_agent_id;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('move.title')}</DialogTitle>
          <DialogDescription>{contactLabel(move.appointment)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          {changedTime && (
            <p>
              {t('move.from')} <b>{formatAppointmentWhen(move.appointment.starts_at)}</b>
              <br />
              {t('move.to')} <b>{formatAppointmentWhen(move.start)}</b>
            </p>
          )}
          {changedAgent && (
            <p>
              {t('move.agent')} <b>{agentName(move.agentId)}</b>
            </p>
          )}
          {canNotify && changedTime && (
            <label className="mt-2 flex items-center gap-3">
              <Switch checked={notify} onCheckedChange={setNotify} />
              {t('fields.notifyChange')}
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {t('dialog.cancel')}
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm(canNotify && changedTime && notify);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
