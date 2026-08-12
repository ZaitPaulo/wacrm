## 1. Resguardo previo

- [x] 1.1 Volcar a un archivo fuera del repositorio las 2 filas de `automations` con sus 6 `automation_steps`, la fila de `flows` con sus 7 `flow_nodes`, las 5 `pipeline_stages` y los 5 `flow_runs`, para poder restaurar
- [x] 1.2 Confirmar rangos de presupuesto, moneda y nombre de la etiqueta de calificación — resuelto: COP según `accounts.default_currency`, cortes derivados del inventario (decisión 7 del design), etiqueta "Calificado"

## 2. Motor de flujos: capturar y entregar lo que responde el cliente

- [x] 2.1 Relajar el patrón de `interpolateVars` en `src/lib/flows/engine.ts:607` para tolerar espacios dentro de `{{ }}`, con prueba de que `{{ vars.x }}` y `{{vars.x}}` rinden igual
- [x] 2.2 Guardar en `vars[<node_key>]` el título de la opción elegida al resolver un toque de botón o de fila de lista, junto a la escritura de `vars` que ya hace `collect_input`
- [x] 2.3 Documentar en el módulo la convención de la clave y la colisión posible con un `var_key` homónimo
- [x] 2.4 Interpolar `cfg.note` en `executeHandoff` (`engine.ts:504-544`) antes de registrarla en el evento de log
- [x] 2.5 Insertar la nota interpolada en `contact_notes` cuando quede contenido, con `user_id` del flujo; no insertar fila cuando la nota esté vacía
- [x] 2.6 Pruebas: nota con variables capturadas, nota con variable nunca capturada, nota vacía, y que el evento de log siga registrando nota y agente asignado

## 3. Cierre de ejecuciones huérfanas

- [x] 3.1 Cerrar las ejecuciones vivas de un flujo cuando este deja el estado `active`, registrando el motivo del cierre
- [x] 3.2 Prueba de que pasar un flujo activo a borrador no deja ninguna ejecución en `active`

## 4. Validación traducible

- [x] 4.1 Cambiar `ValidationIssue` en `src/lib/flows/validate.ts` de `message: string` a `code: string` + `params?`, y convertir los ~40 puntos de emisión
- [x] 4.2 Hacer lo mismo con los ~25 puntos de `src/lib/automations/validate.ts`
- [x] 4.3 Agregar las claves de los códigos a `messages/es.json`, `en.json` y `ko.json`, usando ICU para los valores de `params`
- [x] 4.4 Traducir en el punto de render: `src/components/flows/validation-panel.tsx:95`
- [x] 4.5 Traducir en el toast de activación: `src/components/automations/automation-builder.tsx:704`
- [x] 4.6 Actualizar `src/lib/flows/validate.test.ts` y `src/lib/automations/validate.test.ts` para afirmar sobre códigos en lugar de frases
- [x] 4.7 Verificar que `src/i18n/messages.test.ts` y `src/i18n/icu-safety.test.ts` pasan

## 5. Restos de interfaz sin catálogo

- [x] 5.1 Migrar `src/components/flows/forms/node-config-form.tsx` líneas 469, 511, 670, 818 y 941
- [x] 5.2 Migrar `src/components/flows/header.tsx` líneas 70, 83 y 172, y `flow-editor-shell.tsx:109`
- [x] 5.3 Migrar `src/components/automations/automation-builder.tsx` líneas 879, 1157, 1166 y 1476, y `automations/page.tsx:339`
- [x] 5.4 Errores de carga desde el catálogo — comprobado que `flows/page.tsx`, `flows/[id]/page.tsx` y `runs/page.tsx` ya capturaban y mostraban toast traducido (el inglés solo iba a consola). Sí se corrigieron `flow-editor-state.tsx`: el `window.confirm` de borrado estaba en inglés y el toast mostraba `Delete failed: 500`
- [x] 5.5 Agregar las claves nuevas a los tres catálogos

## 6. Plantillas semilla en español y del rubro

- [x] 6.1 Reescribir las 3 plantillas de `src/lib/flows/templates.ts` para compraventa de vehículos, con `welcome_menu` y `faq_bot` en español y `lead_capture` reemplazada por el guion de calificación del design
- [x] 6.2 Verificar que el guion de calificación pasa `validateFlowForActivation` sin errores, respetando los límites de WhatsApp
- [x] 6.2b Redactar los cinco rangos de presupuesto en COP según la tabla de la decisión 7, y comprobar contra `inventory_vehicles` que cada rango tiene al menos una unidad disponible
- [x] 6.3 Reescribir las 4 plantillas de `src/lib/automations/templates.ts`, con palabras clave en español y sin el `create_deal` de valor fijo
- [x] 6.4 Quitar de `lead_qualifier` el `wait` de 10 minutos previo a la asignación
- [x] 6.5 Mover la creación del negocio a una plantilla disparada por `tag_added` con la etiqueta de calificación, con `value: 0`
- [x] 6.6 Verificar que todo `{{…}}` de las plantillas usa la sintaxis que su motor entiende

## 7. Galería de plantillas desde el catálogo

- [x] 7.1 Que `src/app/api/flows/templates/route.ts:25` deje de devolver `name` y `description` como prosa y exponga la referencia al catálogo
- [x] 7.2 Traducir las tarjetas en `src/app/(dashboard)/flows/page.tsx` y en `src/app/(dashboard)/automations/page.tsx:197`
- [x] 7.3 Tolerar una plantilla sin traducción en el catálogo activo sin romper la galería
- [x] 7.4 Agregar nombres y descripciones de las 7 plantillas a los tres catálogos
- [x] 7.5 Comprobar que clonar una plantilla y editar un mensaje persiste la edición

## 8. Advertencia de disparador en conflicto

- [x] 8.1 Detectar, al activar una automatización, si hay un flujo activo con el mismo disparador de relación y la automatización tiene algún paso de envío (`send_message`, `send_buttons`, `send_list`, `send_template`)
- [x] 8.2 Devolver la advertencia junto con la respuesta exitosa, nombrando el flujo en conflicto, sin bloquear la activación
- [x] 8.3 Mostrar la advertencia en el builder, con su clave en los tres catálogos
- [x] 8.4 Pruebas: conflicto detectado, automatización silenciosa sin advertencia, flujo en borrador sin advertencia, y que continuar activa igual

## 9. Migración de los datos ya cargados

> **Escrita y sin aplicar.** No hay Docker, `psql`, proyecto enlazado ni
> cadena de conexión en `.env`, así que la migración no se pudo ejecutar
> desde aquí. El SQL está en `supabase/migrations/509_flows_automations_es.sql`.

- [x] 9.1 Crear `supabase/migrations/509_*.sql`, idempotente, sin UUIDs de esta instalación y reescribiendo solo lo que aún coincide con el texto en inglés de la semilla original
- [x] 9.1b **Ampliar el CHECK de `flow_runs.status` para admitir `cancelled`** — el código del grupo 3 ya lo escribe y la base lo rechaza hasta que esta migración corra
- [x] 9.2 Renombrar y redescribir las 2 automatizaciones y pasar sus palabras clave a español
- [x] 9.3 Traducir los textos de los `automation_steps`, quitar el `create_deal` de 20.000 y el `wait` previo a la asignación — **ojo**: el `create_deal` y el `assign_conversation` no venían de la semilla, los configuró el operador; van marcados como correcciones autorizadas (capa B) y no bajo la regla de «coincide con la semilla»
- [x] 9.4 ~~Reemplazar el flujo y sus nodos~~ → **desviación**: el operador había agregado un nodo propio y reenrutado el grafo, así que reemplazarlo borraba su trabajo. El flujo existente se traduce nodo a nodo y se renombra a «Captura de prospecto (heredado)»; el guion nuevo entra como flujo aparte en borrador
- [x] 9.5 Renombrar las 5 `pipeline_stages` sin alterar `id` ni `position`
- [x] 9.6 Crear la etiqueta de calificación si no existe, conservando "Prospecto"
- [x] 9.7 Cerrar las ejecuciones `active` de flujos que no están `active`
- [ ] 9.8 (requiere aplicar la migración) Verificar que el nodo editado a mano ("Transfiriendo a un agente de servicio") no fue sobrescrito
- [ ] 9.9 (requiere aplicar la migración) Re-ejecutar la migración y comprobar que no produce cambios

## 10. Verificación final

- [x] 10.1 `pnpm test` en verde
- [x] 10.2 `pnpm lint` y compilación de tipos sin errores
- [ ] 10.3 (requiere aplicar la migración) Recorrer en la interfaz: galería de plantillas, editor de flujos con un error de validación provocado, editor de automatizaciones y embudo — todo en español
- [ ] 10.4 (requiere aplicar la migración) Ejercitar el guion de punta a punta y confirmar que el agente ve la nota con las respuestas en la barra lateral del contacto
- [x] 10.5 Anotar en `CHANGELOG.md` el cambio de comportamiento de la nota de derivación
