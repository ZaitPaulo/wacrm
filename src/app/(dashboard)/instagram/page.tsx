'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { formatPrice } from '@/lib/showcase/format';

/**
 * La cola de publicaciones, de todas las redes.
 *
 * Acá se revisa lo que el sistema preparó y se decide qué sale. NADA
 * llega a ninguna red sin que alguien apriete Publicar en esta
 * pantalla: el encolado solo deja borradores.
 *
 * UN VEHÍCULO PUEDE APARECER DOS VECES, una por red, y son decisiones
 * distintas: aprobar la de Instagram no publica en Facebook. Por eso
 * cada tarjeta dice a dónde va y los estados nunca se colapsan en uno
 * solo por vehículo — "salió en una y falló en la otra" tiene que
 * poder verse.
 *
 * La URL sigue siendo /instagram para no romper enlaces guardados.
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
  /** A qué red va. Dos filas del mismo vehículo difieren en esto. */
  network: string;
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

/** El estado de una red conectada, como lo manda la API. */
interface NetworkState {
  network: string;
  displayName: string | null;
  /** `true` si esta red informa un tope por periodo. */
  reportsQuota: boolean;
  quota: Quota | null;
  limits: { maxImages: number; captionMaxChars: number; maxHashtags: number | null };
}

interface QueueResponse {
  posts?: QueuePost[];
  networks?: NetworkState[];
}

/**
 * Trae la cola. Devuelve `null` si algo falló, y entonces la pantalla
 * se queda con lo que ya tuviera en vez de vaciarse.
 */
async function fetchQueue(): Promise<QueueResponse | null> {
  try {
    const res = await fetch('/api/social/queue');
    if (!res.ok) return null;
    return (await res.json()) as QueueResponse;
  } catch {
    return null;
  }
}

export default function SocialQueuePage() {
  const t = useTranslations('SocialQueue');
  const { defaultCurrency } = useAuth();

  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [networks, setNetworks] = useState<NetworkState[]>([]);
  /** `null` = todas. Filtrar es lo que hace usable una cola del doble. */
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Aplica una respuesta de la cola al estado. Separado del fetch para
  // que el efecto de carga inicial no llame a setState de forma
  // síncrona en su cuerpo, que es lo que la regla de hooks prohíbe.
  const apply = useCallback((json: QueueResponse) => {
    setPosts(json.posts ?? []);
    setNetworks(json.networks ?? []);
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

  const visible = filter ? posts.filter((p) => p.network === filter) : posts;
  const pending = visible.filter((p) => p.status === 'pending');
  const history = visible.filter((p) => p.status !== 'pending');

  // Conectado es "hay al menos una red". El estado de cada una se mira
  // por separado: una red caída no puede bloquear la aprobación de la
  // otra, que es la garantía de que son independientes.
  const connected = networks.length > 0;
  const networkOf = (post: QueuePost) =>
    networks.find((n) => n.network === post.network) ?? null;

  /**
   * Si esta publicación se puede aprobar ahora mismo.
   *
   * Una red sin tope publica con normalidad; una CON tope que no se
   * pudo leer no, porque publicar a ciegas gasta el intento. Los dos
   * casos llegan como `quota: null` y solo `reportsQuota` los separa.
   */
  const canPublish = (post: QueuePost) => {
    const net = networkOf(post);
    if (!net) return false;
    if (!net.reportsQuota) return true;
    return (net.quota?.remaining ?? 0) > 0;
  };

  /** El nombre de la red como lo lee una persona. */
  const nameOf = (network: string) =>
    t.has(`networkNames.${network}`) ? t(`networkNames.${network}`) : network;

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

      {/* El margen lo informa cada red, no lo calculamos nosotros: es
          el mismo número que después decide si se puede aprobar. Solo se
          muestra donde la red informa uno — inventarle un tope a la que
          no lo tiene impediría aprobar sin motivo real. */}
      {networks
        .filter((net) => net.reportsQuota)
        .map((net) => (
          <div
            key={net.network}
            className="text-muted-foreground rounded-lg border p-4 text-sm"
          >
            {net.quota
              ? t('quota', {
                  network: nameOf(net.network),
                  remaining: String(net.quota.remaining),
                  total: String(net.quota.total),
                })
              : t('quotaUnknown', { network: nameOf(net.network) })}
          </div>
        ))}

      {/* Filtro por red. Solo aparece con más de una conectada: con una
          sola es un control que no filtra nada. */}
      {networks.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[null, ...networks.map((n) => n.network)].map((value) => (
            <Button
              key={value ?? 'all'}
              size="sm"
              variant={filter === value ? 'default' : 'outline'}
              onClick={() => setFilter(value)}
            >
              {value === null ? t('filterAll') : nameOf(value)}
            </Button>
          ))}
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
              captionMaxChars={networkOf(post)?.limits.captionMaxChars ?? 0}
              networkName={nameOf(post.network)}
              target={networkOf(post)?.displayName ?? null}
              canPublish={canPublish(post)}
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
            <HistoryRow
              key={post.id}
              post={post}
              networkName={nameOf(post.network)}
            />
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
  captionMaxChars,
  networkName,
  target,
  canPublish,
  onBusy,
  onDone,
}: {
  post: QueuePost;
  currency: string;
  busy: boolean;
  /** El de la red de ESTA publicación, nunca el de otra. */
  captionMaxChars: number;
  /** Instagram, Facebook. */
  networkName: string;
  /** A dónde exactamente: `@usuario` o el nombre de la página. */
  target: string | null;
  canPublish: boolean;
  onBusy: (id: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('SocialQueue');
  const [caption, setCaption] = useState(
    post.edited_caption ?? post.proposed_caption
  );
  const [dirty, setDirty] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);

  const remainingChars = captionMaxChars - [...caption].length;

  async function saveCaption() {
    onBusy(post.id);
    try {
      const res = await fetch(`/api/social/queue/${post.id}`, {
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
      const res = await fetch(`/api/social/queue/${post.id}/rewrite`, {
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
      const res = await fetch(`/api/social/queue/${post.id}/approve`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        // El servidor ya redactó un mensaje que apunta a dónde se
        // arregla el problema; no se reescribe acá.
        toast.error(json.error ?? t('publishFailed'));
      } else {
        toast.success(t('published', { network: networkName }));
      }
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  async function discard() {
    onBusy(post.id);
    try {
      const res = await fetch(`/api/social/queue/${post.id}`, {
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
          {/* A DÓNDE VA, arriba del todo. El mismo vehículo puede tener
              otra tarjeta idéntica de la otra red justo al lado, y
              aprobar la equivocada no se deshace. */}
          <p className="text-muted-foreground mt-1 text-xs">
            <span className="text-foreground border-border rounded-full border px-2 py-0.5 font-medium">
              {networkName}
            </span>
            {target && (
              <span className="ml-2">
                {t('publishingTo', { target })}
              </span>
            )}
          </p>
        </div>

        {/* Un vehículo que ya se publicó antes no se bloquea: se avisa.
            Republicar puede ser lo correcto o un descuido, y desde acá
            no se distingue — quien decide necesita el dato a la vista. */}
        {post.previously_published_at && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs">
            {t('alreadyPublishedHere', {
              network: networkName,
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
function HistoryRow({
  post,
  networkName,
}: {
  post: QueuePost;
  networkName: string;
}) {
  const t = useTranslations('SocialQueue');
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
        {/* La red va junto al estado y no en otra columna: dos filas del
            mismo vehículo con distinto desenlace tienen que poder
            leerse de un vistazo sin cruzar la mirada. */}
        <span className="text-muted-foreground ml-2">
          {networkName} · {t(`status.${post.status}`)}
        </span>
        {post.failure_reason && (
          <p className="text-muted-foreground">
            {post.failure_kind === 'credentials'
              ? t('failureCredentials', { network: networkName })
              : post.failure_reason}
          </p>
        )}
      </div>

      {soldWithLivePost && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs">
          {t('soldWithLivePost', { network: networkName })}
        </span>
      )}
    </div>
  );
}
