'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { SettingsPanelHead } from './settings-panel-head';
import { useCan } from '@/hooks/use-can';

/**
 * Lo que `GET /api/social/connection/facebook` devuelve.
 *
 * NUNCA incluye el token: la ruta lo omite a propósito y esta pantalla
 * no tiene por qué verlo.
 */
interface ConnectionInfo {
  connected: boolean;
  pageId: string | null;
  pageName: string | null;
  /**
   * Cuándo caduca el token, cuando Meta lo informó.
   *
   * En Facebook suele venir NULL: un token de página derivado de uno de
   * usuario de larga duración no caduca mientras el permiso siga
   * concedido. Se muestra solo si hay fecha — afirmar una que no
   * sabemos sería peor que no decir nada.
   */
  tokenExpiresAt: string | null;
}

/** Una página que el usuario administra, ya sin su token. */
interface PageOption {
  id: string;
  name: string | null;
}

/**
 * Panel de Ajustes → Facebook: conecta y desconecta la página del
 * negocio en la que se publica el inventario (migración 517).
 *
 * SON DOS PASOS, y no por gusto: un usuario puede administrar varias
 * páginas, y elegir por él publicaría en la equivocada — algo visible
 * para los clientes del negocio y que no se deshace. Primero se pega el
 * token y el servidor lista las páginas; después se elige una y recién
 * ahí se guarda. Con una sola página, queda preseleccionada y el
 * segundo paso es confirmar.
 *
 * ES INDEPENDIENTE DE INSTAGRAM. Otro token, otro panel, otra fila.
 * Conectar acá no conecta la otra red, y desconectar acá no la afecta:
 * son dos caminos de autenticación distintos de Meta.
 *
 * Requiere `admin` o superior — la misma regla que aprobar una
 * publicación, y la misma que aplica la RLS de `facebook_config`.
 */
export function FacebookConfig() {
  const t = useTranslations('Settings');
  const canEdit = useCan('edit-settings');

  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // El segundo paso. `pages` en null significa que todavía no se
  // consultó; una lista vacía nunca llega acá porque el servidor la
  // rechaza con su motivo.
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pageId, setPageId] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/social/connection/facebook');
        if (res.ok) setInfo(await res.json());
      } catch {
        // noop — se muestra como desconectado.
      }
      setLoading(false);
    })();
  }, []);

  /** Paso 1: pedirle a Meta las páginas que administra este token. */
  async function loadPages() {
    if (!token.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/social/connection/facebook/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        // El mensaje viene del servidor porque es él quien habló con
        // Meta: "no administras ninguna página" no se puede adivinar acá.
        toast.error(json.error ?? t('facebook.pagesFailed'));
        return;
      }
      const found = (json.pages ?? []) as PageOption[];
      setPages(found);
      // Con una sola no hay nada que elegir; queda confirmar.
      if (found.length === 1) setPageId(found[0].id);
    } catch {
      toast.error(t('facebook.pagesFailed'));
    } finally {
      setSaving(false);
    }
  }

  /** Paso 2: guardar la página elegida. */
  async function connect() {
    if (!token.trim() || !pageId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/social/connection/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token.trim(), page_id: pageId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('facebook.connectFailed'));
        return;
      }
      setInfo({
        connected: true,
        pageId: json.page_id ?? null,
        pageName: json.page_name ?? null,
        tokenExpiresAt: null,
      });
      // El token no se conserva en memoria más de lo necesario.
      setToken('');
      setPages(null);
      setPageId('');
      toast.success(t('facebook.connected'));
    } catch {
      toast.error(t('facebook.connectFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Desconectar borra la fila entera del lado del servidor. Lo ya
  // publicado sigue intacto en Facebook —el sistema nunca borra de
  // allá— e Instagram no se entera de nada.
  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/social/connection/facebook', {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('facebook.disconnectFailed'));
        return;
      }
      setInfo({
        connected: false,
        pageId: null,
        pageName: null,
        tokenExpiresAt: null,
      });
      toast.success(t('facebook.disconnected'));
    } catch {
      toast.error(t('facebook.disconnectFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('facebook.loading')}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        <SettingsPanelHead
          title={t('facebook.title')}
          description={t('facebook.description')}
        />

        {info?.connected ? (
          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">{t('facebook.connectedTo')}</p>
              <p className="text-muted-foreground text-sm">
                {info.pageName ?? t('facebook.unknownPage')}
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              {t('facebook.disconnectHint')}
            </p>
            <Button
              variant="outline"
              onClick={disconnect}
              disabled={!canEdit || saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('facebook.disconnect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label htmlFor="fb-token">{t('facebook.tokenLabel')}</Label>
              <Input
                id="fb-token"
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  // Cambiar el token invalida la lista anterior: puede
                  // ser de otro usuario, con otras páginas.
                  setPages(null);
                  setPageId('');
                }}
                placeholder={t('facebook.tokenPlaceholder')}
                disabled={!canEdit || saving}
              />
              <p className="text-muted-foreground text-sm">
                {t('facebook.requirement')}
              </p>
            </div>

            {pages === null ? (
              <Button
                onClick={loadPages}
                disabled={!canEdit || saving || !token.trim()}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('facebook.listPages')}
              </Button>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('facebook.choosePage')}</Label>
                  {/* Radios y no un desplegable: la elección decide en
                      qué muro del negocio aparece cada auto, así que las
                      opciones se ven todas de una vez y ninguna queda
                      elegida por descuido. */}
                  <div className="space-y-2">
                    {pages.map((page) => (
                      <label
                        key={page.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm"
                      >
                        <input
                          type="radio"
                          name="fb-page"
                          value={page.id}
                          checked={pageId === page.id}
                          onChange={() => setPageId(page.id)}
                          disabled={!canEdit || saving}
                        />
                        <span>
                          {page.name ?? t('facebook.unknownPage')}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={connect}
                  disabled={!canEdit || saving || !pageId}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('facebook.connect')}
                </Button>
              </div>
            )}
          </div>
        )}

        {!canEdit && (
          <p className="text-muted-foreground mt-4 text-sm">
            {t('facebook.adminOnly')}
          </p>
        )}
      </div>

      {/* Instrucciones, con la misma forma que las de Instagram: cada
          paso es un acordeón numerado. Los nombres de los menús van
          textuales porque el panel de Meta está en inglés aunque el CRM
          no lo esté. */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">
              {t('facebook.setupTitle')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('facebook.setupDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion>
              {[1, 2, 3].map((n) => (
                <AccordionItem key={n} className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs font-bold">
                        {n}
                      </span>
                      {t(`facebook.step${n}`)}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1 text-sm">
                      {(t.raw(`facebook.step${n}Items`) as string[]).map(
                        (item) => (
                          <li key={item}>{item}</li>
                        )
                      )}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {/* Los permisos son revisados por Meta, y sin esa revisión
                la conexión falla por más que el token esté bien. Es la
                causa más probable de un fallo acá, y la menos evidente. */}
            <p className="text-muted-foreground mt-4 text-sm">
              {t('facebook.reviewNote')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
