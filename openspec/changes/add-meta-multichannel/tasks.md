## 1. Antes de escribir código

- [ ] 1.1 Iniciar en Meta la solicitud de permisos y revisión de la aplicación para mensajería de Instagram y Messenger — **es calendario, no desarrollo**, puede tomar semanas y bloquea las pruebas reales
- [ ] 1.2 Confirmar con el cliente por cuál de los dos canales llegan consultas de venta reales; puede que uno no justifique el trabajo
- [ ] 1.3 Leer de la documentación vigente de Meta las ventanas de respuesta y las condiciones fuera de ventana de cada canal, y dejarlas escritas en el design
- [ ] 1.4 Decidir si un negocio puede tener varias cuentas de Instagram o páginas de Facebook, porque eso cambia el modelo del lado del negocio
- [ ] 1.5 Definir una cuenta de pruebas por canal, separada de la del cliente

## 2. Migración de base de datos

- [ ] 2.1 Crear la migración en el rango 510+, idempotente y en el estilo del repo
- [ ] 2.2 Catálogo de canales soportados
- [ ] 2.3 Tabla de identidades por canal: contacto, canal, identificador externo, con unicidad por cuenta y canal
- [ ] 2.4 Columna de canal en `conversations`, con `whatsapp` por defecto
- [ ] 2.5 RLS de las tablas nuevas siguiendo el patrón del repo (lectura de miembro, escritura de `agent`)
- [ ] 2.6 Backfill: una identidad de WhatsApp por cada contacto con teléfono, y toda conversación existente marcada como WhatsApp
- [ ] 2.7 **Verificar el backfill por conteo** antes de continuar: tantas identidades de WhatsApp como contactos con teléfono. Si no cuadra, detenerse
- [ ] 2.8 Aplicar a la nube (lo corre el usuario) y verificar por introspección

## 3. Identidad sin teléfono

- [ ] 3.1 Reescribir la resolución de contactos para buscar por canal e identificador en vez de por teléfono
- [ ] 3.2 Permitir crear contactos sin teléfono, conservando el teléfono para WhatsApp
- [ ] 3.3 Revisar cada punto del código que hoy asume `contact.phone` presente
- [ ] 3.4 Tests: contacto nuevo sin teléfono, contacto recurrente por identidad, mismo identificador en dos cuentas, contacto con identidades en varios canales

## 4. Núcleo del webhook (sin cambiar comportamiento)

- [ ] 4.1 Extraer el procesamiento común —resolver contacto, resolver conversación, guardar mensaje, disparar automatizaciones, flujos e IA— a un módulo independiente del canal
- [ ] 4.2 Enrutador que determina el canal del evento antes de procesarlo
- [ ] 4.3 Un evento desconocido se registra y se descarta respondiendo con éxito, sin generar error ni reintentos
- [ ] 4.4 Un lote con eventos mezclados procesa cada uno por separado; el fallo de uno no detiene los demás
- [ ] 4.5 Conservar la dirección de webhook actual para no obligar a reconfigurar instalaciones
- [ ] 4.6 **Verificar que WhatsApp se comporta exactamente igual que antes** — este grupo no debe cambiar nada visible

## 5. Puerta de salida única

- [ ] 5.1 Función única de envío que recibe la conversación y resuelve el canal internamente
- [ ] 5.2 Migrar `src/lib/whatsapp/send-message.ts` a la puerta común
- [ ] 5.3 Migrar `src/lib/automations/meta-send.ts` a la puerta común
- [ ] 5.4 Migrar `src/lib/flows/meta-send.ts` a la puerta común
- [ ] 5.5 Verificar que ningún camino de envío acepta el canal como parámetro suelto: siempre se lee de la conversación
- [ ] 5.6 Tests de que la respuesta sale por el canal de la conversación, incluida la de automatizaciones, flujos e IA

## 6. Reglas de ventana por canal

- [ ] 6.1 Declarar las reglas de cada canal en un único lugar
- [ ] 6.2 `src/lib/ai/reply-window.ts` pasa a evaluar según el canal de la conversación
- [ ] 6.3 Impedir el envío fuera de ventana antes de intentarlo, con motivo explicado y alternativa si el canal la ofrece
- [ ] 6.4 Las plantillas de WhatsApp solo se ofrecen en conversaciones de WhatsApp
- [ ] 6.5 Tests de los bordes de cada ventana y del caso fuera de ventana en automatizaciones

## 7. Canales nuevos

- [ ] 7.1 Manejador de mensajes entrantes de Messenger
- [ ] 7.2 Envío por Messenger
- [ ] 7.3 Manejador de mensajes entrantes de Instagram
- [ ] 7.4 Envío por Instagram
- [ ] 7.5 Adjuntos entrantes (imágenes, audio, archivos) por cada canal
- [ ] 7.6 Configuración por canal en Ajustes: conectar y desconectar cada uno

## 8. Bandeja

- [ ] 8.1 Indicador de canal en la lista de conversaciones
- [ ] 8.2 Filtro por canal, que no estorbe cuando la cuenta solo usa uno
- [ ] 8.3 Indicador de canal dentro de la conversación abierta
- [ ] 8.4 Ver los hilos de un contacto en varios canales desde su ficha
- [ ] 8.5 Traducciones en `messages/{es,en,ko}.json`

## 9. Vinculación de identidades

- [ ] 9.1 Detección de identidades que podrían ser la misma persona
- [ ] 9.2 Presentarlo como sugerencia, sin fusionar
- [ ] 9.3 Vincular bajo confirmación de un usuario con permiso de escritura, conservando ambos historiales
- [ ] 9.4 Deshacer una vinculación equivocada, devolviendo cada conversación a su contacto
- [ ] 9.5 Tests de vincular y deshacer sin pérdida de información

## 10. Verificación

- [ ] 10.1 `pnpm typecheck` limpio
- [ ] 10.2 `pnpm lint` sin errores nuevos (el repo arrastra 2 preexistentes en `join/[token]/page.tsx`)
- [ ] 10.3 `pnpm test` sin fallos nuevos (5 preexistentes de locale)
- [ ] 10.4 **Regresión de WhatsApp**: recibir, responder, automatizar y usar el asistente exactamente como antes
- [ ] 10.5 Prueba real de punta a punta por Messenger: recibir, responder, ver el hilo en la bandeja
- [ ] 10.6 Prueba real de punta a punta por Instagram
- [ ] 10.7 Prueba de que una respuesta nunca sale por el canal equivocado, con un contacto que tiene hilos en dos canales
- [ ] 10.8 Prueba de evento desconocido: el webhook responde con éxito y no entra en reintentos
