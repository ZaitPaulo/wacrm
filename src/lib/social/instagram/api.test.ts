import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCarouselContainer,
  getAccountInfo,
  getPublishingLimit,
  isPublishableAccountType,
  publishImagePost,
} from './api';
import { SocialPublishError } from '../errors';

const AUTH = { igUserId: 'ig-123', accessToken: 'token-abc' } as const;

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

describe('publishImagePost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publica una sola imagen sin pasar por el carrusel', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'container-1' }))
      .mockResolvedValueOnce(ok({ id: 'container-1', status_code: 'FINISHED' }))
      .mockResolvedValueOnce(ok({ id: 'post-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const postId = await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'Un auto',
    });

    expect(postId).toBe('post-1');
    // Crear, comprobar que está listo, publicar.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // El contenedor único lleva el texto y NO se marca como hijo.
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.caption).toBe('Un auto');
    expect(firstBody.is_carousel_item).toBeUndefined();
    expect(firstBody.media_type).toBeUndefined();
  });

  it('arma un carrusel con un hijo por imagen y el texto en el padre', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'child-1' }))
      .mockResolvedValueOnce(ok({ id: 'child-2' }))
      .mockResolvedValueOnce(ok({ id: 'parent-1' }))
      .mockResolvedValueOnce(ok({ id: 'parent-1', status_code: 'FINISHED' }))
      .mockResolvedValueOnce(ok({ id: 'post-2' }));
    vi.stubGlobal('fetch', fetchMock);

    const postId = await publishImagePost({
      ...AUTH,
      imageUrls: [
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ],
      caption: 'Dos fotos',
    });

    expect(postId).toBe('post-2');
    // Dos hijos, el padre, la comprobación de estado y la publicación.
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const childBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(childBody.is_carousel_item).toBe('true');
    expect(childBody.caption).toBeUndefined();

    const parentBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(parentBody.media_type).toBe('CAROUSEL');
    expect(parentBody.children).toBe('child-1,child-2');
    expect(parentBody.caption).toBe('Dos fotos');
  });

  it('recorta al máximo de Instagram en vez de fallar', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => ok({ id: 'x', status_code: 'FINISHED' }));
    vi.stubGlobal('fetch', fetchMock);

    const imageUrls = Array.from(
      { length: 14 },
      (_, i) => `https://cdn.example.com/${i}.jpg`
    );
    await publishImagePost({ ...AUTH, imageUrls, caption: 'Muchas' });

    // 10 hijos + 1 padre + 1 comprobación de estado + 1 publicación.
    expect(fetchMock).toHaveBeenCalledTimes(13);
  });

  it('espera a que Instagram termine de procesar antes de publicar', async () => {
    // El contenedor no está listo en cuanto Instagram devuelve su id.
    // Publicarlo antes de tiempo devuelve "Media ID is not available", que
    // fue exactamente lo que impidió la primera publicación real.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'container-1' }))
      .mockResolvedValueOnce(
        ok({ id: 'container-1', status_code: 'IN_PROGRESS' })
      )
      .mockResolvedValueOnce(ok({ id: 'container-1', status_code: 'FINISHED' }))
      .mockResolvedValueOnce(ok({ id: 'post-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const postId = await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'x',
      poll: { intervalMs: 0 },
    });

    expect(postId).toBe('post-1');
    // La consulta de estado es un GET al contenedor, no un POST.
    expect(fetchMock.mock.calls[1][0]).toContain('status_code');
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined();
    // Y publicar es lo ÚLTIMO que ocurre.
    expect(fetchMock.mock.calls[3][0]).toContain('media_publish');
  });

  it('no publica un contenedor que sigue procesándose, y lo dice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'container-1' }))
      .mockResolvedValue(ok({ id: 'container-1', status_code: 'IN_PROGRESS' }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'x',
      poll: { intervalMs: 0, timeoutMs: 0 },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SocialPublishError);
    // Contenido, no credenciales: la cuenta está bien, hay que reintentar.
    expect((err as SocialPublishError).kind).toBe('content');
    expect((err as Error).message).toMatch(/procesando/i);
    // Nada se publicó.
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('media_publish'))
    ).toBe(false);
  });

  it('no publica un contenedor que Instagram no pudo procesar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'container-1' }))
      .mockResolvedValueOnce(ok({ id: 'container-1', status_code: 'ERROR' }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'x',
      poll: { intervalMs: 0 },
    }).catch((e: unknown) => e);

    expect((err as SocialPublishError).kind).toBe('content');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rechaza publicar sin imágenes', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      publishImagePost({ ...AUTH, imageUrls: [], caption: 'Nada' })
    ).rejects.toThrow(/No hay imágenes/);
  });

  it('usa el host de Instagram Login, no el de Facebook', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => ok({ id: 'x', status_code: 'FINISHED' }));
    vi.stubGlobal('fetch', fetchMock);

    await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'Host',
    });

    expect(fetchMock.mock.calls[0][0]).toContain('graph.instagram.com');
    expect(fetchMock.mock.calls[0][0]).not.toContain('graph.facebook.com');
  });
});

describe('clasificación de errores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('trata un token vencido como problema de credenciales', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(400, {
          message: 'Error validating access token: Session has expired',
          code: 190,
          type: 'OAuthException',
        })
      )
    );

    const err = await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.jpg'],
      caption: 'x',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SocialPublishError);
    expect((err as SocialPublishError).kind).toBe('credentials');
    expect((err as SocialPublishError).code).toBe(190);
  });

  it('trata una imagen rechazada como problema de contenido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(400, {
          message: 'The image is not a valid format',
          code: 36003,
        })
      )
    );

    const err = await publishImagePost({
      ...AUTH,
      imageUrls: ['https://cdn.example.com/a.png'],
      caption: 'x',
    }).catch((e: unknown) => e);

    expect((err as SocialPublishError).kind).toBe('content');
  });

  it('no manda a reconectar por un contenedor que no estaba listo', async () => {
    // Meta devuelve "Media ID is not available" con type OAuthException
    // aunque el token esté perfecto. Leerlo como credencial mandaba a
    // desconectar una cuenta que funciona — justo lo que el módulo
    // promete no hacer.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(400, {
          message: 'Media ID is not available',
          code: 9007,
          type: 'OAuthException',
        })
      )
    );

    const err = await getAccountInfo({ accessToken: 'buena' }).catch(
      (e: unknown) => e
    );

    expect((err as SocialPublishError).kind).toBe('content');
    expect((err as SocialPublishError).code).toBe(9007);
  });

  it('trata un 401 sin cuerpo útil como problema de credenciales', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401 }))
    );

    const err = await getAccountInfo({ accessToken: 'bad' }).catch(
      (e: unknown) => e
    );

    expect((err as SocialPublishError).kind).toBe('credentials');
  });

  it('trata un permiso faltante como problema de credenciales', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        metaError(403, {
          message: 'Application does not have permission for this action',
          code: 200,
        })
      )
    );

    const err = await getAccountInfo({ accessToken: 'x' }).catch(
      (e: unknown) => e
    );

    expect((err as SocialPublishError).kind).toBe('credentials');
  });
});

describe('createCarouselContainer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rechaza un carrusel vacío antes de la red', async () => {
    await expect(
      createCarouselContainer({ ...AUTH, childrenIds: [], caption: 'x' })
    ).rejects.toThrow(/al menos una imagen/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechaza más elementos de los que Instagram acepta', async () => {
    await expect(
      createCarouselContainer({
        ...AUTH,
        childrenIds: Array.from({ length: 11 }, (_, i) => `c${i}`),
        caption: 'x',
      })
    ).rejects.toThrow(/hasta 10/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('getPublishingLimit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lee el tope de la respuesta, no de una constante', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok({
          data: [
            {
              quota_usage: 7,
              config: { quota_total: 50, quota_duration: 86400 },
            },
          ],
        })
      )
    );

    const limit = await getPublishingLimit(AUTH);
    expect(limit.used).toBe(7);
    expect(limit.total).toBe(50);
    expect(limit.remaining).toBe(43);
    expect(limit.durationSeconds).toBe(86400);
  });

  it('nunca informa un margen negativo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok({
          data: [
            {
              quota_usage: 60,
              config: { quota_total: 50, quota_duration: 86400 },
            },
          ],
        })
      )
    );

    expect((await getPublishingLimit(AUTH)).remaining).toBe(0);
  });

  it('falla en vez de suponer un tope cuando la respuesta no lo trae', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ data: [] })));

    await expect(getPublishingLimit(AUTH)).rejects.toThrow(/no informó/);
  });
});

describe('isPublishableAccountType', () => {
  it('rechaza una cuenta personal', () => {
    expect(isPublishableAccountType('PERSONAL')).toBe(false);
  });

  it('acepta los tipos profesionales', () => {
    expect(isPublishableAccountType('BUSINESS')).toBe(true);
    expect(isPublishableAccountType('MEDIA_CREATOR')).toBe(true);
  });

  it('deja pasar un tipo desconocido en vez de bloquear una cuenta válida', () => {
    expect(isPublishableAccountType(null)).toBe(true);
    expect(isPublishableAccountType('SOMETHING_NEW')).toBe(true);
  });
});
