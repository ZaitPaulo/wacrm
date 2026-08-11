## Context

El dashboard actual es un **client component** (`src/app/(dashboard)/dashboard/page.tsx`) que dispara cinco cargas en paralelo contra Supabase con la sesión del usuario y renderiza cada widget con su propio skeleton. Toda la agregación vive en `src/lib/dashboard/queries.ts` y es **JavaScript sobre filas crudas**: `db.from('deals').select('value, status')` seguido de un `reduce`. No hay una sola llamada `rpc()`, ni vistas, ni funciones de Postgres en todo el módulo.

Ese patrón es la restricción principal de este diseño. Lo natural sería mover los agregados a SQL, pero eso introduciría un mecanismo que el proyecto no usa en ninguna parte (ver `AGENTS.md` y la guía de no introducir patrones que el repo no tenga ya).

El otro condicionante es la seguridad. La RLS de `inventory_vehicles` (`500_inventory_vehicles.sql`) concede `SELECT` a `is_account_member(account_id)` — es decir, a **cualquier** miembro, incluido `viewer`. El costo de adquisición no puede vivir ahí.

A favor: `useAuth()` ya expone `isOwner` / `isAdmin` / `accountRole` derivados de `profiles.account_role`, y `src/lib/auth/roles.ts` ya concentra los helpers de permiso (`canManageMembersFor`, `canEditSettingsFor`). El gating de UI no requiere infraestructura nueva.

## Goals / Non-Goals

**Goals**
- Que el tablero hable de vehículos: stock, envejecimiento, ventas, márgenes.
- Que el costo de adquisición sea inaccesible para `agent` y `viewer` **por base de datos**, no por UI.
- Cerrar la cadena vitrina → WhatsApp → vehículo sin tocar la API de Meta.
- No romper nada de lo que ya funciona en el tablero.

**Non-Goals**
- Rehacer el pipeline ni relacionar `deals` con vehículos. Sigue en desarrollo y queda fuera.
- Soporte multi-moneda. Confirmado que los precios dispares son datos de prueba; se usa el `default_currency` de la cuenta como hasta ahora.
- Contabilidad real: gastos de reacondicionamiento, comisiones, impuestos. El margen aquí es **bruto** (venta − compra) y así debe titularse en la UI.
- Series históricas de inventario. No se guardan snapshots; todo se calcula sobre el estado actual.

## Decisions

### 1. El costo va en tabla propia, no en columnas de `inventory_vehicles`

`vehicle_acquisitions` (uno-a-uno con el vehículo, `UNIQUE(vehicle_id)`, scopeada por `account_id`) con RLS que exige `is_account_member(account_id, 'admin')` tanto en lectura como en escritura.

*Alternativa descartada:* columnas `purchase_cost` / `purchase_date` en `inventory_vehicles` y ocultarlas en la UI. La RLS de Postgres filtra **filas, no columnas**: un `agent` que consulte `/rest/v1/inventory_vehicles?select=*` recibiría el costo en el JSON. Sería seguridad decorativa.

*Alternativa descartada:* privilegios por columna (`GRANT SELECT (col)`). Postgres los soporta, pero se combinan mal con PostgREST —`select=*` empieza a fallar para roles sin el privilegio en vez de omitir la columna— y no hay precedente en el repo.

### 2. Los datos de venta sí van en `inventory_vehicles`

`sold_price`, `sold_at` y `sold_to_contact_id` como columnas del vehículo. El precio de cierre no es secreto: el comprador lo conoce y el vendedor lo negoció. Mantenerlo junto al vehículo evita un join en la consulta más frecuente del tablero comercial.

`sold_to_contact_id` con `ON DELETE SET NULL`: borrar un contacto no debe borrar la historia de la venta.

Un `CHECK` garantiza la coherencia que exige la spec de reversión: si `status <> 'sold'`, entonces `sold_price`, `sold_at` y `sold_to_contact_id` deben ser `NULL`.

### 3. El margen se calcula en el cliente, y la RLS es la que decide

Siguiendo el patrón de `queries.ts`, el cálculo es un join en JavaScript entre las filas de vehículos vendidos y las de adquisiciones:

```
loadSalesPerformance(db)
   ├── db.from('inventory_vehicles').select('id, sold_price, sold_at, brand')
   │      → todos los miembros reciben filas
   └── db.from('vehicle_acquisitions').select('vehicle_id, purchase_cost, purchase_date')
          → admin+ recibe filas; agent/viewer reciben []  ← la RLS decide
```

Con `agent` el segundo array llega vacío, el join no produce márgenes y la sección sencillamente no tiene datos que mostrar. **La restricción la impone la base**, y el `isAdmin` de `useAuth()` es sólo cosmética: evita renderizar un bloque vacío. Si alguien se salta el gating de UI, no obtiene datos igual.

Corolario que la spec vuelve normativo: estas consultas **nunca** deben ejecutarse con service-role. El módulo `queries.ts` ya recibe siempre el cliente de sesión, así que basta con no desviarse.

*Alternativa descartada:* una vista SQL con `security_invoker` que devolviera el margen ya agregado. Es más elegante y respetaría la RLS, pero introduce vistas —inexistentes en el repo— y con el volumen esperado (decenas a cientos de vehículos por cuenta) la agregación en JS es irrelevante en costo.

### 4. Código de referencia: columna corta y estable, no prefijo del UUID

Nueva columna `inventory_vehicles.public_ref`: 6 caracteres de un alfabeto sin ambigüedad visual (sin `I`, `L`, `O`, `U`), única por cuenta, generada al crear el vehículo. El mensaje del CTA queda:

```
Hola, me interesa el Toyota Corolla 2021. ¿Sigue disponible? [Ref: X7K2M9]
```

El webhook reconoce `[Ref: XXXXXX]` con una expresión regular tolerante a mayúsculas y espacios, y resuelve el vehículo con una igualdad exacta sobre una columna indexada.

*Alternativa descartada:* usar los primeros caracteres del UUID (`[#a3f91b]`). Evita la columna, pero obliga a un match por prefijo sobre un `uuid` —incómodo desde PostgREST— y abre el caso de prefijos ambiguos que habría que resolver descartando la atribución.

### 5. `vehicle_inquiries` es una tabla, no una columna en `conversations`

Un mismo contacto puede preguntar por varios autos, y un mismo auto lo consultan muchos contactos. La relación es N:N y necesita fecha propia para poder medir por período. Tabla con `vehicle_id`, `contact_id`, `conversation_id`, `created_at`, RLS de miembro (no es dato sensible).

La conversión consulta→venta se deriva cruzando `vehicle_inquiries` con los vehículos vendidos; no se persiste ningún estado de "convertida".

### 6. La antigüedad usa la fecha de adquisición y cae a la de alta

`COALESCE(purchase_date, created_at)`, resuelto en JS. Un vehículo sin adquisición registrada igual aparece en el envejecimiento —el stock parado es stock parado— mientras que sí queda excluido del **margen**, donde un costo desconocido no puede inventarse.

Esa asimetría es deliberada: en aging, omitir un auto lo esconde; en margen, asumir costo cero reportaría 100% de utilidad. La spec la fija como requisito.

## Risks / Trade-offs

- **Fuga del costo por una consulta con service-role** → El único vector real. Las consultas del tablero se mantienen en `queries.ts`, que sólo recibe el cliente de sesión; ninguna métrica de margen debe pasar por rutas API con `SUPABASE_SERVICE_ROLE_KEY`.
- **El costo se filtra al bot RAG** → `knowledge-sync.ts` corre con service-role (necesita saltarse la RLS del KB) y podría arrastrar el costo al documento del vehículo, que el bot le lee a un cliente. La spec lo prohíbe explícitamente; el sync debe seguir seleccionando campos de forma nominal, nunca `select('*')`.
- **Márgenes calculados sobre pocas unidades** → Con 5 vehículos y 0 ventas, cualquier promedio será ruidoso. Toda métrica agregada muestra sobre cuántas unidades se calculó, en vez de un número desnudo.
- **Atribución perdida porque el cliente edita el mensaje** → Es best-effort por diseño. Se registra sin vehículo y no se correlaciona por cercanía temporal, que produciría falsos positivos peores que el dato faltante.
- **Códigos de referencia y privacidad** → `public_ref` viaja en un mensaje de WhatsApp y en la vitrina pública. No debe derivarse de datos internos (ni del VIN ni de la placa); es un identificador opaco y nada más.
- **El tablero crece y se vuelve lento** → Cada bloque ya carga por separado con su propio skeleton. Se mantiene ese aislamiento: una sección lenta no bloquea al resto.

## Migration Plan

1. **Migración `508_vehicle_economics.sql`**, idempotente como el resto del repo (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de crear):
   - Tabla `vehicle_acquisitions` + RLS `admin`+ (las cuatro políticas).
   - Columnas `sold_price`, `sold_at`, `sold_to_contact_id` y `public_ref` en `inventory_vehicles`, más el `CHECK` de coherencia de venta.
   - Índice único parcial de `public_ref` por cuenta; índices de consulta sobre `sold_at` y `status`.
   - Tabla `vehicle_inquiries` + RLS de miembro.
   - Backfill de `public_ref` para los vehículos existentes.
2. **Aplicar a la nube** con la receta del proyecto: `npx supabase db push --db-url "<cadena>?sslmode=require" --include-all`. El `?sslmode=require` es obligatorio y `--include-all` hace falta porque nuestras migraciones van en el rango 500+.
3. **Código** en orden: captura (inventario) → atribución (vitrina + webhook) → tablero. El tablero va último porque consume lo que los otros dos producen.

**Rollback:** el cambio es puramente aditivo — ninguna columna se elimina ni se renombra, y el estado `sold` ya existía en el enum. Revertir el código deja el dashboard anterior funcionando intacto sobre el esquema nuevo; las tablas y columnas añadidas quedan huérfanas pero no molestan. No hace falta migración inversa.

## Open Questions

- **¿Se necesita registrar el proveedor de la compra?** (a quién se le compró el auto). `vehicle_acquisitions` es el lugar natural y agregarlo después es trivial, pero no salió en la conversación y no se incluye por ahora.
- **¿La reversión de una venta debe dejar rastro?** Hoy se limpian los campos y se pierde que existió. Con volumen bajo es aceptable; si aparece la necesidad de auditoría, pediría una tabla de historial aparte.
- **¿Qué período muestra por defecto el bloque comercial?** El tablero ya tiene rangos de 7/30/90 días para conversaciones. Para ventas, el mes corriente suele ser lo que se mira; queda por decidir si se reutiliza el selector existente o el bloque comercial lleva el suyo.
