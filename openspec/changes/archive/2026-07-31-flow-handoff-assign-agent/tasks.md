## 1. Tipos y política de fallback

- [x] 1.1 Agregar `handoff_assign_to?: string` a `FlowFallbackPolicy` en `src/lib/flows/types.ts`, con KDoc que aclare que aplica tanto al nodo `handoff` como al camino de fallback agotado
- [x] 1.2 Normalizar el campo en `resolveFallbackPolicy` (`src/lib/flows/fallback.ts`): string no vacío se conserva, cualquier otra cosa queda `undefined`
- [x] 1.3 Extender `src/lib/flows/fallback.test.ts` con los casos del campo nuevo: presente, ausente, vacío y de tipo no textual

## 2. Motor

- [x] 2.1 En `executeHandoff` (`src/lib/flows/engine.ts`), aceptar la política resuelta y aplicar la precedencia `cfg.assign_to` → `policy.handoff_assign_to`; sin agente resuelto, dejar solo `status: "pending"`
- [x] 2.2 En `advanceFromNodeKey`, cargar el flujo de forma perezosa —solo al entrar a un nodo `handoff`— y pasar la política resuelta a `executeHandoff`
- [x] 2.3 Registrar en el evento `handoff` el agente efectivamente asignado (o `null`), no el crudo del config
- [x] 2.4 En el camino de fallback agotado (`handleReplyForActiveRun`, acción `handoff`), asignar `policy.handoff_assign_to` solo si la conversación no tiene ya `assigned_agent_id`; reusar la política ya cargada en ese bloque
- [x] 2.5 Cubrir en `src/lib/flows/engine.test.ts` la precedencia del nodo, la herencia del default, el caso sin agente, y el no-pisar del fallback sobre una conversación ya asignada

## 3. Campo de selección de agente

- [x] 3.1 En `src/components/flows/forms/fields.tsx`, agregar un hook que cargue los miembros desde `/api/account/members` con `cache: "no-store"` y tolere el fallo devolviendo lista vacía
- [x] 3.2 Agregar el campo de selección de agente: opción "sin asignar", miembros por nombre, fallback a input crudo con lista vacía, y preservación del id guardado que ya no figure entre los miembros

## 4. Builder — nodo de derivación

- [x] 4.1 En `src/components/flows/forms/node-config-form.tsx`, sumar el selector de agente al `case "handoff"` junto a la nota interna, escribiendo `assign_to`
- [x] 4.2 Cambiar `defaultConfigFor("handoff")` en `src/components/flows/flow-editor-state.tsx` a `{ note: "", assign_to: "" }`

## 5. Builder — default del flujo

- [x] 5.1 Sumar `fallback_policy` a `BuilderState` y sembrarla desde `initialFlow.fallback_policy` pasándola por `resolveFallbackPolicy`
- [x] 5.2 Incluir `fallback_policy` en el payload del `PUT` en `save()`
- [x] 5.3 Exponer el campo del agente por defecto en el builder (`src/components/flows/flow-builder.tsx`), reusando el componente del punto 3.2
- [x] 5.4 Verificar que editar el campo marca el formulario como dirty y que el valor sobrevive a un guardado + recarga del editor

## 6. i18n

- [x] 6.1 Agregar las etiquetas nuevas a `messages/es.json` bajo `Flows.builder` (etiqueta y ayuda del agente del nodo, etiqueta y ayuda del agente por defecto del flujo, opción "sin asignar", texto de agente desconocido)
- [x] 6.2 Replicar las mismas claves en `messages/en.json` y `messages/ko.json`

## 7. Verificación

- [x] 7.1 Correr `npx vitest run src/lib/flows` y confirmar que pasa
- [x] 7.2 Correr `npx tsc --noEmit` y `npm run lint` sobre los archivos tocados
- [x] 7.3 Prueba manual de punta a punta: flujo con nodo de derivación con agente elegido → la conversación queda asignada a esa persona, con notificación creada y el evento `handoff` mostrando el `assigned_to`
