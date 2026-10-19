## 1. Base de datos

- [x] 1.1 Elegir el número de migración libre (revisar `supabase/migrations/` y los cambios abiertos `chats-por-responder` y `hoja-de-vida-contacto`) y confirmar los valores reales de `deals.status` y de `conversations.channel`
- [x] 1.2 Escribir `NNN_management_report.sql` con la función `management_report(p_account_id, p_from, p_to, p_agent, p_limit)`, `SECURITY INVOKER`, `STABLE`, `search_path = public`: conversación más reciente, negocio reportado, conteos de mensajes por tipo de remitente, citas por estado y próxima cita, última nota con autor, último `ai_handoff_summary`, etiquetas ordenadas, asesor calculado, filtro de asesor y exclusión de fusionados
- [x] 1.3 `GRANT EXECUTE` a `authenticated` y `COMMENT ON FUNCTION`
- [x] 1.4 Aplicar en el stack local y probar con SQL: un admin ve todos los contactos de la cuenta, un agent solo los suyos (por RLS), y el filtro `unassigned` funciona
- [x] 1.5 `EXPLAIN ANALYZE` con un volumen realista y agregar un índice parcial en `messages` solo si hace falta

## 2. Lógica del informe

- [x] 2.1 Agregar `exceljs` a `package.json`
- [x] 2.2 Crear `src/lib/reports/management.ts` con el tipo de fila de la función, `buildManagementSummary(row, now, timeZone)` según el orden de la spec (acción del asesor, cliente sin respuesta, citas, nota o traspaso recortado a 200), y `toSheetRow(row)`
- [x] 2.3 Crear `src/lib/reports/management.test.ts` con los escenarios de la spec: cliente esperando respuesta, sin nota con traspaso, asesor que nunca escribió, cliente sin nada, recorte a 200 caracteres y citas con la próxima
- [x] 2.4 Agregar `parseManagementFilters(searchParams, today, timeZone)` (rango por defecto de 30 días, fechas inválidas, rango invertido, `agent` vacío, `unassigned` o uuid) con sus pruebas
- [x] 2.5 Agregar `buildManagementWorkbook(rows, params)` con `exceljs`: hoja "Clientes" con encabezado fijo, filtro automático, anchos y celdas de fecha, y hoja "Parámetros" con el aviso de recorte; probar que el buffer se lea de vuelta con las dos hojas y el número de filas esperado

## 3. API

- [x] 3.1 Revisar en `node_modules/next/dist/docs/` cómo se devuelve un binario desde un route handler en Next 16.2
- [x] 3.2 Crear `src/app/api/reports/management/route.ts`: `requireRole('admin')`, filtros, validar que el asesor sea miembro, `rpc('management_report')` con límite 10.001, libro y respuesta con `Content-Type` y `Content-Disposition` (`informe-gestion-AAAA-MM-DD.xlsx`); errores con `toErrorResponse` y 400 en español
- [x] 3.3 Crear `route.test.ts` siguiendo el patrón de las otras rutas: 401 sin sesión, 403 para agent, 400 con rango invertido o asesor ajeno, y 200 con los encabezados de descarga para admin

## 4. Interfaz

- [x] 4.1 Crear `src/components/contacts/management-report-dialog.tsx`: desde y hasta (30 días por defecto), selector de asesor (Todos, Sin asignar y miembros), Descargar con `fetch` → `blob` → `<a download>`, spinner y toast de error
- [x] 4.2 Agregar el botón "Informe de gestión" en la cabecera de `src/app/(dashboard)/contacts/page.tsx`, visible solo con `canManageMembers`
- [x] 4.3 Agregar los textos en `messages/es.json` y `messages/en.json` (y en `ko.json` si el proyecto lo exige)

## 5. Verificación

- [x] 5.1 `npm run lint`, `npx tsc --noEmit` y `npx vitest run` en verde
- [x] 5.2 Prueba manual en local: descargar como owner y abrir en Excel (fechas como fecha, filtro, encabezado fijo); confirmar que como agent no se ve el botón y que la ruta da 403
- [x] 5.3 `openspec validate informe-gestion-asesores`
