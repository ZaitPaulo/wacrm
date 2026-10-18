## Why

Los dueños de Lora Motors necesitan ver en un solo lugar todo lo que ha pasado con cada cliente: citas, llamadas, conversaciones, negocios, lo que se le vendió y lo que se le compró. Hoy esa historia está repartida en siete pestañas de un panel lateral, en el inventario y en la Agenda, y algunas partes ni se registran (llamadas, a quién se le compró un carro). Además, la migración 520 hace que cada asesor vea solo a sus clientes. Pero los contactos son del negocio y no de cada asesor: cuando un cliente vuelve o lo atiende otra persona, el equipo tiene que poder ver su historia completa.

## What Changes

**Fase 1 — Ficha del contacto a pantalla completa**
- Nueva ruta `/contacts/[id]` con la ficha completa: encabezado con datos y acciones, resumen editable (datos, etiquetas, campos personalizados), hoja de vida y documentos.
- Desde la lista de Contactos, un clic en un contacto navega a la ficha en vez de abrir el panel lateral. **BREAKING (UI)**: se retira `ContactDetailView` (el `Sheet` de `contact-detail-view.tsx`) y lo que sirve de él pasa a la página.
- La bandeja conserva su panel lateral (`contact-sidebar.tsx`) y le suma un enlace "Ver hoja de vida".
- La Agenda, el Inventario (comprador, propietario y vendedor) y las notificaciones con contacto enlazan a la ficha.

**Fase 2 — Contactos del negocio: ver es de todos, atender sigue siendo del asignado**
- Cualquier miembro de la cuenta puede ver cualquier contacto con sus etiquetas, campos, notas, documentos y canales, y su hoja de vida completa, incluidos los hilos de conversación en solo lectura.
- Cualquier miembro con rol `agent` o superior puede agregar notas y registrar interacciones sobre cualquier contacto.
- Sin cambio: la bandeja, el embudo, la Agenda y el panel de indicadores siguen mostrando al asesor solo lo suyo. Responder, reasignar, editar los datos del contacto, mover negocios y modificar citas siguen restringidos por asignación.

**Fase 3 — Hoja de vida (línea de tiempo unificada)**
- Línea de tiempo por contacto, armada al consultar y sin tabla duplicada. Reúne: primer contacto y origen (anuncio), conversaciones resumidas por hilo, asignaciones y traspasos, citas y sus eventos (agendó, confirmó, asistió, no asistió, movida, cancelada), negocios y cambios de etapa, consultas por vehículo, ventas (le vendimos), consignaciones (nos dejó en venta), compras y retomas (le compramos), documentos, notas e interacciones registradas.
- Hoy no queda guardado el historial de cambios de etapa de un negocio: `pipeline_stage_transitions` son las reglas de qué etapa puede seguir a cuál, no un historial. Se agrega `deal_stage_events`, que un trigger llena de aquí en adelante. Los cambios anteriores no se pueden recuperar.
- Filtros por tipo de evento, paginación hacia atrás y un resumen arriba (cliente desde, asesor actual, número de citas, compras y ventas).
- El costo de adquisición nunca aparece para quien no es `admin`: el equipo ve "le compramos un Spark 2015", sin el precio.

**Fase 4 — Registrar lo que hoy no queda guardado**
- Registro manual de interacciones desde la ficha: llamada saliente, llamada entrante, visita sin cita u otra, con resultado, duración opcional, fecha y nota.
- Vendedor y tipo de adquisición en el vehículo: `seller_contact_id` (a quién se le compró) y `acquisition_kind` (compra o retoma), legibles por el equipo y separados del costo, que sigue siendo solo para admin. Las compras viejas quedan sin vendedor.
- Desde la ficha del contacto: "Registrar venta" abre el mismo cierre de venta del inventario con el comprador ya elegido, y "Registrar compra" abre el vehículo con el vendedor ya elegido.

## Capabilities

### New Capabilities
- `contact-profile-page`: la ficha del contacto como página propia (`/contacts/[id]`), cómo se llega a ella desde la lista, la bandeja, la Agenda, el Inventario y las notificaciones, y qué contiene.
- `contact-timeline`: la hoja de vida, es decir, qué fuentes la componen, cómo se ordena, filtra y pagina, qué ve cada rol y cómo se protege el costo de adquisición.
- `contact-interactions`: el registro manual de llamadas, visitas sin cita y otras interacciones.
- `vehicle-seller`: a quién se le compró un vehículo y si fue compra o retoma, distinto del propietario (consignación) y del comprador.

### Modified Capabilities
- `conversation-visibility`: los contactos y lo que cuelga de ellos (etiquetas, campos, notas, documentos, canales) pasan a ser visibles para todo miembro de la cuenta. Los hilos de un contacto se pueden leer en solo lectura desde su hoja de vida. La bandeja, el embudo, la Agenda y toda escritura conservan la restricción por asignación.
- `vehicle-sales-recording`: la venta también se puede registrar desde la ficha del contacto, con el comprador ya elegido.

## Impact

- **Base de datos** (migraciones 553 en adelante; verificar que no haya otra con el mismo número al desplegar):
  - Políticas `SELECT` de `contacts`, `contact_tags`, `contact_custom_values`, `contact_notes`, `documents`, `contact_channels` y `contact_links`.
  - `INSERT` de `contact_notes`.
  - Funciones `SECURITY DEFINER` para la hoja de vida y la lectura de hilos.
  - Tablas nuevas `contact_interactions` y `deal_stage_events`, con GRANT explícito.
  - Columnas `seller_contact_id` y `acquisition_kind` en `inventory_vehicles`.
  - Sin cambio: `conversation_visible`, `contact_visible` (sigue gobernando negocios y citas), RLS de `conversations`, `messages`, `deals`, `appointments` y `vehicle_acquisitions`.
- **Front-end:**
  - Nueva `src/app/(dashboard)/contacts/[id]/` (Next 16.2: revisar en `node_modules/next/dist/docs/` cómo llegan los `params`).
  - `src/app/(dashboard)/contacts/page.tsx` y `src/components/contacts/*`.
  - `src/components/inbox/contact-sidebar.tsx` (enlace).
  - `src/components/agenda/*`.
  - `src/app/(dashboard)/inventory/page.tsx` (vendedor, tipo de adquisición, cierre de venta reutilizable).
  - Notificaciones.
- **API:** `src/app/api/contacts/*` (hoja de vida, interacciones), `src/app/api/inventory/*` y `src/lib/inventory/payload.ts` (vendedor).
- **Riesgo principal:** cambiar la visibilidad de contactos. Todos los listados de contactos del asesor se amplían. El embudo, la bandeja, la Agenda y los indicadores no deben cambiar, y eso se prueba explícitamente por rol.
- **Operación:** sin variables de entorno nuevas ni cron. Despliegue en un solo paso; las fases se pueden entregar por separado.
