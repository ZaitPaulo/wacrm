## Why

Los asesores reciben documentos, fotos y audios de los clientes (cédula, papeles del carro) y necesitan pasárselos a otra persona por WhatsApp: al banco, a un compañero, al dueño. Hoy solo pueden descargarlos y volver a adjuntarlos a mano.

## What Changes

- Botón **"Reenviar a WhatsApp"** en cada foto, video, audio y documento del chat, y en el visor de fotos.
- Abre el menú de compartir del dispositivo con el archivo adjunto; el asesor elige WhatsApp y ahí escoge el destinatario.
- Donde el navegador no puede compartir ese archivo, lo descarga y avisa que se adjunte en WhatsApp.

## Capabilities

### New Capabilities

- `media-forwarding`: reenviar un adjunto del chat por el menú de compartir del dispositivo.

### Modified Capabilities

(ninguna)

## Impact

- `src/lib/media/share.ts`, `src/hooks/use-media-share.ts`, `src/components/inbox/message-media.tsx`, `src/components/inbox/media-lightbox.tsx`, traducciones.
- Sin backend ni migraciones. Los adjuntos entrantes se siguen pidiendo a Meta al abrirlos, así que un archivo que Meta ya borró no se puede reenviar (limitación de la descarga que ya existía).
