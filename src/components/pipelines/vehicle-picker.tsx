'use client';

import { useMemo, useState } from 'react';
import { Car, Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/currency';
import {
  formatVehicleLabel,
  rankVehicleOptions,
  type VehicleInquiryRef,
  type VehicleLabelInput,
} from '@/lib/pipelines/deal-vehicle';
import type { DealVehicle, VehicleStatus } from '@/types';

export interface VehiclePickerLabels {
  /** Texto del botón cuando no hay vehículo. */
  placeholder: string;
  /** Opción para dejar el negocio sin vehículo. */
  none: string;
  search: string;
  empty: string;
  suggested: string;
  inventory: string;
  /** Marca visible para los estados que no son "disponible". */
  status: Partial<Record<VehicleStatus, string>>;
}

interface VehiclePickerProps {
  id?: string;
  vehicles: DealVehicle[];
  /** Consultas de la vitrina del contacto: de ahí salen los sugeridos. */
  inquiries: VehicleInquiryRef[];
  /** El id elegido; `''` es sin vehículo. */
  value: string;
  /**
   * Nombre del vehículo elegido cuando todavía no está en `vehicles` (p. ej.
   * el embed del negocio mientras carga el inventario).
   */
  fallbackSelected?: VehicleLabelInput | null;
  /** Recibe el vehículo elegido, o null al quitarlo. */
  onChange: (vehicle: DealVehicle | null) => void;
  /** Moneda de la cuenta, para mostrar el precio. */
  currency: string;
  labels: VehiclePickerLabels;
  disabled?: boolean;
}

/**
 * Selector del vehículo de un negocio, con buscador.
 *
 * Mismo patrón que `ContactPicker` (Popover + Input + filas-botón). Arriba van
 * los vehículos que el contacto consultó desde la vitrina y debajo el resto del
 * inventario; el orden y el filtrado los decide `rankVehicleOptions`.
 */
export function VehiclePicker({
  id,
  vehicles,
  inquiries,
  value,
  fallbackSelected,
  onChange,
  currency,
  labels,
  disabled,
}: VehiclePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected: VehicleLabelInput | null =
    vehicles.find((v) => v.id === value) ?? (value ? fallbackSelected ?? null : null);

  const { suggested, others } = useMemo(
    () => rankVehicleOptions(vehicles, inquiries, query, { selectedId: value || null }),
    [vehicles, inquiries, query, value]
  );

  function pick(vehicle: DealVehicle | null) {
    onChange(vehicle);
    setOpen(false);
    setQuery('');
  }

  function renderOption(v: DealVehicle) {
    const statusLabel = labels.status[v.status];
    return (
      <PickerOption key={v.id} selected={v.id === value} onSelect={() => pick(v)}>
        <span className="min-w-0 flex-1 truncate">{formatVehicleLabel(v)}</span>
        {statusLabel && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              v.status === 'reserved'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-muted-foreground/15 text-muted-foreground'
            )}
          >
            {statusLabel}
          </span>
        )}
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {formatCurrency(v.price, currency)}
        </span>
      </PickerOption>
    );
  }

  const nothing = suggested.length === 0 && others.length === 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className="border-border bg-muted w-full justify-between font-normal"
          />
        }
      >
        <span className={cn('flex min-w-0 items-center gap-2', !selected && 'text-muted-foreground')}>
          <Car className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="truncate">{selected ? formatVehicleLabel(selected) : labels.placeholder}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--anchor-width) min-w-80 p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="pl-8"
          />
        </div>

        <div role="listbox" className="max-h-72 overflow-y-auto">
          {/* "Sin vehículo" solo sin búsqueda: al escribir se busca un carro. */}
          {!query.trim() && (
            <PickerOption selected={!value} onSelect={() => pick(null)}>
              <span className="text-muted-foreground">{labels.none}</span>
            </PickerOption>
          )}

          {suggested.length > 0 && (
            <>
              <GroupHeading>{labels.suggested}</GroupHeading>
              {suggested.map(renderOption)}
              {others.length > 0 && <GroupHeading>{labels.inventory}</GroupHeading>}
            </>
          )}
          {others.map(renderOption)}

          {nothing && (
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">{labels.empty}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground px-2 pt-2 pb-1 text-[10px] font-medium tracking-wider uppercase">
      {children}
    </p>
  );
}

function PickerOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
    >
      <Check className={cn('h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      {children}
    </button>
  );
}
