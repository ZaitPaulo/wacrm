-- ============================================================
-- 519_ai_handoff_attempts.sql
--
-- Intentos de transferencia rechazados por el gate de datos.
--
-- Agrega la columna `ai_handoff_attempts` en `conversations`. La cuenta
-- lleva el auto-reply de IA: cada vez que el modelo pide transferir la
-- conversación a un asesor y el gate la rechaza por datos incompletos,
-- el contador sube.
--
-- Para qué sirve:
--   El gate exige nombre, presupuesto, vehículo de interés y si
--   requiere crédito antes de transferir. Cuando el motivo es urgente
--   —un reclamo, o que el cliente pidió hablar con una persona— solo se
--   exige el nombre. Un cliente que se niega a darlo dejaría al bot
--   pidiéndolo en cada turno mientras la urgencia crece, así que al
--   segundo intento urgente se transfiere igual. Ese "segundo" es lo
--   que este contador hace posible saber: el historial de mensajes no
--   distingue un turno normal de un intento de transferencia.
--
-- Decisiones de diseño:
--   * NOT NULL DEFAULT 0: toda conversación arranca sin intentos, y el
--     código puede sumar sin comprobar NULL. Postgres 11+ resuelve el
--     default sin reescribir la tabla, así que no bloquea `conversations`.
--   * Se resetea junto con `ai_handoff_summary` cuando un agente
--     reactiva el auto-reply del hilo: reactivar deja la conversación
--     como nueva a ojos del gate.
--   * El código tolera que la columna no exista todavía solo en el
--     sentido de que un despliegue previo a esta migración nunca la
--     lee; aplicar la migración antes de desplegar es el orden correcto.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN conversations.ai_handoff_attempts IS
  'Cuántas veces el gate de datos rechazó una transferencia a asesor pedida por el auto-reply de IA. Habilita el escape al segundo intento urgente; se resetea al reactivar el auto-reply del hilo.';
