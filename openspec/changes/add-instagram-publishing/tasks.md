## 1. Antes de escribir código

- [ ] 1.1 Iniciar en Meta la solicitud de permisos de publicación en Instagram y la revisión de la app — **es calendario ajeno**, puede tomar semanas y bloquea toda prueba real
- [ ] 1.2 Confirmar que el cliente tiene (o puede convertir) su Instagram a una cuenta apta para publicación, vinculada a una página de Facebook. Una cuenta personal no sirve
- [ ] 1.3 Leer de la documentación vigente de Meta el tope de publicaciones por periodo y los formatos aceptados, y dejarlo escrito en el design
- [ ] 1.4 Decidir **carrusel o imagen única** (ver preguntas abiertas). Si es carrusel con placa de datos, generar esa imagen es trabajo aparte y hay que cotizarlo
- [ ] 1.5 Decidir **quién aprueba**: cualquier asesor o solo administración
- [ ] 1.6 Evaluar si conviene empezar por historias en vez del feed — caducan en 24 h y resuelven solas el problema del vehículo vendido
- [ ] 1.7 Definir una cuenta de Instagram de pruebas, separada de la del cliente

## 2. Migración

- [ ] 2.1 Crear la migración en el rango 509+, idempotente y en el estilo del repo
- [ ] 2.2 Tabla de conexión de Instagram por cuenta, con el token cifrado siguiendo el patrón de `whatsapp_config`
- [ ] 2.3 Tabla de la cola: vehículo, red, estado, texto propuesto, texto editado, identificador devuelto por Instagram, motivo de fallo, fechas
- [ ] 2.4 Campo de bloqueo para el candado de publicación, calcado de `broadcasts.delivery_locked_at` (migración 038)
- [ ] 2.5 Unicidad que impida dos pendientes del mismo vehículo en la misma red
- [ ] 2.6 RLS con el patrón del repo; la conexión solo legible por `admin` o superior
- [ ] 2.7 Aplicar a la nube (lo corre el usuario) y verificar por introspección

## 3. Cliente de publicación

- [ ] 3.1 Módulo `src/lib/instagram/` aislado, al estilo de `src/lib/whatsapp/meta-api.ts`
- [ ] 3.2 Publicación de contenido con imágenes, siguiendo el flujo que exija Meta
- [ ] 3.3 Distinguir fallo de credenciales de fallo de contenido en los errores devueltos
- [ ] 3.4 Concentrar en un solo lugar todo lo que depende de política de Meta: topes, formatos, límites de texto
- [ ] 3.5 Tests con la API simulada, siguiendo el estilo de `meta-api.test.ts`

## 4. Composición de la publicación

- [ ] 4.1 Armar el texto desde la ficha del vehículo, omitiendo los datos ausentes
- [ ] 4.2 Formatear el precio con el mismo helper que la vitrina, para que no se contradigan
- [ ] 4.3 Incluir el contacto público del negocio; si no hay, invitación genérica sin inventar datos
- [ ] 4.4 **Verificar que el costo de compra no aparece por ningún camino** — es contenido público
- [ ] 4.5 No preparar publicación para vehículos sin imágenes, registrando el motivo
- [ ] 4.6 Tests de composición: ficha completa, ficha parcial, sin fotos y vehículo con costo registrado

## 5. Encolado

- [ ] 5.1 Al pasar un vehículo a disponible, preparar el borrador
- [ ] 5.2 Best-effort: un fallo al encolar no impide guardar el vehículo
- [ ] 5.3 No duplicar la pendiente si el vehículo ya tiene una
- [ ] 5.4 Retirar la pendiente cuando el vehículo se vende antes de publicarse
- [ ] 5.5 Preparar la publicación que no pudo armarse cuando se le agregan fotos después

## 6. Revisión y aprobación

- [ ] 6.1 Pantalla de cola: pendientes con su vista previa y el texto propuesto
- [ ] 6.2 Editar el texto antes de aprobar
- [ ] 6.3 Descartar una pendiente
- [ ] 6.4 Indicador de pendientes visible, para que la cola no se vuelva un trabajo olvidado
- [ ] 6.5 Mostrar cuánto margen queda del tope del periodo
- [ ] 6.6 Gating por rol según lo decidido en 1.5

## 7. Publicación

- [ ] 7.1 Tomar el candado antes de hablar con Meta y liberarlo al terminar
- [ ] 7.2 Revalidar antes de publicar: vehículo disponible, existente e imágenes accesibles
- [ ] 7.3 Impedir la aprobación cuando no queda margen del tope
- [ ] 7.4 Guardar el identificador devuelto por Instagram como prueba de publicación
- [ ] 7.5 Ante respuesta perdida, marcar para revisión manual — **nunca reintentar a ciegas**
- [ ] 7.6 Registrar los fallos con su motivo, distinguiendo credenciales de contenido

## 8. Ciclo de vida posterior

- [ ] 8.1 Señalar en la cola los vehículos vendidos que tienen publicación viva
- [ ] 8.2 Confirmar que el sistema no borra publicaciones de Instagram en ningún caso
- [ ] 8.3 Decidir qué ocurre con un vehículo reingresado que ya tuvo publicación (ver preguntas abiertas)

## 9. Ajustes y traducciones

- [ ] 9.1 Conectar y desconectar la cuenta de Instagram desde Ajustes
- [ ] 9.2 Rechazar al conectar una cuenta no apta, explicando el requisito
- [ ] 9.3 Mensaje claro de "reconecta la cuenta" cuando el token expire
- [ ] 9.4 Traducciones en `messages/{es,en,ko}.json` — recordar el test de paridad de catálogos

## 10. Verificación

- [ ] 10.1 `pnpm typecheck` limpio
- [ ] 10.2 `pnpm lint` sin errores nuevos (el repo arrastra 2 preexistentes en `join/[token]/page.tsx`)
- [ ] 10.3 `pnpm test` sin fallos nuevos (5 preexistentes de locale)
- [ ] 10.4 Prueba real: cargar un vehículo, revisar la pendiente, aprobar y verla publicada en la cuenta de pruebas
- [ ] 10.5 Prueba de doble aprobación simultánea: una sola publicación
- [ ] 10.6 Prueba de vehículo vendido entre encolar y aprobar: no se publica
- [ ] 10.7 Prueba de token inválido: el mensaje habla de reconectar, no del contenido
- [ ] 10.8 Confirmar que ningún camino publica sin aprobación humana
