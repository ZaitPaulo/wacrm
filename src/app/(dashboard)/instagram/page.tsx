'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { formatPrice } from '@/lib/showcase/format';
import { CAPTION_MAX_CHARS } from '@/lib/instagram/limits';

/**
 * La cola de publicaciones de Instagram.
 *
 * Acá se revisa lo que el sistema preparó y se decide qué sale. NADA
 * llega a Instagram sin que alguien apriete Publicar en esta pantalla:
 * el encolado solo deja borradores.
 *
 * Es de `admin` o superior — la RLS de `social_posts` ya lo impone, así
 * que un asesor que llegue por URL ve la cola vacía.
 */

interface QueueVehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  status: string;
}

interface QueuePost {
  id: string;
  vehicle_id: string;
  status: 'pending' | 'published' | 'discarded' | 'failed' | 'needs_review';
  proposed_caption: string;
  edited_caption: string | null;
  image_urls: string[];
  external_post_id: string | null;
  published_at: string | null;
  failure_kind: 'credentials' | 'content' | null;
  failure_reason: string | null;
  created_at: string;
  previously_published_at: string | null;
  vehicle: QueueVehicle | null;
}

interface Quota {
  used: number;
  total: number;
  remaining: number;
  durationSeconds: number;
}

interface QueueResponse {
  posts?: QueuePost[];
  quota?: Quota | null;
  connected?: boolean;
}

/**
 * Trae la cola. Devuelve `null` si algo falló, y entonces la pantalla
 * se queda con lo que ya tuviera en vez de vaciarse.
 */
async function fetchQueue(): Promise<QueueResponse | null> {
  try {
    const res = await fetch('/api/instagram/queue');
    if (!res.ok) return null;
    return (await res.json()) as QueueResponse;
  } catch {
    return null;
  }
}

export default function InstagramQueuePage() {
  const t = useTranslations('InstagramQueue');
  const { defaultCurrency } = useAuth();

  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Aplica una respuesta de la cola al estado. Separado del fetch para
  // que el efecto de carga inicial no llame a setState de forma
  // síncrona en su cuerpo, que es lo que la regla de hooks prohíbe.
  const apply = useCallback((json: QueueResponse) => {
    setPosts(json.posts ?? []);
    setQuota(json.quota ?? null);
    setConnected(!!json.connected);
  }, []);

  /** Recarga después de aprobar, descartar o editar. */
  const load = useCallback(async () => {
    const json = await fetchQueue();
    if (json) apply(json);
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const json = await fetchQueue();
      if (cancelled) return;
      if (json) apply(json);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const pending = posts.filter((p) => p.status === 'pending');
  const history = posts.filter((p) => p.status !== 'pending');

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          {t('pageTitle')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('pageDesc')}</p>
      </div>

      {!connected && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          {t('notConnected')}
        </div>
      )}

      {/* El margen lo informa Instagram, no lo calculamos nosotros: es
          el mismo número que después decide si se puede aprobar. */}
      {connected && (
        <div className="text-muted-foreground rounded-lg border p-4 text-sm">
          {quota
            ? t('quota', {
                remaining: String(quota.remaining),
                total: String(quota.total),
              })
            : t('quotaUnknown')}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">
          {t('pendingTitle', { count: String(pending.length) })}
        </h2>

        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noPending')}</p>
        ) : (
          pending.map((post) => (
            <PendingCard
              key={post.id}
              post={post}
              currency={defaultCurrency ?? 'USD'}
              busy={busyId === post.id}
              canPublish={connected && (quota?.remaining ?? 0) > 0}
              onBusy={setBusyId}
              onDone={load}
            />
          ))
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('historyTitle')}</h2>
          {history.map((post) => (
            <HistoryRow key={post.id} post={post} />
          ))}
        </section>
      )}
    </div>
  );
}

function PendingCard({
  post,
  currency,
  busy,
  canPublish,
  onBusy,
  onDone,
}: {
  post: QueuePost;
  currency: string;
  busy: boolean;
  canPublish: boolean;
  onBusy: (id: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('InstagramQueue');
  const [caption, setCaption] = useState(
    post.edited_caption ?? post.proposed_caption
  );
  const [dirty, setDirty] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);

  const remainingChars = CAPTION_MAX_CHARS - [...caption].length;

  async function saveCaption() {
    onBusy(post.id);
    try {
      const res = await fetch(`/api/instagram/queue/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('saveFailed'));
        return;
      }
      setDirty(false);
      toast.success(t('saved'));
    } finally {
      onBusy(null);
    }
  }

  /**
   * Propone una reescritura. No guarda: deja el texto en el editor
   * para que la persona lo lea y decida. Si la cuenta no tiene IA, el
   * botón se esconde a partir de la primera respuesta y la cola sigue
   * funcionando igual.
   */
  async function rewrite() {
    onBusy(post.id);
    try {
      const res = await fetch(`/api/instagram/queue/${post.id}/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === 'ai_not_configured') setAiAvailable(false);
        toast.error(json.error ?? t('rewriteFailed'));
        return;
      }
      setCaption(json.caption);
      setDirty(true);
      toast.success(t('rewritten'));
    } finally {
      onBusy(null);
    }
  }

  async function publish() {
    onBusy(post.id);
    try {
      const res = await fetch(`/api/instagram/queue/${post.id}/approve`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        // El servidor ya redactó un mensaje que apunta a dónde se
        // arregla el problema; no se reescribe acá.
        toast.error(json.error ?? t('publishFailed'));
      } else {
        toast.success(t('published'));
      }
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  async function discard() {
    onBusy(post.id);
    try {
      const res = await fetch(`/api/instagram/queue/${post.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('discardFailed'));
      } else {
        toast.success(t('discarded'));
      }
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  const vehicle = post.vehicle;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium">
            {vehicle
              ? `${vehicle.brand} ${vehicle.model} ${vehicle.year}`
              : t('vehicleGone')}
          </p>
          {vehicle && (
            <p className="text-muted-foreground text-sm">
              {formatPrice(vehicle.price, currency)}
            </p>
          )}
        </div>

        {/* Un vehículo que ya se publicó antes no se bloquea: se avisa.
            Republicar puede ser lo correcto o un descuido, y desde acá
            no se distingue — quien decide necesita el dato a la vista. */}
        {post.previously_published_at && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs">
            {t('alreadyPublished', {
              date: new Date(post.previously_published_at).toLocaleDateString(),
            })}
          </span>
        )}
      </div>

      {vehicle && vehicle.status !== 'available' && (
        <p className="border-destructive/40 bg-destructive/10 rounded-md border p-2 text-sm">
          {t('vehicleNotAvailable')}
        </p>
      )}

      {post.image_urls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {post.image_urls.map((url, i) => (
            <div
              key={url}
              className="relative size-24 shrink-0 overflow-hidden rounded-md border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-full object-cover" />
              {i === 0 && (
                // Instagram recorta todo el carrusel según la primera:
                // conviene que se vea cuál manda.
                <span className="bg-background/80 absolute bottom-0 left-0 px-1 text-[10px]">
                  {t('firstImage')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Textarea
          value={caption}
          rows={8}
          onChange={(e) => {
            setCaption(e.target.value);
            setDirty(true);
          }}
          disabled={busy}
        />
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span className={remainingChars < 0 ? 'text-destructive' : undefined}>
            {t('charsLeft', { count: String(remainingChars) })}
          </span>
          <span className="flex gap-1">
            {aiAvailable && (
              <Button
                size="sm"
                variant="ghost"
                onClick={rewrite}
                disabled={busy}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                {t('rewrite')}
              </Button>
            )}
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                onClick={saveCaption}
                disabled={busy}
              >
                {t('saveText')}
              </Button>
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={publish} disabled={busy || dirty || !canPublish}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('publish')}
        </Button>
        <Button variant="outline" onClick={discard} disabled={busy}>
          {t('discard')}
        </Button>
        {dirty && (
          <span className="text-muted-foreground self-center text-xs">
            {t('saveBeforePublishing')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Una fila del historial.
 *
 * Lo publicado NO se puede deshacer desde acá: el sistema nunca borra
 * de Instagram. Cuando el vehículo de una publicación viva se vende,
 * esta fila lo señala para que alguien decida qué hacer con el aviso —
 * dejarlo como prueba social o retirarlo a mano.
 */
function HistoryRow({ post }: { post: QueuePost }) {
  const t = useTranslations('InstagramQueue');
  const vehicle = post.vehicle;
  const soldWithLivePost =
    post.status === 'published' && vehicle?.status === 'sold';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div>
        <span className="font-medium">
          {vehicle
            ? `${vehicle.brand} ${vehicle.model} ${vehicle.year}`
            : t('vehicleGone')}
        </span>
        <span className="text-muted-foreground ml-2">
          {t(`status.${post.status}`)}
        </span>
        {post.failure_reason && (
          <p className="text-muted-foreground">
            {post.failure_kind === 'credentials'
              ? t('failureCredentials')
              : post.failure_reason}
          </p>
        )}
      </div>

      {soldWithLivePost && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs">
          {t('soldWithLivePost')}
        </span>
      )}
    </div>
  );
}
