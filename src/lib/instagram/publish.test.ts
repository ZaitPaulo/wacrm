import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { claimPublishLock, releasePublishLock } from './publish';
import { InstagramError } from './errors';

// ============================================================
// Candado — el mutex que impide la doble publicación.
// ============================================================

interface ClaimCall {
  update: Record<string, unknown>;
  filters: Record<string, unknown>;
  or?: string;
}

function claimDb(returnedRows: unknown[], calls: ClaimCall[]): SupabaseClient {
  return {
    from() {
      const call: ClaimCall = { update: {}, filters: {} };
      const b: Record<string, unknown> = {
        update: (row: Record<string, unknown>) => {
          call.update = row;
          calls.push(call);
          return b;
        },
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          return b;
        },
        or: (expr: string) => {
          call.or = expr;
          return b;
        },
        select: async () => ({ data: returnedRows, error: null }),
        then: (resolve: (r: { error: null }) => unknown) =>
          resolve({ error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('claimPublishLock', () => {
  it('toma el candado cuando el UPDATE condicional enganchó una fila', async () => {
    const calls: ClaimCall[] = [];
    const ok = await claimPublishLock(
      claimDb([{ id: 'post-1' }], calls),
      'acct-1',
      'post-1',
      new Date('2026-08-12T12:00:00Z')
    );

    expect(ok).toBe(true);
    expect(calls[0].update.publish_locked_at).toBe('2026-08-12T12:00:00.000Z');
  });

  it('exige que la fila siga pendiente, no solo que esté libre', async () => {
    // Si otra petición ya la dejó publicada, el candado no se toma
    // aunque publish_locked_at esté en null.
    const calls: ClaimCall[] = [];
    await claimPublishLock(
      claimDb([{ id: 'post-1' }], calls),
      'acct-1',
      'post-1'
    );

    expect(calls[0].filters.status).toBe('pending');
    expect(calls[0].filters.account_id).toBe('acct-1');
  });

  it('rechaza cuando otra aprobación llegó primero', async () => {
    // El WHERE del UPDATE no enganchó: la perdedora de la carrera.
    const ok = await claimPublishLock(claimDb([], []), 'acct-1', 'post-1');
    expect(ok).toBe(false);
  });

  it('considera abandonado un candado más viejo que la ventana', async () => {
    const calls: ClaimCall[] = [];
    await claimPublishLock(
      claimDb([{ id: 'post-1' }], calls),
      'acct-1',
      'post-1',
      new Date('2026-08-12T12:00:00Z')
    );

    // 30 minutos antes del `now` pasado.
    expect(calls[0].or).toContain('publish_locked_at.is.null');
    expect(calls[0].or).toContain('2026-08-12T11:30:00.000Z');
  });
});

describe('releasePublishLock', () => {
  it('deja el candado en null', async () => {
    const calls: ClaimCall[] = [];
    await releasePublishLock(claimDb([], calls), 'post-1');
    expect(calls[0].update).toEqual({ publish_locked_at: null });
  });
});

// ============================================================
// approveAndPublish — el desenlace de cada camino.
// ============================================================

const api = vi.hoisted(() => ({
  getPublishingLimit: vi.fn(),
  publishImagePost: vi.fn(),
}));
const configMod = vi.hoisted(() => ({ loadInstagramConfig: vi.fn() }));
const imagesMod = vi.hoisted(() => ({ ensurePublishableImages: vi.fn() }));

vi.mock('./api', () => api);
vi.mock('./config', () => configMod);
vi.mock('./images', () => imagesMod);

const { approveAndPublish } = await import('./publish');

/** Filas escritas, para poder afirmar sobre el estado final. */
interface Written {
  table: string;
  update?: Record<string, unknown>;
  deleted?: boolean;
}

interface FakeDbOptions {
  post?: Record<string, unknown> | null;
  vehicle?: Record<string, unknown> | null;
  /** Filas que devuelve el UPDATE del candado. Vacío = no lo toma. */
  claimRows?: unknown[];
}

function fakeDb(opts: FakeDbOptions) {
  const written: Written[] = [];
  const {
    post = {
      id: 'post-1',
      vehicle_id: 'veh-1',
      status: 'pending',
      proposed_caption: 'propuesto',
      edited_caption: null,
      image_urls: ['https://cdn.example.com/a.jpg'],
    },
    vehicle = { id: 'veh-1', status: 'available' },
    claimRows = [{ id: 'post-1' }],
  } = opts;

  const db = {
    from(table: string) {
      const record: Written = { table };
      const b: Record<string, unknown> = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        select: (_cols?: string) => b,
        update: (row: Record<string, unknown>) => {
          record.update = row;
          written.push(record);
          return b;
        },
        delete: () => {
          record.deleted = true;
          written.push(record);
          return b;
        },
        eq: () => b,
        or: () => b,
        maybeSingle: async () => ({
          data: table === 'social_posts' ? post : vehicle,
          error: null,
        }),
        // El claim termina en .select() tras el update.
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: record.update ? claimRows : [], error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;

  return { db, written };
}

const CONNECTED = {
  igUserId: 'ig-1',
  accessToken: 'tok',
  username: 'concesionario',
  tokenExpiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  configMod.loadInstagramConfig.mockResolvedValue(CONNECTED);
  api.getPublishingLimit.mockResolvedValue({
    used: 3,
    total: 50,
    durationSeconds: 86400,
    remaining: 47,
  });
  imagesMod.ensurePublishableImages.mockImplementation(
    async ({ imageUrls }: { imageUrls: string[] }) => imageUrls
  );
  api.publishImagePost.mockResolvedValue('ig-post-999');
});

const ARGS = { accountId: 'acct-1', postId: 'post-1', userId: 'user-1' };

describe('approveAndPublish — camino feliz', () => {
  it('publica y guarda el identificador como prueba', async () => {
    const { db, written } = fakeDb({});
    const out = await approveAndPublish({ db, ...ARGS });

    expect(out).toEqual({ status: 'published', externalPostId: 'ig-post-999' });

    const published = written.find((w) => w.update?.status === 'published');
    expect(published?.update?.external_post_id).toBe('ig-post-999');
    expect(published?.update?.approved_by).toBe('user-1');
    expect(published?.update?.publish_locked_at).toBeNull();
  });

  it('publica el texto editado, no el propuesto', async () => {
    const { db } = fakeDb({
      post: {
        id: 'post-1',
        vehicle_id: 'veh-1',
        status: 'pending',
        proposed_caption: 'propuesto',
        edited_caption: 'lo que escribió la persona',
        image_urls: ['https://cdn.example.com/a.jpg'],
      },
    });

    await approveAndPublish({ db, ...ARGS });

    expect(api.publishImagePost).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'lo que escribió la persona' })
    );
  });
});

describe('approveAndPublish — lo que impide publicar', () => {
  it('no publica sin cuenta conectada', async () => {
    configMod.loadInstagramConfig.mockResolvedValue(null);
    const { db } = fakeDb({});

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'no_connection',
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('no publica una fila que ya no está pendiente', async () => {
    const { db } = fakeDb({
      post: {
        id: 'post-1',
        vehicle_id: 'veh-1',
        status: 'published',
        proposed_caption: 'x',
        edited_caption: null,
        image_urls: [],
      },
    });

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'not_pending',
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('no publica cuando no queda margen del tope', async () => {
    api.getPublishingLimit.mockResolvedValue({
      used: 50,
      total: 50,
      durationSeconds: 86400,
      remaining: 0,
    });
    const { db } = fakeDb({});

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'quota_exhausted',
      remaining: 0,
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('no publica a ciegas cuando el margen no pudo consultarse', async () => {
    api.getPublishingLimit.mockRejectedValue(new Error('sin respuesta'));
    const { db } = fakeDb({});

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'quota_unknown',
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('no publica si otra aprobación tiene el candado', async () => {
    const { db } = fakeDb({ claimRows: [] });

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'locked',
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('consulta el margen antes de tomar el candado', async () => {
    // Si no queda margen, la fila debe seguir libre para mañana en vez
    // de quedar trabada por un candado que nadie va a soltar.
    api.getPublishingLimit.mockResolvedValue({
      used: 50,
      total: 50,
      durationSeconds: 86400,
      remaining: 0,
    });
    const { db, written } = fakeDb({});

    await approveAndPublish({ db, ...ARGS });

    expect(written.some((w) => w.update?.publish_locked_at !== undefined)).toBe(
      false
    );
  });
});

describe('approveAndPublish — revalidación', () => {
  it('no publica un vehículo que se vendió mientras esperaba', async () => {
    const { db } = fakeDb({ vehicle: { id: 'veh-1', status: 'sold' } });

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'vehicle_unavailable',
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('tampoco publica uno reservado', async () => {
    const { db } = fakeDb({ vehicle: { id: 'veh-1', status: 'reserved' } });

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'vehicle_unavailable',
    });
  });

  it('tampoco publica uno oculto', async () => {
    const { db } = fakeDb({ vehicle: { id: 'veh-1', status: 'hidden' } });

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'vehicle_unavailable',
    });
  });

  it('retira la pendiente de un vehículo que ya no existe', async () => {
    const { db, written } = fakeDb({ vehicle: null });

    expect(await approveAndPublish({ db, ...ARGS })).toEqual({
      status: 'vehicle_missing',
    });
    expect(written.some((w) => w.deleted)).toBe(true);
  });

  it('suelta el candado aunque no haya publicado', async () => {
    const { db, written } = fakeDb({
      vehicle: { id: 'veh-1', status: 'sold' },
    });

    await approveAndPublish({ db, ...ARGS });

    expect(written.some((w) => w.update?.publish_locked_at === null)).toBe(
      true
    );
  });
});

describe('approveAndPublish — fallos', () => {
  it('registra un token vencido como problema de credenciales', async () => {
    api.publishImagePost.mockRejectedValue(
      new InstagramError('Session has expired', 'credentials', {
        code: 190,
        answered: true,
        step: 'container',
      })
    );
    const { db, written } = fakeDb({});

    const out = await approveAndPublish({ db, ...ARGS });

    expect(out).toMatchObject({ status: 'failed', kind: 'credentials' });
    const failed = written.find((w) => w.update?.status === 'failed');
    expect(failed?.update?.failure_kind).toBe('credentials');
  });

  it('registra una imagen rechazada como problema de contenido', async () => {
    api.publishImagePost.mockRejectedValue(
      new InstagramError('Invalid image format', 'content', {
        code: 36003,
        answered: true,
        step: 'container',
      })
    );
    const { db } = fakeDb({});

    expect(await approveAndPublish({ db, ...ARGS })).toMatchObject({
      status: 'failed',
      kind: 'content',
    });
  });

  it('trata un fallo de conversión como contenido, no como conexión', async () => {
    imagesMod.ensurePublishableImages.mockRejectedValue(
      new InstagramError('No se pudo convertir la imagen', 'content')
    );
    const { db } = fakeDb({});

    expect(await approveAndPublish({ db, ...ARGS })).toMatchObject({
      status: 'failed',
      kind: 'content',
    });
    expect(api.publishImagePost).not.toHaveBeenCalled();
  });

  it('manda a revisión manual cuando NO SE SABE si publicó', async () => {
    // La petición de media_publish se fue y no volvió nada: pudo haber
    // publicado. Reintentar duplicaría algo que no se puede retirar.
    api.publishImagePost.mockRejectedValue(
      new InstagramError('Instagram no respondió (publish)', 'content', {
        answered: false,
        step: 'publish',
      })
    );
    const { db, written } = fakeDb({});

    const out = await approveAndPublish({ db, ...ARGS });

    expect(out).toMatchObject({ status: 'needs_review' });
    const row = written.find((w) => w.update?.status === 'needs_review');
    expect(row).toBeDefined();
    expect(written.some((w) => w.update?.status === 'failed')).toBe(false);
  });

  it('marca fallida, no a revisión, si se cayó creando contenedores', async () => {
    // Sin respuesta pero ANTES de publicar: no salió nada, y eso sí se
    // puede reintentar sin riesgo de duplicar.
    api.publishImagePost.mockRejectedValue(
      new InstagramError('Instagram no respondió (container)', 'content', {
        answered: false,
        step: 'container',
      })
    );
    const { db } = fakeDb({});

    expect(await approveAndPublish({ db, ...ARGS })).toMatchObject({
      status: 'failed',
    });
  });
});
