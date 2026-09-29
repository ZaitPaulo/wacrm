'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CAPTION_VARIABLES,
  MAX_TEMPLATE_LENGTH,
  buildVehicleCaption,
  unknownTemplateVariables,
  type AccountForCaption,
  type VehicleForCaption,
} from '@/lib/social/caption';

/** Las mismas columnas que lee la cola (`VEHICLE_COLUMNS` en queue.ts). */
const PREVIEW_COLUMNS =
  'brand, model, year, price, warranty_price, mileage, transmission, ' +
  'engine_displacement, plate_city, soat_expires_at, tecnomecanica_expires_at';

type PublicProfile = Omit<
  AccountForCaption,
  'default_currency' | 'social_post_template'
>;

/**
 * Ajustes → Publicaciones: la plantilla del texto con que se propone
 * publicar cada vehículo en Facebook e Instagram (migración 545).
 *
 * La vista previa usa `buildVehicleCaption` tal cual —es pura—, así
 * que lo que se ve acá es exactamente lo que la cola va a proponer.
 * Lee y guarda vía /api/account, que valida las variables.
 */
export function SocialPostSettings() {
  const t = useTranslations('Settings');
  const tPost = useTranslations('SocialPost');
  const canEdit = useCan('edit-settings');
  const { defaultCurrency } = useAuth();

  // Cruda: el catálogo ICU leería `{marca}` como un argumento.
  const defaultTemplate = tPost.raw('defaultTemplate') as string;

  const [template, setTemplate] = useState('');
  const [savedCustom, setSavedCustom] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [vehicle, setVehicle] = useState<VehicleForCaption | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [accountRes, vehicleRes] = await Promise.all([
          fetch('/api/account'),
          createClient()
            .from('inventory_vehicles')
            .select(PREVIEW_COLUMNS)
            .eq('status', 'available')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<VehicleForCaption>(),
        ]);
        const json = await accountRes.json();
        if (accountRes.ok) {
          const a = json.account ?? {};
          setTemplate(a.social_post_template ?? defaultTemplate);
          setSavedCustom(!!a.social_post_template);
          setProfile({
            public_name: a.public_name ?? null,
            public_address: a.public_address ?? null,
            public_whatsapp: a.public_whatsapp ?? null,
            public_phone: a.public_phone ?? null,
            public_email: a.public_email ?? null,
          });
        }
        if (vehicleRes.data) setVehicle(vehicleRes.data);
      } catch {
        // noop — se muestra la plantilla por defecto sin vista previa.
        setTemplate(defaultTemplate);
      }
      setLoading(false);
    })();
    // `defaultTemplate` sale del catálogo y no cambia durante la vida
    // del panel; volver a pedir todo por él sería pisar lo que se editó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unknown = useMemo(() => unknownTemplateVariables(template), [template]);

  const preview = useMemo(() => {
    if (!vehicle || !profile) return null;
    return buildVehicleCaption({
      vehicle,
      account: {
        ...profile,
        default_currency: defaultCurrency,
        social_post_template: template,
      },
      t: (key, values) => tPost(key, values),
      defaultTemplate,
    });
  }, [vehicle, profile, defaultCurrency, template, tPost, defaultTemplate]);

  function insertVariable(name: string) {
    const token = `{${name}}`;
    const el = textareaRef.current;
    if (!el) {
      setTemplate((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    // El cursor queda después de lo insertado, para seguir escribiendo.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function persist(value: string | null, okMessage: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ social_post_template: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t('socialPosts.saveFailed'));
      setSavedCustom(value !== null);
      toast.success(okMessage);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('socialPosts.saveFailed')
      );
    } finally {
      setSaving(false);
    }
  }

  function save() {
    // Guardar el texto idéntico al de defecto se guarda como null: así
    // la cuenta sigue recibiendo las mejoras futuras de la plantilla
    // por defecto en vez de quedarse con una copia congelada.
    const value =
      template.trim() === '' || template === defaultTemplate ? null : template;
    void persist(value, t('socialPosts.saved'));
  }

  function restore() {
    setTemplate(defaultTemplate);
    void persist(null, t('socialPosts.restored'));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const tooLong = template.length > MAX_TEMPLATE_LENGTH;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('socialPosts.title')}</h2>
        <p className="text-muted-foreground text-sm">
          {t('socialPosts.description')}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="border-border space-y-4 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="social-post-template">
              {t('socialPosts.template')}
            </Label>
            <Textarea
              id="social-post-template"
              ref={textareaRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              disabled={!canEdit}
              rows={18}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {savedCustom ? '' : t('socialPosts.usingDefault')}
              </span>
              <span
                className={tooLong ? 'text-destructive' : 'text-muted-foreground'}
              >
                {template.length}/{MAX_TEMPLATE_LENGTH}
              </span>
            </div>
            {unknown.length > 0 && (
              <p className="text-destructive text-xs">
                {unknown.map((v) => `{${v}}`).join(', ')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">
                {t('socialPosts.variables')}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t('socialPosts.variablesHint')}
              </p>
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {CAPTION_VARIABLES.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => insertVariable(name)}
                    disabled={!canEdit}
                    className="hover:bg-muted flex w-full flex-col items-start rounded-md px-2 py-1 text-left disabled:opacity-60"
                  >
                    <code className="text-primary text-xs">{`{${name}}`}</code>
                    <span className="text-muted-foreground text-xs">
                      {t(`socialPosts.vars.${name}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {canEdit && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={restore}
                disabled={saving || !savedCustom}
              >
                <RotateCcw className="size-4" />
                {t('socialPosts.restore')}
              </Button>
              <Button
                onClick={save}
                disabled={saving || unknown.length > 0 || tooLong}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('socialPosts.save')}
              </Button>
            </div>
          )}
        </div>

        <div className="border-border space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-medium">{t('socialPosts.preview')}</h3>
          {vehicle && preview !== null ? (
            <>
              <p className="text-muted-foreground text-xs">
                {t('socialPosts.previewWith', {
                  vehicle: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
                })}
              </p>
              <pre className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap break-words">
                {preview}
              </pre>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t('socialPosts.previewEmpty')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
