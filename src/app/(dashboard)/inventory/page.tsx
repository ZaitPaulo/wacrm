'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { InventoryVehicle, VehicleStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Car,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { formatPrice, formatNumber } from '@/lib/showcase/format';
import { useTranslations } from 'next-intl';
import {
  TRANSMISSIONS,
  FUEL_TYPES,
  BODY_TYPES,
  CONDITIONS,
  suggestedWarrantyPrice,
} from '@/lib/inventory/specs';
import { uploadAccountMedia } from '@/lib/storage/upload-media';

// Sólo la variante visual vive acá; la etiqueta sale del catálogo, por
// clave, para que el orden del selector siga siendo el de este objeto.
const STATUS_META: Record<
  VehicleStatus,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  available: { variant: 'default' },
  reserved: { variant: 'secondary' },
  sold: { variant: 'outline' },
  hidden: { variant: 'secondary' },
};

interface VehicleDraft {
  brand: string;
  model: string;
  year: string;
  license_plate: string;
  vin: string;
  price: string;
  mileage: string;
  transmission: string;
  fuel_type: string;
  body_type: string;
  color: string;
  condition: string;
  doors: string;
  status: VehicleStatus;
  // Lista de precios del cliente (510).
  engine_displacement: string;
  location_city: string;
  warranty_price: string;
  soat_expires_at: string;
  tecnomecanica_expires_at: string;
  has_lien: boolean;
  on_display: boolean;
  accepts_trade_in: boolean;
  featuresText: string;
  images: string[];
  internal_notes: string;
  // Compra (508) — sólo visible/editable para admin+.
  purchase_cost: string;
  purchase_date: string;
  // Cierre de venta (508) — sólo se piden cuando el estado es 'sold'.
  sold_price: string;
  sold_at: string;
  sold_to_contact_id: string;
}

const EMPTY_DRAFT: VehicleDraft = {
  brand: '',
  model: '',
  year: String(new Date().getFullYear()),
  license_plate: '',
  vin: '',
  price: '',
  mileage: '',
  transmission: '',
  fuel_type: '',
  body_type: '',
  color: '',
  condition: 'used',
  doors: '',
  status: 'available',
  engine_displacement: '',
  location_city: '',
  warranty_price: '',
  soat_expires_at: '',
  tecnomecanica_expires_at: '',
  has_lien: false,
  on_display: false,
  // La norma del negocio es recibir permuta; se marca la excepción.
  accepts_trade_in: true,
  featuresText: '',
  images: [],
  internal_notes: '',
  purchase_cost: '',
  purchase_date: '',
  sold_price: '',
  sold_at: '',
  sold_to_contact_id: '',
};

/** Fecha de hoy como YYYY-MM-DD, para prellenar los inputs de fecha. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// features (JSONB) <-> texto "Clave: Valor" por línea.
function featuresToText(features: InventoryVehicle['features']): string {
  if (!features) return '';
  if (Array.isArray(features)) return features.map((f) => String(f)).join('\n');
  return Object.entries(features)
    .map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`))
    .join('\n');
}

/**
 * Convierte el textarea de características a JSONB. Cada línea «Clave:
 * Valor» produce `{ Clave: "Valor" }`; una línea sin «:» se guarda como
 * `{ línea: true }` (característica presente sin valor). Líneas vacías se
 * ignoran.
 */
function textToFeatures(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) out[line] = true;
    else out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function draftFromVehicle(v: InventoryVehicle): VehicleDraft {
  return {
    brand: v.brand,
    model: v.model,
    year: String(v.year),
    license_plate: v.license_plate ?? '',
    vin: v.vin ?? '',
    price: String(v.price),
    mileage: v.mileage != null ? String(v.mileage) : '',
    transmission: v.transmission ?? '',
    fuel_type: v.fuel_type ?? '',
    body_type: v.body_type ?? '',
    color: v.color ?? '',
    condition: v.condition ?? 'used',
    doors: v.doors != null ? String(v.doors) : '',
    status: v.status,
    engine_displacement: v.engine_displacement ?? '',
    location_city: v.location_city ?? '',
    warranty_price: v.warranty_price != null ? String(v.warranty_price) : '',
    soat_expires_at: v.soat_expires_at ?? '',
    tecnomecanica_expires_at: v.tecnomecanica_expires_at ?? '',
    has_lien: v.has_lien ?? false,
    on_display: v.on_display ?? false,
    accepts_trade_in: v.accepts_trade_in ?? true,
    featuresText: featuresToText(v.features),
    images: v.images ?? [],
    internal_notes: v.internal_notes ?? '',
    // `acquisition` llega vacío tanto si no hay costo cargado como si el
    // usuario no tiene permiso para verlo: la RLS no distingue, y está bien.
    purchase_cost:
      v.acquisition?.purchase_cost != null ? String(v.acquisition.purchase_cost) : '',
    purchase_date: v.acquisition?.purchase_date ?? '',
    sold_price: v.sold_price != null ? String(v.sold_price) : '',
    sold_at: v.sold_at ? v.sold_at.slice(0, 10) : '',
    sold_to_contact_id: v.sold_to_contact_id ?? '',
  };
}

/**
 * Página de inventario de vehículos (/inventory). Lista, crea, edita y
 * elimina el stock vía las rutas /api/inventory (que además sincronizan
 * cada vehículo con el knowledge base del bot). La escritura se habilita
 * solo para roles con permiso de edición (`send-messages` = agent+).
 */
export default function InventoryPage() {
  const t = useTranslations('Inventory');
  const canEdit = useCan('send-messages');
  // Gate de UI para el costo de compra. La defensa real es la RLS de
  // vehicle_acquisitions: a un 'agent' la API no le devuelve el dato
  // aunque fuerce este flag.
  const canViewMargins = useCan('view-margins');
  const { account } = useAuth();
  const currency = account?.default_currency ?? 'USD';

  const [vehicles, setVehicles] = useState<InventoryVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  // Para el selector de comprador al cerrar una venta. Se cargan una vez
  // con el cliente de sesión (la RLS los acota a la cuenta), igual que en
  // /documents.
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryVehicle | null>(null);
  const [draft, setDraft] = useState<VehicleDraft>(EMPTY_DRAFT);

  // Precio con garantía que propone el botón del formulario. Se recalcula
  // con el precio y la carrocería porque el recargo depende de si es
  // camioneta; queda en null mientras no haya precio del que partir.
  const suggestedWarranty = useMemo(
    () =>
      suggestedWarrantyPrice(
        draft.price.trim() === '' ? null : Number(draft.price),
        draft.body_type || null,
      ),
    [draft.price, draft.body_type],
  );
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadingImages(true);
    try {
      const urls: string[] = [];
      for (const file of files) {
        const { publicUrl } = await uploadAccountMedia('showcase-media', file);
        urls.push(publicUrl);
      }
      setDraft((d) => ({ ...d, images: [...d.images, ...urls] }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toasts.uploadFailed'));
    } finally {
      setUploadingImages(false);
    }
  }

  function removeImage(index: number) {
    setDraft((d) => ({ ...d, images: d.images.filter((_, i) => i !== index) }));
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al cargar');
      setVehicles(json.vehicles ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toasts.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Los contactos sólo alimentan el selector de comprador; si la consulta
  // falla, cerrar una venta sigue siendo posible sin vincular a nadie.
  useEffect(() => {
    const db = createClient();
    void db
      .from('contacts')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          console.warn('[inventory] no se pudieron cargar los contactos:', error);
          return;
        }
        setContacts((data ?? []) as { id: string; name: string }[]);
      });
  }, []);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(v: InventoryVehicle) {
    setEditing(v);
    setDraft(draftFromVehicle(v));
    setDialogOpen(true);
  }

  async function save() {
    if (!draft.brand.trim() || !draft.model.trim() || !draft.year.trim()) {
      toast.error(t('toasts.requiredFields'));
      return;
    }
    // Marcar vendido sin precio de cierre dejaría la venta sin margen ni
    // ingreso en el tablero. El backend también lo rechaza; acá se avisa
    // antes de perder el viaje.
    if (draft.status === 'sold' && draft.sold_price.trim() === '') {
      toast.error(t('toasts.soldPriceRequired'));
      return;
    }
    // Salir de 'sold' borra el cierre (lo impone el CHECK de la 508), así
    // que se avisa antes de que el dato desaparezca.
    if (editing?.status === 'sold' && draft.status !== 'sold') {
      if (!confirm(t('confirmRevertSale'))) return;
    }
    setSaving(true);
    try {
      const payload = {
        brand: draft.brand.trim(),
        model: draft.model.trim(),
        year: Number(draft.year),
        license_plate: draft.license_plate.trim() || null,
        vin: draft.vin.trim() || null,
        price: draft.price.trim() === '' ? 0 : Number(draft.price),
        mileage: draft.mileage.trim() === '' ? null : Number(draft.mileage),
        transmission: draft.transmission || null,
        fuel_type: draft.fuel_type || null,
        body_type: draft.body_type || null,
        color: draft.color.trim() || null,
        condition: draft.condition || 'used',
        doors: draft.doors.trim() === '' ? null : Number(draft.doors),
        status: draft.status,
        engine_displacement: draft.engine_displacement.trim() || null,
        location_city: draft.location_city.trim() || null,
        warranty_price:
          draft.warranty_price.trim() === '' ? null : Number(draft.warranty_price),
        soat_expires_at: draft.soat_expires_at || null,
        tecnomecanica_expires_at: draft.tecnomecanica_expires_at || null,
        has_lien: draft.has_lien,
        on_display: draft.on_display,
        accepts_trade_in: draft.accepts_trade_in,
        features: textToFeatures(draft.featuresText),
        images: draft.images,
        internal_notes: draft.internal_notes.trim() || null,
        // Sólo se mandan si el vehículo queda vendido; al revertir, el
        // backend los limpia solo (applySoldCoherence).
        ...(draft.status === 'sold'
          ? {
              sold_price: Number(draft.sold_price),
              sold_at: draft.sold_at || today(),
              sold_to_contact_id: draft.sold_to_contact_id || null,
            }
          : {}),
        // El costo viaja sólo si el usuario puede verlo; si no, ni se
        // menciona en el body y la API no toca el registro existente.
        ...(canViewMargins
          ? {
              purchase_cost:
                draft.purchase_cost.trim() === ''
                  ? null
                  : Number(draft.purchase_cost),
              purchase_date: draft.purchase_date || null,
            }
          : {}),
      };

      const res = await fetch(
        editing ? `/api/inventory/${editing.id}` : '/api/inventory',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');

      if (json.warning) toast.warning(json.warning);
      else toast.success(editing ? t('toasts.updated') : t('toasts.created'));

      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(v: InventoryVehicle) {
    if (!confirm(`¿Eliminar ${v.brand} ${v.model} ${v.year}?`)) return;
    setDeletingId(v.id);
    try {
      const res = await fetch(`/api/inventory/${v.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al eliminar');
      toast.success(t('toasts.deleted'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toasts.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <span className="text-muted-foreground text-sm">
            {t('vehicleCount', { count: vehicles.length })}
          </span>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addVehicle')}
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.vehicle')}</TableHead>
              <TableHead>{t('table.year')}</TableHead>
              <TableHead>{t('table.plate')}</TableHead>
              <TableHead className="text-right">{t('table.price')}</TableHead>
              <TableHead className="text-right">{t('table.mileage')}</TableHead>
              <TableHead>{t('table.status')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : vehicles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground h-24 text-center">
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              vehicles.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">
                    {v.brand} {v.model}
                  </TableCell>
                  <TableCell>{v.year}</TableCell>
                  <TableCell>{v.license_plate ?? '—'}</TableCell>
                  <TableCell className="text-right">{formatPrice(v.price, currency)}</TableCell>
                  <TableCell className="text-right">
                    {v.mileage != null ? `${formatNumber(v.mileage)} km` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_META[v.status].variant}>
                      {t(`status.${v.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={deletingId === v.id}
                            />
                          }
                        >
                          {deletingId === v.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-4" />
                          )}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(v)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t('actions.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => remove(v)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('actions.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t('dialog.editTitle') : t('dialog.createTitle')}</DialogTitle>
            <DialogDescription>
              {t('dialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand">{t('fields.brand')}</Label>
              <Input
                id="brand"
                value={draft.brand}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">{t('fields.model')}</Label>
              <Input
                id="model"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">{t('fields.year')}</Label>
              <Input
                id="year"
                type="number"
                value={draft.year}
                onChange={(e) => setDraft({ ...draft, year: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">{t('fields.status')}</Label>
              <Select
                value={draft.status}
                onValueChange={(value) =>
                  setDraft({ ...draft, status: value as VehicleStatus })
                }
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_META) as VehicleStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">{t('fields.price')}</Label>
              <Input
                id="price"
                type="number"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mileage">{t('fields.mileage')}</Label>
              <Input
                id="mileage"
                type="number"
                value={draft.mileage}
                onChange={(e) => setDraft({ ...draft, mileage: e.target.value })}
              />
            </div>

            {/* Compra — sólo admin+. Aunque alguien fuerce este bloque, la
                RLS de vehicle_acquisitions rechaza la escritura. */}
            {canViewMargins && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 sm:col-span-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('purchase.title')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('purchase.hint')}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="purchase_cost">{t('purchase.cost')}</Label>
                    <Input
                      id="purchase_cost"
                      type="number"
                      value={draft.purchase_cost}
                      onChange={(e) =>
                        setDraft({ ...draft, purchase_cost: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchase_date">{t('purchase.date')}</Label>
                    <Input
                      id="purchase_date"
                      type="date"
                      value={draft.purchase_date}
                      onChange={(e) =>
                        setDraft({ ...draft, purchase_date: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Cierre de venta — aparece al elegir 'vendido'. Es lo que
                convierte un cambio de estado en una venta medible. */}
            {draft.status === 'sold' && (
              <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 sm:col-span-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('sale.title')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('sale.hint')}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="sold_price">{t('sale.price')}</Label>
                    <Input
                      id="sold_price"
                      type="number"
                      value={draft.sold_price}
                      // Se propone el precio de lista para no teclearlo de
                      // nuevo cuando se vendió sin descuento.
                      placeholder={draft.price || undefined}
                      onChange={(e) =>
                        setDraft({ ...draft, sold_price: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sold_at">{t('sale.date')}</Label>
                    <Input
                      id="sold_at"
                      type="date"
                      value={draft.sold_at || today()}
                      onChange={(e) =>
                        setDraft({ ...draft, sold_at: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sold_to_contact_id">{t('sale.buyer')}</Label>
                    <Select
                      value={draft.sold_to_contact_id || 'none'}
                      onValueChange={(value) =>
                        setDraft({
                          ...draft,
                          // 'none' es el centinela de "sin comprador"; el
                          // Select puede entregar null al deseleccionar.
                          sold_to_contact_id:
                            !value || value === 'none' ? '' : value,
                        })
                      }
                    >
                      <SelectTrigger id="sold_to_contact_id">
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
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="license_plate">{t('fields.plate')}</Label>
              <Input
                id="license_plate"
                value={draft.license_plate}
                onChange={(e) => setDraft({ ...draft, license_plate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vin">{t('fields.vin')}</Label>
              <Input
                id="vin"
                value={draft.vin}
                onChange={(e) => setDraft({ ...draft, vin: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transmission">{t('fields.transmission')}</Label>
              <Select
                value={draft.transmission}
                onValueChange={(v) => setDraft({ ...draft, transmission: v ?? '' })}
              >
                <SelectTrigger id="transmission">
                  <SelectValue placeholder={t('fields.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {TRANSMISSIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fuel_type">{t('fields.fuelType')}</Label>
              <Select
                value={draft.fuel_type}
                onValueChange={(v) => setDraft({ ...draft, fuel_type: v ?? '' })}
              >
                <SelectTrigger id="fuel_type">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {FUEL_TYPES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="body_type">{t('fields.bodyType')}</Label>
              <Select
                value={draft.body_type}
                onValueChange={(v) => setDraft({ ...draft, body_type: v ?? '' })}
              >
                <SelectTrigger id="body_type">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {BODY_TYPES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="condition">{t('fields.condition')}</Label>
              <Select
                value={draft.condition}
                onValueChange={(v) => setDraft({ ...draft, condition: v ?? 'used' })}
              >
                <SelectTrigger id="condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">{t('fields.color')}</Label>
              <Input
                id="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doors">{t('fields.doors')}</Label>
              <Input
                id="doors"
                type="number"
                value={draft.doors}
                onChange={(e) => setDraft({ ...draft, doors: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="engine_displacement">{t('fields.engine')}</Label>
              <Input
                id="engine_displacement"
                placeholder={t('fields.enginePlaceholder')}
                value={draft.engine_displacement}
                onChange={(e) =>
                  setDraft({ ...draft, engine_displacement: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location_city">{t('fields.locationCity')}</Label>
              <Input
                id="location_city"
                placeholder={t('fields.locationCityPlaceholder')}
                value={draft.location_city}
                onChange={(e) => setDraft({ ...draft, location_city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warranty_price">{t('fields.warrantyPrice')}</Label>
              <div className="flex gap-2">
                <Input
                  id="warranty_price"
                  type="number"
                  value={draft.warranty_price}
                  onChange={(e) =>
                    setDraft({ ...draft, warranty_price: e.target.value })
                  }
                />
                {/* Propone precio + recargo (1,5 M vehículo / 2,0 M
                    camioneta) en vez de imponerlo: la regla se cumple en
                    toda la lista del cliente, pero una excepción puntual
                    no debe obligar a pelear con el formulario. */}
                <Button
                  type="button"
                  variant="outline"
                  disabled={suggestedWarranty == null}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      warranty_price: String(suggestedWarranty ?? ''),
                    })
                  }
                >
                  {t('fields.warrantySuggest')}
                </Button>
              </div>
              {suggestedWarranty != null && (
                <p className="text-muted-foreground text-xs">
                  {t('fields.warrantyHint', {
                    amount: formatPrice(suggestedWarranty, currency),
                  })}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="soat_expires_at">{t('fields.soat')}</Label>
              <Input
                id="soat_expires_at"
                type="date"
                value={draft.soat_expires_at}
                onChange={(e) =>
                  setDraft({ ...draft, soat_expires_at: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tecnomecanica_expires_at">{t('fields.tecno')}</Label>
              <Input
                id="tecnomecanica_expires_at"
                type="date"
                value={draft.tecnomecanica_expires_at}
                onChange={(e) =>
                  setDraft({ ...draft, tecnomecanica_expires_at: e.target.value })
                }
              />
            </div>
            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="on_display">{t('fields.onDisplay')}</Label>
                  <p className="text-muted-foreground text-xs">
                    {t('fields.onDisplayHint')}
                  </p>
                </div>
                <Switch
                  id="on_display"
                  checked={draft.on_display}
                  onCheckedChange={(v) => setDraft({ ...draft, on_display: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="accepts_trade_in">{t('fields.acceptsTradeIn')}</Label>
                  <p className="text-muted-foreground text-xs">
                    {t('fields.acceptsTradeInHint')}
                  </p>
                </div>
                <Switch
                  id="accepts_trade_in"
                  checked={draft.accepts_trade_in}
                  onCheckedChange={(v) => setDraft({ ...draft, accepts_trade_in: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="has_lien">{t('fields.hasLien')}</Label>
                  <p className="text-muted-foreground text-xs">
                    {t('fields.hasLienHint')}
                  </p>
                </div>
                <Switch
                  id="has_lien"
                  checked={draft.has_lien}
                  onCheckedChange={(v) => setDraft({ ...draft, has_lien: v })}
                />
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="features">{t('fields.features')}</Label>
              <Textarea
                id="features"
                rows={4}
                placeholder={t('fields.featuresPlaceholder')}
                value={draft.featuresText}
                onChange={(e) => setDraft({ ...draft, featuresText: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t('fields.images')}</Label>
              <div className="flex flex-wrap gap-2">
                {draft.images.map((url, i) => (
                  <div
                    key={i}
                    className="border-border relative size-20 overflow-hidden rounded-md border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                      title={t('images.remove')}
                    >
                      <X className="size-3" />
                    </button>
                    {i === 0 && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">
                        {t('images.primary')}
                      </span>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploadingImages}
                  className="text-muted-foreground border-border flex size-20 items-center justify-center rounded-md border border-dashed disabled:opacity-50"
                  title={t('images.upload')}
                >
                  {uploadingImages ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </button>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />
              <p className="text-muted-foreground text-xs">
                {t('images.hint')}
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="internal_notes">{t('fields.internalNotes')}</Label>
              <Textarea
                id="internal_notes"
                rows={2}
                value={draft.internal_notes}
                onChange={(e) => setDraft({ ...draft, internal_notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {t('dialog.cancel')}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? t('dialog.save') : t('dialog.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
