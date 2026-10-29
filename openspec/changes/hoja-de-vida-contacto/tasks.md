## 1. Preparación

- [x] 1.1 Leer en `node_modules/next/dist/docs/01-app/` cómo se declaran las rutas dinámicas y sus `params` en Next 16.2, y anotar en design.md cualquier diferencia con lo supuesto
- [x] 1.2 Confirmar que no hay migraciones 553–555 en `develop`, `main` ni en el upstream, y que el VPS está en la 552
- [x] 1.3 Inventariar en `src/` cada lectura de `contacts`, `contact_tags`, `contact_custom_values`, `contact_notes`, `documents`, `contact_channels` y `contact_links` hecha con sesión de usuario. Anotar cuáles cambian de alcance para el rol `agent` y si el cambio es deseado
- [x] 1.4 Verificar qué autorización aplica el proxy de medios de `isProxiedMediaUrl` / `loadMediaBlob` para conversaciones no asignadas

## 2. Fase 1 — Ficha a pantalla completa

- [x] 2.1 Extraer de `contact-detail-view.tsx` los bloques reutilizables (formulario de datos, etiquetas, campos personalizados, notas, negocios, documentos) a componentes en `src/components/contacts/`, sin cambiar su comportamiento
- [x] 2.2 Crear `src/app/(dashboard)/contacts/[id]/page.tsx` con encabezado, columna de resumen y pestañas `Hoja de vida | Documentos` (por ahora, la hoja de vida muestra las pestañas actuales de conversaciones, notas y negocios), y con estado de "no encontrado"
- [x] 2.3 Distribución para celular: columnas apiladas, sin desplazamiento horizontal, con la barra de navegación y `app-shell-viewport` respetados
- [x] 2.4 Hacer que la lista de Contactos navegue a `/contacts/[id]` al hacer clic y quitar el `Sheet`. Borrar `ContactDetailView` después de confirmar con una búsqueda que no tiene otros usos
- [x] 2.5 Edición condicionada: los datos, etiquetas y campos son editables solo si quien mira atiende el contacto o es admin u owner; si no, solo lectura
- [x] 2.6 Enlace "Ver hoja de vida" en `src/components/inbox/contact-sidebar.tsx`, sin otros cambios en el panel
- [x] 2.7 Enlaces a la ficha desde el detalle de cita (`appointment-sheet.tsx`), comprador y propietario en el Inventario, y notificaciones con `contact_id`
- [x] 2.8 Caja "Escribe una nota" encima de la hoja de vida (agent+), sin pestaña de notas aparte; la nota nueva aparece de inmediato en la línea de tiempo
- [x] 2.9 Botón "Agendar visita" en la ficha reutilizando `appointment-dialog.tsx` con `prefill.contactId` (como `schedule-visit-button.tsx`), visible solo para owner, admin o el asesor que atiende el contacto
- [x] 2.10 Textos en `messages/es` (y en los demás idiomas existentes); `src/i18n/messages.test.ts` e `icu-safety.test.ts` en verde

## 3. Fase 2 — Contactos del negocio (migración 553)

- [x] 3.1 Escribir `553_contact_visibility_business.sql`: `SELECT` con `is_account_member(account_id)` en las siete tablas de D1, y `contact_notes_insert` con `is_account_member(account_id, 'agent')`. Copiar en un comentario `down` las políticas originales de la 520
- [x] 3.2 Prueba SQL `supabase/tests/contact_visibility_business.test.sql`:
  - un `agent` ve todos los contactos de su cuenta y ninguno de otra;
  - un `agent` no puede actualizar ni borrar un contacto ajeno;
  - un `agent` puede insertar una nota en un contacto ajeno y un `viewer` no;
  - un `agent` sigue sin ver por tabla las conversaciones, mensajes, negocios y citas ajenos
- [x] 3.3 Prueba de no regresión por rol: con un `agent`, la bandeja, el embudo, la Agenda y `src/lib/dashboard/queries.ts` devuelven lo mismo que antes de la 553 (mismos conteos sobre los datos de prueba locales)
- [x] 3.4 Ajustar en la interfaz lo que el inventario de 1.3 haya marcado (por ejemplo, la columna "atiende" en la lista de Contactos, ya visible para el `agent`, y acciones de edición ocultas en contactos ajenos)

## 4. Fase 3 — Hoja de vida (migración 554)

- [x] 4.1 Tabla `deal_stage_events` con trigger `AFTER INSERT OR UPDATE OF stage_id, status ON deals`, RLS de lectura igual a `deals_select`, sin escritura desde el cliente y con `GRANT SELECT` explícito
- [x] 4.2 Índices faltantes por `contact_id` (con fecha donde corresponda) en las fuentes de la hoja de vida, incluidas `inventory_vehicles(sold_to_contact_id)` y `conversation_assignments` vía conversación
- [x] 4.3 Función `get_contact_timeline(p_contact_id, p_kinds, p_before, p_limit)`, `SECURITY DEFINER`: verificación de cuenta primero, `UNION ALL` de todas las fuentes de D2, conversaciones agregadas por hilo, costo solo para admin, orden estable y cursor
- [x] 4.4 Función `get_contact_summary(p_contact_id)` con los conteos del resumen
- [x] 4.5 Función `get_contact_conversation_messages(p_conversation_id, p_before, p_limit)`, solo lectura, con verificación de cuenta
- [x] 4.6 Prueba SQL `supabase/tests/contact_timeline.test.sql`:
  - un `agent` recibe eventos de otro asesor;
  - otra cuenta recibe cero;
  - el costo no está para `agent` y sí para `owner`;
  - mover una etapa registra un `deal_stage_events`;
  - la paginación no repite ni salta eventos con la misma fecha
- [x] 4.7 Ruta `GET /api/contacts/[id]/timeline` (con `kinds` y `before`) y `GET /api/contacts/[id]/summary` usando la sesión del usuario
- [x] 4.8 Componente de línea de tiempo: un renglón por `kind` con ícono, texto armado con `next-intl`, enlace al origen, filtros por tipo, "Cargar más" y estado vacío
- [x] 4.9 Visor de hilo en solo lectura: reutilizar `message-bubble` y `message-media`; mostrar "Atiende: {asesor}" y "Abrir en la bandeja" si quien mira es el asignado. Ampliar el proxy de medios si 1.4 lo pidió
- [x] 4.10 Pruebas de vitest de las funciones puras de mapeo evento → texto y del armado de filtros
- [x] 4.11 Medir con `EXPLAIN ANALYZE` la hoja de vida del contacto con más mensajes (con una copia de datos del VPS o un volumen similar en local) y anotar el resultado en design.md

## 5. Fase 4 — Interacciones, vendedor y accesos rápidos (migración 555)

- [x] 5.1 Tabla `contact_interactions` según D6: CHECK de `kind`, `outcome`, duración ≥ 0 y `occurred_at` no futura; RLS (lectura para miembros, alta para `agent`+ a su nombre, edición y borrado para el autor o un admin); `GRANT` explícito; `updated_at` con trigger
- [x] 5.2 Columnas `inventory_vehicles.seller_contact_id` (`ON DELETE SET NULL`, índice parcial) y `acquisition_kind` (`purchase` | `trade_in`), con validación de que el vendedor es de la misma cuenta
- [x] 5.3 Incluir en `get_contact_timeline` y `get_contact_summary` los eventos `interaction` y `acquisition` desde el vendedor (si no se hizo en la fase 3)
- [x] 5.4 Prueba SQL:
  - un `agent` registra una interacción en un contacto ajeno;
  - un `viewer` no puede;
  - un `agent` no borra una interacción ajena y un admin sí;
  - una fecha futura es rechazada;
  - un vendedor de otra cuenta es rechazado;
  - borrar el vendedor deja el vehículo intacto
- [x] 5.5 Rutas `POST/PATCH/DELETE /api/contacts/[id]/interactions` con validación del cuerpo, siguiendo el patrón de las rutas existentes
- [x] 5.6 Diálogo "Registrar interacción" en la ficha (tipo, fecha y hora, resultado solo para llamadas, duración, nota)
- [x] 5.7 Vendedor y tipo de adquisición en el formulario del vehículo con el selector del propietario. Extender `src/lib/inventory/payload.ts` y su prueba, y la ruta `/api/inventory`
- [x] 5.8 Extraer el cierre de venta de `inventory/page.tsx` a `src/components/inventory/sell-vehicle-dialog.tsx`; el Inventario lo usa sin cambiar su comportamiento
- [x] 5.9 "Registrar venta" en la ficha: diálogo con el comprador fijo y vehículos `available`/`reserved`
- [x] 5.10 "Registrar compra" en la ficha: navega a `/inventory` con el alta abierta y el vendedor precargado
- [x] 5.11 Enlace a la ficha desde el vendedor en el Inventario

## 6. Verificación y entrega

- [x] 6.1 `npx tsc --noEmit`, `npm run lint` y `npm test` en verde, y las pruebas SQL nuevas y existentes en verde contra el stack local con las migraciones aplicadas
- [ ] 6.2 Prueba manual en local con un `owner`, un `admin`, dos `agent` y un `viewer`:
  - recorrer la ficha, la hoja de vida, el hilo en solo lectura, la interacción, la venta y la compra;
  - confirmar que la bandeja, el embudo y la Agenda de cada asesor no cambiaron
- [ ] 6.3 Prueba en el celular (vista de la ficha y del diálogo de interacción)
- [x] 6.4 Desplegar cuando el usuario lo indique: migraciones 553–555 en el VPS en orden y un solo despliegue `develop` → `main`. Actualizar la memoria de despliegue
- [ ] 6.5 Avisar a los dueños que la hoja de vida solo muestra ventas, compras y llamadas si el equipo las registra
