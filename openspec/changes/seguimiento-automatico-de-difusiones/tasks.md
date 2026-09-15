## 1. Base de datos

- [x] 1.1 Elegir el número de migración comprobando que no exista ni en `develop` ni en `main` (hoy la última es la 523) y crear `supabase/migrations/<NNN>_broadcast_follow_up.sql`, idempotente, con comentarios en el estilo de las 038 y 523
- [x] 1.2 Agregar a `broadcasts` las columnas `follow_up_template_name`, `follow_up_template_language`, `follow_up_delay_hours` (con `CHECK` de rango 1–168) y `follow_up_cancelled_at`, con `COMMENT ON COLUMN`
- [x] 1.3 Agregar a `broadcast_recipients` las columnas `follow_up_status` (con `CHECK` de `sending`/`sent`/`failed`/`skipped`), `follow_up_claimed_at`, `follow_up_sent_at`, `follow_up_message_id` y `follow_up_error`, y un índice parcial para los candidatos (`follow_up_status IS NULL AND status IN ('sent','delivered','read')`)
- [x] 1.4 Crear `claim_due_broadcast_follow_ups(p_account_ids UUID[], p_limit INT)`, `SECURITY DEFINER` y ejecutable solo por `service_role`. Debe: pasar a `failed` las filas en `sending` de más de 30 minutos; marcar `skipped` a los vencidos con contacto borrado o con un mensaje `customer` posterior a `sent_at`; reclamar hasta `p_limit` con `UPDATE … WHERE follow_up_status IS NULL … RETURNING`; y devolver id, `account_id`, `contact_id`, `template_params` y la plantilla del recordatorio
- [x] 1.5 Aplicar la migración en el stack local y probar la función a mano: una difusión vencida, una cancelada, un contacto que escribió después, dos llamadas seguidas que no reclamen la misma fila (2026-09-14: aplicada con `supabase migration up --local`, re-aplicable sin error, y 8 comprobaciones en verde, incluidas la fila en `sending` interrumpida, la cuenta ajena y los conteos del trigger)
- [x] 1.6 Extender `Broadcast` y `BroadcastRecipient` en `src/types/index.ts` con las columnas nuevas, documentadas como las de la migración 038

## 2. Validación de la plantilla del recordatorio

- [x] 2.1 Escribir las pruebas de una función pura en `src/lib/whatsapp/` que diga si una plantilla sirve como recordatorio de otra: acepta 0 variables o igual número; rechaza encabezado de imagen, video o documento y encabezado de texto con variable; rechaza un botón URL con variable (`COPY_CODE` se acepta: cae a su `example`)
- [x] 2.2 Implementarla reutilizando `extractVariableIndices` y la lógica de `buttonNeedsSendParam` de `template-send-builder.ts`, sin duplicarla, y dejar las pruebas en verde

## 3. Envío del recordatorio

- [x] 3.1 Extraer de `deliverBroadcast` (`src/lib/whatsapp/broadcast-core.ts`) un `sendTemplateWithVariants` con el bucle de variantes de teléfono, y hacer que `deliverBroadcast` lo use sin cambiar su comportamiento (sus pruebas deben seguir pasando)
- [x] 3.2 Exportar `fueraDeHorario` desde `src/lib/outbound/gate.ts` sin cambiar su comportamiento
- [x] 3.3 Escribir las pruebas del módulo nuevo `src/lib/whatsapp/broadcast-follow-up.ts`: solo reclama cuentas en horario; destino por `resolveRecipientId` en el momento del envío; parámetros congelados solo si la plantilla del recordatorio tiene variables; un fallo de Meta queda en `follow_up_error` y no corta la pasada; un contacto sin destino alcanzable queda `failed` con su motivo
- [x] 3.4 Implementar el módulo: cuentas con vencidos → filtro de horario → `claim_due_broadcast_follow_ups` → envío a 10 por segundo con tope de 100 por pasada → registrar `sent` (con `follow_up_sent_at` y `follow_up_message_id`) o `failed` (con `follow_up_error`)
- [x] 3.5 Leer en `node_modules/next/dist/docs/` la guía de route handlers de esta versión de Next antes de escribir la ruta
- [x] 3.6 Crear `GET /api/broadcasts/cron` con la misma verificación de `x-cron-secret` que `/api/automations/cron`, que llame al módulo y devuelva `{ claimed, sent, failed }` (los omitidos los marca la función SQL y no los cuenta)
- [x] 3.7 Agregar a `deploy/cron/crontab` la línea `*/5 * * * * /tick.sh /api/broadcasts/cron`, con un comentario en el estilo de las otras dos

## 4. Asistente de difusión

- [x] 4.1 En `src/components/broadcasts/step4-schedule-send.tsx`, agregar la sección "Seguimiento": interruptor, selector de plantillas aprobadas y plazo en días (1 a 7, por defecto 2), con el motivo visible cuando la plantilla no sirve (tarea 2) y la recomendación de activar el horario de atención
- [x] 4.2 Llevar el estado del seguimiento en `src/app/(dashboard)/broadcasts/new/page.tsx` y bloquear el envío mientras la configuración sea inválida
- [x] 4.3 En `src/hooks/use-broadcast-sending.ts`, aceptar la configuración en `BroadcastPayload` y guardarla en el `insert` de `broadcasts` (el plazo en horas)
- [x] 4.4 Agregar los textos en español y en inglés a los mensajes de traducción de `Broadcasts.wizard`

## 5. Detalle de la difusión

- [x] 5.1 En `src/app/(dashboard)/broadcasts/[id]/page.tsx`, mostrar la plantilla y el plazo del seguimiento, y los conteos: pendientes, vencidos sin enviar, enviados, fallidos, omitidos y respondieron después del recordatorio
- [x] 5.2 Agregar el botón "Cancelar seguimiento", con confirmación, que ponga `follow_up_cancelled_at`, y mostrar el estado cancelado
- [x] 5.3 Mostrar por destinatario si recibió el recordatorio y el motivo cuando falló o se omitió
- [x] 5.4 Agregar los textos en español y en inglés

## 6. Verificación y despliegue

- [x] 6.1 Correr `npm run lint`, `npm run typecheck` y `npm test`, y dejar todo en verde (2026-09-14: typecheck limpio, 1 620 pruebas en verde, ESLint sin problemas en lo tocado. El lint del proyecto tiene 6 errores previos de `react-hooks/preserve-manual-memoization` en 3 archivos ajenos a este cambio)
- [ ] 6.2 Prueba de punta a punta en el stack local: difusión con seguimiento a un contacto de prueba, plazo acortado en la base y llamada manual a la ruta de cron; comprobar que llega una sola vez, que no llega si el contacto escribió y que la respuesta marca `replied` en la difusión original (2026-09-14, PARCIAL: en el servidor local, `GET /api/broadcasts/cron` reclama el vencido una sola vez, omite al que escribió después, registra el fallo con su motivo (cuenta sin WhatsApp), la segunda pasada no reclama nada y un secreto equivocado recibe 401. Falta: el envío real a Meta y que la respuesta marque `replied`, a probar en producción con un contacto propio)
- [ ] 6.3 Desplegar en el VPS: respaldo, `git pull`, migración aplicada, `up -d --build`, y **recrear el contenedor del cron**; verificar en su log la línea `ok /api/broadcasts/cron`
- [ ] 6.4 En producción, antes de la campaña real: crear y hacer aprobar en Meta la plantilla del recordatorio con los mismos botones SI / NO, y probar con una difusión a un contacto propio
- [ ] 6.6 Arreglar el cron del VPS, que no ejecutaba ninguna tarea (hallado el 2026-09-15 al verificar el despliegue): busybox crond solo carga crontabs cuyo dueño es root, y el crontab estaba montado desde el host con uid 1001. Montar `deploy/cron` como directorio, copiar `crontab` y `tick.sh` al arrancar, y verificar en `docker logs crm-cron` un `ok /api/automations/cron` por minuto y un `ok /api/broadcasts/cron` cada 5
- [x] 6.5 Actualizar `docs/self-hosting.md` con la ruta de cron nueva y la necesidad de recrear el contenedor del cron al cambiar el crontab
