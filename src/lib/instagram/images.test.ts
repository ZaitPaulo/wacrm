import { isSharedArrayBuffer } from 'node:util/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// sharp es un módulo nativo y acá no interesa qué píxeles produce, sino
// que se lo llame solo cuando hace falta y que su fallo se clasifique
// bien. Se simula con una cadena que imita su API fluida.
const toBuffer = vi.fn(async () => Buffer.from('jpeg-bytes'));
const jpeg = vi.fn(() => ({ toBuffer }));
const flatten = vi.fn(() => ({ jpeg }));
const sharpMock = vi.fn(() => ({ flatten }));

vi.mock('sharp', () => ({ default: sharpMock }));

const { convertedObjectPath, ensurePublishableImages } =
  await import('./images');
const { InstagramError } = await import('./errors');

const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555';

interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
}

/** Cliente de Storage simulado, con el encadenamiento de supabase-js. */
function fakeDb(opts: { uploadError?: string } = {}) {
  // Los parámetros van declarados aunque el cuerpo no los use: sin
  // ellos las llamadas registradas se tipan como tupla vacía y leer
  // mock.calls[0][2] no compila.
  const upload = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_path: string, _body: Buffer, _options: UploadOptions) => ({
      error: opts.uploadError ? { message: opts.uploadError } : null,
    })
  );
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://bucket.example.com/${path}` },
  }));
  return {
    db: { storage: { from: () => ({ upload, getPublicUrl }) } },
    upload,
    getPublicUrl,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('convertedObjectPath', () => {
  it('respeta el prefijo account- que exige la RLS del bucket', () => {
    const path = convertedObjectPath(ACCOUNT_ID, 'https://x.com/a.png');
    expect(path.startsWith(`account-${ACCOUNT_ID}/`)).toBe(true);
    expect(path.endsWith('.jpg')).toBe(true);
  });

  it('es determinista: la misma foto siempre cae en la misma ruta', () => {
    const a = convertedObjectPath(ACCOUNT_ID, 'https://x.com/a.png');
    const b = convertedObjectPath(ACCOUNT_ID, 'https://x.com/a.png');
    expect(a).toBe(b);
  });

  it('separa fotos distintas', () => {
    const a = convertedObjectPath(ACCOUNT_ID, 'https://x.com/a.png');
    const b = convertedObjectPath(ACCOUNT_ID, 'https://x.com/b.png');
    expect(a).not.toBe(b);
  });
});

describe('ensurePublishableImages', () => {
  it('no reconvierte lo que ya es JPEG', async () => {
    const { db, upload } = fakeDb();
    const urls = [
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpeg',
    ];

    const out = await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: urls,
    });

    expect(out).toEqual(urls);
    expect(sharpMock).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('convierte PNG y WebP y devuelve la copia del bucket', async () => {
    const { db, upload } = fakeDb();

    const out = await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: [
        'https://cdn.example.com/a.png',
        'https://cdn.example.com/b.webp',
      ],
    });

    expect(sharpMock).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
    for (const url of out) {
      expect(url).toContain('https://bucket.example.com/');
      expect(url.endsWith('.jpg')).toBe(true);
    }
  });

  it('sube bytes que fetch acepte, aunque sharp los entregue compartidos', async () => {
    // sharp asigna sus salidas en un pool de memoria COMPARTIDA: su
    // toBuffer() real devuelve un Buffer cuyo `.buffer` es un
    // SharedArrayBuffer de 16 MB (comprobado en producción con sharp
    // 0.35 sobre Node 20). undici rechaza ese cuerpo con "ArrayBuffer:
    // SharedArrayBuffer is not allowed", así que la subida fallaba
    // SIEMPRE y ninguna publicación llegó nunca a Instagram.
    const pool = new Uint8Array(new SharedArrayBuffer(64));
    pool.set([0xff, 0xd8, 0xff, 0xe0]);
    // El cast reproduce la mentira de los tipos de sharp, que es parte
    // del bug: prometen Buffer<ArrayBuffer> y en runtime entregan uno
    // respaldado por memoria compartida, así que TypeScript nunca pudo
    // avisar de nada.
    toBuffer.mockResolvedValueOnce(
      Buffer.from(pool.buffer, 0, 4) as unknown as Buffer<ArrayBuffer>
    );

    const { db, upload } = fakeDb();

    await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: ['https://cdn.example.com/a.webp'],
    });

    const [, body] = upload.mock.calls[0];
    expect(isSharedArrayBuffer(body.buffer)).toBe(false);
    expect([...body]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('sube como image/jpeg y sobreescribe su propia copia', async () => {
    const { db, upload } = fakeDb();

    await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: ['https://cdn.example.com/a.png'],
    });

    const [, , options] = upload.mock.calls[0];
    expect(options.contentType).toBe('image/jpeg');
    expect(options.upsert).toBe(true);
  });

  it('aplana la transparencia para que un PNG no salga con fondo negro', async () => {
    const { db } = fakeDb();

    await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: ['https://cdn.example.com/a.png'],
    });

    expect(flatten).toHaveBeenCalledWith({ background: '#ffffff' });
  });

  it('conserva el orden, que define el encuadre del carrusel', async () => {
    const { db } = fakeDb();

    const out = await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: [
        'https://cdn.example.com/primera.jpg',
        'https://cdn.example.com/segunda.png',
        'https://cdn.example.com/tercera.jpg',
      ],
    });

    expect(out[0]).toBe('https://cdn.example.com/primera.jpg');
    expect(out[1]).toContain('bucket.example.com');
    expect(out[2]).toBe('https://cdn.example.com/tercera.jpg');
  });
});

describe('un fallo de imagen nunca se reporta como problema de conexión', () => {
  it('clasifica como contenido una conversión fallida', async () => {
    const { db } = fakeDb();
    toBuffer.mockRejectedValueOnce(new Error('corrupt image'));

    const err = await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: ['https://cdn.example.com/a.png'],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InstagramError);
    expect((err as InstanceType<typeof InstagramError>).kind).toBe('content');
    expect((err as Error).message).toMatch(/no se pudo convertir/i);
  });

  it('clasifica como contenido una foto que ya no está', async () => {
    const { db } = fakeDb();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 }))
    );

    const err = await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: ['https://cdn.example.com/a.png'],
    }).catch((e: unknown) => e);

    expect((err as InstanceType<typeof InstagramError>).kind).toBe('content');
    expect((err as Error).message).toMatch(/no se pudo descargar/i);
  });

  it('clasifica como contenido un fallo al guardar la copia', async () => {
    const { db } = fakeDb({ uploadError: 'bucket lleno' });

    const err = await ensurePublishableImages({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      accountId: ACCOUNT_ID,
      imageUrls: ['https://cdn.example.com/a.png'],
    }).catch((e: unknown) => e);

    expect((err as InstanceType<typeof InstagramError>).kind).toBe('content');
  });
});
