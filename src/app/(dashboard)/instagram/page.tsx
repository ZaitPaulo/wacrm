'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { formatPrice } from '@/lib/showcase/format';
import { strictestLimits, type NetworkLimits } from '@/lib/social/limits';

/**
 * La cola de publicaciones, de todas las redes.
 *
 * Acá se revisa lo que el sistema preparó y se decide qué sale. NADA
 * llega a ninguna red sin que alguien apriete Publicar en esta
 * pantalla: el encolado solo deja borradores.
 *
 * SE AGRUPA POR VEHÍCULO, y esa es la decisión de forma que manda. Un
 * auto es UNA tarjeta con un texto y un botón, y dentro se ve una línea
 * por red con su estado. El botón aprueba todas sus pendientes, de a
 * una; cada envío conserva su candado y su registro, así que lo que se
 * ahorra es el segundo clic, no la separación entre publicaciones.
 *
 * POR ESO EL BOTÓN NO PROMETE UN RESULTADO ÚNICO. Al terminar informa
 * por red, y la tarjeta queda mostrando qué salió y qué no: "publicado"
 * a secas cuando una de las dos falló sería mentira sobre la otra.
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
  limits: NetworkLimits;
}

interface QueueResponse {
  posts?: QueuePost[];
  networks?: NetworkState[];
}

/** Un vehículo con todas sus publicaciones, que es la unidad de la pantalla. */
interface VehicleGroup {
  vehicleId: string;
  vehicle: QueueVehicle | null;
  posts: QueuePost[];
  /** Las que todavía se pueden aprobar. */
  pending: QueuePost[];
  /** Las que fallaron o quedaron en duda: se pueden reintentar. */
  retryable: QueuePost[];
  createdAt: string;
}

/** Estados que mantienen un vehículo en la lista de trabajo. */
const NEEDS_ATTENTION = new Set(['pending', 'failed', 'needs_review']);

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

  /** Recarga después de aprobar, reintentar, descartar o editar. */
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

  const connected = networks.length > 0;

  /** El nombre de la red como lo lee una persona. */
  const nameOf = useCallback(
    (network: string) =>
      t.has(`networkNames.${network}`) ? t(`networkNames.${network}`) : network,
    [t]
  );

  const stateOf = useCallback(
    (network: string) => networks.find((n) => n.network === network) ?? null,
    [networks]
  );

  // Agrupar por vehículo es lo que convierte dos filas en una tarjeta.
  // Se descartan las 'discarded': fueron una decisión tomada y no hay
  // nada más que hacer con ellas.
  const groups = useMemo(() => {
    const visible = (filter ? posts.filter((p) => p.network === filter) : posts)
      .filter((p) => p.status !== 'discarded');

    const byVehicle = new Map<string, QueuePost[]>();
    for (const post of visible) {
      const list = byVehicle.get(post.vehicle_id);
      if (list) list.push(post);
      else byVehicle.set(post.vehicle_id, [post]);
    }

    const out: VehicleGroup[] = [];
    for (const [vehicleId, list] of byVehicle) {
      out.push({
        vehicleId,
        vehicle: list.find((p) => p.vehicle)?.vehicle ?? null,
        posts: list,
        pending: list.filter((p) => p.status === 'pending'),
        retryable: list.filter(
          (p) =>
            (p.status === 'failed' || p.status === 'needs_review') &&
            !p.external_post_id
        ),
        createdAt: list
          .map((p) => p.created_at)
          .reduce((a, b) => (a > b ? a : b)),
      });
    }
    return out.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }, [posts, filter]);

  // Lo que pide atención arriba; lo terminado, abajo. Un vehículo con
  // una red publicada y otra fallida sigue arriba: todavía hay algo que
  // decidir.
  const active = groups.filter((g) =>
    g.posts.some((p) => NEEDS_ATTENTION.has(p.status))
  );
  const done = groups.filter(
    (g) => !g.posts.some((p) => NEEDS_ATTENTION.has(p.status))
  );

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
          {t('pendingTitle', { count: String(active.length) })}
        </h2>

        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noPending')}</p>
        ) : (
          active.map((group) => (
            <VehicleCard
              key={group.vehicleId}
              group={group}
              currency={defaultCurrency ?? 'USD'}
              busy={busyId === group.vehicleId}
              nameOf={nameOf}
              stateOf={stateOf}
              onBusy={setBusyId}
              onDone={load}
            />
          ))
        )}
      </section>

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('historyTitle')}</h2>
          {done.map((group) => (
            <HistoryRow key={group.vehicleId} group={group} nameOf={nameOf} />
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * Un vehículo, con todas sus redes.
 *
 * El texto es UNO: la tarjeta tiene un editor, no dos, y al guardar el
 * servidor lo escribe en todas las pendientes de este vehículo. Dos
 * textos distintos para el mismo auto no le sirven a nadie que revisa,
 * y romperían el botón único.
 */
function VehicleCard({
  group,
  currency,
  busy,
  nameOf,
  stateOf,
  onBusy,
  onDone,
}: {
  group: VehicleGroup;
  currency: string;
  busy: boolean;
  nameOf: (network: string) => string;
  stateOf: (network: string) => NetworkState | null;
  onBusy: (id: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('SocialQueue');
  const { vehicle, pending, retryable, posts } = group;

  // Todas las pendientes comparten el texto, así que alcanza con la
  // primera para saber cuál es.
  const source = pending[0] ?? posts[0];
  const [caption, setCaption] = useState(
    source.edited_caption ?? source.proposed_caption
  );
  const [dirty, setDirty] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);

  // Contra el límite MÁS ESTRICTO de las redes que siguen pendientes:
  // un texto que una de ellas rechazaría no sirve para un botón que
  // publica en todas. Es el mismo cálculo que hace el servidor.
  const limits = strictestLimits(
    pending
      .map((p) => stateOf(p.network)?.limits)
      .filter((l): l is NetworkLimits => l !== undefined)
  );
  const remainingChars = (limits?.captionMaxChars ?? 0) - [...caption].length;

  /** Si esta red puede publicar ahora mismo, según su tope. */
  const canPublish = (post: QueuePost) => {
    const net = stateOf(post.network);
    if (!net) return false;
    if (!net.reportsQuota) return true;
    return (net.quota?.remaining ?? 0) > 0;
  };

  const publishable = pending.filter(canPublish);

  async function saveCaption() {
    onBusy(group.vehicleId);
    try {
      // Se manda una sola vez: el servidor escribe en todas las
      // pendientes de este vehículo.
      const res = await fetch(`/api/social/queue/${source.id}`, {
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
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  async function rewrite() {
    onBusy(group.vehicleId);
    try {
      const res = await fetch(`/api/social/queue/${source.id}/rewrite`, {
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

  /**
   * Publica en todas las redes pendientes, UNA POR UNA.
   *
   * En serie y no en paralelo: cada aprobación toma su propio candado y
   * habla con una API distinta. En paralelo, un fallo en la primera
   * dejaría a la segunda a mitad de camino sin poder decir cuál quedó
   * cómo. Y el fallo de una NO corta el intento de la otra.
   */
  async function publishAll() {
    onBusy(group.vehicleId);
    try {
      for (const post of publishable) {
        const red = nameOf(post.network);
        try {
          const res = await fetch(`/api/social/queue/${post.id}/approve`, {
            method: 'POST',
          });
          const json = await res.json();
          if (res.ok) {
            toast.success(t('published', { network: red }));
          } else {
            // El servidor ya redactó un mensaje que apunta a dónde se
            // arregla el problema; no se reescribe acá.
            toast.error(json.error ?? t('publishFailed'));
          }
        } catch {
          toast.error(t('publishFailed'));
        }
      }
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  /** Devuelve una fallida a la cola. Por red, nunca las dos juntas. */
  async function retry(post: QueuePost) {
    onBusy(group.vehicleId);
    try {
      const res = await fetch(`/api/social/queue/${post.id}/retry`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? t('retryFailed'));
        return;
      }
      toast.success(t('retried', { network: nameOf(post.network) }));
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  async function discard() {
    onBusy(group.vehicleId);
    try {
      for (const post of pending) {
        await fetch(`/api/social/queue/${post.id}`, { method: 'DELETE' });
      }
      toast.success(t('discarded'));
      await onDone();
    } finally {
      onBusy(null);
    }
  }

  const images = source.image_urls;

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
      </div>

      {vehicle && vehicle.status !== 'available' && (
        <p className="border-destructive/40 bg-destructive/10 rounded-md border p-2 text-sm">
          {t('vehicleNotAvailable')}
        </p>
      )}

      {/* UNA LÍNEA POR RED, con su estado propio. Es el corazón de esta
          pantalla: nunca un estado único por vehículo, porque en cuanto
          una red falla ese estado sería falso sobre la otra. */}
      <div className="divide-y rounded-md border">
        {posts.map((post) => (
          <NetworkRow
            key={post.id}
            post={post}
            busy={busy}
            label={nameOf(post.network)}
            target={stateOf(post.network)?.displayName ?? null}
            onRetry={() => retry(post)}
          />
        ))}
      </div>

      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((url, i) => (
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

      {pending.length > 0 && (
        <>
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
              <span
                className={remainingChars < 0 ? 'text-destructive' : undefined}
              >
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
            <Button
              onClick={publishAll}
              disabled={busy || dirty || publishable.length === 0}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {/* El botón dice EN CUÁNTAS redes va a publicar, para que
                  nadie lo apriete creyendo que sale en una sola. */}
              {publishable.length > 1
                ? t('publishAll', { count: String(publishable.length) })
                : t('publish')}
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
        </>
      )}

      {pending.length === 0 && retryable.length > 0 && (
        // Sin pendientes pero con algo que falló: no hay texto que
        // editar, pero sí una decisión que tomar.
        <p className="text-muted-foreground text-xs">{t('onlyRetryLeft')}</p>
      )}
    </div>
  );
}

/**
 * Una red dentro de la tarjeta de un vehículo: a dónde va, cómo quedó y
 * qué se puede hacer al respecto.
 */
function NetworkRow({
  post,
  busy,
  label,
  target,
  onRetry,
}: {
  post: QueuePost;
  busy: boolean;
  label: string;
  /** A dónde exactamente: `@usuario` o el nombre de la página. */
  target: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations('SocialQueue');

  // 'needs_review' NO se ofrece como un reintento cualquiera: puede
  // haberse publicado, y quien reintenta tiene que saberlo antes.
  const inDoubt = post.status === 'needs_review';
  const canRetry =
    (post.status === 'failed' || inDoubt) && !post.external_post_id;

  const tone =
    post.status === 'published'
      ? 'text-emerald-500'
      : post.status === 'failed'
        ? 'text-destructive'
        : inDoubt
          ? 'text-amber-500'
          : 'text-muted-foreground';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className={`ml-2 ${tone}`}>{t(`status.${post.status}`)}</span>

        {post.status === 'pending' && target && (
          <span className="text-muted-foreground ml-2 text-xs">
            {t('publishingTo', { target })}
          </span>
        )}
        {post.status === 'published' && post.published_at && (
          <span className="text-muted-foreground ml-2 text-xs">
            {new Date(post.published_at).toLocaleDateString()}
          </span>
        )}

        {/* Un vehículo que ya se publicó antes EN ESTA RED no se
            bloquea: se avisa. Republicar puede ser lo correcto o un
            descuido, y desde acá no se distingue. */}
        {post.status === 'pending' && post.previously_published_at && (
          <p className="mt-1 text-xs text-amber-500">
            {t('alreadyPublishedHere', {
              network: label,
              date: new Date(post.previously_published_at).toLocaleDateString(),
            })}
          </p>
        )}

        {post.failure_reason && (
          <p className="text-muted-foreground mt-1 text-xs">
            {post.failure_kind === 'credentials'
              ? t('failureCredentials', { network: label })
              : post.failure_reason}
          </p>
        )}
        {inDoubt && (
          <p className="mt-1 text-xs text-amber-500">
            {t('reviewHint', { network: label })}
          </p>
        )}
      </div>

      {canRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
          {inDoubt ? t('retryFromReview') : t('retry')}
        </Button>
      )}
    </div>
  );
}

/**
 * Un vehículo sin nada que decidir: todo publicado o descartado.
 *
 * Lo publicado NO se puede deshacer desde acá: el sistema nunca borra
 * de una red. Cuando el vehículo de una publicación viva se vende, esta
 * fila lo señala para que alguien decida qué hacer con el aviso —
 * dejarlo como prueba social o retirarlo a mano.
 */
function HistoryRow({
  group,
  nameOf,
}: {
  group: VehicleGroup;
  nameOf: (network: string) => string;
}) {
  const t = useTranslations('SocialQueue');
  const { vehicle, posts } = group;
  const live = posts.filter((p) => p.status === 'published');
  const soldWithLivePost = live.length > 0 && vehicle?.status === 'sold';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div>
        <span className="font-medium">
          {vehicle
            ? `${vehicle.brand} ${vehicle.model} ${vehicle.year}`
            : t('vehicleGone')}
        </span>
        <span className="text-muted-foreground ml-2">
          {posts
            .map((p) => `${nameOf(p.network)}: ${t(`status.${p.status}`)}`)
            .join(' · ')}
        </span>
      </div>

      {soldWithLivePost && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs">
          {t('soldWithLivePost', {
            network: live.map((p) => nameOf(p.network)).join(', '),
          })}
        </span>
      )}
    </div>
  );
}
