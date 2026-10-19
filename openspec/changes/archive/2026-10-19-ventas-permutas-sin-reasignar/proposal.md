## Why

El cambio `asesor-ventas-y-permutas` (desplegado el 2026-09-25) manda todo traspaso por venta o permuta al asesor configurado (Angélica), **aunque el cliente ya tenga asesor**, y se lo quita al anterior. Decisión del Director del 2026-09-26: un cliente que ya tiene asesor no se reasigna nunca de forma automática. El asesor configurado solo recibe a los clientes que **no tienen asesor**. Si alguno tiene que pasar a Angélica, lo mueve a mano un admin.

## What Changes

- **BREAKING (respecto del 2026-09-25):** el traspaso por `vende_su_carro` o `permuta` deja de reemplazar a un asesor vigente. El orden pasa a ser: conservar el asesor de la conversación → asesor de continuidad del contacto → **asesor de ventas y permutas** (solo con esos motivos) → porcentajes.
- Se quitan la reasignación con override, el aviso "Tu cliente pasó a …" y el traslado del negocio abierto al asesor nuevo. Ya no tienen sentido, porque nunca se le quita un cliente a nadie.
- La guarda de la 535 vuelve a no tener excepciones automáticas.
- El texto de ayuda del ajuste en Ajustes → Asignación cambia para decir que solo aplica a clientes sin asesor.
- Se conservan el ajuste `trade_in_agent_id`, su pantalla y `source = 'reason'` en el historial, que no consume cuota.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `handoff-reason-routing`: el asesor de ventas y permutas solo se elige cuando el cliente no tiene asesor. Se eliminan los requisitos del aviso al asesor anterior y del traslado del negocio.
- `sticky-contact-assignment`: se elimina la excepción del traspaso por venta o permuta; ningún camino automático cambia a un asesor vigente.

## Impact

- **Base de datos:** migración 544, que reemplaza `ai_handoff_assign` con la misma firma de cuatro parámetros. No hay cambios de esquema.
- **Aplicación:** sin cambios de lógica; `auto-reply.ts` ya pasa el motivo.
- **UI:** el texto de ayuda en `messages/{es,en,ko}.json`.
- **Pruebas:** `supabase/tests/trade_in_agent.test.sql`.
- **Producción:** no hay traspasos con `source = 'reason'` todavía (0 al 2026-09-26), así que no hay reasignaciones que deshacer.
