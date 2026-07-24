'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { InventoryVehicle, VehicleStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  TRANSMISSIONS,
  FUEL_TYPES,
  BODY_TYPES,
  CONDITIONS,
} from '@/lib/inventory/specs';
import { uploadAccountMedia } from '@/lib/storage/upload-media';

const STATUS_META: Record<
  VehicleStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  available: { label: 'Disponible', variant: 'default' },
  reserved: { label: 'Reservado', variant: 'secondary' },
  sold: { label: 'Vendido', variant: 'outline' },
  hidden: { label: 'Oculto', variant: 'secondary' },
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
  featuresText: string;
  images: string[];
  internal_notes: string;
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
  featuresText: '',
  images: [],
  internal_notes: '',
};

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
    featuresText: featuresToText(v.features),
    images: v.images ?? [],
    internal_notes: v.internal_notes ?? '',
  };
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Página de inventario de vehículos (/inventory). Lista, crea, edita y
 * elimina el stock vía las rutas /api/inventory (que además sincronizan
 * cada vehículo con el knowledge base del bot). La escritura se habilita
 * solo para roles con permiso de edición (`send-messages` = agent+).
 */
export default function InventoryPage() {
  const canEdit = useCan('send-messages');

  const [vehicles, setVehicles] = useState<InventoryVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryVehicle | null>(null);
  const [draft, setDraft] = useState<VehicleDraft>(EMPTY_DRAFT);
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
      toast.error(err instanceof Error ? err.message : 'No se pudo subir la imagen');
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
      toast.error(err instanceof Error ? err.message : 'No se pudo cargar el inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      toast.error('Marca, modelo y año son obligatorios');
      return;
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
        features: textToFeatures(draft.featuresText),
        images: draft.images,
        internal_notes: draft.internal_notes.trim() || null,
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
      else toast.success(editing ? 'Vehículo actualizado' : 'Vehículo agregado');

      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
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
      toast.success('Vehículo eliminado');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Inventario</h1>
          <span className="text-muted-foreground text-sm">
            {vehicles.length} vehículo{vehicles.length === 1 ? '' : 's'}
          </span>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar vehículo
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehículo</TableHead>
              <TableHead>Año</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Kilometraje</TableHead>
              <TableHead>Estado</TableHead>
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
                  Sin vehículos todavía.
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
                  <TableCell className="text-right">{formatPrice(v.price)}</TableCell>
                  <TableCell className="text-right">
                    {v.mileage != null ? `${formatPrice(v.mileage)} km` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_META[v.status].variant}>
                      {STATUS_META[v.status].label}
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
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => remove(v)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
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
            <DialogTitle>{editing ? 'Editar vehículo' : 'Agregar vehículo'}</DialogTitle>
            <DialogDescription>
              Los vehículos en estado &quot;Disponible&quot; se sincronizan automáticamente con
              el asistente de IA de WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand">Marca *</Label>
              <Input
                id="brand"
                value={draft.brand}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Modelo *</Label>
              <Input
                id="model"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Año *</Label>
              <Input
                id="year"
                type="number"
                value={draft.year}
                onChange={(e) => setDraft({ ...draft, year: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Estado</Label>
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
                      {STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Precio</Label>
              <Input
                id="price"
                type="number"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mileage">Kilometraje</Label>
              <Input
                id="mileage"
                type="number"
                value={draft.mileage}
                onChange={(e) => setDraft({ ...draft, mileage: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="license_plate">Placa</Label>
              <Input
                id="license_plate"
                value={draft.license_plate}
                onChange={(e) => setDraft({ ...draft, license_plate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vin">VIN</Label>
              <Input
                id="vin"
                value={draft.vin}
                onChange={(e) => setDraft({ ...draft, vin: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transmission">Transmisión</Label>
              <Select
                value={draft.transmission}
                onValueChange={(v) => setDraft({ ...draft, transmission: v ?? '' })}
              >
                <SelectTrigger id="transmission">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {TRANSMISSIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fuel_type">Combustible</Label>
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
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="body_type">Carrocería</Label>
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
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="condition">Condición</Label>
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
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <Input
                id="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doors">Puertas</Label>
              <Input
                id="doors"
                type="number"
                value={draft.doors}
                onChange={(e) => setDraft({ ...draft, doors: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="features">Características (una por línea, «Clave: Valor»)</Label>
              <Textarea
                id="features"
                rows={4}
                placeholder={'Transmisión: Automática\nColor: Negro\nAire acondicionado'}
                value={draft.featuresText}
                onChange={(e) => setDraft({ ...draft, featuresText: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Imágenes</Label>
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
                      title="Quitar"
                    >
                      <X className="size-3" />
                    </button>
                    {i === 0 && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">
                        Principal
                      </span>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploadingImages}
                  className="text-muted-foreground border-border flex size-20 items-center justify-center rounded-md border border-dashed disabled:opacity-50"
                  title="Subir imagen"
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
                PNG, JPG o WEBP (máx. 5 MB c/u). La primera imagen es la principal.
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="internal_notes">Notas internas</Label>
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
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
