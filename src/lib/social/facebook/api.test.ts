import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPhotoPost,
  listManagedPages,
  publishPhotoPost,
  uploadPhoto,
} from './api';
import { SocialPublishError } from '../errors';

const AUTH = { pageId: 'page-123', accessToken: 'page-token-abc' } as const;

/** Respuesta JSON exitosa. */
function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Respuesta de error de Meta, con su forma real. */
function metaError(
  status: number,
  error: { message: string; code?: number; type?: string }
): Response {
  return new Response(JSON.stringify({ error }), { status });
}

/** El cuerpo JSON de la llamada n-ésima al fetch simulado. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

/** La URL de la llamada n-ésima. */
function urlOf(fetchMock: ReturnType<typeof vi.fn>, call: number): string {
  return String(fetchMock.mock.calls[call][0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publishPhotoPost', () => {
  it('publica una sola foto directamente, sin armar una entrada', async () => {
    // Una entrada de una sola adjunta agrega un paso que no aporta y
    // deja una foto suelta subida si el segundo paso falla.
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ id: 'photo-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const postId = await publishPhotoPost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'Un auto',
    });

    expect(postId).toBe('photo-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock, 0)).toContain('page-123/photos');

    // La foto sale publicada y con su texto.
    const body = bodyOf(fetchMock, 0);
    expect(body.caption).toBe('Un auto');
    expect(body.url).toBe('https://cdn.example.com/a.jpg');
    expect(body.published).toBeUndefined();
  });

  it('sube las fotos sin publicar y recién después crea la entrada', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'photo-1' }))
      .mockResolvedValueOnce(ok({ id: 'photo-2' }))
      .mockResolvedValueOnce(ok({ id: 'post-9' }));
    vi.stubGlobal('fetch', fetchMock);

    const postId = await publishPhotoPost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      caption: 'Dos fotos',
    });

    expect(postId).toBe('post-9');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Las dos primeras suben sin publicar: nadie las ve todavía.
    expect(bodyOf(fetchMock, 0).published).toBe('false');
    expect(bodyOf(fetchMock, 1).published).toBe('false');
    // Y no llevan texto: el texto vive en la entrada.
    expect(bodyOf(fetchMock, 0).caption).toBeUndefined();

    // La tercera es la entrada, y es el paso irreversible.
    expect(urlOf(fetchMock, 2)).toContain('page-123/feed');
    const feed = bodyOf(fetchMock, 2);
    expect(feed.message).toBe('Dos fotos');
    expect(JSON.parse(feed.attached_media)).toEqual([
      { media_fbid: 'photo-1' },
      { media_fbid: 'photo-2' },
    ]);
  });

  it('conserva el orden de las fotos', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'p-a' }))
      .mockResolvedValueOnce(ok({ id: 'p-b' }))
      .mockResolvedValueOnce(ok({ id: 'p-c' }))
      .mockResolvedValueOnce(ok({ id: 'post-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await publishPhotoPost({
      ...AUTH,
      imageUrls: ['a.jpg', 'b.jpg', 'c.jpg'].map(
        (n) => `https://cdn.example.com/${n}`
      ),
      caption: 'Tres',
    });

    expect(JSON.parse(bodyOf(fetchMock, 3).attached_media)).toEqual([
      { media_fbid: 'p-a' },
      { media_fbid: 'p-b' },
      { media_fbid: 'p-c' },
    ]);
  });

  it('recorta al máximo de fotos en vez de fallar', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      String(url).includes('/feed')
        ? ok({ id: 'post-1' })
        : ok({ id: `photo-${fetchMock.mock.calls.length}` })
    );
    vi.stubGlobal('fetch', fetchMock);

    const many = Array.from(
      { length: 15 },
      (_, i) => `https://cdn.example.com/${i}.jpg`
    );
    await publishPhotoPost({ ...AUTH, imageUrls: many, caption: 'Muchas' });

    // 10 subidas + 1 entrada.
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(JSON.parse(bodyOf(fetchMock, 10).attached_media)).toHaveLength(10);
  });

  it('rechaza publicar sin imágenes', async () => {
    await expect(
      publishPhotoPost({ ...AUTH, imageUrls: [], caption: 'Nada' })
    ).rejects.toThrow(SocialPublishError);
  });
});

describe('clasificación de errores', () => {
  it('lee un token vencido como problema de credenciales', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(400, {
          message: 'Error validating access token',
          code: 190,
          type: 'OAuthException',
        })
      )
    );

    await expect(
      uploadPhoto({ ...AUTH, imageUrl: 'https://x/a.jpg', publish: true })
    ).rejects.toMatchObject({ kind: 'credentials' });
  });

  it('lee un permiso faltante como credenciales, no como contenido', async () => {
    // Falta pages_manage_posts: se arregla del lado de Meta, no tocando
    // el vehículo.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(403, { message: 'Permissions error', code: 200 })
      )
    );

    await expect(
      uploadPhoto({ ...AUTH, imageUrl: 'https://x/a.jpg', publish: true })
    ).rejects.toMatchObject({ kind: 'credentials' });
  });

  it('lee una foto rechazada como problema de contenido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(400, { message: 'Could not fetch the image', code: 1_000_000 })
      )
    );

    await expect(
      uploadPhoto({ ...AUTH, imageUrl: 'https://x/roto.jpg', publish: true })
    ).rejects.toMatchObject({ kind: 'content' });
  });
});

describe('desenlace desconocido', () => {
  it('deja en duda una entrada cuya respuesta se perdió', async () => {
    // Subir sin publicar salió bien; la entrada se fue y no volvió nada.
    // Puede haberse publicado, así que NO se puede reintentar.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'photo-1' }))
      .mockResolvedValueOnce(ok({ id: 'photo-2' }))
      .mockRejectedValueOnce(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      publishPhotoPost({
        ...AUTH,
        imageUrls: ['https://x/a.jpg', 'https://x/b.jpg'],
        caption: 'Dos',
      })
    ).rejects.toMatchObject({ answered: false, step: 'publish' });
  });

  it('NO deja en duda una subida sin publicar que se perdió', async () => {
    // Una foto sin publicar no la vio nadie: se puede reintentar sin
    // riesgo de duplicar.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      publishPhotoPost({
        ...AUTH,
        imageUrls: ['https://x/a.jpg', 'https://x/b.jpg'],
        caption: 'Dos',
      })
    ).rejects.toMatchObject({ answered: false, step: 'container' });
  });
});

describe('createPhotoPost', () => {
  it('rechaza una entrada sin fotos', async () => {
    await expect(
      createPhotoPost({ ...AUTH, photoIds: [], message: 'x' })
    ).rejects.toThrow(SocialPublishError);
  });

  it('rechaza más fotos de las que admite una entrada', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `p-${i}`);
    await expect(
      createPhotoPost({ ...AUTH, photoIds: ids, message: 'x' })
    ).rejects.toThrow(SocialPublishError);
  });

  it('falla si Meta no devuelve el identificador de la entrada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})));

    await expect(
      createPhotoPost({ ...AUTH, photoIds: ['p-1', 'p-2'], message: 'x' })
    ).rejects.toMatchObject({ kind: 'content' });
  });
});

describe('listManagedPages', () => {
  it('devuelve las páginas con su propio token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok({
          data: [
            { id: 'p-1', name: 'LoraMotors', access_token: 'tok-1' },
            { id: 'p-2', name: 'Otra', access_token: 'tok-2' },
          ],
        })
      )
    );

    const pages = await listManagedPages({ userAccessToken: 'user-token' });

    expect(pages).toEqual([
      { id: 'p-1', name: 'LoraMotors', accessToken: 'tok-1' },
      { id: 'p-2', name: 'Otra', accessToken: 'tok-2' },
    ]);
  });

  it('descarta las páginas sin token de publicación', async () => {
    // Sin token no se puede publicar ahí. Ofrecerla terminaría en un
    // fallo de credenciales días después, sin relación aparente con lo
    // que se hizo en Ajustes.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok({
          data: [
            { id: 'p-1', name: 'Sin permiso' },
            { id: 'p-2', name: 'Con permiso', access_token: 'tok-2' },
          ],
        })
      )
    );

    const pages = await listManagedPages({ userAccessToken: 'user-token' });

    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe('p-2');
  });

  it('devuelve vacío cuando el usuario no administra ninguna', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ data: [] })));

    expect(await listManagedPages({ userAccessToken: 'user-token' })).toEqual(
      []
    );
  });

  it('reporta un token de usuario inválido como credenciales', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(400, {
          message: 'Invalid OAuth access token',
          code: 190,
          type: 'OAuthException',
        })
      )
    );

    await expect(
      listManagedPages({ userAccessToken: 'malo' })
    ).rejects.toMatchObject({ kind: 'credentials' });
  });
});
