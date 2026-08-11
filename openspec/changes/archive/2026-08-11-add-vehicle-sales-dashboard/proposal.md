## Why

El dashboard (`src/app/(dashboard)/dashboard/page.tsx`) sigue siendo el del CRM de WhatsApp del que salió el fork: conversaciones activas, contactos nuevos hoy, valor de deals abiertos, mensajes enviados hoy, una serie in/out de conversaciones, una dona de pipeline, tiempo de respuesta por día de semana y un feed de actividad. **No menciona vehículos en ninguna parte**, aunque el negocio es una compraventa de autos y `inventory_vehicles` existe desde la migración 500.

Peor: la dona de pipeline —una de las dos gráficas grandes— dibuja una tabla vacía. `deals` tiene **0 filas** y ni siquiera se relaciona con `inventory_vehicles`; son dos mundos separados (`001_initial_schema.sql:267`). El usuario confirma que el pipeline está apenas en desarrollo.

Y las métricas que de verdad gestionan una compraventa hoy **no se pueden calcular**, porque el esquema no captura los datos:

| Métrica | Bloqueada por |
|---|---|
| Margen bruto, utilidad | No existe el costo de compra. `inventory_vehicles.price` es sólo el de venta. |
| Ventas del mes, ingresos, ticket promedio | No existe `sold_at` ni el precio de cierre. El enum `vehicle_status` tiene `sold`, pero nada registra *cuándo* ni *en cuánto*. |
| Días reales en inventario (rotación) | No hay fecha de adquisición. `created_at` sólo dice cuándo se cargó al sistema. |
| Qué vehículo genera más consultas | El CTA de la vitrina (`src/lib/showcase/format.ts:76-83`) abre WhatsApp con un texto prellenado sin ningún identificador: la cadena vitrina → chat → vehículo está cortada. |

El momento es bueno: hay 5 vehículos de prueba y 0 ventas registradas, así que no hay historia real que migrar.

## What Changes

**Datos nuevos (migración 508)**

- Tabla **`vehicle_acquisitions`**: el costo de compra y la fecha de adquisición de cada vehículo, con RLS que exige `is_account_member(account_id, 'admin')`. Va en tabla aparte —y no como columnas de `inventory_vehicles`— porque la RLS de esa tabla da `SELECT` a **cualquier** miembro, incluido `viewer` (`500_inventory_vehicles.sql`): un vendedor que negocia el precio con el cliente no debe poder leer en cuánto se compró el auto. Ocultarlo sólo en la UI sería seguridad falsa, porque la respuesta de PostgREST lo traería igual.
- Columnas de cierre en **`inventory_vehicles`**: `sold_price`, `sold_at`, `sold_to_contact_id`. El precio de venta no es secreto (el cliente lo conoce), así que se queda donde vive el vehículo y sigue visible para todo el equipo.
- Tabla **`vehicle_inquiries`**: qué vehículo originó qué conversación. Un contacto puede preguntar por varios autos, así que es una tabla, no una columna.

**Captura**

- Al pasar un vehículo a `sold` en `/inventory`, un diálogo pide **precio final, fecha y comprador** (contacto vinculable, opcional). Hoy el cambio de estado es un simple update sin registrar nada.
- El formulario de vehículo gana los campos de adquisición (costo y fecha), visibles **sólo** para `admin`+.

**Atribución**

- `whatsappHref()` añade un código de referencia corto al mensaje prellenado del CTA de la vitrina.
- El webhook de WhatsApp entrante parsea ese código y registra la consulta en `vehicle_inquiries`. Sin cambios en la API de Meta: es parseo del texto del primer mensaje.

**Tablero**

El dashboard pasa a tener dos bloques: uno de **inventario** (stock por estado, valor inmovilizado, envejecimiento del stock en tramos 0-30/31-60/61-90/90+ días, mix por marca/carrocería/combustible, distribución por precio y año) y uno **comercial** (utilidad e ingresos del mes, margen por unidad y por marca, ticket promedio, días compra→venta, vehículos más consultados y conversión consulta→venta). Las métricas de margen sólo se renderizan para `admin`+.

Las métricas de WhatsApp heredadas que siguen siendo útiles (conversaciones, tiempo de respuesta, feed) se conservan. La dona de pipeline se mantiene pero baja de jerarquía: el pipeline sigue en desarrollo y **no se elimina**.

Sin cambios de contrato: todo lo nuevo es aditivo. Los vehículos existentes quedan sin registro de adquisición y el tablero los trata como costo desconocido, no como costo cero.

## Capabilities

### New Capabilities
- `vehicle-acquisition-costs`: qué se registra del lado de la compra (costo, fecha, proveedor) y quién puede leerlo — la frontera de visibilidad entre `admin`+ y el resto del equipo.
- `vehicle-sales-recording`: qué se captura al cerrar una venta (precio final, fecha, comprador) y cómo se comporta el cambio de estado a `sold`, incluida la reversión.
- `vehicle-lead-attribution`: cómo se marca el CTA de la vitrina y cómo se reconoce ese código en el mensaje entrante para atribuir la consulta a un vehículo.
- `vehicle-sales-dashboard`: qué métricas muestra el tablero, cómo se calculan (en particular el envejecimiento y el margen) y qué ve cada rol.

### Modified Capabilities
<!-- Ninguna. Las capacidades documentadas (`ai-reply-gating`, `flow-handoff-routing`, `spanish-locale`) no cambian sus requisitos. -->

## Impact

**Base de datos**
- Nueva migración `508_vehicle_economics.sql` (la última es `507_ai_providers_openrouter_gemini.sql`; nuestras migraciones van en rango 500+ por el fork de `ArnasDon/wacrm`).
- Tablas nuevas `vehicle_acquisitions` y `vehicle_inquiries`; columnas nuevas en `inventory_vehicles`. Nada se elimina ni se renombra.

**Código afectado**
- `src/lib/dashboard/queries.ts`, `types.ts` — consultas y shapes de las métricas nuevas.
- `src/app/(dashboard)/dashboard/page.tsx` — reorganización en bloques y gating por rol.
- `src/components/dashboard/*` — gráficas nuevas (recharts, ya en dependencias).
- `src/app/(dashboard)/inventory/page.tsx` — diálogo de venta y campos de adquisición.
- `src/app/api/inventory/route.ts`, `[id]/route.ts`, `src/lib/inventory/payload.ts` — validación y persistencia de los campos nuevos.
- `src/lib/showcase/format.ts` — código de referencia en `whatsappHref()`.
- `src/app/api/whatsapp/webhook/route.ts` — parseo del código y registro de la consulta.
- `messages/{es,en,ko}.json` — todo texto nuevo traducido (next-intl).

**Sin cambios**
- La tabla `deals` y el pipeline. Fuera de alcance.
- La API de Meta / configuración de WhatsApp: la atribución es parseo de texto entrante.
- El sync con el knowledge base (`src/lib/inventory/knowledge-sync.ts`): los campos nuevos no entran al RAG — el costo es interno y no debe filtrarse al bot.

**Riesgo operativo**
- **Fuga del costo por el lado equivocado.** El dato es sensible; la RLS de `vehicle_acquisitions` es la única defensa real. Cualquier consulta del dashboard que lo agregue debe correr bajo la sesión del usuario, nunca con service-role, o el gating por rol se evapora.
- **Vehículos sin costo registrado.** Los 5 actuales y cualquier carga rápida quedan sin adquisición. Las métricas de margen deben excluirlos explícitamente y decir sobre cuántas unidades se calculó, en vez de asumir costo 0 y reportar margen del 100%.
- **Códigos de referencia editables.** El usuario puede borrar o alterar el texto prellenado antes de enviarlo en WhatsApp. La atribución es best-effort: si no hay código, la consulta se registra sin vehículo y no se inventa una correlación.
