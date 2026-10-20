'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ContactPicker } from '@/components/contacts/contact-picker';
import { VehiclePicker } from '@/components/pipelines/vehicle-picker';
import { cn } from '@/lib/utils';
import type { PickableContact } from '@/lib/contacts/filter-contacts';
import { formatVehicleLabel, type VehicleInquiryRef } from '@/lib/pipelines/deal-vehicle';
import type { DealVehicle } from '@/types';
import { canManageAllAppointments } from '@/lib/appointments/status';
import { freeSlots } from '@/lib/appointments/slots';
import { formatAppointmentTime, fromDayKey, toDayKey } from '@/lib/appointments/format';
import {
  createAppointment,
  fetchAgentBusy,
  updateAppointment,
  type AgendaAppointment,
  type AgendaVehicle,
} from '@/lib/appointments/queries';
import { APPOINTMENT_PURPOSES, type AppointmentPurpose } from '@/lib/appointments/types';
import type { AgendaBase } from './use-agenda-base';

const VEHICLE_COLUMNS = 'id, brand, model, year, license_plate, price, status';
const DURATIONS = [15, 30, 45, 60, 90, 120];

export interface AppointmentPrefill {
  contactId?: string | null;
  conversationId?: string | null;
  agentId?: string | null;
  startsAt?: Date | null;
}

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: AgendaBase;
  /** Cita a editar; sin ella el formulario crea una nueva. */
  appointment?: AgendaAppointment | null;
  prefill?: AppointmentPrefill;
  onSaved?: (id: string) => void;
}

/**
 * Formulario de cita, para crear y para editar.
 *
 * Las horas que ofrece son las franjas libres del asesor ese día
 * (`freeSlots`), pero no garantizan nada: si otra persona toma la misma
 * franja mientras tanto, la base rechaza el guardado (23P01) y aquí se
 * avisa "Esa hora ya está ocupada" y se recargan las franjas.
 */
export function AppointmentDialog({
  open,
  onOpenChange,
  base,
  appointment,
  prefill,
  onSaved,
}: AppointmentDialogProps) {
  const t = useTranslations('Agenda');
  const { accountId, accountRole, user, defaultCurrency } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const isEdit = !!appointment;
  const isAdmin = canManageAllAppointments(accountRole);

  const [contactId, setContactId] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [day, setDay] = useState(toDayKey(new Date()));
  const [slot, setSlot] = useState<number | null>(null);
  const [duration, setDuration] = useState(base.settings.default_duration_minutes);
  const [purpose, setPurpose] = useState<AppointmentPurpose>('view_vehicle');
  const [notes, setNotes] = useState('');
  const [chosenVehicles, setChosenVehicles] = useState<AgendaVehicle[]>([]);
  const [notify, setNotify] = useState(true);

  const [contacts, setContacts] = useState<PickableContact[]>([]);
  const [fixedContact, setFixedContact] = useState<PickableContact | null>(null);
  const [vehicles, setVehicles] = useState<DealVehicle[]>([]);
  const [inquiries, setInquiries] = useState<VehicleInquiryRef[]>([]);
  const [busy, setBusy] = useState<Awaited<ReturnType<typeof fetchAgentBusy>>>([]);
  const [busyToken, setBusyToken] = useState(0);
  const [saving, setSaving] = useState(false);

  const contactFixed = isEdit || !!prefill?.contactId;

  // Valores iniciales en cada apertura.
  useEffect(() => {
    if (!open) return;
    if (appointment) {
      const start = new Date(appointment.starts_at);
      setContactId(appointment.contact_id);
      setConversationId(appointment.conversation_id);
      setAgentId(appointment.assigned_agent_id);
      setDay(toDayKey(start));
      setSlot(start.getTime());
      setDuration(appointment.duration_minutes);
      setPurpose(appointment.purpose);
      setNotes(appointment.notes ?? '');
      setChosenVehicles(appointment.vehicles);
    } else {
      const start = prefill?.startsAt ?? null;
      setContactId(prefill?.contactId ?? '');
      setConversationId(prefill?.conversationId ?? null);
      // Un asesor siempre se agenda a sí mismo; para admin, el asesor de
      // la conversación o, si no tiene, quien agenda.
      setAgentId(
        accountRole === 'agent'
          ? (user?.id ?? '')
          : (prefill?.agentId ?? user?.id ?? '')
      );
      setDay(toDayKey(start ?? new Date()));
      setSlot(start ? start.getTime() : null);
      setDuration(base.settings.default_duration_minutes);
      setPurpose('view_vehicle');
      setNotes('');
      setChosenVehicles([]);
    }
    setNotify(true);
  }, [open, appointment, prefill, accountRole, user?.id, base.settings.default_duration_minutes]);

  // Contactos: la lista entera solo si hay que elegirlo.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (contactFixed) {
        const id = appointment?.contact_id ?? prefill?.contactId;
        const { data } = await supabase
          .from('contacts')
          .select('id, name, phone')
          .eq('id', id)
          .maybeSingle();
        if (!cancelled) setFixedContact((data as PickableContact | null) ?? null);
      } else if (accountRole === 'agent') {
        // Desde la 553 el asesor VE todos los contactos, pero solo puede
        // agendarle a los que atiende (`appointments_insert` sigue con
        // `contact_visible`): se le ofrecen solo esos.
        const { data } = await supabase
          .from('conversations')
          .select('contact:contacts(id, name, phone)')
          .eq('assigned_agent_id', user?.id ?? '');
        const seen = new Map<string, PickableContact>();
        for (const row of (data ?? []) as unknown as { contact: PickableContact | null }[]) {
          if (row.contact) seen.set(row.contact.id, row.contact);
        }
        const list = [...seen.values()].sort((a, b) =>
          (a.name ?? '').localeCompare(b.name ?? '')
        );
        if (!cancelled) setContacts(list);
      } else {
        const { data } = await supabase.from('contacts').select('id, name, phone').order('name');
        if (!cancelled) setContacts((data ?? []) as PickableContact[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactFixed, appointment?.contact_id, prefill?.contactId, supabase, accountRole, user?.id]);

  // Al elegir contacto desde el calendario, su conversación más reciente:
  // la confirmación sale por ahí.
  useEffect(() => {
    if (!open || contactFixed || !contactId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setConversationId(data?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactFixed, contactId, supabase]);

  // Inventario ofrecible y consultas del contacto (los sugeridos).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('inventory_vehicles')
        .select(VEHICLE_COLUMNS)
        .in('status', ['available', 'reserved']);
      if (!cancelled) setVehicles((data ?? []) as DealVehicle[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  useEffect(() => {
    if (!open || !contactId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('vehicle_inquiries')
        .select('vehicle_id, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!cancelled) setInquiries((data ?? []) as VehicleInquiryRef[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  // Lo que ya ocupa al asesor ese día.
  const dayDate = fromDayKey(day);
  useEffect(() => {
    if (!open || !agentId || !dayDate) return;
    let cancelled = false;
    const start = dayDate;
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    fetchAgentBusy(supabase, agentId, start, end)
      .then((rows) => {
        if (!cancelled) setBusy(rows);
      })
      .catch((err) => console.error('[agenda] franjas:', err));
    return () => {
      cancelled = true;
    };
    // `day` (string) en vez de `dayDate` (objeto nuevo en cada render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId, day, busyToken, supabase]);

  const slots = useMemo(() => {
    if (!dayDate) return [];
    return freeSlots({
      day: dayDate,
      agenda: base.agenda,
      durationMinutes: duration,
      busy,
      ignoreId: appointment?.id,
      now: new Date(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, base.agenda, duration, busy, appointment?.id]);

  // La hora vigente de una cita que se edita se ofrece aunque ya pasó.
  const originalStart = appointment ? new Date(appointment.starts_at).getTime() : null;
  const slotOptions = useMemo(() => {
    const times = slots.map((d) => d.getTime());
    if (originalStart && toDayKey(new Date(originalStart)) === day && !times.includes(originalStart)) {
      times.push(originalStart);
      times.sort((a, b) => a - b);
    }
    return times;
  }, [slots, originalStart, day]);

  const moved = isEdit && slot !== null && (slot !== originalStart || duration !== appointment!.duration_minutes);
  const showNotify = base.settings.customer_messages_enabled && (!isEdit || moved);

  const canSave =
    !!accountId && !!contactId && !!agentId && slot !== null && slotOptions.includes(slot) && !saving;

  async function handleSave() {
    if (!canSave || !accountId || slot === null) return;
    setSaving(true);
    const input = {
      accountId,
      contactId,
      conversationId,
      agentId,
      startsAt: new Date(slot),
      durationMinutes: duration,
      purpose,
      notes,
      vehicleIds: chosenVehicles.map((v) => v.id),
      notifyCustomer: showNotify && notify,
    };
    const result = appointment
      ? await updateAppointment(supabase, appointment, input)
      : await createAppointment(supabase, input);
    setSaving(false);

    if (!result.ok) {
      if (result.reason === 'overlap') {
        toast.error(t('errors.overlap'));
        setSlot(null);
        setBusyToken((n) => n + 1);
      } else {
        console.error('[agenda] guardar:', result.message);
        toast.error(t('errors.saveFailed'));
      }
      return;
    }
    toast.success(isEdit ? t('dialog.updated') : t('dialog.created'));
    onOpenChange(false);
    onSaved?.(result.id);
  }

  function addVehicle(v: DealVehicle | null) {
    if (!v || chosenVehicles.some((c) => c.id === v.id)) return;
    setChosenVehicles((prev) => [
      ...prev,
      { id: v.id, brand: v.brand, model: v.model, year: v.year, license_plate: v.license_plate ?? null, status: v.status },
    ]);
  }

  const agentName = (id: string) => base.allAgents.find((a) => a.userId === id)?.fullName ?? '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('dialog.editTitle') : t('dialog.createTitle')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t('fields.contact')}</Label>
            {contactFixed ? (
              <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm">
                {fixedContact?.name?.trim() || fixedContact?.phone || '…'}
              </div>
            ) : (
              <ContactPicker
                contacts={contacts}
                value={contactId}
                onChange={setContactId}
                labels={{
                  none: t('fields.contactPlaceholder'),
                  search: t('fields.contactSearch'),
                  empty: t('fields.contactEmpty'),
                  more: (count) => t('fields.contactMore', { count }),
                }}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t('fields.agent')}</Label>
              <Select
                value={agentId}
                onValueChange={(v) => {
                  setAgentId(String(v));
                  setSlot(null);
                }}
                disabled={!isAdmin}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => (v ? agentName(v) : t('fields.agentPlaceholder'))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {base.agents.map((a) => (
                    <SelectItem key={a.userId} value={a.userId}>
                      {a.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('fields.purpose')}</Label>
              <Select value={purpose} onValueChange={(v) => setPurpose(v as AppointmentPurpose)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: AppointmentPurpose) => t(`purpose.${v}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_PURPOSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`purpose.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="appointment-day">{t('fields.date')}</Label>
              <Input
                id="appointment-day"
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setSlot(null);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t('fields.duration')}</Label>
              <Select
                value={String(duration)}
                onValueChange={(v) => {
                  setDuration(Number(v));
                  setSlot(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => t('fields.minutes', { count: Number(v) })}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...DURATIONS, duration])]
                    .sort((a, b) => a - b)
                    .map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {t('fields.minutes', { count: d })}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t('fields.time', { agent: agentId ? agentName(agentId) : '—' })}</Label>
            {slotOptions.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('fields.noSlots')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slotOptions.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() => setSlot(time)}
                    className={cn(
                      'border-border hover:bg-muted rounded-md border px-2.5 py-1 text-xs transition-colors',
                      slot === time && 'border-primary bg-primary/10 text-primary font-semibold'
                    )}
                  >
                    {formatAppointmentTime(new Date(time))}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>{t('fields.vehicles')}</Label>
            {chosenVehicles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chosenVehicles.map((v) => (
                  <span
                    key={v.id}
                    className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
                  >
                    {formatVehicleLabel(v)}
                    <button
                      type="button"
                      aria-label={t('fields.removeVehicle')}
                      onClick={() => setChosenVehicles((prev) => prev.filter((c) => c.id !== v.id))}
                      className="hover:bg-background rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <VehiclePicker
              vehicles={vehicles.filter((v) => !chosenVehicles.some((c) => c.id === v.id))}
              inquiries={inquiries}
              value=""
              onChange={addVehicle}
              currency={defaultCurrency}
              labels={{
                placeholder: t('fields.vehicleAdd'),
                none: t('fields.vehicleNone'),
                search: t('fields.vehicleSearch'),
                empty: t('fields.vehicleEmpty'),
                suggested: t('fields.vehicleSuggested'),
                inventory: t('fields.vehicleInventory'),
                status: { reserved: t('fields.vehicleReserved') },
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="appointment-notes">{t('fields.notes')}</Label>
            <Textarea
              id="appointment-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('fields.notesPlaceholder')}
            />
          </div>

          {showNotify && (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={notify} onCheckedChange={setNotify} />
              {isEdit ? t('fields.notifyChange') : t('fields.notify')}
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isEdit ? t('dialog.save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
