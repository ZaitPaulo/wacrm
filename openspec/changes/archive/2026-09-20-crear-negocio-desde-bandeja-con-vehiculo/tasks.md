## 1. Base de datos (/backend)

- [x] 1.1 Comprobar el último número de migración (repo) y la versión de Postgres local; en producción, lo verifica el orquestador al desplegar
- [x] 1.2 Crear `supabase/migrations/529_deal_vehicle.sql`: `unique (account_id, id)` idempotente en `inventory_vehicles`, `deals.vehicle_id` nullable, FK compuesta con nombre `deals_vehicle_fkey` y `ON DELETE SET NULL (vehicle_id)` (o FK simple + trigger si la versión no lo soporta), índice parcial y `NOTIFY pgrst, 'reload schema'`
- [x] 1.3 Aplicarla en local y verificar con psql: vínculo válido, rechazo de un vehículo de otra cuenta, que borrar el vehículo deja `vehicle_id` en NULL y conserva `account_id`, y que el embed `vehicle:inventory_vehicles!deals_vehicle_fkey(...)` responde por la API REST local

## 2. Dominio (/backend)

- [x] 2.1 Tipos: `Deal.vehicle_id?`, `Deal.vehicle?` y un tipo `DealVehicle` (id, brand, model, year, license_plate, price, status) en `src/types/index.ts`
- [x] 2.2 `src/lib/pipelines/deal-vehicle.ts`: `formatVehicleLabel`, `rankVehicleOptions(vehicles, inquiries, query)` → `{ suggested, others }`, `applyVehicleSelection({ title, autoTitle }, vehicle)` y `pickDefaultPipeline(pipelines)`
- [x] 2.3 Tests en `src/lib/pipelines/deal-vehicle.test.ts` que cubran los escenarios de la spec: búsqueda AND sin tildes ni mayúsculas, sugeridos ordenados y sin repetir, vendidos y ocultos excluidos, título manual respetado, cambio de vehículo con título autollenado, embudo "Ventas" o el primero

## 3. Formulario de negocio (/frontend)

- [x] 3.1 `DealForm`: props opcionales `fixedContactId`, y `pipelineId`/`stages` opcionales con elección de embudo y primera etapa por defecto
- [x] 3.2 Selector de vehículo (combobox con búsqueda, sugeridos arriba, estado reservado visible) que guarda `vehicle_id`; al editar un negocio, muestra el vehículo vinculado aunque esté vendido
- [x] 3.3 Autollenado de valor y título con `applyVehicleSelection`; quitar el vehículo no borra nada
- [x] 3.4 Textos en `messages/es.json`, `en.json` y `ko.json`

## 4. Bandeja y tablero (/frontend)

- [x] 4.1 `contact-sidebar.tsx`: `+` en el encabezado de Negocios, botón "Crear negocio" cuando no hay negocios, `DealForm` con `fixedContactId` y `fetchContactData()` al guardar
- [x] 4.2 Embed del vehículo en el `select` de negocios de la bandeja y del tablero (`pipelines/page.tsx`)
- [x] 4.3 Mostrar el vehículo en la tarjeta de la bandeja y en `deal-card.tsx`

## 5. Verificación (/qa)

- [x] 5.1 `npm test`, `npm run typecheck`, `npx eslint` sobre los archivos tocados y `npx next build`
- [x] 5.2 Revisión contra la spec y prueba de la FK y del `SET NULL` en la base local; confirmar que un negocio sin vehículo y el flujo del tablero no cambian
  - Auditoría QA 2026-09-18: 141 archivos / 1817 tests en verde (30 de `deal-vehicle`), `tsc --noEmit` sin errores, `eslint` sobre los archivos tocados con 0 errores (3 warnings previos: `User` sin usar y `<img>` en `contact-sidebar.tsx`, disable sin uso en `pipelines/page.tsx:182`), `next build` correcto.
  - Base local, en transacción con ROLLBACK: la 529 está aplicada y re-ejecutarla no cambia nada; la FK rechaza un vehículo de otra cuenta (insert y update); borrar el vehículo deja `vehicle_id` en NULL y conserva `account_id`; un negocio sin vehículo se crea `open` como antes. Con RLS de agente: lee `inventory_vehicles` (incluidos vendidos, no los de otra cuenta) y `vehicle_inquiries`, inserta/cambia/quita el vehículo de su cuenta y la FK rechaza el de otra cuenta. El embed `vehicle:inventory_vehicles!deals_vehicle_fkey(...)` responde 200 por REST con los `select` exactos del tablero y de la bandeja, como agente y como service role.
  - Arreglado en la auditoría: al reabrir un negocio con vehículo, su "Marca Modelo Año" cuenta como título autollenado (`formatVehicleTitle`); el contacto fijo ya no muestra un instante el de la conversación anterior; el buscador del selector tiene `aria-label`.
  - La revisión del tablero es de código (sin prueba manual de UI): con `pipelineId` fijo el flujo de crear/editar no cambia, salvo que ahora guarda `vehicle_id`.
- [x] 5.3 Prueba manual del usuario en producción: crear un negocio desde la bandeja con un vehículo sugerido, ajustar el valor y ver el vehículo en la bandeja y en el tablero
