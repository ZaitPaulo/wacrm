## Why

Desde el 2026-08-28 el negocio publica su inventario en Instagram desde `/instagram`: alguien revisa el borrador que armó el sistema, lo edita si hace falta y lo aprueba. El cliente pidió que esa misma ficha salga también en su página de Facebook, que hoy sigue siendo trabajo manual — las mismas fotos, el mismo texto, subidos a mano por segunda vez.

La mitad del trabajo ya está hecha, y no por casualidad:

- **El esquema ya distingue redes.** `social_posts.network` existe desde la migración 512 y el índice único de pendientes es `(vehicle_id, network)`. El comentario de esa migración lo dice literal: *"agregarla después obligaría a reconstruir el índice"*.
- **La composición no es de Instagram.** `buildVehicleCaption` y `composeVehiclePost` (`src/lib/instagram/caption.ts`, `compose.ts`) arman texto y lista de fotos a partir del vehículo, sin tocar la API de Meta.
- **La cola tampoco lo es.** El candado (`claimPublishLock`), la revalidación del vehículo, la clasificación credenciales/contenido y el estado `needs_review` son reglas sobre publicar algo irreversible, no sobre Instagram.

Lo que **no** está resuelto, y es el costo real de este change: **el token que tenemos no sirve para Facebook**. La decisión 13 de `add-instagram-publishing` eligió *Instagram API with Instagram Login* (`graph.instagram.com`) precisamente para no exigir una página de Facebook vinculada. Publicar en una página exige el camino contrario —Facebook Login, `graph.facebook.com`, un **Page Access Token** distinto y tres permisos nuevos que Meta revisa—, y esa revisión es calendario ajeno.

## What Changes

- **Conectar la página de Facebook del negocio**, por separado de la cuenta de Instagram. Es otro token, otro panel en Ajustes y otra fila de configuración. Conectar una no conecta la otra.
- **Cada red tiene su propia publicación pendiente.** Un vehículo disponible con ambas redes conectadas deja **dos** borradores independientes en la cola, no uno con dos destinos.
- **La cola muestra a qué red va cada publicación** y permite aprobar o descartar cada una por su cuenta.
- **Publicar en Facebook** con la API de páginas: una foto sola va por `/{page-id}/photos`; varias se suben sin publicar y se agrupan en una entrada de `/{page-id}/feed`.
- **Los módulos se mueven de `src/lib/instagram/` a `src/lib/social/`**, con lo específico de cada red en su propio submódulo. Instagram sigue funcionando exactamente igual.

**Por qué dos publicaciones y no un botón que publique en ambas.** Un solo "Aprobar" para las dos redes crea un estado que el diseño actual no sabe representar: salió en Instagram y falló en Facebook. `external_post_id` es la única prueba de que algo se publicó y el candado protege una publicación, no dos; con un botón compartido habría que decidir si la fila queda publicada, fallida o a medias, y cualquier respuesta es mentira sobre una de las dos redes. Con dos filas, cada red falla, se reintenta y se descarta sola.

**Qué queda igual.** No se toca nada de lo que hoy publica en Instagram: ni la plantilla del texto, ni la espera del procesado, ni la conversión a JPEG, ni la cuota. Este change es aditivo.

**Fuera de alcance**

- **Marketplace de Facebook.** Es otro producto, con otra API y otras políticas. Que ambos digan "Facebook" no los hace lo mismo.
- **Publicación automática sin aprobación.** Vale acá el mismo argumento que en Instagram, y con más razón: son dos redes.
- **Responder comentarios de Facebook.** Eso es mensajería, y vive en `add-meta-multichannel`.
- **Historias, reels y vídeo.** Solo fotos, igual que hoy.
- **Compartir automáticamente de Instagram a Facebook** (el "crossposting" de la app de Meta). No aplica a publicaciones hechas por API, y además publicaría en Facebook algo que nadie aprobó para Facebook.
- **Despublicar de Facebook cuando el vehículo se vende.** El sistema avisa, igual que con Instagram; la decisión es humana.
- **Unificar los dos tokens en una sola conexión de Meta.** Sería posible con Facebook Login para ambas redes, pero obligaría a reconectar Instagram en producción, donde ya funciona, para ganar comodidad. Ver decisión 2 del design.

## Capabilities

### New Capabilities
- `facebook-page-connection`: cómo se vincula la página de Facebook del negocio, qué se guarda, por qué es una conexión aparte de la de Instagram y qué la hace inválida.

### Modified Capabilities
- `social-publishing-queue`: la cola deja de ser de Instagram y pasa a ser por red. Cambian los requisitos de qué se encola (una pendiente por vehículo **y red**), qué se revalida antes de publicar y cómo se informa el tope, que existe en Instagram y no en Facebook.
- `vehicle-post-composition`: la ficha compuesta deja de asumir un único destino. Cambian los límites que la hacen inválida —cantidad de fotos y formato aceptado difieren entre redes— y se declara que el texto es el mismo en ambas.

> Ambas capacidades viven hoy como deltas de `add-instagram-publishing`, que está implementado pero sin archivar (`openspec/specs/` todavía no las tiene). Este change escribe sus deltas contra esa base; al archivar, el orden es Instagram primero.

## Impact

**Meta — el bloqueante, y no es nuestro**
- Registro de la app: agregar el producto **Facebook Login** y solicitar `pages_show_list`, `pages_read_engagement` y `pages_manage_posts` en App Review. Los permisos exactos se confirman contra la documentación vigente antes de enviar la solicitud.
- El negocio necesita una **página de Facebook** con el usuario conectado como administrador. LoraMotors la tiene; hay que verificar el rol.
- Hasta que Meta apruebe, no hay pruebas reales posibles. Todo lo demás puede construirse y probarse contra dobles.

**Base de datos**
- Migración nueva (rango 513+): tabla `facebook_config` con el mismo trato que `instagram_config` —token cifrado, una por cuenta, RLS de `admin`— y ampliación del `CHECK` de `social_posts.network` para admitir `'facebook'`. Ninguna fila existente se modifica.

**Código**
- `src/lib/instagram/` → `src/lib/social/`, con `social/instagram/` y `social/facebook/` para lo propio de cada red y lo común (`caption`, `compose`, `images`, `queue`, la mecánica de `publish`) en la raíz. Es un movimiento de archivos con renombres de import; el comportamiento de Instagram no cambia.
- `src/lib/social/queue.ts` — hoy tiene `const NETWORK = 'instagram'` fijo (`src/lib/instagram/queue.ts:29`); pasa a encolar por cada red conectada.
- `src/app/api/instagram/*` → `src/app/api/social/*`, con la red como parte de la ruta o del recurso.
- `src/app/(dashboard)/instagram/page.tsx` — la cola pasa a mostrar y filtrar por red.
- `src/components/settings/` — panel nuevo para la página de Facebook, junto al de Instagram.
- `messages/{es,en,ko}.json`.

**Sin cambios**
- La plantilla del texto. El formato lo definió el negocio y se respeta tal cual.
- La vitrina, el inventario y la mensajería de WhatsApp.
- La conexión de Instagram ya activa en producción. No hay que reconectarla.

**Riesgos**
- **La revisión de Meta se demora o rechaza.** Es el riesgo dominante y no se mitiga con código. Lo que sí se puede: mantener Instagram funcionando sin depender de nada de esto, que es lo que garantiza separar las conexiones.
- **La refactorización rompe Instagram.** Mover `src/lib/instagram/` toca código que hoy publica en producción. Las pruebas existentes (`api.test.ts`, `publish.test.ts`, `compose.test.ts`, `images.test.ts`, `limits.test.ts`) son la red: se mueven con el código y tienen que seguir pasando sin cambios de expectativas.
- **Publicar dos veces en Facebook.** Mismo riesgo que en Instagram y misma respuesta: candado condicional y el id de Meta como única prueba. Una entrada de página **sí** se puede borrar por API, pero borrar no es deshacer —quien la vio, la vio— así que la regla de no reintentar ante duda se mantiene.
- **Publicar en una sola red y creer que salió en las dos.** Con filas independientes el estado es honesto, pero la cola tiene que dejarlo evidente: dos publicaciones del mismo vehículo con distinto desenlace no pueden verse iguales de un vistazo.
- **El doble de pendientes en la cola.** Cada vehículo disponible genera dos. Con ambas redes conectadas, un lunes de quince autos deja treinta pendientes; el riesgo de que la cola se estanque —ya reconocido para Instagram— se duplica.
- **Los dos tokens caducan por separado.** Un fallo de credenciales tiene que decir **de qué red**, o manda a reconectar la que estaba bien.

**Esfuerzo estimado**
- Del orden de 1 a 2 semanas de desarrollo, de las cuales buena parte es la refactorización a `src/lib/social/`. Más la revisión de Meta, que corre por fuera y no se estima.
