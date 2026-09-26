## 1. Base de datos

- [x] 1.1 Confirmar el siguiente número libre de migración (hoy la última es 542) y crear `supabase/migrations/543_trade_in_agent.sql` con encabezado explicativo, al estilo de la 534/537
- [x] 1.2 Agregar `assignment_settings.trade_in_agent_id UUID NULL`, con un `COMMENT`
- [x] 1.3 Ampliar `conversation_assignments_source_check` con `'reason'` (DROP y ADD idempotente)
- [x] 1.4 `DROP FUNCTION ai_handoff_assign(UUID, TEXT, TEXT)` y recrearla con `p_reason TEXT DEFAULT NULL`: ruta por motivo antes de `resolve_auto_agent`, override solo en el UPDATE de reasignación y reseteo inmediato, `source = 'reason'`
- [x] 1.5 En el caso `reason` con reasignación, mover a Angélica los negocios abiertos del contacto que tenía el asesor anterior (por `profiles.id`), dentro de `EXCEPTION WHEN OTHERS → WARNING`
- [x] 1.6 En el caso `reason` con reasignación, insertar la notificación "Tu cliente pasó a <primer nombre>" para el asesor anterior, dentro de `EXCEPTION WHEN OTHERS → WARNING`
- [x] 1.7 Repetir `OWNER`, `REVOKE` y `GRANT` de la 537 para la nueva firma
- [x] 1.8 Aplicar la migración en el stack local y probar por SQL los escenarios: lead nuevo, asesor vigente reemplazado, `kept`, motivo normal, ajuste vacío, persona que ya no es miembro, cuota intacta, negocio movido y aviso al asesor anterior

## 2. Aplicación

- [x] 2.1 `src/lib/assignment/auto-assign.ts`: `aiHandoffAssign` acepta `reason` y pasa `p_reason`; `AssignmentSource` y `SOURCES` suman `'reason'`
- [x] 2.2 `src/lib/ai/auto-reply.ts`: `handOffToHuman` pasa `request?.motivo ?? null`
- [x] 2.3 Pruebas: `parseAutoAssignResult` acepta `'reason'`, y el traspaso pasa el motivo a la RPC (actualizar los tests existentes de auto-assign y auto-reply)

## 3. API de ajustes

- [x] 3.1 `src/lib/assignment/settings.ts`: campo `trade_in_agent_id` (string o null), validación contra `memberIds` y código de error `tradeInAgentInvalid`
- [x] 3.2 `src/app/api/assignment/settings/route.ts`: GET devuelve `trade_in_agent_id` y `members` (owner, admin y agent con rol); PUT lee los miembros, valida y guarda en el mismo upsert
- [x] 3.3 Pruebas del parser: válido, `null`, no miembro y tipo inválido

## 4. UI

- [x] 4.1 `assignment-settings-model.ts`: el formulario, `formFromResponse`, `buildAssignmentPayload` (solo si cambió) y el mapeo del error al campo
- [x] 4.2 `assignment-settings.tsx`: tarjeta "Ventas y permutas" con un selector de miembros, la opción "Nadie (orden normal)" y un texto de ayuda
- [x] 4.3 Textos en `messages/es.json` (y en `en.json` si existe)
- [x] 4.4 Pruebas del modelo y de la vista con el catálogo real

## 5. Verificación

- [x] 5.1 `npm test` y `tsc` en verde
- [x] 5.2 (Cubierta por `supabase/tests/trade_in_agent.test.sql` y las pruebas de la app; desplegado el 2026-09-25 con Angélica configurada. Falta verlo con el primer traspaso real por venta o permuta.) Prueba punta a punta en local: una conversación asignada a un agent, un traspaso simulado con motivo `permuta` que termina en la admin configurada, más la nota, el aviso y el negocio
- [x] 5.3 Dejar anotado en la memoria de despliegue que en producción hay que elegir a Angélica en Ajustes → Asignación después de desplegar
