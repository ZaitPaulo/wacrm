## Context

- `DealForm` (`src/components/pipelines/deal-form.tsx`) crea y edita negocios desde el tablero. Recibe `pipelineId` y `stages` fijos, carga **todos** los contactos en un `<select>` y vincula la conversación abierta más reciente del contacto. El insert lleva `user_id`, `account_id` y `status: 'open'`.
- El panel de la bandeja (`contact-sidebar.tsx`) ya lista los negocios del contacto y, desde el cambio `cambiar-etapa-negocio-desde-bandeja`, permite moverlos de etapa. Recarga con `fetchContactData()`.
- `inventory_vehicles`: `brand`, `model`, `year`, `license_plate`, `price NUMERIC(12,2)`, `status vehicle_status ('available','reserved','sold','hidden')`, `account_id`. En producción hay unos 136 vehículos.
- `vehicle_inquiries(account_id, vehicle_id, contact_id, created_at)` registra qué vehículo consultó cada contacto desde la vitrina.
- `deals` no tiene vínculo con vehículos.

## Goals / Non-Goals

**Goals:**
- Crear negocios desde la bandeja reutilizando `DealForm`.
- Vincular un vehículo opcional a cada negocio, con sugeridos y autollenado de valor y título.
- Mostrar el vehículo en la bandeja, en el formulario y en las tarjetas del tablero.

**Non-Goals:**
- Reservar o vender el vehículo automáticamente al crear el negocio o al llegar a "Cerrado".
- Varios vehículos por negocio.
- Que la automatización `create_deal` elija un vehículo.
- Recalcular el valor del negocio cuando cambia el precio del vehículo después: el valor es una foto tomada al elegirlo.

## Decisions

1. **`deals.vehicle_id UUID NULL` con FK compuesta `(account_id, vehicle_id) → inventory_vehicles(account_id, id) ON DELETE SET NULL (vehicle_id)`.**
   Garantiza en la base que el vehículo sea de la misma cuenta, igual que en la 528. Requiere agregar `unique (account_id, id)` a `inventory_vehicles` de forma idempotente. El `SET NULL` con lista de columnas (PG15+) evita que se anule también `account_id`, y hay que verificar la versión de Postgres del VPS.
   *Alternativa si la versión no lo soporta:* FK simple a `inventory_vehicles(id) ON DELETE SET NULL` más un trigger `BEFORE INSERT OR UPDATE` que compruebe la cuenta.
   Se agrega un índice parcial en `vehicle_id`. La RLS de `deals` no cambia.

2. **Reutilizar `DealForm` con props nuevas opcionales** en lugar de un formulario aparte para la bandeja:
   - `fixedContactId?: string`: preselecciona el contacto y oculta o deshabilita su selector. Evita cargar todos los contactos.
   - `pipelineId` y `stages` pasan a ser opcionales. Si no vienen, el formulario carga los embudos de la cuenta y las etapas del elegido, y propone "Ventas" o el primero. La elección por defecto la hace la función pura `pickDefaultPipeline`.

   Así el tablero gana el selector de vehículo sin duplicar la lógica de guardado, que es lo que pidió el usuario.

3. **Selector de vehículo:** un `Popover` con un buscador, siguiendo el patrón de combobox que ya use el repo, que se busca antes de crear uno nuevo. Carga una sola vez, al abrir el formulario, los vehículos `available` y `reserved` de la cuenta (columnas mínimas: `id, brand, model, year, license_plate, price, status`), más el vinculado si es otro. Con cerca de 136 vehículos se filtra en el cliente; no hace falta buscar en el servidor.
   Los sugeridos salen de `vehicle_inquiries` del contacto, ordenados por `created_at desc` y sin repetir. La función pura `rankVehicleOptions(vehicles, inquiries, query)` devuelve `{ suggested, others }`, y la búsqueda es por términos AND, sin distinguir mayúsculas ni tildes, sobre "marca modelo año placa".

4. **Autollenado con memoria del último título autollenado.** Un estado `autoTitle` guarda el título puesto por el último vehículo. Al elegir otro vehículo, el título se reemplaza solo si está vacío o si sigue siendo igual a `autoTitle`, y el valor se reemplaza siempre. Es la función pura `applyVehicleSelection({ title, autoTitle }, vehicle)` → `{ title, autoTitle, value }`. Quitar el vehículo no toca el valor ni el título.

5. **Formato del vehículo:** la función pura `formatVehicleLabel(v)` devuelve "Marca Modelo Año" y agrega " · PLACA" cuando hay placa. La usan el selector y las tres vistas.

6. **Bandeja:** el `+` en el encabezado de Negocios y, si no hay negocios, el botón "Crear negocio" abren `DealForm` con `fixedContactId = contact.id`. Al guardar (`onSaved`) se llama a `fetchContactData()`, que ya trae etapas y reglas, así que la tarjeta aparece con su selector de etapa. El `select` de negocios agrega `vehicle:inventory_vehicles(id, brand, model, year, license_plate)`.

7. **Tablero:** el `select` de `pipelines/page.tsx:104` agrega el mismo embed, y `deal-card.tsx` muestra una línea con el vehículo. Con dos FKs posibles entre `deals` e `inventory_vehicles` (no las hay hoy), el embed necesitaría nombrar la FK; se nombra explícitamente por si acaso.

## Risks / Trade-offs

- [El embed de PostgREST sobre una FK compuesta puede resultar ambiguo] → nombrar la FK en el embed (`inventory_vehicles!deals_vehicle_fkey(...)`) y probarlo en local antes de desplegar.
- [PostgREST no conoce la columna nueva hasta recargar su caché de esquema] → la migración termina con `NOTIFY pgrst, 'reload schema'`. En la 528 funcionó sin eso, pero es barato y evita el riesgo.
- [El asesor espera que el negocio reserve el carro] → queda como fuera de alcance y se menciona al usuario.
- [La lista de 136 vehículos crece] → el filtrado en el cliente aguanta miles. Si algún día no alcanza, se cambia por búsqueda en el servidor sin tocar el contrato de `rankVehicleOptions`.
- [Números de migración] → usar 529 tras comprobar el último número en el repo y en el VPS (`schema_migrations`).

## Migration Plan

1. Migración 529 en local con `npx supabase migration up --local`.
2. Pruebas y QA en local.
3. En el VPS: respaldo, `git pull`, `apply-migrations.sh --dry-run`, aplicar y reconstruir la app. Avisar que hay que recargar con Ctrl+Shift+R.
4. Rollback: `ALTER TABLE deals DROP COLUMN vehicle_id`. El código trata `vehicle` nulo como "sin vehículo".

## Open Questions

- ¿Al crear un negocio con vehículo se debería marcar el vehículo como reservado? Queda para un cambio posterior.
