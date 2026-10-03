// ============================================================
// La subida de una tanda de fotos de un vehículo, sin DOM.
//
// Vive fuera de la página porque el error que corrige es de lógica, no
// de interfaz: con un solo try alrededor de toda la tanda, una foto que
// fallaba a mitad de camino tiraba también las que ya habían subido.
// Quedaban en el bucket, huérfanas, y fuera de la ficha, y la persona
// tenía que volver a subirlas todas sin saber cuáles habían entrado.
//
// Las dependencias (comprimir, subir, el tope) llegan inyectadas para
// probar la tanda con archivos falsos; la página solo pone los toasts y
// agrega las URLs al borrador.
// ============================================================

import { sortFilesByName } from '@/lib/inventory/photo-order';

export type UploadBatchDeps<F, C> = {
  /** Achica la foto antes de subirla (las de celular superan el tope). */
  compress: (file: F) => Promise<C>;
  /** Sube la foto ya comprimida y devuelve su URL pública. */
  upload: (optimized: C) => Promise<string>;
  /** Tope del bucket: lo que lo supera aún comprimido no se intenta subir. */
  maxBytes: number;
};

/**
 * Por qué no entró una foto. `tooLarge` es culpa del archivo y tiene un
 * mensaje propio que le dice a la persona qué hacer; `error` es todo lo
 * demás (red, bucket, compresión) y trae el error para mostrarlo.
 */
export type UploadBatchFailure =
  | { name: string; reason: 'tooLarge' }
  | { name: string; reason: 'error'; error: unknown };

export type UploadBatchResult = {
  /** Las que subieron, en orden por nombre de archivo. */
  urls: string[];
  /** Las que no, en el mismo orden, para avisar una por una. */
  failed: UploadBatchFailure[];
};

/**
 * Sube las fotos de a una, en orden por nombre (ver `sortFilesByName`:
 * el `FileList` no respeta el orden que la persona ve), y NUNCA corta la
 * tanda por una foto que falla: la anota y sigue con la siguiente. Así
 * lo que ya subió siempre vuelve en `urls` y llega a la ficha.
 *
 * Secuencial y no en paralelo a propósito: el orden de llegada al bucket
 * no importa, pero el de `urls` sí —decide la portada—, y en serie no
 * hace falta reordenar nada al final ni saturar la conexión del celular.
 */
export async function uploadPhotoBatch<F extends { name: string }, C extends { size: number }>(
  files: readonly F[],
  deps: UploadBatchDeps<F, C>
): Promise<UploadBatchResult> {
  const urls: string[] = [];
  const failed: UploadBatchFailure[] = [];

  for (const file of sortFilesByName(files)) {
    try {
      const optimized = await deps.compress(file);
      if (optimized.size > deps.maxBytes) {
        failed.push({ name: file.name, reason: 'tooLarge' });
        continue;
      }
      urls.push(await deps.upload(optimized));
    } catch (error) {
      failed.push({ name: file.name, reason: 'error', error });
    }
  }

  return { urls, failed };
}
