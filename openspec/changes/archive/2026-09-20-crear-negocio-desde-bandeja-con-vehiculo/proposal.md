## Why

Si un contacto de la bandeja no tiene negocio, el asesor tiene que ir a Embudos, buscar al contacto en una lista y escribir título y valor a mano. En una compraventa de carros casi todos los negocios son "este cliente por este carro", pero hoy el negocio no guarda de qué vehículo se trata y su valor se escribe de memoria. Hay que poder crear el negocio desde la conversación, amarrado a un vehículo del inventario y con el precio de ese vehículo.

## What Changes

- **Crear negocio desde la bandeja:** la sección "Negocios" del panel lateral tiene siempre un **+** en el título (como Etiquetas). Si el contacto no tiene negocios, en lugar de "Sin negocios" aparece un botón "Crear negocio". Los dos abren el formulario de negocio con el contacto ya puesto.
- **Vehículo del negocio:** columna nueva `deals.vehicle_id`, opcional (migración 529). La FK compuesta con `account_id` impide vincular un vehículo de otra cuenta, y borrar el vehículo deja el negocio sin vehículo (`SET NULL`).
- **Selector de vehículo** en el formulario de negocio:
  - Busca por marca, modelo, año o placa entre los vehículos **disponibles y reservados**.
  - Arriba muestra, como **sugeridos**, los que ese contacto consultó desde la vitrina (`vehicle_inquiries`).
  - Al elegir un vehículo, el **valor** se llena con su precio y el **título** con "Marca Modelo Año" si está vacío o todavía tiene el título autollenado. Los dos se pueden editar.
- **Embudo y etapa:** abierto desde la bandeja, el formulario deja elegir el embudo y propone "Ventas" y su primera etapa.
- **El vehículo se ve en:** la tarjeta del negocio en la bandeja, el formulario del tablero (crear/editar) y las tarjetas del tablero de Embudos.

## Capabilities

### New Capabilities
- `deal-vehicle-link`: vínculo opcional entre un negocio y un vehículo del inventario, el selector de vehículo con sugeridos y el autollenado de valor y título, y dónde se muestra el vehículo.
- `inbox-deal-creation`: crear un negocio desde el panel lateral de la bandeja con el contacto ya puesto y embudo y etapa por defecto.

### Modified Capabilities
<!-- Ninguna: los requisitos existentes de ventas de vehículos y del embudo no cambian. -->

## Impact

- **Base de datos:** `supabase/migrations/529_deal_vehicle.sql` (columna, FK compuesta, índice). Revisar si hace falta `unique (account_id, id)` en `inventory_vehicles`.
- **Código:**
  - `src/components/pipelines/deal-form.tsx`: selector de vehículo, autollenado, contacto fijo y elección de embudo.
  - `src/components/inbox/contact-sidebar.tsx`: botones de crear y vehículo en la tarjeta.
  - `src/components/pipelines/deal-card.tsx` y `src/app/(dashboard)/pipelines/page.tsx`: traer el vehículo en el `select` y mostrarlo.
  - `src/types/index.ts` y `messages/*.json`.
  - Funciones puras nuevas en `src/lib/pipelines/`, con tests.
- **Sin cambios:** el registro de ventas de vehículos (`sold_to_contact_id`), las automatizaciones (`create_deal` sigue sin vehículo) y la vitrina.
- **Despliegue:** migración 529 en el VPS antes de promover a `main`.
