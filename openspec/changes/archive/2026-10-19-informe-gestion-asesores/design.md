## Context

El dueño de Lora Motors pidió un listado de todos los clientes con el asesor que los atiende, la fecha de llegada, en qué parte del negocio están y un breve resumen de lo que se ha hecho. Las decisiones del usuario (2026-10-17) fueron:

- el resumen se arma con datos, sin IA;
- "estado" significa la etapa del embudo más las etiquetas;
- el formato es solo un Excel descargable, sin pantalla nueva;
- solo lo ven `admin` y `owner`.

Los datos ya existen, pero están repartidos:

| Dato | Fuente |
|---|---|
| Fecha de llegada | `contacts.created_at` |
| Asesor | `conversations.assigned_agent_id` (lo protege `sticky-contact-assignment`), y si no hay, `deals.assigned_to` |
| Negocio | `deals` → `pipelines.name`, `pipeline_stages.name`, `deals.status` |
| Etiquetas | `contact_tags` → `tags.name` |
| Mensajes | `messages.sender_type` / `sender_id` (asesor = `agent` con `sender_id`) |
| Citas | `appointments.status`, `starts_at` |
| Notas | `contact_notes` (+ `profiles.full_name` del autor) |
| Traspaso del bot | `conversations.ai_handoff_summary` |

La RLS de la 520 deja ver todo a quien no es `agent`. Por eso un `admin` que consulta con su propia sesión ya ve todos los contactos, conversaciones y mensajes de la cuenta, y no hace falta `SECURITY DEFINER` ni el cliente de service-role.

Patrones del repo que se siguen: rutas API con `requireRole(min)` y `toErrorResponse` (ver `api/ai/usage/route.ts`), migraciones `NNN_nombre.sql` idempotentes, lógica pura en `src/lib/**` con pruebas Vitest, UI con shadcn y textos en `messages/*.json`.

## Goals / Non-Goals

**Goals:**
- Una descarga `.xlsx` con una fila por cliente y las columnas de la spec.
- Que la consulta sea una sola llamada a la base de datos, sin N+1 desde Node.
- Que el resumen sea determinista y se pueda probar sin base de datos.

**Non-Goals:**
- Una pantalla o tabla del informe dentro del CRM.
- Resúmenes con IA.
- Un envío programado del informe (correo, WhatsApp o cron).
- Un historial de cambios de etapa ("en esta etapa desde"). Eso depende de `deal_stage_events` de `hoja-de-vida-contacto`.
- Que el asesor vea su propio informe.
- Un PDF.

## Decisions

### D1. Agregar en una función SQL `SECURITY INVOKER`

Se crea `management_report(p_account_id uuid, p_from timestamptz, p_to timestamptz, p_agent text, p_limit int)`, que devuelve `SETOF` una fila por contacto. Usa `LATERAL` para:

- la conversación más reciente;
- el negocio que se reporta (abierto más reciente, si no, el más reciente);
- los conteos de mensajes con `count(*) FILTER (...)` y los `max(created_at)` por tipo de remitente, sobre todas las conversaciones del contacto;
- los conteos de citas por estado y la próxima cita (`starts_at > now()` y estado `scheduled` o `confirmed`);
- la última nota con su autor;
- el último `ai_handoff_summary` no vacío;
- las etiquetas con `string_agg(... ORDER BY name)`.

El filtro de asesor se aplica sobre el asesor ya calculado (`COALESCE(conv.assigned_agent_id, deal.assigned_to)`), así que va en el `WHERE` externo.

**¿Por qué `INVOKER`?** Respeta la RLS. Si algún día otro rol llama la función, ve solo lo que ya podía ver, sin abrir nada. La ruta exige `admin` igual.

**Alternativa descartada:** varias consultas desde Node (contactos, luego conversaciones, mensajes y citas con `in (...)`), agregando en memoria. Con miles de clientes y decenas de miles de mensajes habría que traer todos los mensajes para contarlos. Además, PostgREST limita las filas por respuesta.

**Alternativa descartada:** una vista. No admite los parámetros de rango y asesor sin filtrar después de calcular todo.

### D2. Ruta `GET /api/reports/management` que devuelve el archivo

La ruta hace, en orden:

1. `requireRole('admin')`;
2. valida `from`, `to` y `agent` (si es un id, que sea miembro de la cuenta en `profiles`);
3. convierte las fechas a instantes en la zona horaria de la cuenta, con los helpers de `src/lib/dashboard/date-utils.ts`, si sirven;
4. llama a `supabase.rpc('management_report', ...)` con `p_limit = 10_001`, para saber si se pasó del máximo;
5. mapea las filas con `src/lib/reports/management.ts`;
6. escribe el libro con `exceljs` y responde con `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y `Content-Disposition: attachment; filename="informe-gestion-AAAA-MM-DD.xlsx"`.

Usa el runtime de Node, el de las otras rutas. Antes de escribirla, revisar en `node_modules/next/dist/docs/` cómo se devuelve un binario desde un route handler en Next 16.2.

**Alternativa descartada:** generar el archivo en el navegador. Habría que mandar los datos crudos al cliente y cargar `exceljs` en el bundle del front.

### D3. `exceljs` como dependencia nueva

Hoy no hay ninguna librería de hojas de cálculo. El import de contactos lee CSV con un parser propio. Se elige `exceljs` porque:

- escribe `.xlsx` de verdad, con fechas como fecha;
- permite fijar el encabezado, poner filtro automático y definir anchos de columna;
- no trae dependencias nativas;
- solo se importa en la ruta del servidor.

**Alternativa descartada:** un CSV con BOM, que Excel abre. Las fechas quedan como texto, se pierde el filtro y el encabezado fijo, y con `;` y `,` según la configuración regional de Excel las columnas se rompen. El usuario pidió Excel.

**Alternativa descartada:** SheetJS (`xlsx`). La versión de npm está desactualizada y la actual se distribuye desde su propio CDN.

### D4. El resumen es una función pura en TypeScript

`buildManagementSummary(row, now, timeZone)` en `src/lib/reports/management.ts` arma el texto según el orden de la spec. `toSheetRow(row)` mapea a las columnas. Se arman en TypeScript y no en SQL porque:

- se prueban con Vitest sin base de datos;
- los textos (por ejemplo "hace N días") se cambian sin migración;
- usan el mismo formato de fecha `dd/MM/yyyy` con `date-fns`, que ya está en el proyecto.

### D5. Botón y diálogo en Contactos

En la cabecera de `contacts/page.tsx`, visible solo si `canManageMembers` (de `useAuth`), hay un botón "Informe de gestión" que abre un `Dialog` de shadcn con:

- desde y hasta (por defecto, hace 30 días y hoy);
- un selector de asesor ("Todos", "Sin asignar" y los miembros con rol `agent` o superior, con la misma lista que usa el filtro de asesor de la bandeja);
- el botón "Descargar".

La descarga hace `fetch` a la ruta, convierte la respuesta en `blob` y la descarga con un `<a download>` temporal. Mientras genera, muestra un spinner y deshabilita el botón. Si hay error, muestra un `toast` con el mensaje de la API.

**Alternativa descartada:** un `<a href>` directo a la ruta. No permite mostrar el error en un toast ni el estado de "generando".

### D6. Número de migración e índices

Quedó en la **552** (`552_management_report.sql`): `chats-por-responder` tomó la 551 y `hoja-de-vida-contacto` se corrió a 553–555. La migración también crea `idx_deals_contact (contact_id, updated_at DESC)` e `idx_contact_notes_contact (contact_id, created_at DESC)`, que no existían. Sin ellos, cada fila del informe recorría `deals` y `contact_notes` completas. `messages`, `conversations` y `appointments` ya tenían índice por conversación o contacto.

### D7. Zona horaria

Las fechas se interpretan con el reloj del proceso, igual que el horario de atención (`lib/outbound/business-hours.ts`). El contenedor corre con `TZ=America/Bogota`. En el Excel, la hora local se escribe como si fuera UTC, para que se vea la hora de pared y no la hora UTC.

## Risks / Trade-offs

- **[Rendimiento con muchos mensajes]** Contar mensajes por contacto recorre `messages` de todas sus conversaciones. → La consulta filtra primero por los contactos del rango y el índice por `conversation_id` limita el recorrido. Se mide con `EXPLAIN ANALYZE` sobre la base del VPS (unos 136 vehículos y algunos miles de contactos) antes de desplegar. Si pasa de unos segundos, se agrega un índice parcial `messages(conversation_id, created_at) WHERE sender_type IN ('customer','agent')`.
- **[El asesor "de la conversación" no es el asesor del negocio]** Puede que el chat lo tenga una persona y el negocio otra. → Se documenta la regla en la spec: la conversación manda y el negocio es el respaldo. Si el dueño pide verlos por separado, se agrega una columna "asesor del negocio" sin cambiar la regla.
- **[Etapa sin fecha]** No se sabe desde cuándo está el negocio en la etapa. → `deals.updated_at` no sirve, porque cambia con cualquier edición. Se deja fuera hasta que exista `deal_stage_events`.
- **[Notas con datos sensibles en un archivo que circula]** El Excel sale del CRM y puede reenviarse. → Lo genera solo `admin`, la nota se recorta a 200 caracteres y la hoja "Parámetros" registra quién lo generó. No se incluyen costos de adquisición ni precios.
- **[Dependencia nueva]** `exceljs` suma peso al servidor. → Solo la importa la ruta. Next la deja fuera del bundle del cliente.
- **[Zona horaria]** Las fechas de Excel no llevan zona. → Se escriben convertidas a la hora local de la cuenta, y la hoja "Parámetros" la indica.

## Migration Plan

1. Migración `NNN_management_report.sql`: `CREATE OR REPLACE FUNCTION management_report(...)` con `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public`, `GRANT EXECUTE ... TO authenticated` y `COMMENT`. Es idempotente.
2. Se despliega con el flujo normal (develop → main → VPS, una sola vez cuando el usuario lo indique).
3. Rollback: `DROP FUNCTION IF EXISTS management_report(...)` y revertir el commit. No hay datos que migrar.

## Open Questions

- ¿El dueño quiere que "último mensaje del asesor" tome cualquier miembro humano que haya escrito, o solo el asesor asignado? La propuesta toma cualquier humano, porque es lo que se puede ver en la conversación.
- ¿Hace falta una columna "asesor del negocio" aparte del asesor de la conversación? Por ahora no.
