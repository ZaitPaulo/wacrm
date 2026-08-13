// ============================================================
// Las fotos, en el formato que Instagram acepta.
//
// El bucket `showcase-media` admite PNG, JPEG y WebP (migración 506).
// Instagram publica JPEG y nada más. El desajuste es real y silencioso:
// un vehículo bien fotografiado pero subido en PNG no sería publicable,
// por una razón invisible para quien cargó las fotos.
//
// Se convierte antes de publicar y la copia se deja en el mismo bucket
// público, que es de donde Meta descarga (decisión 12 del design).
//
// Corre en el servidor, con el cliente service-role que le pasa quien
// llama — mismo trato que `logAiUsage`, y por lo mismo: acá no hay
// `auth.uid()` que valga.
// ============================================================

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

import { contentError } from './errors';
import { isPublishableImageUrl } from './limits';

/** El bucket de la vitrina, ya público desde la 506. */
export const SHOWCASE_BUCKET = 'showcase-media';

/**
 * Calidad de la conversión.
 *
 * 90 mantiene la foto presentable y deja el archivo holgadamente bajo
 * el tope de 5 MB del bucket, que es más estricto que el de Instagram.
 * Va acá y no en limits.ts a propósito: no es una regla de Meta, es una
 * decisión nuestra sobre la copia que generamos.
 */
const JPEG_QUALITY = 90;

/**
 * Ruta determinista de la copia convertida.
 *
 * Deriva del hash de la URL original, así que la misma foto siempre cae
 * en la misma ruta. Eso hace la conversión idempotente: reintentar una
 * publicación no llena el bucket de copias, sobreescribe la suya.
 *
 * Respeta el prefijo `account-<uuid>/` que exige la RLS de escritura
 * del bucket. El service-role la saltea, pero desviarse de la
 * convención dejaría objetos que ningún miembro podría borrar después.
 */
export function convertedObjectPath(
  accountId: string,
  sourceUrl: string
): string {
  const digest = createHash('sha256').update(sourceUrl).digest('hex');
  return `account-${accountId}/instagram/${digest.slice(0, 32)}.jpg`;
}

/**
 * Descarga una imagen y devuelve sus bytes.
 *
 * Un fallo acá es de CONTENIDO, no de credenciales: la foto no está
 * donde decía estar, y eso se arregla en el vehículo, no reconectando
 * Instagram.
 */
async function downloadImage(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw contentError(`No se pudo descargar la imagen: ${url}`);
  }
  if (!response.ok) {
    throw contentError(
      `No se pudo descargar la imagen (${response.status}): ${url}`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Convierte una imagen a JPEG y la deja en el bucket, devolviendo su
 * URL pública.
 */
async function convertAndUpload(args: {
  db: SupabaseClient;
  accountId: string;
  sourceUrl: string;
}): Promise<string> {
  const { db, accountId, sourceUrl } = args;

  const original = await downloadImage(sourceUrl);

  let jpeg: Buffer;
  try {
    // `flatten` sobre blanco antes de convertir: el JPEG no tiene canal
    // alfa, y sin esto un PNG con transparencia sale con el fondo negro.
    jpeg = await sharp(original)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch {
    throw contentError(`No se pudo convertir la imagen: ${sourceUrl}`);
  }

  const path = convertedObjectPath(accountId, sourceUrl);
  const { error } = await db.storage.from(SHOWCASE_BUCKET).upload(path, jpeg, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    // La ruta es determinista: reintentar sobreescribe su propia copia
    // en vez de chocar con ella.
    upsert: true,
  });
  if (error) {
    throw contentError(
      `No se pudo guardar la imagen convertida: ${error.message}`
    );
  }

  const {
    data: { publicUrl },
  } = db.storage.from(SHOWCASE_BUCKET).getPublicUrl(path);
  return publicUrl;
}

/**
 * Devuelve las URLs listas para mandarle a Instagram, convirtiendo solo
 * lo que haga falta.
 *
 * El ORDEN SE CONSERVA: Instagram recorta todo el carrusel según la
 * primera imagen, así que reordenar acá cambiaría el encuadre de la
 * publicación que la persona aprobó.
 *
 * Se procesan en serie y no en paralelo: cada conversión carga la
 * imagen entera en memoria, y diez a la vez en una función serverless
 * es la forma corta de quedarse sin memoria.
 */
export async function ensurePublishableImages(args: {
  db: SupabaseClient;
  accountId: string;
  imageUrls: string[];
}): Promise<string[]> {
  const { db, accountId, imageUrls } = args;

  const out: string[] = [];
  for (const url of imageUrls) {
    if (isPublishableImageUrl(url)) {
      out.push(url);
      continue;
    }
    out.push(await convertAndUpload({ db, accountId, sourceUrl: url }));
  }
  return out;
}
