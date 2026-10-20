'use client';

import { useTranslations } from 'next-intl';

import type { PickableContact } from '@/lib/contacts/filter-contacts';
import { ContactProfileLink } from '@/components/contacts/contact-profile-link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SaleClosing {
  sold_price: string;
  sold_at: string;
  sold_to_contact_id: string;
}

/** Fecha de hoy como YYYY-MM-DD, para prellenar los inputs de fecha. */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Mismo rango que valida la API (ver el formulario del Inventario).
const DATE_MIN = '1900-01-01';
const DATE_MAX = '2100-12-31';

interface SaleClosingFieldsProps {
  value: SaleClosing;
  onChange: (patch: Partial<SaleClosing>) => void;
  /** Para el selector de comprador. Ignorado si `buyerName` viene. */
  contacts: PickableContact[];
  /** Comprador fijo (la venta se registra desde su ficha): no se elige. */
  buyerName?: string | null;
  /** Precio de lista, que se propone como precio de cierre. */
  listPrice?: string;
  errorField?: string | null;
}

/**
 * El cierre de venta: precio final, fecha (hoy por defecto) y comprador.
 * Es lo que convierte un cambio de estado en una venta medible. Lo usan
 * el formulario del Inventario y "Registrar venta" de la ficha del
 * contacto, para que las dos vías pidan exactamente lo mismo; las reglas
 * las aplica `PATCH /api/inventory/[id]` en ambos casos.
 */
export function SaleClosingFields({
  value,
  onChange,
  contacts,
  buyerName,
  listPrice,
  errorField,
}: SaleClosingFieldsProps) {
  const t = useTranslations('Inventory');
  const buyerFixed = buyerName !== undefined;

  return (
    <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 sm:col-span-2">
      <div>
        <p className="text-foreground text-sm font-medium">{t('sale.title')}</p>
        <p className="text-muted-foreground text-xs">{t('sale.hint')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="sold_price">{t('sale.price')}</Label>
          <Input
            id="sold_price"
            aria-invalid={errorField === 'sold_price'}
            type="number"
            value={value.sold_price}
            // Se propone el precio de lista para no teclearlo de nuevo
            // cuando se vendió sin descuento.
            placeholder={listPrice || undefined}
            onChange={(e) => onChange({ sold_price: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sold_at">{t('sale.date')}</Label>
          <Input
            id="sold_at"
            aria-invalid={errorField === 'sold_at'}
            type="date"
            min={DATE_MIN}
            max={DATE_MAX}
            value={value.sold_at || todayKey()}
            onChange={(e) => onChange({ sold_at: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sold_to_contact_id">{t('sale.buyer')}</Label>
          {buyerFixed ? (
            <p id="sold_to_contact_id" className="text-foreground flex h-8 items-center text-sm">
              {buyerName || t('sale.noBuyer')}
            </p>
          ) : (
            <Select
              value={value.sold_to_contact_id || 'none'}
              onValueChange={(v) =>
                // 'none' es el centinela de "sin comprador"; el Select
                // puede entregar null al deseleccionar.
                onChange({ sold_to_contact_id: !v || v === 'none' ? '' : v })
              }
            >
              <SelectTrigger id="sold_to_contact_id" aria-invalid={errorField === 'sold_to_contact_id'}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('sale.noBuyer')}</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!buyerFixed && (
            <ContactProfileLink contactId={value.sold_to_contact_id} label={t('contactLink')} />
          )}
        </div>
      </div>
    </div>
  );
}
