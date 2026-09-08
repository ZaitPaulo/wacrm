## Context

`handOffToHuman` (`src/lib/ai/auto-reply.ts:296`) asigna así:

```ts
if (args.handoffAgentId && !args.assignedAgentId) {
  update.assigned_agent_id = args.handoffAgentId
}
```

Un solo campo, elegido a mano en Ajustes. En producción apunta a una admin que ya carga las 3 conversaciones asignadas de la cuenta, mientras los tres miembros con rol `agent` están en cero.

El aviso al cliente sale de `notify-customer.ts`, que lee un texto fijo del catálogo (`Handoff.customerNotice`). La notificación al asesor la escribe el trigger SQL `notify_conversation_assigned` (migración 027), que compone el cuerpo con `auth.uid()` — NULL cuando asigna la IA con el service role, de donde sale el "Someone assigned you...".

La membresía vive en `profiles` (`account_id`, `account_role`, `full_name`); no hay tabla de miembros aparte.

## Goals / Non-Goals

**Goals:**

- Repartir las transferencias por carga real en vez de amontonarlas en una persona.
- Que el cliente sepa el nombre de quien lo va a atender.
- Que el asesor abra la notificación sabiendo qué quiere el cliente.

**Non-Goals:**

- Horarios de disponibilidad por asesor. Un asesor de vacaciones seguirá siendo candidato; eso necesita un modelo de turnos que no existe.
- Reasignar conversaciones ya asignadas para equilibrar. El reparto decide en el momento de transferir y no vuelve a tocar el hilo.
- Cambiar cuándo procede una transferencia: de eso se ocupa `ai-handoff-readiness` y no se toca.
- Notificaciones push o por correo. Esto escribe en la campana del CRM, que es donde el usuario pidió verlo.

## Decisions

### Carga = conversaciones abiertas asignadas

Se cuenta `conversations` con `assigned_agent_id = <miembro>` y `status = 'open'`. Es la definición que ya usa el resto del producto y la que corresponde a "cuánto tiene encima ahora mismo".

Se descartó contar todas las conversaciones históricas: castigaría para siempre al asesor que más ha atendido. Y se descartó el round-robin puro porque no mira la realidad — reparte parejo aunque un asesor tenga diez hilos vivos y otro ninguno.

### Empate por antigüedad, no aleatorio

Con todos en cero —el caso del primer día— hace falta un criterio. `profiles.created_at` ascendente da una elección determinista y reproducible en tests, y se autoequilibra sola: en cuanto el elegido recibe una conversación deja de estar empatado y el siguiente pasa al frente.

Se descartó el azar: hace el comportamiento imposible de testear y de explicar cuando alguien pregunta por qué le llegó a él.

### `handoff_agent_id` mantiene la precedencia

Configurar un asesor fijo es una decisión explícita de un admin, y hacer que el reparto la ignore convertiría un despliegue en un cambio silencioso de a quién le llegan los clientes.

El costo es que el reparto no se activa solo: hay que vaciar ese campo en producción, y queda anotado como paso de despliegue. A cambio, cualquier cuenta que hubiera configurado un asesor a propósito sigue funcionando igual.

### Candidatos: `agent` y `admin`, sin `owner`

En una concesionaria chica los admin atienden — la que hoy recibe todas las transferencias es admin. El `owner` es la cuenta del dueño del CRM y meterlo en el reparto le mandaría clientes a quien administra el sistema.

Si no hay ningún candidato, la conversación cae en la cola compartida y el aviso al cliente vuelve a la forma anónima. Nunca se promete un nombre inexistente.

### El nombre al cliente es solo el primer nombre

"Juan Marino Arias Medina" en un WhatsApp comercial suena a registro civil. Se toma el primer token de `full_name`, que es como se presenta un vendedor.

El catálogo gana una segunda forma del aviso, con nombre, en vez de concatenar el nombre al texto existente: así cada idioma decide dónde va el nombre en la frase.

### El resumen viaja por la columna, no por el trigger

`ai_handoff_summary` se escribe en el MISMO `UPDATE` que `assigned_agent_id`, así que dentro del trigger `NEW.ai_handoff_summary` ya trae el resumen. La migración solo cambia cómo se compone el cuerpo:

- `auth.uid()` NULL y `ai_handoff_summary` presente → asignación de la IA: el cuerpo es el resumen.
- En cualquier otro caso → el texto actual entre personas.

No hace falta que la aplicación escriba la notificación: sigue siendo trabajo del trigger, que es donde ya vivía.

## Risks / Trade-offs

- **Dos transferencias simultáneas pueden ir al mismo asesor** → la carga se lee antes de escribir y no hay bloqueo. Con el volumen de una concesionaria el desbalance máximo es de una conversación, y se corrige en la siguiente transferencia. Un lock por asignación costaría más de lo que arregla.
- **Un asesor ausente sigue recibiendo** → sin modelo de turnos no hay forma de saberlo; queda anotado como no-goal y el admin puede reasignar a mano.
- **Vaciar `handoff_agent_id` cambia a quién le llegan los clientes** → es el efecto buscado, pero debe hacerse a la vista y no como consecuencia oculta del despliegue.
- **El nombre del asesor sale al cliente** → es información que de todos modos verá cuando esa persona le escriba.

## Migration Plan

1. Migración `520_ai_handoff_notification.sql`: redefine `notify_conversation_assigned`, idempotente.
2. Desplegar el código.
3. Vaciar `ai_configs.handoff_agent_id` para activar el reparto.
4. Rollback: revertir el despliegue y, si hace falta, volver a configurar el asesor fijo desde Ajustes. La migración anterior de la función se restaura reaplicando la 027.

## Open Questions

- ¿Debería el reparto respetar el horario de atención del negocio (8-18 L-V) y dejar en cola compartida fuera de él? Hoy no, porque el aviso al cliente ya no promete inmediatez.
- ¿Conviene una vista en el CRM que muestre la carga por asesor? Sería el siguiente paso natural, fuera de este cambio.
