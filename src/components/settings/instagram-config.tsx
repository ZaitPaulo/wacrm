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
 * Lo que `GET /api/instagram/connection` devuelve sobre la conexión.
 *
 * NUNCA incluye el token: la ruta lo omite a propósito y esta pantalla
 * no tiene por qué verlo.
 */
interface ConnectionInfo {
  connected: boolean;
  username: string | null;
  /**
   * Cuándo caduca el token, cuando Instagram lo informó.
   *
   * Todavía no se muestra: el aviso de los 60 días vive en el texto
   * fijo de las instrucciones. Está acá para cuando convenga avisar con
   * la fecha concreta, antes de que una aprobación falle.
   */
  tokenExpiresAt: string | null;
}

/**
 * Panel de Ajustes → Instagram: conecta y desconecta la cuenta del
 * negocio con la que se publica el inventario (migración 512).
 *
 * El token se pega a mano, igual que en WhatsApp, en vez de obtenerse
 * por un redirect de OAuth. La columna derecha explica cómo generarlo
 * en el panel de Meta.
 *
 * Al conectar, el servidor verifica el token contra Instagram ANTES de
 * guardarlo: así una cuenta personal se rechaza acá y con su motivo, en
 * lugar de convertirse en un fallo al publicar días después, sin
 * relación aparente con lo que se hizo en esta pantalla.
 *
 * Requiere `admin` o superior — la misma regla que aprobar una
 * publicación, y la misma que aplica la RLS de `instagram_config`.
 */
export function InstagramConfig() {
  const t = useTranslations('Settings');
  const canEdit = useCan('edit-settings');

  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/instagram/connection');
        if (res.ok) setInfo(await res.json());
      } catch {
        // noop — se muestra como desconectado.
      }
      setLoading(false);
    })();
  }, []);

  async function connect() {
    if (!token.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/instagram/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        // El mensaje viene del servidor porque es él quien habló con
        // Instagram: "es una cuenta personal" no se puede adivinar acá.
        toast.error(json.error ?? t('instagram.connectFailed'));
        return;
      }
      setInfo({
        connected: true,
        username: json.username ?? null,
        tokenExpiresAt: null,
      });
      setToken('');
      toast.success(t('instagram.connected'));
    } catch {
      toast.error(t('instagram.connectFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Desconectar borra la fila entera del lado del servidor. Lo ya
  // publicado sigue intacto en Instagram —el sistema nunca borra de
  // allá— y las pendientes esperan a que haya cuenta de nuevo.
  async function disconnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/instagram/connection', {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('instagram.disconnectFailed'));
        return;
      }
      setInfo({ connected: false, username: null, tokenExpiresAt: null });
      toast.success(t('instagram.disconnected'));
    } catch {
      toast.error(t('instagram.disconnectFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('instagram.loading')}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        <SettingsPanelHead
          title={t('instagram.title')}
          description={t('instagram.description')}
        />

        {info?.connected ? (
          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">
                {t('instagram.connectedTo')}
              </p>
              <p className="text-muted-foreground text-sm">
                {info.username
                  ? `@${info.username}`
                  : t('instagram.unknownUser')}
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              {t('instagram.disconnectHint')}
            </p>
            <Button
              variant="outline"
              onClick={disconnect}
              disabled={!canEdit || saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('instagram.disconnect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label htmlFor="ig-token">{t('instagram.tokenLabel')}</Label>
              <Input
                id="ig-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('instagram.tokenPlaceholder')}
                disabled={!canEdit || saving}
              />
              <p className="text-muted-foreground text-sm">
                {t('instagram.requirement')}
              </p>
            </div>
            <Button
              onClick={connect}
              disabled={!canEdit || saving || !token.trim()}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('instagram.connect')}
            </Button>
          </div>
        )}

        {!canEdit && (
          <p className="text-muted-foreground mt-4 text-sm">
            {t('instagram.adminOnly')}
          </p>
        )}
      </div>

      {/* Instrucciones, con la misma forma que las de WhatsApp: cada
          paso es un acordeón numerado. Los nombres de los menús van
          textuales —"API setup with Instagram business login"— porque
          el panel de Meta está en inglés aunque el CRM no. */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">
              {t('instagram.setupTitle')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('instagram.setupDesc')}
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
                      {t(`instagram.step${n}`)}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-inside list-decimal space-y-1 text-sm">
                      {(t.raw(`instagram.step${n}Items`) as string[]).map(
                        (item) => (
                          <li key={item}>{item}</li>
                        )
                      )}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {/* Los tokens de Meta caducan y esto es lo que después
                explica un fallo de credenciales sin causa aparente. */}
            <p className="text-muted-foreground mt-4 text-sm">
              {t('instagram.expiryNote')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
