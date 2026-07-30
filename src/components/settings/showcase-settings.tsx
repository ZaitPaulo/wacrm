'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/hooks/use-can';
import { Loader2 } from 'lucide-react';

/**
 * Ajustes de la vitrina pública (migraciones 503/505). Un admin activa
 * la vitrina de esta cuenta, fija el WhatsApp del CTA y edita el perfil
 * del negocio que se muestra en el footer (nombre, logo, dirección,
 * contactos, horario). Lee/guarda vía /api/account.
 */
export function ShowcaseSettings() {
  const canEdit = useCan('edit-settings');

  const [enabled, setEnabled] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [hours, setHours] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    try {
      const { publicUrl } = await uploadAccountMedia('showcase-media', file);
      setLogoUrl(publicUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir el logo');
    } finally {
      setUploadingLogo(false);
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      try {
        const res = await fetch('/api/account');
        const json = await res.json();
        if (res.ok) {
          const a = json.account ?? {};
          setEnabled(!!a.showcase_enabled);
          setWhatsapp(a.public_whatsapp ?? '');
          setName(a.public_name ?? '');
          setLogoUrl(a.public_logo_url ?? '');
          setAddress(a.public_address ?? '');
          setPhone(a.public_phone ?? '');
          setEmail(a.public_email ?? '');
          setHours(a.public_hours ?? '');
        }
      } catch {
        // noop — se muestran los valores por defecto.
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          showcase_enabled: enabled,
          public_whatsapp: whatsapp.trim() || null,
          public_name: name.trim() || null,
          public_logo_url: logoUrl.trim() || null,
          public_address: address.trim() || null,
          public_phone: phone.trim() || null,
          public_email: email.trim() || null,
          public_hours: hours.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error al guardar');
      toast.success('Vitrina actualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Vitrina pública</h2>
        <p className="text-muted-foreground text-sm">
          Publica el inventario disponible de esta cuenta en la página principal
          del sitio, con la información de tu negocio.
        </p>
      </div>

      {/* Activación + WhatsApp */}
      <div className="border-border space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>Activar vitrina</Label>
            <p className="text-muted-foreground text-xs">
              La raíz del dominio mostrará tus vehículos disponibles.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wa">WhatsApp del CTA (con código de país)</Label>
          <Input
            id="wa"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="573001234567"
            disabled={!canEdit}
          />
          <p className="text-muted-foreground text-xs">
            Solo números. El botón “Me interesa” de cada vehículo abre wa.me con
            este número.
          </p>
        </div>

        {enabled && origin && (
          <p className="text-sm">
            URL de la vitrina:{' '}
            <a
              href={origin}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {origin}
            </a>
          </p>
        )}
      </div>

      {/* Información del negocio (footer) */}
      <div className="border-border space-y-4 rounded-lg border p-4">
        <div>
          <h3 className="font-medium">Información del negocio</h3>
          <p className="text-muted-foreground text-xs">
            Se muestra en el pie de página de la vitrina.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pname">Nombre comercial</Label>
            <Input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Autos del Valle"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plogo">Logo</Label>
            <div className="flex items-center gap-2">
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="size-10 rounded object-contain" />
              )}
              <Input
                id="plogo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://… o sube un archivo"
                disabled={!canEdit}
              />
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {uploadingLogo ? <Loader2 className="size-4 animate-spin" /> : 'Subir'}
                </Button>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoUpload}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pphone">Teléfono</Label>
            <Input
              id="pphone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+57 300 123 4567"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pemail">Email</Label>
            <Input
              id="pemail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ventas@negocio.com"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="paddr">Dirección</Label>
            <Textarea
              id="paddr"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle 123 #45-67, Ciudad"
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="phours">Horario de atención</Label>
            <Textarea
              id="phours"
              rows={2}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Lun–Sáb 8:00–18:00"
              disabled={!canEdit}
            />
          </div>
        </div>
      </div>

      {canEdit && (
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          Guardar
        </Button>
      )}
    </div>
  );
}
