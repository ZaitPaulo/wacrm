## Why

La vitrina ya se actualiza sola: `src/lib/showcase/data.ts:57-58` lee en cada carga los vehículos con `status = 'available'`, así que cargar un auto lo publica y venderlo lo retira sin que nadie toque nada. Instagram, en cambio, sigue siendo trabajo manual — alguien baja las fotos, arma la publicación y la sube, para cada vehículo.

Automatizarlo es viable porque la infraestructura ya está puesta:

- **Integración con Meta.** El proyecto ya habla con Graph API y ya cifra credenciales por cuenta (`src/lib/whatsapp/encryption.ts`, patrón de tabla `whatsapp_config`).
- **Fotos en URLs públicas.** Meta exige que las imágenes a publicar sean accesibles públicamente, y el bucket `showcase-media` (migración 506) ya es público justamente para eso.
- **Ejecución diferida.** Ya existen rutas de cron protegidas por secreto (`/api/automations/cron`, `/api/flows/cron`).

Conviene separar dos cosas que suenan parecidas y no lo son: **publicar contenido en Instagram no es recibir mensajes de Instagram**. Son APIs, permisos y revisiones de Meta distintas. El change `add-meta-multichannel` cubre la mensajería; este cubre la publicación, y ninguno depende del otro.

## What Changes

- **Conectar una cuenta de Instagram** del negocio, con sus credenciales cifradas como ya se hace con WhatsApp.
- **Una cola de publicaciones.** Cuando un vehículo queda disponible, el sistema **prepara** una publicación y la deja pendiente de revisión. No publica solo.
- **Aprobación humana explícita.** Alguien revisa la publicación armada, puede editarle el texto y decide publicarla o descartarla. Publicar es un acto deliberado.
- **Composición de la publicación** a partir de los datos que ya tiene el vehículo: un carrusel con sus fotos y un texto con precio, año, kilometraje y ficha técnica.
- **Aviso cuando se vende algo publicado**, para que alguien decida qué hacer con la publicación viva.

**Por qué con aprobación y no automático.** Publicar en el Instagram del cliente es intervenir su marca. Un lunes con quince vehículos cargados serían quince publicaciones seguidas: le arruina el perfil y probablemente el alcance. Y una publicación no se deshace limpiamente — el mismo problema que un mensaje de WhatsApp enviado, que el propio código ya reconoce en la migración 038 al proteger las difusiones con un mutex. La cola convierte una acción irreversible en una decisión revisable.

**Fuera de alcance**

- Publicación totalmente automática, sin intervención. Es justamente lo que este diseño evita.
- Historias de Instagram. Para inventario que rota rápido probablemente sean mejores que el feed —caducan solas en 24 horas y resuelven el problema del auto vendido—, pero son otro endpoint y merecen su propia decisión.
- Facebook, TikTok, Marketplace y cualquier otra red.
- Programar publicaciones a una hora determinada.
- Responder comentarios de Instagram. Eso es mensajería, y vive en `add-meta-multichannel`.
- Borrar automáticamente publicaciones de vehículos vendidos. El sistema avisa; la decisión es humana.

## Capabilities

### New Capabilities
- `instagram-account-connection`: cómo se vincula la cuenta de Instagram del negocio, qué se guarda y cómo se protege.
- `social-publishing-queue`: el ciclo de vida de una publicación desde que se prepara hasta que se publica o se descarta, y la garantía de que nada sale sin aprobación ni se publica dos veces.
- `vehicle-post-composition`: qué contiene la publicación que se arma con los datos del vehículo, y qué la hace inválida.

### Modified Capabilities
<!-- Ninguna. Las capacidades documentadas no cambian sus requisitos: publicar es aditivo y no altera inventario, vitrina ni mensajería. -->

## Impact

**Base de datos**
- Migración nueva en el rango 509+. Tabla de conexión de Instagram por cuenta y tabla de la cola de publicaciones. Nada existente se modifica.

**Código**
- `src/lib/instagram/` — cliente de Graph API para publicación, siguiendo el estilo de `src/lib/whatsapp/meta-api.ts`, más la composición del texto y la conversión de imágenes a JPEG.
- `src/app/api/inventory/[id]/route.ts` — al pasar a `available`, encolar un borrador.
- Pantalla nueva para revisar, editar y aprobar la cola.
- Ajustes — conectar y desconectar la cuenta de Instagram.
- `messages/{es,en,ko}.json`.

**Sin cambios**
- La vitrina. Ya funciona y no se toca.
- La mensajería de WhatsApp.

**Riesgos**
- **Publicar dos veces el mismo vehículo.** Una publicación no se puede recall. Necesita el mismo tipo de candado que la migración 038 le puso a las difusiones.
- **Publicar un vehículo ya vendido.** Entre que se encola y se aprueba puede pasar cualquier cosa; hay que revalidar en el momento de publicar, no solo al encolar.
- **Saturar el feed del cliente.** Es el riesgo de negocio, no técnico, y es la razón de que exista la cola.
- **Tope de publicaciones de Meta.** Hay un máximo por periodo; superarlo devuelve error. Meta expone un endpoint que informa el consumo y el tope vigente, así que se consulta en vez de estimarlo.
- **Fotos que Instagram no acepta.** Instagram publica únicamente JPEG, y el bucket guarda además PNG y WebP. Las imágenes se convierten antes de publicar; sin eso, vehículos con fotos perfectamente válidas quedarían fuera.
- **Permisos y revisión de la app.** Publicar exige permisos que Meta revisa, y la cuenta debe ser profesional — una cuenta personal no sirve. Es calendario ajeno y bloquea las pruebas reales. No hace falta página de Facebook vinculada: se usa Instagram Login, que no la exige.

**Esfuerzo estimado**
- Del orden de 2 a 3 semanas de desarrollo, más el tiempo de revisión de Meta, que corre por fuera.
