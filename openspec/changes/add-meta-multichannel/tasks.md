## 1. Antes de escribir código

Las decisiones de diseño que esta sección listaba se resolvieron el 2026-08-12 y viven en `design.md` como decisiones 7 a 10. Lo que queda acá no depende de nosotros.

- [ ] 1.1 Iniciar en Meta la solicitud de permisos y revisión de la aplicación para mensajería de Instagram y Messenger, incluida la etiqueta `human_agent` — **es calendario, no desarrollo**, puede tomar semanas y bloquea las pruebas reales
- [x] 1.2 Confirmar con el cliente por cuál de los dos canales llegan consultas de venta reales — respondido: llegan por WhatsApp, Instagram y Messenger, así que los tres se justifican
- [x] 1.3 Leer de la documentación vigente de Meta las ventanas de respuesta y las condiciones fuera de ventana de cada canal, y dejarlas escritas en el design — hecho: tabla en `design.md`, sección Context
- [x] 1.4 Decidir si un negocio puede tener varias cuentas de Instagram o páginas de Facebook — decidido: una por canal por cuenta (decisión 7)
- [ ] 1.5 Definir una cuenta de pruebas por canal, separada de la del cliente

## 2. Migración de base de datos

- [x] 2.1 Crear la migración **513**, idempotente y en el estilo del repo (la 512 es la de publicación en Instagram)
- [x] 2.2 Catálogo de canales soportados
- [x] 2.3 Tabla de identidades por canal: contacto, canal, identificador externo, con unicidad por cuenta y canal
- [x] 2.4 Columna de canal en `conversations`, con `whatsapp` por defecto
- [x] 2.4b Reemplazar el índice único de la 036 por uno que incluya el canal — el actual `(account_id, contact_id)` **prohíbe** el modelo multicanal
- [x] 2.5 RLS de las tablas nuevas siguiendo el patrón del repo (lectura de miembro, escritura de `agent`)
- [x] 2.6 Backfill: una identidad de WhatsApp por cada contacto con teléfono, y toda conversación existente marcada como WhatsApp
- [x] 2.7 **Verificar el backfill por conteo** antes de continuar: tantas identidades de WhatsApp como contactos con teléfono. Si no cuadra, detenerse — la comprobación va dentro de la migración y aborta la transacción
- [x] 2.8 Verificar que el consumo se puede desglosar por canal sin columna nueva: `messages` llega a la cuenta solo por `conversations`, así que el join ya obligatorio arrastra el canal (decisión 9)
- [ ] 2.9 Aplicar a la nube (lo corre el usuario) y verificar por introspección

## 3. Identidad sin teléfono

- [x] 3.1 Reescribir la resolución de contactos para buscar por canal e identificador en vez de por teléfono — `src/lib/contacts/channel-identity.ts`. **El webhook todavía no la usa**: eso lo hace la tarea 4.1 al extraer el núcleo
- [x] 3.2 Permitir crear contactos sin teléfono, conservando el teléfono para WhatsApp
- [x] 3.3 Revisar cada punto del código que hoy asume `contact.phone` presente — hecho con el compilador: `Contact.phone` pasó a `string | null` y `tsc` señaló los 10 sitios, todos corregidos
- [x] 3.4 Tests: contacto nuevo sin teléfono, contacto recurrente por identidad, mismo identificador en dos cuentas, contacto con identidades en varios canales — más el de tolerancia troncal, que es el que fija que WhatsApp no cambió

## 4. Núcleo del webhook (sin cambiar comportamiento)

- [x] 4.1 Extraer el procesamiento común —resolver contacto, resolver conversación, guardar mensaje, disparar automatizaciones, flujos e IA— a un módulo independiente del canal — `src/lib/inbound/core.ts`. El webhook quedó de 1209 a 800 líneas y `processMessage` es ahora solo el traductor de WhatsApp
- [x] 4.2 Enrutador que determina el canal del evento antes de procesarlo
- [x] 4.3 Un evento desconocido se registra y se descarta respondiendo con éxito, sin generar error ni reintentos
- [x] 4.4 Un lote con eventos mezclados procesa cada uno por separado; el fallo de uno no detiene los demás
- [x] 4.5 Conservar la dirección de webhook actual para no obligar a reconfigurar instalaciones
- [x] 4.6 **Acotar por canal toda búsqueda de conversación por contacto** antes de que exista un solo hilo que no sea de WhatsApp. Hoy usan `.maybeSingle()` sobre `(account_id, contact_id)`; con dos hilos del mismo contacto eso vuelve a fallar en cada mensaje, que es exactamente el bug #363 que motivó la 036
- [x] 4.7 **Verificar que WhatsApp se comporta exactamente igual que antes** — los 7 tests que ya existían siguen pasando; el único ajuste fue el mock, que ahora refleja el filtro por canal

## 5. Puerta de salida única

- [x] 5.1 Función única de envío que recibe la conversación y resuelve el canal internamente
- [x] 5.2 Migrar `src/lib/whatsapp/send-message.ts` a la puerta común
- [x] 5.3 Migrar `src/lib/automations/meta-send.ts` a la puerta común
- [x] 5.4 Migrar `src/lib/flows/meta-send.ts` a la puerta común
- [x] 5.5 Verificar que ningún camino de envío acepta el canal como parámetro suelto: siempre se lee de la conversación — verificado por grep: las únicas menciones de `channel` en los tres son el manejo del resultado de la puerta
- [x] 5.6 Tests de que la respuesta sale por el canal de la conversación, incluida la de automatizaciones, flujos e IA

## 6. Reglas de ventana por canal

- [x] 6.1 Declarar las reglas de cada canal en un único lugar: ventana ordinaria de 24 h y qué se permite fuera de ella por canal (decisión 8) — `src/lib/outbound/window.ts`, función pura con 14 tests
- [x] 6.2 La evaluación pasa a depender del canal **y** de quién responde — vive en la puerta, no en `ai/reply-window.ts`: ese archivo resuelve otra cosa (si el hilo cambió desde el mensaje que disparó a la IA), y la IA entra como `senderKind: 'automated'` por el mismo camino que todos
- [x] 6.3 Impedir el envío fuera de ventana antes de intentarlo, con motivo explicado y alternativa si el canal la ofrece — **comportamiento NUEVO**, decidido con el usuario: se bloquea y se ofrece la plantilla como salida
- [x] 6.4 La etiqueta `human_agent` la decide la puerta de salida a partir de quién envía; **ningún camino puede pedirla como parámetro**
- [x] 6.5 Verificar que la IA nunca la usa: a los 5 días un asesor puede responder por Instagram y el asistente no — test en `window.test.ts`; además `senderKind` es obligatorio, así que un camino automático no puede heredar los permisos de una persona por omisión
- [ ] 6.6 Las plantillas de WhatsApp solo se ofrecen en conversaciones de WhatsApp
- [x] 6.7 Tests de los bordes de cada ventana (24 h y 7 días), por canal y por autor, y del caso fuera de ventana en automatizaciones

## 7. Canales nuevos

- [ ] 7.1 Manejador de mensajes entrantes de Messenger
- [ ] 7.2 Envío por Messenger
- [ ] 7.3 Manejador de mensajes entrantes de Instagram
- [ ] 7.4 Envío por Instagram
- [ ] 7.5 Adjuntos entrantes (imágenes, audio, archivos) por cada canal
- [ ] 7.6 Configuración por canal en Ajustes: conectar y desconectar cada uno

## 8. Bandeja

- [x] 8.1 Indicador de canal en la lista de conversaciones
- [x] 8.2 Filtro por canal, que no estorbe cuando la cuenta solo usa uno — se muestra solo si hay más de un canal en la bandeja
- [x] 8.3 Indicador de canal dentro de la conversación abierta
- [ ] 8.4 Ver los hilos de un contacto en varios canales desde su ficha — **pendiente**: la ficha hoy no lista conversaciones (tiene Negocios y Notas), así que es una sección nueva, no un ajuste
- [x] 8.5 Traducciones en `messages/{es,en,ko}.json`

## 9. Vinculación de identidades

- [ ] 9.1 Detección de identidades que podrían ser la misma persona
- [ ] 9.2 Presentarlo como sugerencia, sin fusionar
- [ ] 9.3 Vincular bajo confirmación de un usuario con permiso de escritura, conservando ambos historiales
- [ ] 9.4 Deshacer una vinculación equivocada, devolviendo cada conversación a su contacto
- [ ] 9.5 Tests de vincular y deshacer sin pérdida de información

## 10. Verificación

- [ ] 10.1 `pnpm typecheck` limpio
- [ ] 10.2 `pnpm lint` sin errores nuevos — la referencia actual son 31 errores en 26 archivos preexistentes, casi todos por `set-state-in-effect`; la nota anterior decía 2 en `join/[token]/page.tsx` y estaba vencida
- [ ] 10.3 `pnpm test` sin fallos nuevos (5 preexistentes de locale)
- [ ] 10.4 **Regresión de WhatsApp**: recibir, responder, automatizar y usar el asistente exactamente como antes
- [ ] 10.5 Prueba real de punta a punta por Messenger: recibir, responder, ver el hilo en la bandeja
- [ ] 10.6 Prueba real de punta a punta por Instagram
- [ ] 10.7 Prueba de que una respuesta nunca sale por el canal equivocado, con un contacto que tiene hilos en dos canales
- [ ] 10.8 Prueba de evento desconocido: el webhook responde con éxito y no entra en reintentos
- [ ] 10.9 Prueba de la ventana por autor: pasadas 24 h en Instagram, un asesor puede responder y el asistente con IA no
