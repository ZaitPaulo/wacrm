'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useTranslations } from 'next-intl';
import type {
  DocumentRecord,
  DocumentCategory,
  InventoryVehicle,
  Contact,
} from '@/types';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES,
} from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  FileText,
  Upload,
  Trash2,
  Loader2,
  Download,
  Search,
  Check,
  X,
  ChevronsUpDown,
  Eye,
} from 'lucide-react';

const CATEGORY_ORDER: DocumentCategory[] = ['person', 'vehicle', 'purchase', 'sale'];
// Las etiquetas salen del catálogo por clave; acá solo queda el orden.
const CATEGORY_LABEL_KEY = (c: DocumentCategory) => `categories.${c}` as const;
const CATEGORY_VARIANT: Record<
  DocumentCategory,
  'default' | 'secondary' | 'outline'
> = {
  person: 'secondary',
  vehicle: 'default',
  purchase: 'outline',
  sale: 'outline',
};

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/** Categorías distintas de "person" requieren asociar un vehículo. */
function needsVehicle(c: DocumentCategory): boolean {
  return c !== 'person';
}
/** Persona/Compra/Venta requieren un contacto; Vehículo lo hace opcional. */
function needsContact(c: DocumentCategory): boolean {
  return c === 'person' || c === 'purchase' || c === 'sale';
}

type VehicleOption = Pick<InventoryVehicle, 'id' | 'brand' | 'model' | 'year'>;

function vehicleLabel(v: { brand: string; model: string; year: number }): string {
  return `${v.brand} ${v.model} ${v.year}`;
}
function contactLabel(c: { name?: string | null; phone?: string | null }): string {
  // Un contacto que llegó por Instagram puede no tener teléfono
  // (migración 513), así que el rótulo no puede depender de él.
  return c.name?.trim() || c.phone || '—';
}

// ============================================================
// Selector de contacto buscable (Popover + búsqueda server-side).
// ============================================================
function ContactPicker({
  value,
  label,
  onSelect,
}: {
  value: string;
  label: string;
  onSelect: (id: string, label: string) => void;
}) {
  const t = useTranslations('Documents');
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Pick<Contact, 'id' | 'name' | 'phone'>[]>([]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      let q = supabase
        .from('contacts')
        .select('id, name, phone')
        .order('updated_at', { ascending: false })
        .limit(20);
      const term = query.trim().replace(/[,()%]/g, '');
      if (term) q = q.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      const { data } = await q;
      if (active) setResults(data ?? []);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, supabase]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-full justify-start font-normal" />
        }
      >
        <span className="truncate">{label || t('picker.selectContact')}</span>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <Search className="text-muted-foreground size-4" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('upload.searchContact')}
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-sm">
              {t('picker.noResults')}
            </p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                onClick={() => {
                  onSelect(c.id, contactLabel(c));
                  setOpen(false);
                }}
              >
                <Check
                  className={`size-4 ${value === c.id ? 'opacity-100' : 'opacity-0'}`}
                />
                <span className="truncate">{contactLabel(c)}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// Filtro etiquetado y BUSCABLE (título + combobox: caja de texto que
// filtra la lista en vivo + opción "Todas" para limpiar).
// ============================================================
function SearchableFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value);
  const term = query.trim().toLowerCase();
  const shown = term
    ? options.filter((o) => o.label.toLowerCase().includes(term))
    : options;

  function pick(v: string) {
    onChange(v);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" className="w-44 justify-start font-normal" />
          }
        >
          <span className="truncate">
            {value === 'all' ? allLabel : (selected?.label ?? allLabel)}
          </span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <div className="border-border flex items-center gap-2 border-b px-3 py-2">
            <Search className="text-muted-foreground size-4" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder ?? 'Buscar…'}
              className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
              onClick={() => pick('all')}
            >
              <Check
                className={`size-4 ${value === 'all' ? 'opacity-100' : 'opacity-0'}`}
              />
              <span className="truncate">{allLabel}</span>
            </button>
            {shown.length === 0 ? (
              <p className="text-muted-foreground px-3 py-3 text-center text-sm">
                Sin resultados.
              </p>
            ) : (
              shown.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="hover:bg-muted flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
                  onClick={() => pick(o.value)}
                >
                  <Check
                    className={`size-4 ${value === o.value ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span className="truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Menú central de gestión de documentos (/documents). Lista todos los
 * documentos de la cuenta con filtros por categoría y nombre, permite
 * subir (eligiendo categoría, contacto y/o vehículo), descargar (signed
 * URL, bucket privado) y borrar. Escritura para roles agent+.
 */
export default function DocumentsPage() {
  const t = useTranslations('Documents');
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('send-messages');

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterContactId, setFilterContactId] = useState<string>('all');
  const [filterVehicleId, setFilterVehicleId] = useState<string>('all');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [filterPlate, setFilterPlate] = useState<string>('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Visor in-app (modal) con la vista previa firmada del documento.
  const [viewerDoc, setViewerDoc] = useState<DocumentRecord | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // Formulario de subida.
  const [category, setCategory] = useState<DocumentCategory>('person');
  const [contactId, setContactId] = useState('');
  const [contactName, setContactName] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select(
        '*, inventory_vehicles(brand, model, year, license_plate), contacts(name, phone)',
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) toast.error(t('toasts.loadFailed'));
    else setDocuments(data ?? []);
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/inventory');
        if (!res.ok) return;
        const json = await res.json();
        if (active) setVehicles(json.vehicles ?? []);
      } catch {
        // Sin inventario simplemente no se puede asociar vehículo.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function openUpload() {
    setCategory('person');
    setContactId('');
    setContactName('');
    setVehicleId('');
    setPendingFile(null);
    setDialogOpen(true);
  }

  async function doUpload() {
    if (!accountId) {
      toast.error(t('toasts.noAccount'));
      return;
    }
    if (needsContact(category) && !contactId) {
      toast.error(t('toasts.pickContact'));
      return;
    }
    if (needsVehicle(category) && !vehicleId) {
      toast.error(t('toasts.pickVehicle'));
      return;
    }
    if (!pendingFile) {
      toast.error(t('toasts.pickFile'));
      return;
    }
    if (!ALLOWED.has(pendingFile.type)) {
      toast.error(t('toasts.invalidType'));
      return;
    }
    if (pendingFile.size > MEDIA_MAX_BYTES) {
      toast.error(t('toasts.tooLarge'));
      return;
    }

    setUploading(true);
    try {
      const { path } = await uploadAccountMedia('contact-documents', pendingFile);
      const { error } = await supabase.from('documents').insert({
        account_id: accountId,
        contact_id: contactId || null,
        vehicle_id: needsVehicle(category) ? vehicleId : null,
        category,
        file_name: pendingFile.name,
        file_path: path,
        mime_type: pendingFile.type,
        size_bytes: pendingFile.size,
      });
      if (error) {
        await deleteAccountMedia('contact-documents', path).catch(() => {});
        throw new Error(error.message);
      }
      toast.success(t('toasts.uploaded'));
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toasts.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function openDocument(doc: DocumentRecord) {
    const { data, error } = await supabase.storage
      .from('contact-documents')
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) {
      toast.error(t('toasts.linkFailed'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  // Abre el visor in-app: firma la URL (más margen que la descarga) y
  // muestra el archivo embebido en un modal.
  async function openViewer(doc: DocumentRecord) {
    setViewerDoc(doc);
    setViewerUrl(null);
    const { data, error } = await supabase.storage
      .from('contact-documents')
      .createSignedUrl(doc.file_path, 300);
    if (error || !data) {
      toast.error(t('toasts.previewFailed'));
      setViewerDoc(null);
      return;
    }
    setViewerUrl(data.signedUrl);
  }

  async function remove(doc: DocumentRecord) {
    if (!confirm(t('confirmDelete', { name: doc.file_name }))) return;
    setDeletingId(doc.id);
    try {
      const { error } = await supabase.from('documents').delete().eq('id', doc.id);
      if (error) throw new Error(error.message);
      await deleteAccountMedia('contact-documents', doc.file_path).catch(() => {});
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toasts.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  }

  // Opciones de cada filtro, derivadas de los documentos cargados (solo
  // se ofrecen valores presentes en los datos).
  const contactOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of documents)
      if (d.contact_id && d.contacts) m.set(d.contact_id, contactLabel(d.contacts));
    return Array.from(m, ([value, label]) => ({ value, label }));
  }, [documents]);

  const vehicleOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of documents)
      if (d.vehicle_id && d.inventory_vehicles)
        m.set(d.vehicle_id, vehicleLabel(d.inventory_vehicles));
    return Array.from(m, ([value, label]) => ({ value, label }));
  }, [documents]);

  const brandOptions = useMemo(() => {
    const s = new Set<string>();
    for (const d of documents) if (d.inventory_vehicles?.brand) s.add(d.inventory_vehicles.brand);
    return Array.from(s)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [documents]);

  const plateOptions = useMemo(() => {
    const s = new Set<string>();
    for (const d of documents)
      if (d.inventory_vehicles?.license_plate) s.add(d.inventory_vehicles.license_plate);
    return Array.from(s)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [documents]);

  const categoryOptions = CATEGORY_ORDER.map((c) => ({
    value: c,
    label: t(CATEGORY_LABEL_KEY(c)),
  }));

  const filtered = documents.filter((d) => {
    if (filterCategory !== 'all' && d.category !== filterCategory) return false;
    if (filterContactId !== 'all' && d.contact_id !== filterContactId) return false;
    if (filterVehicleId !== 'all' && d.vehicle_id !== filterVehicleId) return false;
    if (filterBrand !== 'all' && d.inventory_vehicles?.brand !== filterBrand) return false;
    if (filterPlate !== 'all' && d.inventory_vehicles?.license_plate !== filterPlate)
      return false;
    if (search.trim() && !d.file_name.toLowerCase().includes(search.trim().toLowerCase()))
      return false;
    return true;
  });

  const hasActiveFilters =
    filterCategory !== 'all' ||
    filterContactId !== 'all' ||
    filterVehicleId !== 'all' ||
    filterBrand !== 'all' ||
    filterPlate !== 'all' ||
    search.trim() !== '';

  function clearFilters() {
    setSearch('');
    setFilterCategory('all');
    setFilterContactId('all');
    setFilterVehicleId('all');
    setFilterBrand('all');
    setFilterPlate('all');
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <span className="text-muted-foreground text-sm">
            {filtered.length} de {documents.length}
          </span>
        </div>
        {canEdit && (
          <Button onClick={openUpload}>
            <Upload className="mr-2 h-4 w-4" />
            Subir documento
          </Button>
        )}
      </div>

      {/* Filtros — cada uno con su etiqueta de título */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">{t('filters.search')}</Label>
          <div className="relative">
            <Search className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('filters.fileName')}
              className="w-56 pl-8"
            />
          </div>
        </div>
        <SearchableFilter
          label="Tipo de documento"
          value={filterCategory}
          onChange={setFilterCategory}
          options={categoryOptions}
          allLabel="Todos"
          placeholder={t('filters.category')}
        />
        <SearchableFilter
          label="Persona"
          value={filterContactId}
          onChange={setFilterContactId}
          options={contactOptions}
          allLabel="Todas"
          placeholder={t('filters.contact')}
        />
        <SearchableFilter
          label="Vehículo"
          value={filterVehicleId}
          onChange={setFilterVehicleId}
          options={vehicleOptions}
          allLabel="Todos"
          placeholder={t('filters.vehicle')}
        />
        <SearchableFilter
          label="Marca"
          value={filterBrand}
          onChange={setFilterBrand}
          options={brandOptions}
          allLabel="Todas"
          placeholder={t('filters.brand')}
        />
        <SearchableFilter
          label="Placa"
          value={filterPlate}
          onChange={setFilterPlate}
          options={plateOptions}
          allLabel="Todas"
          placeholder={t('filters.plate')}
        />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 size-4" />
            {t('filters.clear')}
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.file')}</TableHead>
              <TableHead>{t('table.category')}</TableHead>
              <TableHead>{t('table.contact')}</TableHead>
              <TableHead>{t('table.vehicle')}</TableHead>
              <TableHead>{t('table.date')}</TableHead>
              <TableHead className="w-28 text-right">{t('table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground h-24 text-center">
                  Sin documentos.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell
                    className="hover:text-primary max-w-xs cursor-pointer truncate font-medium"
                    title={t('actions.view')}
                    onClick={() => openViewer(doc)}
                  >
                    {doc.file_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant={CATEGORY_VARIANT[doc.category]}>
                      {t(CATEGORY_LABEL_KEY(doc.category))}
                    </Badge>
                  </TableCell>
                  <TableCell>{doc.contacts ? contactLabel(doc.contacts) : '—'}</TableCell>
                  <TableCell>
                    {doc.inventory_vehicles ? vehicleLabel(doc.inventory_vehicles) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(doc.created_at).toLocaleDateString('es')}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground p-1"
                      onClick={() => openViewer(doc)}
                      title={t('actions.preview')}
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground ml-1 p-1"
                      onClick={() => openDocument(doc)}
                      title={t('actions.download')}
                    >
                      <Download className="size-4" />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive ml-1 p-1 disabled:opacity-50"
                        disabled={deletingId === doc.id}
                        onClick={() => remove(doc)}
                        title={t('actions.delete')}
                      >
                        {deletingId === doc.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Diálogo de subida */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('upload.dialogTitle')}</DialogTitle>
            <DialogDescription>
              Clasifica el documento y asócialo al contacto y/o vehículo del proceso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('upload.category')}</Label>
              <Select
                value={category}
                onValueChange={(v) => {
                  const c = (v as DocumentCategory) ?? 'person';
                  setCategory(c);
                  if (!needsVehicle(c)) setVehicleId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(CATEGORY_LABEL_KEY(c))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Contacto {needsContact(category) && <span className="text-red-400">*</span>}</Label>
              <ContactPicker
                value={contactId}
                label={contactName}
                onSelect={(id, name) => {
                  setContactId(id);
                  setContactName(name);
                }}
              />
            </div>

            {needsVehicle(category) && (
              <div className="space-y-1.5">
                <Label>
                  Vehículo <span className="text-red-400">*</span>
                </Label>
                <Select value={vehicleId} onValueChange={(v) => setVehicleId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('upload.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles.length === 0 ? (
                      <SelectItem value="none" disabled>
                        Sin vehículos en inventario
                      </SelectItem>
                    ) : (
                      vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {vehicleLabel(v)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('upload.file')}</Label>
              <Input
                type="file"
                accept={ACCEPT}
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-muted-foreground text-xs">
                PDF o imágenes (PNG, JPG, WEBP), máx. 16 MB.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={uploading}>
              Cancelar
            </Button>
            <Button onClick={doUpload} disabled={uploading}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('upload.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visor in-app: previsualiza el documento embebido, sin descargar */}
      <Dialog
        open={!!viewerDoc}
        onOpenChange={(o) => {
          if (!o) {
            setViewerDoc(null);
            setViewerUrl(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{viewerDoc?.file_name}</DialogTitle>
          </DialogHeader>
          <div className="min-h-[60vh]">
            {!viewerUrl ? (
              <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : viewerDoc?.mime_type?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewerUrl}
                alt={viewerDoc.file_name}
                className="mx-auto max-h-[70vh] w-auto rounded"
              />
            ) : viewerDoc?.mime_type === 'application/pdf' ? (
              <iframe
                src={viewerUrl}
                title={viewerDoc.file_name}
                className="h-[70vh] w-full rounded border-0"
              />
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">
                {t('preview.unsupported')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => viewerDoc && openDocument(viewerDoc)}
            >
              <Download className="mr-2 size-4" />
              {t('preview.download')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
