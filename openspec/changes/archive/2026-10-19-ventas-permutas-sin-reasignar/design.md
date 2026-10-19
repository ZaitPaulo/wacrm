## Context

La migración 543 (`asesor-ventas-y-permutas`) hace que `ai_handoff_assign`, con motivo `vende_su_carro` o `permuta`, elija al asesor configurado **antes** del orden normal. Si hace falta, reemplaza a un asesor vigente con `crm.assignment_override`, mueve su negocio abierto y le avisa. El Director cambió la regla el 2026-09-26: a un cliente con asesor no se le cambia nada automáticamente.

En producción la 543 está aplicada, Angélica está configurada y hay 0 asignaciones con `source = 'reason'`. No queda ningún efecto que deshacer.

## Goals / Non-Goals

**Goals:**

- Que el asesor de ventas y permutas sea un paso más del orden normal, **después** de conservar y de la continuidad y antes de los porcentajes.
- Quitar todo lo que solo existía para la reasignación: override, aviso al anterior y traslado de negocio.

**Non-Goals:**

- Cambiar el ajuste, la API o la pantalla, fuera del texto de ayuda.
- Tocar `resolve_auto_agent` ni los otros caminos automáticos.

## Decisions

### 1. Reusar el paso "preferido" de `resolve_auto_agent`

`resolve_auto_agent(account, contact, current, p_preferred_agent, allow_weighted)` ya tiene exactamente este orden: conservar → continuidad → **preferido** → porcentajes. Con venta o permuta, `ai_handoff_assign` le pasa `trade_in_agent_id` como preferido. Si el resultado es `preferred`, lo registra como `'reason'`, para que el historial distinga esta ruta de la de automatizaciones y flujos.

*Alternativa descartada:* reimplementar el orden dentro de `ai_handoff_assign`. Duplicaría la regla que la 537 centralizó a propósito.

`resolve_auto_agent` valida al preferido con `is_active_member`, que acepta owner, admin y agent. Eso sirve para Angélica, que es admin.

### 2. Migración 544 que reescribe la función con la misma firma

`CREATE OR REPLACE` con la firma de cuatro parámetros de la 543. Sin DROP, sin cambios de permisos y sin tocar el esquema. El cuerpo vuelve a ser el de la 537, más el preferido y el cambio de `preferred` a `reason`. Desaparecen `v_takeover`, el override, el UPDATE de `deals` y el aviso "Tu cliente pasó a …".

La columna `trade_in_agent_id` y el valor `'reason'` del CHECK se quedan: siguen en uso.

## Risks / Trade-offs

- **[Un cliente con asesor que quiere vender su carro no llega a Angélica]** → Es lo que decidió el Director. El asesor lo ve en la nota del traspaso ("Motivo: quiere vender su carro") y un admin lo reasigna si hace falta.
- **[Continuidad con admins]** → `contact_continuity_agent` ignora a los admin. Por eso un cliente que Angélica atendió antes y vuelve por otro canal no tiene continuidad hacia ella. Si vuelve a venta o permuta, le llega igual por el paso 3. Si es por otro motivo, va a porcentajes. Es el mismo comportamiento de antes.

## Migration Plan

1. `544_trade_in_agent_only_unassigned.sql`. Antes, verificar que la 544 esté libre en el repo y en el VPS.
2. Desplegar cuando el usuario lo ordene: respaldo → pull → `apply-migrations.sh --dry-run` (solo la 544) → aplicar → rebuild, por el texto de ayuda.
3. Rollback: volver a aplicar el cuerpo de la función de la 543.
