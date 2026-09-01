import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Encolado — un borrador por red conectada.
//
// Lo que se protege acá es que las redes NO SE ARRASTREN entre ellas:
// que una desconectada no deje pendientes, que un fallo de una no
// impida el borrador de la otra, y que retirar por vehículo retire en
// todas mientras que retirar por red retire solo en una.
// ============================================================

/** Una operación contra la base, tal como la vio el fake. */
interface Op {
  table: string;
  kind: 'select' | 'insert' | 'update' | 'delete';
  filters: Record<string, unknown>;
  values?: Record<string, unknown>;
}

interface FakeOptions {
  vehicle?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  /** Pendientes ya existentes, indexadas por red. */
  existing?: Record<string, { id: string; edited_caption: string | null }>;
  /** Redes cuyo `social_posts` falla al escribir. */
  failWritesFor?: string[];
}

const ops: Op[] = [];
let options: FakeOptions = {};

const adminClient = vi.hoisted(() => ({ supabaseAdmin: vi.fn() }));
const networksMod = vi.hoisted(() => ({
  allNetworks: vi.fn(),
  connectedNetworks: vi.fn(),
  networkAdapter: vi.fn(),
}));
const intlMod = vi.hoisted(() => ({ getTranslations: vi.fn() }));

vi.mock('@/lib/ai/admin-client', () => adminClient);
vi.mock('./networks', () => networksMod);
vi.mock('next-intl/server', () => intlMod);

const { syncVehiclePost } = await import('./queue');

/** Qué devuelve una lectura, según a qué tabla apunta. */
function resolveRead(op: Op): unknown {
  if (op.table === 'inventory_vehicles') return options.vehicle ?? null;
  if (op.table === 'accounts') return options.account ?? null;
  if (op.table === 'social_posts') {
    const network = String(op.filters.network ?? '');
    return options.existing?.[network] ?? null;
  }
  return null;
}

function fakeAdmin() {
  return {
    from(table: string) {
      const op: Op = { table, kind: 'select', filters: {} };
      ops.push(op);

      const fail = () => {
        const network = String(op.filters.network ?? '');
        return (
          op.table === 'social_posts' &&
          (options.failWritesFor ?? []).includes(network)
        );
      };

      const b: Record<string, unknown> = {
        select: () => b,
        insert: (values: Record<string, unknown>) => {
          op.kind = 'insert';
          op.values = values;
          // El insert lleva la red en el cuerpo, no en un filtro.
          op.filters.network = values.network;
          return b;
        },
        update: (values: Record<string, unknown>) => {
          op.kind = 'update';
          op.values = values;
          return b;
        },
        delete: () => {
          op.kind = 'delete';
          return b;
        },
        eq: (col: string, val: unknown) => {
          op.filters[col] = val;
          return b;
        },
        in: (col: string, val: unknown) => {
          op.filters[col] = val;
          return b;
        },
        is: (col: string, val: unknown) => {
          op.filters[col] = val;
          return b;
        },
        returns: () => b,
        maybeSingle: async () => ({ data: resolveRead(op), error: null }),
        then: (resolve: (r: { data: unknown; error: unknown }) => unknown) =>
          resolve({
            data: null,
            error: fail() ? { message: 'boom', code: 'XXXXX' } : null,
          }),
      };
      return b;
    },
  };
}

const LIMITS = { maxImages: 10, captionMaxChars: 2200, maxHashtags: 30 };

const IG = { network: 'instagram', limits: LIMITS };
const FB = {
  network: 'facebook',
  limits: { maxImages: 10, captionMaxChars: 63_206, maxHashtags: null },
};

const VEHICLE = {
  id: 'veh-1',
  status: 'available',
  images: ['https://cdn.example.com/a.jpg'],
  brand: 'MAZDA',
  model: '3',
  year: 2019,
  price: 45_000_000,
  warranty_price: null,
  mileage: 50_000,
  transmission: 'automatic',
  engine_displacement: '2.0',
  plate_city: 'BOGOTÁ',
  soat_expires_at: null,
  tecnomecanica_expires_at: null,
};

const ACCOUNT = {
  default_currency: 'COP',
  public_name: 'LoraMotors',
  public_address: null,
  public_whatsapp: null,
  public_phone: null,
  public_email: null,
};

/** Conecta estas redes y deja las demás sin conectar. */
function connect(...networks: { network: string; limits: unknown }[]) {
  networksMod.connectedNetworks.mockResolvedValue(
    networks.map((n) => ({ network: n.network, displayName: null }))
  );
}

beforeEach(() => {
  ops.length = 0;
  options = { vehicle: VEHICLE, account: ACCOUNT };
  vi.clearAllMocks();

  adminClient.supabaseAdmin.mockImplementation(() => fakeAdmin());
  // El traductor devuelve la clave: acá no se prueba el texto, se
  // prueba a cuántas redes y con qué filtros se encola.
  intlMod.getTranslations.mockResolvedValue((key: string) => key);
  networksMod.allNetworks.mockReturnValue([IG, FB]);
  networksMod.networkAdapter.mockImplementation((n: string) =>
    n === 'facebook' ? FB : n === 'instagram' ? IG : undefined
  );
  connect(IG, FB);
});

/** Los insert de pendientes, por red. */
function inserted(): string[] {
  return ops
    .filter((o) => o.table === 'social_posts' && o.kind === 'insert')
    .map((o) => String(o.values?.network));
}

/** Los delete de pendientes, con la red que filtraron (o `undefined`). */
function deleted(): (string | undefined)[] {
  return ops
    .filter((o) => o.table === 'social_posts' && o.kind === 'delete')
    .map((o) =>
      o.filters.network === undefined ? undefined : String(o.filters.network)
    );
}

describe('un borrador por red conectada', () => {
  it('con las dos redes conectadas deja dos pendientes', async () => {
    await syncVehiclePost('acct-1', 'veh-1');
    expect(inserted()).toEqual(['instagram', 'facebook']);
  });

  it('con una sola red conectada deja exactamente una', async () => {
    connect(IG);
    await syncVehiclePost('acct-1', 'veh-1');
    expect(inserted()).toEqual(['instagram']);
  });

  it('sin ninguna red conectada no deja pendientes', async () => {
    connect();
    await syncVehiclePost('acct-1', 'veh-1');
    expect(inserted()).toEqual([]);
  });

  it('no duplica una pendiente que ya existe, la refresca', async () => {
    options.existing = {
      instagram: { id: 'post-ig', edited_caption: null },
    };
    await syncVehiclePost('acct-1', 'veh-1');

    // Instagram ya tenía: se actualiza. Facebook no: se inserta.
    expect(inserted()).toEqual(['facebook']);
    const updates = ops.filter(
      (o) => o.table === 'social_posts' && o.kind === 'update'
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].values?.proposed_caption).toBeDefined();
  });

  it('no pisa el texto que una persona editó, solo sus imágenes', async () => {
    options.existing = {
      instagram: { id: 'post-ig', edited_caption: 'lo escribió alguien' },
      facebook: { id: 'post-fb', edited_caption: null },
    };
    await syncVehiclePost('acct-1', 'veh-1');

    const updates = ops.filter(
      (o) => o.table === 'social_posts' && o.kind === 'update'
    );
    // El de Instagram fue editado: solo imágenes.
    expect(updates[0].values).toHaveProperty('image_urls');
    expect(updates[0].values).not.toHaveProperty('proposed_caption');
    // El de Facebook no: se refresca el texto también.
    expect(updates[1].values).toHaveProperty('proposed_caption');
  });
});

describe('una red desconectada no deja pendientes', () => {
  it('retira las de la red que se desconectó, y solo esas', async () => {
    connect(IG);
    await syncVehiclePost('acct-1', 'veh-1');

    // Facebook quedó fuera: se limpia lo suyo y nada más.
    expect(deleted()).toEqual(['facebook']);
    expect(inserted()).toEqual(['instagram']);
  });
});

describe('el vehículo deja de ser publicable', () => {
  it('retira las pendientes de TODAS las redes al venderse', async () => {
    options.vehicle = { ...VEHICLE, status: 'sold' };
    await syncVehiclePost('acct-1', 'veh-1');

    // Un solo delete, sin filtro de red: no dejó de ser publicable en
    // una red y sí en la otra.
    expect(deleted()).toEqual([undefined]);
    expect(inserted()).toEqual([]);
  });

  it('hace lo mismo si queda reservado u oculto', async () => {
    for (const status of ['reserved', 'hidden']) {
      ops.length = 0;
      options.vehicle = { ...VEHICLE, status };
      await syncVehiclePost('acct-1', 'veh-1');
      expect(deleted()).toEqual([undefined]);
    }
  });

  it('sin fotos no encola en ninguna red, y retira lo que hubiera', async () => {
    options.vehicle = { ...VEHICLE, images: [] };
    await syncVehiclePost('acct-1', 'veh-1');

    expect(inserted()).toEqual([]);
    // Una por red: la composición falla por separado en cada una.
    expect(deleted()).toEqual(['instagram', 'facebook']);
  });
});

describe('las redes no se arrastran entre ellas', () => {
  it('el fallo de una no impide el borrador de la otra', async () => {
    options.failWritesFor = ['instagram'];

    await expect(syncVehiclePost('acct-1', 'veh-1')).rejects.toBeTruthy();

    // Instagram falló, pero Facebook llegó a insertarse igual: se
    // intentan todas y recién al final se propaga el error.
    expect(inserted()).toEqual(['instagram', 'facebook']);
  });

  it('propaga el error para que el llamador se entere', async () => {
    // Encolar es best-effort del lado de la ruta, que lo degrada a
    // warning. Pero tiene que llegarle algo: un fallo silencioso deja
    // vehículos sin publicación sin que nadie lo sepa.
    options.failWritesFor = ['facebook'];
    await expect(syncVehiclePost('acct-1', 'veh-1')).rejects.toBeTruthy();
  });
});

describe('lo que no se hace', () => {
  it('no encola nada si el vehículo no existe', async () => {
    options.vehicle = null;
    await syncVehiclePost('acct-1', 'veh-1');
    expect(inserted()).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it('acota cada consulta por cuenta, que es lo que el service-role no hace solo', async () => {
    // Este módulo corre con service-role porque la RLS de social_posts
    // exige 'admin' y quien edita inventario es 'agent'. Saltearse la
    // RLS significa que el aislamiento entre cuentas depende de que
    // TODA consulta lo filtre a mano.
    await syncVehiclePost('acct-1', 'veh-1');

    for (const op of ops) {
      // Tres formas de acotar, según la operación: `accounts` se busca
      // por su clave primaria, un insert escribe la cuenta en la fila, y
      // todo lo demás la filtra.
      const scoped =
        op.table === 'accounts'
          ? op.filters.id
          : op.kind === 'insert'
            ? op.values?.account_id
            : op.filters.account_id;
      expect({ table: op.table, kind: op.kind, scoped }).toMatchObject({
        scoped: 'acct-1',
      });
    }
  });
});
