## Why

LoraMotors va a lanzar campañas en las que el mismo lead escribe muchas veces, a veces con semanas de diferencia y por canales distintos. Hoy ese lead puede caer cada vez en un asesor distinto: el asesor de una conversación se borra al devolverle el hilo al bot, un `agent` puede pasarle el cliente a un compañero, las automatizaciones y los flujos pisan al asesor que ya había, y el reparto automático es por carga (o un único "asesor fijo") en vez de la proporción que decide el dueño. Además las conversaciones que nadie toma se quedan sin asesor para siempre (177 abiertas en producción el 2026-09-23) y el embudo sigue vacío porque solo el traspaso de la IA crea negocios.

## What Changes

- **El asesor de un contacto es pegajoso (P2).** Una vez asignado, solo un `owner`/`admin` lo cambia a mano. Ningún camino automático —IA, automatizaciones, flujos, el job nuevo— pisa a un asesor que sigue siendo miembro de la cuenta, y la garantía vive también en la base. Una conversación nueva de un contacto que ya tiene asesor (otro canal) lo hereda. **BREAKING**: el `agent` deja de poder reasignar o soltar conversaciones, y el nodo de derivación de un flujo deja de reemplazar al asesor existente.
- **"Tener asesor" deja de callar al bot.** La elegibilidad de la IA depende solo de `ai_autoreply_disabled`. "Reactivar IA" ya no quita al asesor. El bot se pausa cuando el asesor escribe desde la bandeja, y la migración pausa las 71 conversaciones hoy asignadas con el bot activo para que el día del despliegue nada cambie.
- **El lead que vuelve habla primero con el bot y luego con su asesor.** Si entra un mensaje en una conversación pausada que llevaba N días sin actividad (7 por defecto, configurable), el bot se reactiva para ese entrante, solo si su asesor es `agent` o no tiene asesor (con un `owner`/`admin`, como los propietarios de Angélica, nunca). Cuando traspasa, el hilo sigue con el mismo asesor y este recibe un aviso.
- **Reparto por porcentajes (P3).** Configuración por cuenta de asesores `agent` con su porcentaje (enteros que suman 100, validado en API y en base). Algoritmo determinista y auditable basado en el historial de asignaciones. Prioridad: continuidad del contacto → porcentajes. Reemplaza al reparto por carga, al "asesor fijo" de Ajustes (que pasa a ser 100 % a una persona) y al `round_robin` falso de las automatizaciones.
- **Asignación de conversaciones olvidadas (P4).** Un job de cron (cada 5 minutos) asigna, con las reglas de P3, las conversaciones que llevan X **horas** sin asesor —3 en producción, activado al desplegar— y solo las que quedaron sin asesor después de activarse la regla: el rezago previo no se toca nunca.
- **Negocio automático en toda asignación (P5).** Toda asignación a un asesor, y todo traspaso de la IA, abre un negocio en la primera etapa del embudo por defecto (Ventas / Prospecto) si el contacto no tiene uno abierto, asignado al asesor. El traspaso conserva su título rico.
- **Contrato de API para la pantalla de Ajustes** (la pantalla la hace frontend después).

## Capabilities

### New Capabilities

- `sticky-contact-assignment`: el asesor pertenece al contacto; herencia entre canales; solo `owner`/`admin` lo cambian; los caminos automáticos no lo pisan (código y base).
- `weighted-auto-assignment`: configuración por porcentajes, su validación, el algoritmo determinista y la asignación automática unificada (continuidad → preferido → porcentajes).
- `stale-conversation-assignment`: el job de P4, su configuración y su seguridad ante concurrencia.
- `returning-lead-bot-reactivation`: la IA ya no depende del asesor; pausa cuando el asesor escribe; reactivación por inactividad.
- `assignment-deal-creation`: el negocio que nace con cada asignación o traspaso, por contacto y sin perder el título del traspaso.

### Modified Capabilities

- `ai-reply-gating`: se quita la compuerta "conversación asignada a un humano".
- `ai-handoff-assignment`: el traspaso usa continuidad por contacto y porcentajes en vez de carga y asesor fijo; avisa al asesor cuando su cliente vuelve.
- `conversation-visibility`: el `agent` ya no reasigna ni suelta; la interfaz no se lo ofrece.
- `flow-handoff-routing`: el nodo de derivación deja de reemplazar a un asesor vigente.

## Impact

**Base de datos** — migraciones 534 a 539 (tabla de configuración y de porcentajes con RLS y `GRANT`, columnas de origen en `conversation_assignments`, triggers de herencia, protección y negocio, RPC de asignación automática, de reactivación y del job, y la siembra de datos).

**Código:**
- `src/lib/ai/auto-reply.ts`, `src/lib/ai/pick-agent.ts`, `src/lib/ai/handoff-deal.ts` — el traspaso pasa por la RPC.
- `src/lib/automations/engine.ts`, `src/lib/flows/engine.ts` — asignan por la RPC.
- `src/lib/inbound/core.ts` — reactivación del bot para el lead que vuelve.
- `src/lib/whatsapp/send-message.ts` — el mensaje del asesor pausa el bot.
- `src/lib/inbox/assignment.ts`, `PATCH /api/conversations/[id]/assignee`, `POST /api/ai/autoreply/[id]` — reglas nuevas, sin service-role.
- `src/components/inbox/message-thread.tsx`, `src/components/inbox/ai-thread-banner.tsx`, `src/lib/auth/roles.ts`, `src/hooks/use-can.ts`.
- Rutas nuevas: `GET/PUT /api/assignment/settings`, `GET /api/assignment/cron`; `deploy/cron/crontab`.
- `messages/{es,en,ko}.json`.

**Operación:** al desplegar hay que reiniciar el contenedor `cron` (lee el crontab al arrancar). Con 3 horas, el volumen actual produce ≈ 25 asignaciones automáticas y ≈ 25 negocios Prospecto por día (ver design.md, decisión 8).
