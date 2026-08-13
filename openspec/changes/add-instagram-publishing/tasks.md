## 1. Antes de escribir código

Las decisiones de diseño que esta sección listaba se resolvieron el 2026-08-12 y viven en `design.md` como decisiones 6 y 8 a 14. Lo que queda acá es trabajo que no depende de nosotros.

- [ ] 1.1 Iniciar en Meta la solicitud de los permisos `instagram_business_basic` e `instagram_business_content_publish`, y la revisión de la app — **es calendario ajeno**, puede tomar semanas y bloquea toda prueba real
- [ ] 1.2 Confirmar que el cliente tiene (o puede convertir) su Instagram a una cuenta profesional. Una cuenta personal no sirve; página de Facebook vinculada **no** hace falta con Instagram Login
- [x] 1.3 Leer de la documentación vigente de Meta el tope, los formatos y los límites de texto, y dejarlo escrito en el design — hecho: tabla en `design.md`, sección Context
- [ ] 1.4 Definir una cuenta de Instagram de pruebas, separada de la del cliente
- [ ] 1.5 Revisar con el cliente que aprobar quede en `admin` o superior, y que haya alguien que efectivamente entre a la cola

## 2. Migración

- [x] 2.1 Crear la migración en el rango 509+, idempotente y en el estilo del repo — `512_instagram_publishing.sql`
- [x] 2.2 Tabla de conexión de Instagram por cuenta, con el token cifrado siguiendo el patrón de `whatsapp_config` — `instagram_config`
- [x] 2.3 Tabla de la cola: vehículo, red, estado, texto propuesto, texto editado, identificador devuelto por Instagram, motivo de fallo, fechas — `social_posts`
- [x] 2.4 Campo de bloqueo para el candado de publicación, calcado de `broadcasts.delivery_locked_at` (migración 038) — `publish_locked_at`
- [x] 2.5 Unicidad que impida dos pendientes del mismo vehículo en la misma red — parcial sobre el estado pendiente, para no impedir el borrador de un reingreso (decisión 11)
- [x] 2.6 RLS con el patrón del repo; conexión y cola solo para `admin` o superior (decisión 14)
- [x] 2.7 Decidir si `ai_usage_log.mode` gana un valor para la reescritura o reusa `'draft'` (decisión 9) — valor propio `'social_caption'`, con el procedimiento de la 507
- [x] 2.8 Aplicar a la nube (lo corre el usuario) y verificar por introspección

## 3. Cliente de publicación

- [x] 3.1 Módulo `src/lib/instagram/` aislado, al estilo de `src/lib/whatsapp/meta-api.ts`
- [x] 3.2 Flujo de dos pasos: crear los contenedores y publicarlos (`/media` → `/media_publish`)
- [x] 3.3 Carrusel: un contenedor hijo por imagen y uno padre que los agrupa
- [x] 3.4 Consulta del margen restante (`/content_publishing_limit`), leyendo el tope de la respuesta y no de una constante (decisión 6)
- [x] 3.5 Distinguir fallo de credenciales de fallo de contenido en los errores devueltos
- [x] 3.6 Concentrar en un solo lugar todo lo que depende de política de Meta: máximo de imágenes, formato, límites de texto
- [x] 3.7 Tests con la API simulada, siguiendo el estilo de `meta-api.test.ts`

## 4. Composición de la publicación

- [x] 4.1 Armar el texto desde la ficha del vehículo con una plantilla determinista, omitiendo los datos ausentes
- [x] 4.2 Formatear el precio con `formatPrice` de la vitrina, para que no se contradigan
- [x] 4.3 Incluir el contacto público del negocio; si no hay, invitación genérica sin inventar datos
- [x] 4.4 **Verificar que ni el costo de compra ni las notas internas aparecen por ningún camino** — es contenido público, a diferencia del knowledge base
- [x] 4.5 Armar el carrusel con las imágenes en orden, recortando al máximo que acepta Instagram
- [x] 4.6 Validar los límites de texto al editar, no al publicar
- [x] 4.7 No preparar publicación para vehículos sin imágenes, registrando el motivo
- [x] 4.8 Tests de composición: ficha completa, ficha parcial, sin fotos, con más fotos que el máximo, con costo registrado y con notas internas

## 5. Imágenes

- [x] 5.1 Convertir a JPEG las imágenes que no lo sean y dejar la copia accesible en el bucket (decisión 12)
- [x] 5.2 No reconvertir lo que ya es JPEG
- [x] 5.3 Tratar un fallo de conversión como fallo de contenido, nunca de conexión
- [x] 5.4 Tests: vehículo con fotos PNG/WebP, con fotos ya JPEG y con una conversión que falla

## 6. Encolado

- [x] 6.1 Al pasar un vehículo a disponible, preparar el borrador
- [x] 6.2 Best-effort: un fallo al encolar no impide guardar el vehículo
- [x] 6.3 No duplicar la pendiente si el vehículo ya tiene una
- [x] 6.4 Retirar la pendiente cuando el vehículo deja de estar disponible — vendido, reservado u oculto (decisión 10)
- [x] 6.5 Preparar la publicación que no pudo armarse cuando se le agregan fotos después
- [x] 6.6 Al reingresar un vehículo ya publicado, preparar borrador nuevo y conservar el antecedente (decisión 11)

## 7. Revisión y aprobación

- [x] 7.1 Pantalla de cola: pendientes con su vista previa y el texto propuesto
- [x] 7.2 Editar el texto antes de aprobar, con los límites validados
- [x] 7.3 Descartar una pendiente
- [x] 7.4 Indicador de pendientes visible, para que la cola no se vuelva un trabajo olvidado
- [x] 7.5 Mostrar cuánto margen queda, con lo que responde Instagram
- [x] 7.6 Señalar las publicaciones de vehículos que ya se publicaron antes, con la fecha
- [x] 7.7 Reescribir el texto con IA a pedido, y ocultar la opción si la cuenta no tiene IA configurada (decisión 9)
- [x] 7.8 Gating por rol `admin` o superior, con `hasMinRole`

## 8. Publicación

- [x] 8.1 Tomar el candado antes de hablar con Meta y liberarlo al terminar
- [x] 8.2 Revalidar antes de publicar: vehículo en estado disponible, existente e imágenes accesibles
- [x] 8.3 Impedir la aprobación cuando no queda margen, y también cuando el margen no pudo consultarse
- [x] 8.4 Guardar el identificador devuelto por Instagram como prueba de publicación
- [x] 8.5 Ante respuesta perdida, marcar para revisión manual — **nunca reintentar a ciegas**
- [x] 8.6 Registrar los fallos con su motivo, distinguiendo credenciales de contenido

## 9. Ciclo de vida posterior

- [x] 9.1 Señalar en la cola los vehículos vendidos que tienen publicación viva
- [x] 9.2 Confirmar que el sistema no borra publicaciones de Instagram en ningún caso — verificado: `src/lib/instagram/` no emite ningún DELETE contra la API

## 10. Ajustes y traducciones

- [x] 10.1 Conectar y desconectar la cuenta de Instagram desde Ajustes, por Instagram Login (decisión 13)
- [x] 10.2 Rechazar al conectar una cuenta no profesional, explicando el requisito
- [x] 10.3 Mensaje claro de "reconecta la cuenta" cuando el token expire
- [x] 10.4 Traducciones en `messages/{es,en,ko}.json` — recordar el test de paridad de catálogos

## 11. Verificación

- [x] 11.1 `pnpm typecheck` limpio
- [x] 11.2 `pnpm lint` sin errores nuevos — verificado: los 31 errores del repo viven en 26 archivos preexistentes, ninguno tocado por este change (la nota anterior decía 2 en `join/[token]/page.tsx` y estaba vencida)
- [x] 11.3 `pnpm test` sin fallos nuevos (5 preexistentes de locale)
- [ ] 11.4 Prueba real: cargar un vehículo, revisar la pendiente, aprobar y ver el carrusel publicado en la cuenta de pruebas
- [ ] 11.5 Prueba de doble aprobación simultánea: una sola publicación
- [ ] 11.6 Prueba de vehículo que deja de estar disponible entre encolar y aprobar: no se publica
- [ ] 11.7 Prueba de vehículo con fotos PNG: se publica igual
- [ ] 11.8 Prueba de token inválido: el mensaje habla de reconectar, no del contenido
- [x] 11.9 Confirmar que ningún camino publica sin aprobación humana — verificado: `approveAndPublish` tiene un único llamador, `POST /api/instagram/queue/[id]/approve`, con `requireRole('admin')`
