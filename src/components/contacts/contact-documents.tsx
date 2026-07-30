'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { DocumentRecord, DocumentCategory, InventoryVehicle } from '@/types';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES,
} from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useCan } from '@/hooks/use-can';
import { FileText, Upload, Trash2, Loader2, Download } from 'lucide-react';

const BUCKET = 'contact-documents';
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

// Orden + etiquetas de las categorías (enum document_category, migración 502).
const CATEGORY_ORDER: DocumentCategory[] = ['person', 'vehicle', 'purchase', 'sale'];
const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  person: 'Persona',
  vehicle: 'Vehículo',
  purchase: 'Compra',
  sale: 'Venta',
};

/** Las categorías distintas de "person" requieren asociar un vehículo. */
function needsVehicle(category: DocumentCategory): boolean {
  return category !== 'person';
}

type VehicleOption = Pick<InventoryVehicle, 'id' | 'brand' | 'model' | 'year'>;

interface ContactDocumentsProps {
  contactId: string | null;
  accountId: string | null;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function vehicleLabel(v: { brand: string; model: string; year: number }): string {
  return `${v.brand} ${v.model} ${v.year}`;
}

/**
 * Pestaña "Documents" del panel de contacto: reúne la documentación del
 * proceso de compra/venta de ESTE contacto, categorizada (Persona /
 * Vehículo / Compra / Venta) y, cuando aplica, asociada a un vehículo del
 * inventario. Sube a un bucket PRIVADO (`contact-documents`) vía
 * uploadAccountMedia y sirve la descarga con signed URLs que expiran. La
 * edición se limita a roles agent+ (`send-messages`).
 *
 * @param contactId Lead dueño de los documentos (null mientras carga).
 * @param accountId Cuenta activa; requerido para subir (path account-scoped).
 */
export function ContactDocuments({ contactId, accountId }: ContactDocumentsProps) {
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Selección del formulario de subida.
  const [category, setCategory] = useState<DocumentCategory>('person');
  const [vehicleId, setVehicleId] = useState<string>('');

  const fetchDocuments = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('documents')
      .select('*, inventory_vehicles(brand, model, year)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (error) toast.error('No se pudieron cargar los documentos');
    else setDocuments(data ?? []);
    setLoading(false);
  }, [contactId, supabase]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Lista de vehículos para asociar docs de vehículo/compra/venta.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/inventory');
        if (!res.ok) return;
        const json = await res.json();
        if (active) setVehicles(json.vehicles ?? []);
      } catch {
        // Silencioso: sin inventario simplemente no se puede asociar vehículo.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleFile(file: File) {
    if (!contactId || !accountId) {
      toast.error('No se pudo resolver el contacto o tu cuenta.');
      return;
    }
    if (needsVehicle(category) && !vehicleId) {
      toast.error('Selecciona el vehículo para esta categoría.');
      return;
    }
    if (!ALLOWED.has(file.type)) {
      toast.error('Solo se permiten archivos PDF o imágenes (PNG, JPG, WEBP).');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      toast.error('El archivo supera el límite de 16 MB.');
      return;
    }

    setUploading(true);
    try {
      const { path } = await uploadAccountMedia(BUCKET, file);
      const { error } = await supabase.from('documents').insert({
        account_id: accountId,
        contact_id: contactId,
        vehicle_id: needsVehicle(category) ? vehicleId : null,
        category,
        file_name: file.name,
        file_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (error) {
        // El objeto ya subió; si el registro falla, no dejamos huérfano.
        await deleteAccountMedia(BUCKET, path).catch(() => {});
        throw new Error(error.message);
      }
      toast.success('Documento subido');
      await fetchDocuments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir el documento');
    } finally {
      setUploading(false);
    }
  }

  // Bucket privado: la URL pública no sirve, se firma al momento de abrir.
  async function openDocument(doc: DocumentRecord) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) {
      toast.error('No se pudo generar el enlace de descarga.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleDelete(doc: DocumentRecord) {
    if (!confirm(`¿Eliminar «${doc.file_name}»?`)) return;
    setDeletingId(doc.id);
    try {
      const { error } = await supabase.from('documents').delete().eq('id', doc.id);
      if (error) throw new Error(error.message);
      // Best-effort: limpiar el objeto de Storage.
      await deleteAccountMedia(BUCKET, doc.file_path).catch(() => {});
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setDeletingId(null);
    }
  }

  const uploadDisabled = uploading || (needsVehicle(category) && !vehicleId);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="border-border space-y-2 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Categoría</Label>
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v as DocumentCategory);
                  if (!needsVehicle(v as DocumentCategory)) setVehicleId('');
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsVehicle(category) && (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Vehículo</Label>
                <Select value={vehicleId} onValueChange={(v) => setVehicleId(v ?? '')}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Selecciona…" />
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
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploadDisabled}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            Subir documento
          </Button>
          <p className="text-muted-foreground text-xs">
            PDF o imágenes (PNG, JPG, WEBP), máx. 16 MB.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          Sin documentos todavía.
        </p>
      ) : (
        <div className="space-y-4">
          {CATEGORY_ORDER.filter((c) => documents.some((d) => d.category === c)).map(
            (cat) => (
              <div key={cat} className="space-y-2">
                <h4 className="text-muted-foreground text-xs font-medium uppercase">
                  {CATEGORY_LABELS[cat]}
                </h4>
                <ul className="space-y-2">
                  {documents
                    .filter((d) => d.category === cat)
                    .map((doc) => (
                      <li
                        key={doc.id}
                        className="border-border bg-muted/40 flex items-center gap-2 rounded-md border p-2"
                      >
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm" title={doc.file_name}>
                            {doc.file_name}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {doc.inventory_vehicles
                              ? `${vehicleLabel(doc.inventory_vehicles)} · `
                              : ''}
                            {formatSize(doc.size_bytes)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground p-1"
                          onClick={() => openDocument(doc)}
                          title="Abrir / descargar"
                        >
                          <Download className="size-4" />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-50"
                            disabled={deletingId === doc.id}
                            onClick={() => handleDelete(doc)}
                            title="Eliminar"
                          >
                            {deletingId === doc.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
