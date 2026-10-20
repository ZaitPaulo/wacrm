'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { DealVehicle } from '@/types';
import type { VehicleInquiryRef } from '@/lib/pipelines/deal-vehicle';
import { VehiclePicker } from '@/components/pipelines/vehicle-picker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SaleClosingFields, todayKey, type SaleClosing } from './sale-closing-fields';

const VEHICLE_COLUMNS = 'id, brand, model, year, license_plate, price, status';

interface SellVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El comprador queda fijo: la venta se registra desde su ficha. */
  buyer: { id: string; name: string | null };
  onSold: () => void;
}

/**
 * "Registrar venta" desde la ficha del contacto. Ofrece los vehículos
 * disponibles o reservados (primero los que el cliente consultó) y pide
 * el mismo cierre que el Inventario. Escribe por `PATCH
 * /api/inventory/[id]`, que aplica las mismas reglas que desde allá.
 */
export function SellVehicleDialog({ open, onOpenChange, buyer, onSold }: SellVehicleDialogProps) {
  const t = useTranslations('Contacts.sell');
  const tInv = useTranslations('Inventory');
  const { defaultCurrency } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [vehicles, setVehicles] = useState<DealVehicle[]>([]);
  const [inquiries, setInquiries] = useState<VehicleInquiryRef[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [closing, setClosing] = useState<SaleClosing>({
    sold_price: '',
    sold_at: todayKey(),
    sold_to_contact_id: buyer.id,
  });
  const [saving, setSaving] = useState(false);
  const [errorField, setErrorField] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [vehiclesRes, inquiriesRes] = await Promise.all([
        supabase.from('inventory_vehicles').select(VEHICLE_COLUMNS).in('status', ['available', 'reserved']),
        supabase
          .from('vehicle_inquiries')
          .select('vehicle_id, created_at')
          .eq('contact_id', buyer.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (cancelled) return;
      setVehicles((vehiclesRes.data ?? []) as DealVehicle[]);
      setInquiries((inquiriesRes.data ?? []) as VehicleInquiryRef[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, buyer.id]);

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  async function save() {
    if (!vehicle) {
      toast.error(t('vehicleRequired'));
      return;
    }
    if (closing.sold_price.trim() === '') {
      setErrorField('sold_price');
      toast.error(tInv('toasts.soldPriceRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${vehicle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'sold',
          sold_price: Number(closing.sold_price),
          sold_at: closing.sold_at || todayKey(),
          sold_to_contact_id: buyer.id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorField(typeof json.field === 'string' ? json.field : null);
        throw new Error(json.error || tInv('toasts.saveFailed'));
      }
      if (json.warning) toast.warning(json.warning);
      else toast.success(t('sold'));
      onSold();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tInv('toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="sell-vehicle">{t('vehicle')}</Label>
            <VehiclePicker
              id="sell-vehicle"
              vehicles={vehicles}
              inquiries={inquiries}
              value={vehicleId}
              onChange={(v) => {
                setVehicleId(v?.id ?? '');
                setErrorField(null);
              }}
              currency={defaultCurrency}
              labels={{
                placeholder: t('vehiclePlaceholder'),
                none: t('vehicleNone'),
                search: t('vehicleSearch'),
                empty: t('vehicleEmpty'),
                suggested: t('vehicleSuggested'),
                inventory: t('vehicleInventory'),
                status: { reserved: t('vehicleReserved') },
              }}
            />
          </div>
          <SaleClosingFields
            value={closing}
            onChange={(patch) => setClosing((c) => ({ ...c, ...patch }))}
            contacts={[]}
            buyerName={buyer.name}
            listPrice={vehicle ? String(vehicle.price) : undefined}
            errorField={errorField}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving || !vehicle}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
