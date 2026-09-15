## 1. Base de datos

- [x] 1.1 Crear la migración con el siguiente número libre en `develop` y `main` (la 524 es de `seguimiento-automatico-de-difusiones`): `inventory_vehicles.owner_contact_id` (FK a `contacts`, `ON DELETE SET NULL`, índice `(account_id, owner_contact_id)`), `broadcasts.no_reply_hide_after_days` (`CHECK` 1–365), `broadcast_recipients.no_reply_checked_at` y `no_reply_hidden_count`, todo con `COMMENT ON COLUMN`
- [x] 1.2 Crear `hide_owner_vehicles(p_account_id, p_vehicle_ids UUID[], p_note TEXT)`, solo `service_role`: pasa a `hidden` únicamente lo que siga `available`, agrega a `internal_notes` una línea fechada con el motivo sin borrar lo anterior, y devuelve los ids que cambió
- [x] 1.3 Crear `apply_due_no_reply_hides(p_limit INT)`, solo `service_role`: toma con `SKIP LOCKED` los destinatarios vencidos de difusiones con plazo y sin cancelar; marca revisado con 0 a quien escribió después del envío; oculta los vehículos disponibles del resto con la nota "el propietario no respondió en N días"; marca `no_reply_checked_at` y `no_reply_hidden_count`; y devuelve `(account_id, vehicle_id)` de lo ocultado
- [x] 1.4 Aplicar la migración en el stack local y probar las dos funciones a mano: no toca reservados ni vendidos, conserva las notas, no revisa dos veces, respeta la cancelación (2026-09-14: aplicada en local, re-aplicable sin error, y 10 comprobaciones en verde, incluidos los permisos solo para `service_role` y el `ON DELETE SET NULL` del propietario)
- [x] 1.5 Extender los tipos en `src/types/index.ts`: `owner_contact_id` en el vehículo, `no_reply_hide_after_days` en `Broadcast`, `no_reply_*` en `BroadcastRecipient` y `hide_owner_vehicle` en `AutomationStepType`

## 2. Ocultar vehículos

- [x] 2.1 Escribir las pruebas de `hideVehicles` en `src/lib/inventory/auto-delist.ts`: llama a `hide_owner_vehicles` con el motivo, sincroniza el KB solo de los ids devueltos, y un fallo del KB se registra sin cortar ni deshacer
- [x] 2.2 Implementar `hideVehicles` y dejar las pruebas en verde

## 3. Propietario del vehículo

- [x] 3.1 Aceptar `owner_contact_id` en `buildVehiclePayload` (`src/lib/inventory/payload.ts`), con sus pruebas en `payload.test.ts`
- [x] 3.2 En la API del inventario, incluir `owner_contact_id` en las lecturas y, en POST y PATCH, rechazar con 400 un contacto que no sea de la cuenta
- [x] 3.3 En `src/app/(dashboard)/inventory/page.tsx`, agregar el campo "Propietario" con una lista de contactos que se puede buscar por nombre o teléfono (`ContactPicker` + `filterContacts`, con pruebas), con la opción "Sin propietario"; cargar los contactos con su teléfono y por páginas; textos en es / en / ko
- [x] 3.4 Crear `scripts/propietarios-a-sql.mjs`: lee el CSV de referencia y escribe el `UPDATE` por placa y teléfono normalizado (solo donde `owner_contact_id IS NULL`) más el `SELECT` de lo no encontrado; correrlo contra `propietarios-referencia-2026-09-14.csv` y revisar el SQL generado

## 4. Paso de automatización

- [x] 4.1 Escribir las pruebas del paso `hide_owner_vehicle` en `src/lib/automations/engine.test.ts`: con un vehículo lo oculta; con cero o con varios no oculta nada y termina con éxito; no toca reservados ni vendidos; los pasos siguientes siguen corriendo
- [x] 4.2 Implementar el paso en `runStep` usando `hideVehicles`, aceptarlo sin configuración en `src/lib/automations/validate.ts`, y agregarlo al editor (`STEP_META`, `ADDABLE_STEPS`, `blankConfig`, formulario con la explicación en lugar de campos); textos en es / en / ko

## 5. Baja por silencio

- [x] 5.1 Escribir las pruebas de la fase de baja (`runNoReplyDelisting`): llama a `apply_due_no_reply_hides`, sincroniza el KB de cada vehículo devuelto, agrupado por cuenta, y devuelve cuántos vehículos ocultó; no depende del horario de atención
- [x] 5.2 Implementarla y llamarla desde `/api/broadcasts/cron` por separado de los recordatorios, de modo que un fallo de una fase no impida la otra; la respuesta informa las dos fases
- [x] 5.3 En el paso 4 del asistente, agregar el interruptor de la baja por silencio con plazo (30 / 45 / 60 / 90, por defecto 60) y el aviso de que solo afecta a propietarios; guardarlo en el `insert` de `broadcasts`; textos en es / en / ko
- [x] 5.4 En el detalle de la difusión, mostrar cuándo vence la baja, cuántos destinatarios faltan por revisar y cuántos vehículos se ocultaron; mostrar "Cancelar seguimiento" si hay recordatorio o baja, y que cancele los dos; textos en es / en / ko

## 6. Verificación y despliegue

- [x] 6.1 Correr `npm run lint`, `npm run typecheck` y `npm test`, y dejar todo en verde (2026-09-14: typecheck limpio, 1 652 pruebas en verde, ESLint sin problemas en lo tocado. Los 6 errores del lint del proyecto son previos, en 3 archivos ajenos)
- [ ] 6.2 Prueba de punta a punta en el stack local: propietario asignado; el botón `NO` oculta su único vehículo y lo saca del KB; con plazos acortados en la base, la baja por silencio oculta y no repite (2026-09-14, PARCIAL: probado en el servidor local que `GET /api/broadcasts/cron` oculta con la baja por silencio todos los vehículos disponibles del dueño que no respondió, con nota fechada, y que una segunda pasada no repite; `hide_owner_vehicles` probado por la API REST con la forma `[{vehicle_id}]` que espera el código. Falta: el botón `NO` llegando por el webhook real y la interfaz del propietario, a probar con un contacto propio)
- [x] 6.3 Desplegar junto con `seguimiento-automatico-de-difusiones`: migraciones 524 y la de este cambio, `up -d --build` y recreación del contenedor del cron (2026-09-14, commit `9847307`: 525 aplicada, funciones y columnas verificadas en producción; arreglo del cron en `bd7a1d5`)
- [x] 6.4 En producción, después de importar los contactos: generar el SQL de propietarios con el script, revisarlo con el usuario, aplicarlo solo con autorización explícita, y revisar el informe de placas sin vehículo (2026-09-15: 90 contactos importados con la etiqueta `propietario`; el usuario aplicó el SQL y quedaron 86 vehículos con propietario. Placas sin vehículo en el inventario: FJW789, FPM331, IRV586, JUO142, NUL054)
- [x] 6.5 Agregar el paso "Ocultar el vehículo del contacto" a la automatización del botón `NO`, después de la etiqueta `propietario-vendido` (automatización "Propietario: ya no está disponible", junto con "Propietario: sigue disponible" y "Propietario: pasar a Angélica", todas con la condición de la etiqueta `propietario`)
