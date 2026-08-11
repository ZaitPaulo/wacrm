## 1. Migración de base de datos

- [x] 1.1 Crear `supabase/migrations/508_vehicle_economics.sql` idempotente, siguiendo el estilo del repo (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`, cabecera con las decisiones de diseño)
- [x] 1.2 Tabla `vehicle_acquisitions`: `id`, `account_id`, `vehicle_id` (`UNIQUE`, `ON DELETE CASCADE`), `purchase_cost NUMERIC(12,2) CHECK (>= 0)`, `purchase_date DATE` anulable, `created_at`, `updated_at` con trigger
- [x] 1.3 Las cuatro políticas RLS de `vehicle_acquisitions` exigiendo `is_account_member(account_id, 'admin')` en SELECT, INSERT, UPDATE y DELETE
- [x] 1.4 Columnas de cierre en `inventory_vehicles`: `sold_price NUMERIC(12,2) CHECK (>= 0)`, `sold_at TIMESTAMPTZ`, `sold_to_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL`
- [x] 1.5 `CHECK` de coherencia: si `status <> 'sold'`, entonces `sold_price`, `sold_at` y `sold_to_contact_id` son `NULL`
- [x] 1.6 Columna `public_ref TEXT` en `inventory_vehicles` + índice único parcial por `(account_id, public_ref)` ignorando NULLs, siguiendo el patrón de `license_plate`/`vin` de la 500
- [x] 1.7 Backfill de `public_ref` para los vehículos existentes, con alfabeto de 6 caracteres sin `I`/`L`/`O`/`U`
- [x] 1.8 Tabla `vehicle_inquiries` (`vehicle_id`, `contact_id`, `conversation_id`, `created_at`, `account_id`) + RLS de miembro (`is_account_member(account_id)` lectura, `'agent'` escritura)
- [x] 1.9 Índices de consulta sobre `inventory_vehicles(account_id, status)`, `inventory_vehicles(account_id, sold_at)` y `vehicle_inquiries(account_id, vehicle_id)`
- [x] 1.10 Aplicada a la nube por el usuario y verificada: `vehicle_acquisitions` y `vehicle_inquiries` existen y operan (14 y 42 filas), las columnas de cierre y `public_ref` están en `inventory_vehicles` con el backfill hecho, y la RLS devuelve 0 filas a un cliente sin sesión

## 2. Tipos y capa de datos del inventario

- [x] 2.1 Extender los tipos de vehículo con `sold_price`, `sold_at`, `sold_to_contact_id`, `public_ref` y el registro de adquisición opcional
- [x] 2.2 Agregar a `src/lib/auth/roles.ts` un helper de permiso para ver costos y márgenes (`canViewMargins`), siguiendo el estilo de `canEditSettings`
- [x] 2.3 ~~Generador de `public_ref` en JS~~ → **movido a la base**: la función `generate_vehicle_public_ref()` de la migración 508 es el `DEFAULT` de la columna. Evita duplicar el alfabeto en SQL y en JS, y elimina la carrera entre generar y persistir. Tests del payload en `src/lib/inventory/payload.test.ts`
- [x] 2.4 Extender `src/lib/inventory/payload.ts` para validar los campos de venta y de adquisición, incluida la regla de que sin `status = 'sold'` no puede haber datos de cierre

## 3. API de inventario

- [x] 3.1 ~~`POST` asigna `public_ref` con reintento~~ → innecesario: lo genera el `DEFAULT` de la base. El `GET` sí pasa a pedir `public_ref` y los campos de cierre, más la adquisición como tabla embebida
- [x] 3.2 `PATCH /api/inventory/[id]` persiste el cierre de venta (precio final, fecha, comprador) al pasar a `sold`
- [x] 3.3 `PATCH /api/inventory/[id]` limpia los tres campos de cierre al salir de `sold`, cumpliendo el requisito de reversión (resuelto en `applySoldCoherence`, con test)
- [x] 3.4 Alta/edición del registro de adquisición como upsert, rechazando la operación si el usuario no es `admin` o superior (`src/lib/inventory/acquisitions.ts`)
- [x] 3.5 Verificado sin cambios: `knowledge-sync.ts:87-89` ya usa select nominal y no incluye campos de venta ni de adquisición

## 4. Captura en la UI de inventario

- [x] 4.1 Diálogo de cierre de venta en `/inventory`: precio final (por defecto el precio de lista), fecha (por defecto hoy) y selector opcional de contacto comprador
- [x] 4.2 Cancelar el diálogo deja el vehículo en su estado anterior sin persistir nada
- [x] 4.3 Campos de adquisición (costo y fecha) en el formulario de vehículo, renderizados sólo si el rol lo permite
- [x] 4.4 Confirmación al revertir una venta, advirtiendo que se perderán los datos de cierre

## 5. Atribución de leads

- [x] 5.1 `whatsappHref()` en `src/lib/showcase/format.ts` agrega `[Ref: XXXXXX]` al mensaje prellenado cuando el vehículo tiene `public_ref`
- [x] 5.2 Los botones generales de WhatsApp (`store-nav.tsx`, `footer.tsx`) siguen sin código de referencia
- [x] 5.3 Parser del código en el texto entrante: tolerante a mayúsculas y espacios, con tests de mensaje intacto, mensaje editado, sin código y código inexistente
- [x] 5.4 El webhook de WhatsApp registra la consulta en `vehicle_inquiries` al reconocer un código válido de la cuenta
- [x] 5.5 El registro es best-effort: un fallo se loguea como advertencia y no interrumpe el guardado del mensaje ni las automatizaciones
- [x] 5.6 `public_ref` se expone en los datos de la vitrina (`src/lib/showcase/data.ts`) para poder construir el enlace

## 6. Consultas del tablero

- [x] 6.1 `loadInventorySnapshot`: conteo por estado, valor inmovilizado del stock disponible y mix por marca y carrocería
- [x] 6.2 `loadInventoryAging`: tramos 0-30 / 31-60 / 61-90 / 90+ usando `purchase_date` con caída a `created_at`, excluyendo vendidos
- [x] 6.3 `loadSalesPerformance`: unidades vendidas, ingresos, ticket promedio y días promedio de adquisición a venta en el período, informando sobre cuántas unidades se calculó cada promedio
- [x] 6.4 `loadMargins`: join en JS entre vehículos vendidos y adquisiciones, excluyendo las unidades sin costo registrado y devolviendo también cuántas quedaron fuera
- [x] 6.5 `loadVehicleInterest`: vehículos más consultados en el período y proporción de consultas que terminaron en venta
- [x] 6.6 Todas las consultas nuevas reciben el cliente de sesión, nunca service-role, y agregan en JS siguiendo el patrón existente de `queries.ts` (sin `rpc()` ni vistas)
- [x] 6.7 Tipos de los resultados en `src/lib/dashboard/types.ts`
- [x] 6.8 Tests de las funciones puras de agregación: tramos de antigüedad en los bordes (30/31, 90/91), exclusión de unidades sin costo y período sin ventas

## 7. Componentes del tablero

- [x] 7.1 Tarjetas del bloque de inventario (stock por estado y valor inmovilizado)
- [x] 7.2 Gráfica de envejecimiento del stock con el tramo de 90+ días destacado como alerta
- [x] 7.3 Gráfica de mix del inventario por marca y carrocería
- [x] 7.4 Tarjetas del bloque comercial (unidades, ingresos, ticket promedio, días en inventario)
- [x] 7.5 Gráfica de margen por marca, renderizada sólo con permiso
- [x] 7.6 Lista de vehículos más consultados con su conversión a venta
- [x] 7.7 Estados vacíos con sentido para cuenta sin vehículos, período sin ventas y sin consultas atribuidas
- [x] 7.8 ~~recharts directo~~ → el repo **no importa recharts en ningún sitio**: usa el `BarChart` vendorizado en `src/components/tremor/` (que lo envuelve) y SVG/CSS a mano. Se siguió ese patrón; el aging usa barras propias porque Tremor colorea por categoría y el tramo 90+ necesita color propio

## 8. Composición del dashboard

- [x] 8.1 Reorganizar `dashboard/page.tsx` en bloques: inventario, comercial y luego las métricas de conversación heredadas
- [x] 8.2 Bajar la dona de pipeline de jerarquía sin eliminarla, con estado vacío cuando no hay negocios
- [x] 8.3 Gating de las secciones de margen con el helper de rol, sin dejar huecos visuales para quien no las ve
- [x] 8.4 Cada bloque nuevo carga por separado, con su propio skeleton, y un fallo no impide que se rendericen los demás

## 9. Traducciones

- [x] 9.1 Claves nuevas en `messages/es.json`
- [x] 9.2 Claves nuevas en `messages/en.json`
- [x] 9.3 Claves nuevas en `messages/ko.json`
- [x] 9.4 Verificar que no queda ningún texto embebido en los componentes nuevos

## 10. Verificación

- [x] 10.1 `pnpm typecheck` limpio
- [x] 10.2 `pnpm lint` sin errores nuevos (el repo ya arrastra 2 errores preexistentes en `join/[token]/page.tsx`)
- [x] 10.3 `pnpm test` sin fallos nuevos (5 fallos preexistentes de locale en `currency.test.ts` y `date-utils.test.ts`)
- [ ] 10.4 **NO EJECUTADA** — Prueba manual de la frontera de seguridad con un usuario de rol `agent`. Se verificó que un cliente **sin sesión** recibe 0 filas de `vehicle_acquisitions`, pero eso no es la misma prueba: al anónimo lo frena no ser miembro, mientras que al `agent` lo frena `is_account_member(account_id, 'admin')`. Requiere crear un segundo usuario con rol `agent` en la cuenta. **Es la prueba más importante de este change**: si falla, los vendedores ven el costo de compra
- [ ] 10.5 **NO EJECUTADA por la UI** — Ciclo completo: cargar un vehículo con costo, marcarlo vendido, verificar margen y días en inventario, revertir y comprobar que los campos se limpian. La lógica está cubierta por tests unitarios (`payload.test.ts`, `vehicle-metrics.test.ts`) y los datos de demo ejercitan las consultas de punta a punta, pero nadie recorrió el diálogo de venta a mano
- [ ] 10.6 **NO EJECUTADA** — Atribución de punta a punta: enviar un WhatsApp real desde el CTA de la vitrina y verificar que la consulta queda contra el vehículo correcto. El parser tiene tests (`public-ref.test.ts`) y los enlaces se verificaron en la vitrina, pero el tramo del webhook con un mensaje real de Meta no se ha probado

> **Nota de archivo.** Se archiva con 10.4, 10.5 y 10.6 sin ejecutar. Todo lo verificable
> por código está verificado (build, typecheck, lint, 739 tests, RLS contra cliente
> anónimo, migración aplicada con datos reales). Lo que falta exige recorrer la interfaz
> a mano y enviar un mensaje real de WhatsApp. La 10.4 es la que conviene no dejar
> pasar: es la única que confirma que un vendedor no puede leer el costo de compra.
