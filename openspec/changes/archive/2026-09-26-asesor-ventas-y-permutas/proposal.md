## Why

Los clientes que quieren venderle su carro al concesionario o entregarlo en permuta los atiende Angélica: ella avalúa, pide el peritaje y negocia la compra. Hoy la IA los pasa por el orden normal (conservar el asesor → continuidad del contacto → porcentajes), así que caen en cualquier asesor de ventas, que después tiene que reenviárselos a mano. Decisión del Director del 2026-09-25: estos casos van **siempre** a Angélica, aunque el cliente ya tenga asesor.

## What Changes

- Nuevo ajuste de cuenta en Ajustes → Asignación: **"Asesor para ventas y permutas"**. Se puede elegir a cualquier miembro vigente (owner, admin o agent), porque Angélica es `admin`. Vacío = desactivado.
- Cuando la IA traspasa con motivo `vende_su_carro` o `permuta` y hay un asesor configurado y vigente, la conversación se le asigna a esa persona, **aunque ya tuviera otro asesor vigente o el contacto tuviera asesor de continuidad**. Esta es la única excepción a la regla de que un camino automático nunca le quita la conversación a un asesor vigente.
- El asesor al que se le quita la conversación recibe un aviso: "Tu cliente pasó a Angélica", con el contacto y el motivo.
- El negocio abierto del contacto que tenía el asesor anterior pasa a quien queda asignado. Si no había negocio abierto, se crea con el título del traspaso, como hoy.
- La asignación se registra en el historial con un origen nuevo, `source = 'reason'`, y no consume cuota del reparto por porcentajes.
- Sin asesor configurado, o si ya no es miembro vigente, el traspaso sigue el orden normal.

## Capabilities

### New Capabilities

- `handoff-reason-routing`: el asesor configurado para ventas y permutas, cómo se elige y cómo el traspaso con esos motivos lo prioriza sobre el orden normal.

### Modified Capabilities

- `sticky-contact-assignment`: el asesor vigente deja de ser intocable en un único caso, el traspaso de la IA por venta o permuta hacia el asesor configurado.

## Impact

- **Base de datos**: una migración nueva (la siguiente libre después de la 542) que agrega `assignment_settings.trade_in_agent_id`, amplía `conversation_assignments_source_check` con `'reason'` y reemplaza `ai_handoff_assign` para que reciba el motivo.
- **Aplicación**: `src/lib/assignment/auto-assign.ts` (`aiHandoffAssign` pasa `p_reason`; `AssignmentSource` suma `'reason'`) y `src/lib/ai/auto-reply.ts` (`handOffToHuman` pasa `request.motivo`).
- **API**: `GET/PUT /api/assignment/settings` y `src/lib/assignment/settings.ts` leen, validan y guardan el ajuste nuevo.
- **UI**: `src/components/settings/assignment-settings.tsx` y su modelo, con una sección nueva, y los textos en `messages/es.json`.
- **Producción**: después del despliegue hay que elegir a Angélica en el ajuste. Hasta entonces el comportamiento no cambia.
