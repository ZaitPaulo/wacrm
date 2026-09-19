# media-forwarding Specification

## Purpose
TBD - created by archiving change reenviar-adjuntos-whatsapp. Update Purpose after archive.
## Requirements
### Requirement: Un adjunto del chat se puede reenviar por WhatsApp

Cada foto, video, audio y documento de una conversación, y la foto abierta en el visor, SHALL ofrecer "Reenviar a WhatsApp". Al usarlo, el sistema SHALL abrir el menú de compartir del dispositivo con el archivo adjunto, con su nombre y su tipo, para que el asesor elija la app y el destinatario.

#### Scenario: Reenviar una cédula en PDF

- **WHEN** el asesor toca "Reenviar a WhatsApp" en un documento `cedula.pdf`
- **THEN** se abre el menú de compartir con el archivo `cedula.pdf` de tipo PDF

#### Scenario: El asesor cierra el menú

- **WHEN** el asesor abre el menú de compartir y lo cierra sin elegir
- **THEN** no se muestra ningún error

### Requirement: Sin menú de compartir, el archivo se descarga

Cuando el navegador no puede compartir el archivo —no tiene la función o no admite ese tipo—, el sistema SHALL descargarlo y avisar que se adjunte en WhatsApp. Cuando el navegador niega compartir porque bajar el archivo tardó, SHALL pedir que se toque de nuevo.

#### Scenario: Navegador sin Web Share

- **WHEN** el asesor usa un navegador que no comparte archivos y toca "Reenviar a WhatsApp"
- **THEN** el archivo se descarga y aparece el aviso para adjuntarlo en WhatsApp

#### Scenario: Archivo que no se pudo bajar

- **WHEN** el archivo ya no está disponible en Meta
- **THEN** aparece un aviso de error

