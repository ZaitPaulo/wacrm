## 1. Elegir asesor por carga

- [x] 1.1 Tests de `pickHandoffAgent`: cargas distintas, empate por antigüedad, owner excluido, solo cuentan las abiertas, sin candidatos
- [x] 1.2 Implementar `src/lib/ai/pick-agent.ts` consultando `profiles` (rol `agent`/`admin` de la cuenta) y contando conversaciones `open` por asesor
- [x] 1.3 Devolver también el `full_name`, que hace falta para el aviso al cliente

## 2. Conectar la elección a la transferencia

- [x] 2.1 Tests en `auto-reply.test.ts`: con `handoff_agent_id` configurado gana ese; sin él, gana el de menos carga; una asignación humana existente no se pisa
- [x] 2.2 `handOffToHuman` resuelve el destinatario antes de escribir, y pasa el nombre a `notifyCustomerOfHandoff`

## 3. Aviso al cliente con nombre

- [x] 3.1 Añadir `Handoff.customerNoticeNamed` a `messages/es.json`, `en.json` y `ko.json`
- [x] 3.2 `notifyCustomerOfHandoff` acepta el nombre del asesor y elige la forma con o sin nombre
- [x] 3.3 Usar solo el primer nombre del `full_name`
- [x] 3.4 Cubierto desde `auto-reply.test.ts` (con nombre, con asesor fijo, sin asesores); `notify-customer` no tenía suite propia

## 4. Resumen en español

- [x] 4.1 Traducir `buildHandoffSummary` a español y actualizar sus tests

## 5. Notificación al asesor con el resumen

- [x] 5.1 Migración `520_ai_handoff_notification.sql` que redefine `notify_conversation_assigned`: si `auth.uid()` es NULL y hay `ai_handoff_summary`, el cuerpo es el resumen; si no, el texto actual
- [x] 5.2 Título propio para la asignación por IA, distinguible en la campana

## 6. Cierre

- [x] 6.1 Suite completa, typecheck y lint
- [ ] 6.2 Aplicar la migración y desplegar
- [ ] 6.3 Vaciar `ai_configs.handoff_agent_id` en producción para activar el reparto
- [ ] 6.4 Probar una transferencia real: verificar a quién se asignó, qué le llegó al cliente y qué le llegó al asesor en la campana
