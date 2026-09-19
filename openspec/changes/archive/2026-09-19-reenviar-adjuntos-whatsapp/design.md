## Context

WhatsApp no permite adjuntar un archivo por enlace: `wa.me` solo lleva texto. La única vía desde el navegador es la Web Share API con el archivo, que abre el menú del sistema.

## Decisions

- **Web Share API con archivos**, reutilizando `loadMediaBlob` (misma caché que la miniatura y la descarga) y `mediaFilename` (mismo nombre que la descarga).
- **`navigator.share` exige un clic reciente.** Si bajar el archivo tarda, el navegador responde `NotAllowedError`: se pide tocar otra vez, y el segundo toque usa el archivo ya en caché.
- **Respaldo: descargar.** Cubre Firefox de escritorio y tipos que el navegador no comparte (Word, por ejemplo).

## Risks / Trade-offs

- [En PC, WhatsApp aparece en el menú solo si está instalada la app de escritorio] → Con WhatsApp Web no hay forma de entregarle el archivo; el asesor lo adjunta desde la descarga.
