## Context

Hoy el asesor de un traspaso lo elige la base, dentro de `ai_handoff_assign` (migración 537), con `resolve_auto_agent`: conservar al asesor vigente → continuidad del contacto → preferido → porcentajes. El motivo del traspaso (`HandoffRequest.motivo`) vive solo en TypeScript y no llega a la RPC.

Hay tres piezas de la base que condicionan el diseño:

- **La guarda de la 535** (`protect_sticky_assignment`): sin sesión, un UPDATE no puede reemplazar a un asesor vigente, salvo con `crm.assignment_override = 'on'` en la transacción.
- **Angélica es `admin`, no `agent`.** `is_active_member` la acepta (por eso ningún proceso le quita las conversaciones de propietarios), pero `is_assignable_agent` y `contact_continuity_agent` solo aceptan `agent`. El trigger de la 536 tampoco crea negocio cuando el asignado es owner o admin. El negocio del traspaso sí se crea, porque `ai_handoff_assign` llama a `ensure_open_deal_for_contact` directamente.
- **La cuota del reparto** cuenta solo las filas del historial con `source = 'weighted'`.

## Goals / Non-Goals

**Goals:**

- Que los traspasos `vende_su_carro` y `permuta` terminen en el asesor configurado, aunque la conversación ya tenga asesor.
- Que sea configurable desde la UI, sin despliegue para cambiar de persona.
- Todo dentro de la misma transacción que hoy (asignación, negocio, pausa y nota).

**Non-Goals:**

- Cambiar el prompt o las reglas del gate de datos (`ai-handoff-readiness`).
- Rutas por motivo para otros motivos (crédito, papeles…). El diseño deja la puerta abierta, pero no se construye una tabla motivo → asesor.
- Que Angélica pase a ser el asesor de continuidad del contacto en otros canales. `contact_continuity_agent` sigue exigiendo `agent`; ver Riesgos.

## Decisions

### 1. Una columna en `assignment_settings`, no una tabla de rutas

`assignment_settings.trade_in_agent_id UUID NULL` (sin FK, igual que `assigned_agent_id` y `assignment_weights.user_id`). El pedido es un solo asesor para dos motivos. Una tabla `motivo → asesor` sería más general, pero agrega UI y validaciones que nadie pidió. Si mañana piden otra ruta, se migra.

*Alternativa descartada:* reusar las automatizaciones (acción "asignar" con condición por motivo). No existen disparadores por motivo de traspaso, y las automatizaciones no pueden pasar la guarda: justamente por eso existe.

### 2. El motivo entra a la RPC; la regla vive en SQL

`ai_handoff_assign(p_conversation_id, p_summary, p_deal_title, p_reason TEXT DEFAULT NULL)`. Con un DEFAULT, la llamada vieja sigue funcionando entre la migración y el despliegue del código. Dentro, antes de `resolve_auto_agent`:

```
IF p_reason IN ('vende_su_carro','permuta')
   AND is_active_member(account, settings.trade_in_agent_id) THEN
  pick := (trade_in_agent_id, 'reason')
ELSE
  pick := resolve_auto_agent(...)   -- sin cambios
```

La lista de motivos va en la función y no en la aplicación: la elección de asesor ya es de la base (decisión 3 de `sticky-weighted-assignment`), y separarla en dos lugares es como divergen.

`CREATE OR REPLACE` con otra firma crea una sobrecarga. Por eso la migración hace `DROP FUNCTION ai_handoff_assign(UUID, TEXT, TEXT)` antes de crear la de cuatro parámetros, y repite los `REVOKE`/`GRANT` y el `OWNER` de la 537.

### 3. Pasar la guarda con el override, solo en esa escritura

Si el asesor actual es vigente y distinto del configurado, la RPC hace `set_config('crm.assignment_override','on', true)`, ejecuta el UPDATE (asesor + pausa + nota, igual que hoy) y lo vuelve a `''` inmediatamente. Así la excepción queda en el mismo mecanismo auditado que usan los operadores, sin tocar la guarda.

*Alternativa descartada:* que la guarda reconozca `crm.assignment_source = 'reason'`. Eso le daría a cualquier escritura sin sesión una segunda forma de saltarla con solo fijar un ajuste.

Si el asesor actual ya es el configurado, el resultado es `kept` y sale el aviso propio de la 537 ("Tu cliente pidió un asesor").

### 4. `source = 'reason'` en el historial

Se amplía `conversation_assignments_source_check` con `'reason'` (DROP y ADD del constraint, idempotente). No cuenta para la cuota, porque `pick_weighted_agent` solo lee `'weighted'`. En TypeScript, `AssignmentSource` y `SOURCES` suman `'reason'`. Si no, `parseAutoAssignResult` devolvería `source: null`, que es inofensivo pero engañoso.

### 5. El negocio sigue a la conversación

Hoy, si el contacto ya tiene un negocio abierto, `ensure_open_deal_for_contact` devuelve `already_open` y el negocio se queda con el asesor anterior. En el caso `reason` con reasignación, la RPC hace además `UPDATE deals SET assigned_to = <profile de Angélica>` sobre los negocios **abiertos** del contacto cuyo `assigned_to` es el profile del asesor anterior, dentro de un bloque `EXCEPTION WHEN OTHERS → WARNING` como el del negocio. Los negocios de otros asesores no se tocan: pueden ser otra compra.

`deals.assigned_to` apunta a `profiles.id`, no a `auth.users.id` (ya hubo un bug por confundirlos).

### 6. Aviso al asesor que pierde la conversación (decisión del Director, 2026-09-25)

En el caso `reason` con reasignación, la RPC inserta en `notifications` una fila para el asesor anterior: `type = 'conversation_assigned'`, título "Tu cliente pasó a <primer nombre>" y cuerpo con el contacto y el motivo. Va dentro de `EXCEPTION WHEN OTHERS → WARNING`, igual que el aviso `kept` de la 537. Se reutiliza el tipo existente en vez de crear uno nuevo, para no tocar el constraint de la 541, la página de notificaciones ni el push: con eso le llega también la notificación push de la 542.

*Alternativa descartada:* un tipo `conversation_unassigned`. Sería más preciso, pero obliga a tocar el constraint, la UI y el payload del push para un solo aviso.

### 7. API y UI

- `GET` devuelve `trade_in_agent_id` y `members`: owner, admin y agent, con nombre y rol. `agents` no alcanza porque Angélica es admin.
- `PUT` acepta `trade_in_agent_id: string | null`. `parseAssignmentSettingsInput` recibe `memberIds` y lo valida con un código nuevo, `tradeInAgentInvalid`, que tiene su clave i18n. Se guarda en el mismo upsert que las horas y los días.
- La UI agrega una tarjeta **"Ventas y permutas"** con un `Select` de miembros más "Nadie (orden normal)", y un texto de ayuda: "Los clientes que quieren vender su carro o entregarlo en permuta van siempre a esta persona, aunque ya tengan asesor."

## Risks / Trade-offs

- **[Angélica no queda como asesora de continuidad en otros canales]** → Si el mismo cliente escribe luego por Instagram, `contact_continuity_agent` ignora a los admin y ese hilo puede ir por porcentajes. Se acepta: si el nuevo traspaso vuelve a ser por venta o permuta, llega igual a ella. Cambiar la continuidad para admins afectaría la campaña de propietarios.
- **[El modelo clasifica mal el motivo]** → Una permuta etiquetada `credito` no llega a Angélica. Sale del alcance: el prompt ya distingue los motivos. Se puede revisar después con `ai_handoff_summary`.
- **[Se le quita el cliente a un asesor que lo venía trabajando]** → Es lo que decidió el Director. El historial lo deja registrado con `source = 'reason'` y la conversación sigue visible para admins.
- **[Ventana entre migración y código]** → Por el DEFAULT de `p_reason`, la RPC nueva con el código viejo se comporta como antes.
- **[Carga de trabajo de Angélica]** → No hay tope ni respaldo si está ausente. Si hace falta, el ajuste se vacía y todo vuelve al orden normal.

## Migration Plan

1. Migración `543_trade_in_agent.sql` (verificar que no exista otra 543; ver la memoria de colisiones): columna, constraint de `source` y la RPC con cuatro parámetros. Es idempotente.
2. Desplegar el código.
3. En producción, Ajustes → Asignación → elegir a Angélica.
4. Rollback: vaciar el ajuste, con lo que el comportamiento vuelve a ser el de antes. Para el rollback completo, restaurar la RPC de la 537 con tres parámetros; la columna y el valor extra del constraint no molestan.

## Open Questions

- ¿Angélica tiene el mismo alcance en la bandeja para ver estas conversaciones? Como admin sí, pero conviene confirmarlo en la prueba.
