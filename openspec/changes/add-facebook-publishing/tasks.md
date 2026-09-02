## 1. Meta — arranca primero porque es calendario ajeno

- [x] 1.1 Verificar que el usuario de Meta del negocio figure como administrador de la página de Facebook de LoraMotors — página `112969648369416`, confirmada porque `/me/accounts` la devuelve con token de publicación
- [x] 1.2 Confirmar contra la documentación vigente de Meta los permisos exactos que exige publicar en una página — `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, verificados el 2026-09-01
- [x] 1.3 Agregar el producto Facebook Login al registro de la app en el panel de Meta — resuelto agregando el caso de uso de páginas en la consola nueva, que es como se habilitan hoy esos permisos
- [x] 1.4 ~~Enviar los permisos a App Review~~ **NO HACE FALTA.** El acceso estándar se aprueba solo y alcanza para los usuarios con un rol en la app; App Review es para el acceso avanzado, que sirve para actuar sobre páginas de terceros. Acá el CRM publica en la página del propio negocio y quien conecta es administrador de la app y de la página. Verificado el 2026-09-01: los tres permisos salieron `granted` sin revisión
- [x] 1.5 Obtener un token de prueba — quedó mejor que eso: token real de la página de producción, sin vencimiento (`debug_token` informa `expires_at` nulo)

## 2. Refactorización a `src/lib/social/` — completa y verde antes de escribir nada de Facebook

- [x] 2.1 Mover `src/lib/instagram/` a `src/lib/social/`, dejando `api.ts` y `limits.ts` bajo `social/instagram/` y el resto en la raíz
- [x] 2.2 Mover las cinco suites de prueba junto a su código, cambiando únicamente los `import` — ninguna aserción se modifica
- [x] 2.3 Renombrar `InstagramError`, `InstagramErrorKind` e `InstagramStep` a nombres de red-agnósticos en `social/errors.ts`
- [x] 2.4 Crear `social/networks.ts` con el registro por red: cómo cargar su configuración, cómo publicar y cuáles son sus límites
- [x] 2.5 Parametrizar `validateCaption` para que reciba los límites de la red en vez de leer las constantes de Instagram
- [x] 2.6 Parametrizar `composeVehiclePost` para que reciba el máximo de imágenes de la red en vez de `MAX_CAROUSEL_ITEMS`
- [x] 2.7 Quitar `const NETWORK = 'instagram'` de `queue.ts` y pasar la red como parámetro en las cuatro consultas del módulo
- [x] 2.8 Hacer opcional por red el paso de verificación de tope en `approveAndPublish`, sin cambiar el comportamiento de Instagram
- [x] 2.9 Cambiar el prefijo de `convertedObjectPath` de `account-<uuid>/instagram/` a `account-<uuid>/social/`
- [x] 2.10 Mover `src/app/api/instagram/*` a `src/app/api/social/*` con la red como parte del recurso, actualizando el cliente de la pantalla
- [x] 2.11 Renombrar el namespace de traducción `InstagramPost` a uno de red-agnóstico en `messages/{es,en,ko}.json`
- [x] 2.12 Correr toda la suite y verificar que pasa sin cambios de expectativa; desplegar esta refactorización sola, antes de seguir

## 3. Base de datos

- [x] 3.1 Escribir la migración 513: tabla `facebook_config` (una por cuenta, `page_id`, token cifrado, `token_expires_at`, `status`, RLS de `admin`) con el mismo trato que `instagram_config`
- [x] 3.2 En la misma migración, ampliar el `CHECK` de `social_posts.network` a `('instagram', 'facebook')`
- [x] 3.3 Verificar que la migración es idempotente y que no modifica ninguna fila existente
- [ ] 3.4 Aplicar la migración en el VPS de desarrollo y comprobar que la cola de Instagram sigue funcionando igual

## 4. Cliente de Facebook

- [x] 4.1 Escribir `social/facebook/limits.ts` con los límites de la red (máximo de fotos, máximo de caracteres) y la fecha de verificación contra la documentación
- [x] 4.2 Implementar `getPageInfo` y el listado de páginas administradas (`/me/accounts`), devolviendo también el token de cada página
- [x] 4.3 Implementar la publicación de una sola foto (`POST /{page-id}/photos` con `url` y `caption`)
- [x] 4.4 Implementar la publicación de varias fotos: subir cada una con `published=false` y agrupar en `POST /{page-id}/feed` con `attached_media`
- [x] 4.5 Clasificar los errores de Facebook en credenciales o contenido, y marcar el `step` que distingue "no se publicó nada" de "puede haberse publicado"
- [x] 4.6 Escribir las pruebas del cliente contra dobles, cubriendo el camino de una foto, el de varias y cada clasificación de error
- [x] 4.7 Registrar Facebook en `social/networks.ts`, declarando que no expone tope por periodo

## 5. Conexión de la página

- [x] 5.1 Crear `social/facebook/config.ts` con la carga y descifrado de la conexión, siguiendo `loadInstagramConfig`
- [x] 5.2 Implementar la ruta de conexión: recibir el token de usuario, listar las páginas administradas y devolverlas sin guardar nada
- [x] 5.3 Implementar el guardado: recibir la página elegida, guardar cifrado el token **de esa página** y su vencimiento
- [x] 5.4 Implementar el GET de estado y el DELETE de desconexión, sin exponer nunca el token
- [x] 5.5 Rechazar la conexión cuando el token no da acceso a ninguna página, explicando el requisito
- [x] 5.6 Construir el panel de Ajustes de Facebook junto al de Instagram, con el paso de elegir página y preselección cuando hay una sola
- [x] 5.7 Mostrar el vencimiento de cada conexión por separado en Ajustes
- [x] 5.8 Agregar los textos a `messages/{es,en,ko}.json`

## 6. Encolado y cola por red

- [x] 6.1 Hacer que `syncVehiclePost` recorra las redes conectadas de la cuenta y prepare un borrador por cada una
- [x] 6.2 Aislar el fallo de una red para que no impida preparar el borrador de la otra
- [x] 6.3 Hacer que `removePending` retire las pendientes de todas las redes cuando el vehículo deja de estar disponible
- [x] 6.4 Hacer que `refreshPendingCaptions` refresque las pendientes sin editar de todas las redes
- [x] 6.5 Calcular el antecedente de publicación por red, no por vehículo
- [x] 6.6 Verificar que conectar una red no encola retroactivamente el inventario ya cargado
- [x] 6.7 Escribir las pruebas del encolado con una red conectada, con dos, y con el fallo de una sola

## 7. Publicación y aprobación

- [x] 7.1 Hacer que `approveAndPublish` resuelva la configuración y el cliente por la `network` de la fila
- [x] 7.2 Saltear la verificación de tope en Facebook y no mostrar margen para esa red en la cola
- [x] 7.3 Hacer que todo mensaje de fallo de credenciales nombre la red y apunte a la conexión correcta en Ajustes
- [x] 7.4 Verificar que el candado, la revalidación del vehículo y el paso a `needs_review` funcionan igual en Facebook
- [x] 7.5 Escribir las pruebas de publicación en Facebook: éxito, fallo de credenciales, fallo de contenido y desenlace desconocido
- [x] 7.6 Verificar que aprobar en una red no toca la fila de la otra

## 8. Pantalla de la cola

- [x] 8.1 Mostrar la red de cada publicación de forma inequívoca en la tarjeta
- [x] 8.2 Agregar el filtro por red
- [x] 8.3 Mostrar estados distintos por red del mismo vehículo sin colapsarlos en uno solo
- [x] 8.4 Mostrar el tope solo para las redes que lo informan
- [x] 8.5 Mostrar en qué página de Facebook se va a publicar
- [x] 8.6 Aplicar los límites de la red correspondiente al editar el texto
- [x] 8.7 Nombrar las redes en el aviso de vehículo vendido con publicación viva
- [x] 8.8 Agregar los textos a `messages/{es,en,ko}.json`

## 9. Verificación

- [x] 9.1 Correr `npm run lint` y `npx tsc --noEmit` sin errores
- [x] 9.2 Correr toda la suite de pruebas
- [ ] 9.3 Probar en desarrollo el ciclo completo de Instagram, confirmando que no cambió nada
- [ ] 9.4 Publicar de prueba en Facebook un vehículo de una sola foto y verificar la entrada en la página
- [ ] 9.5 Publicar de prueba en Facebook un vehículo de varias fotos y verificar que salen agrupadas en una sola entrada
- [ ] 9.6 Probar el caso de las dos redes: aprobar una, dejar la otra pendiente, y confirmar que los estados son independientes
- [ ] 9.7 Probar la desconexión de una red y confirmar que la otra sigue publicando
- [x] 9.8 Documentar en `docs/` cómo conectar la página, para el cliente

## 10. Un botón por vehículo (pedido del cliente, 2026-09-01)

- [x] 10.1 Ruta `POST /api/social/queue/[id]/retry`: devuelve a `pending` una fallida, solo si `external_post_id` está vacío
- [x] 10.2 Rechazar el reintento con un mensaje propio cuando el índice único ya tiene otra pendiente de ese vehículo y esa red (23505)
- [x] 10.3 Pruebas del reintento: fallida sin id, ya publicada, choque con pendiente existente, y desde `needs_review`
- [x] 10.4 Agrupar la cola por vehículo, con una línea por red y su estado
- [x] 10.5 Botón único que aprueba en serie todas las pendientes del vehículo e informa el desenlace de cada red
- [x] 10.6 Botón de reintentar por red sobre las fallidas, con aviso distinto para `needs_review`
- [x] 10.7 Un solo editor de texto por vehículo, que guarda en todas sus pendientes
- [x] 10.8 Validar el texto contra el límite más estricto de las redes pendientes
- [x] 10.9 Textos en `messages/{es,en,ko}.json`
- [x] 10.10 Verificar: lint, tipos, suite completa
