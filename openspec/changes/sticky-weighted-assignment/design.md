## Context

Este cambio se apoya en `agent-performance-dashboard` (commit `0b209ee`, migraciones 531-533, **sin desplegar**): la tabla append-only `conversation_assignments` alimentada por trigger, la continuidad por historial de `pickHandoffAgent`, el negocio del traspaso (`createHandoffDeal`) y el índice `idx_deals_one_open_per_conversation`.

Estado de producción leído el 2026-09-23 (solo lectura):

| Dato | Valor |
|---|---|
| Miembros | 1 owner, 3 admin, 3 agent |
| Conversaciones abiertas sin asesor | 177 (IA activa) |
| Asignadas con IA activa | **71** (68 de Angélica —admin, campaña de propietarios— y 3 de Brayan) |
| Asignadas con IA pausada | 66 |
| `ai_configs.handoff_agent_id` | NULL |
| Contactos con más de una conversación | 0 |
| `deals` | 0 filas; un solo embudo, "Ventas" |
| Última migración aplicada | 529 |

Hoy "tener asesor" y "bot callado" son lo mismo: `dispatchInboundToAiReply` se abstiene si `assigned_agent_id` no es NULL, y "Reactivar IA" borra al asesor para que el bot pueda hablar. P2 (asesor pegajoso) rompe esa equivalencia, y es la raíz de casi todas las decisiones de abajo.

Caminos que escriben `assigned_agent_id` hoy: traspaso de la IA (`auto-reply.ts`), `assign_conversation` de automatizaciones (con un `round_robin` que devuelve el primer perfil), los dos caminos de derivación de flujos (el nodo **pisa** al asesor), `PATCH /assignee` y `POST /api/ai/autoreply` (con service-role para los `agent`). Caminos que **crean** conversaciones: `inbound/core.ts`, `whatsapp/resolve-conversation.ts`, `whatsapp/send/route.ts`, `automations/meta-send.ts`, `flows/meta-send.ts`, `contacts/identity-links.ts`… (más de seis).

## Goals / Non-Goals

**Goals:**

- Que un lead caiga siempre con el mismo asesor, por cualquier canal y cualquier camino, salvo decisión manual de un `owner`/`admin`.
- Que el reparto automático siga la proporción que decide el dueño, de forma determinista y auditable desde el historial.
- Que ninguna conversación se quede sin asesor para siempre, sin repartir de golpe lo que ya existe.
- Que el embudo se llene solo con cada asignación, sin duplicar ni perder el título rico del traspaso.
- Que el día del despliegue nada cambie de comportamiento hasta que un admin configure.

**Non-Goals:**

- La pantalla de Ajustes (porcentajes, X horas, N días): la hace frontend con el contrato de abajo.
- Mover el negocio abierto cuando un admin reasigna la conversación a otro asesor.
- Reconstruir historial anterior a la 531.
- Retirar la columna `ai_configs.handoff_agent_id` o su selector en `ai-config.tsx` (ver Riesgos).

## Decisions

### 1. La IA depende solo de `ai_autoreply_disabled`; el asesor que escribe la pausa

Se quita la compuerta `if (conv.assigned_agent_id) return` y "Reactivar IA" deja de tocar al asesor (decisión 1 del Tech Lead).

Eso deja un hueco que el encargo no nombra: ¿qué calla al bot cuando un asesor asignado por el job, una automatización o un admin empieza a atender? Antes lo hacía la asignación. **Decisión: lo hace el primer mensaje humano.** `sendMessage` ya pausa los flujos cuando escribe un asesor ("the strongest yield, human is here signal"); ahora, cuando el saliente lleva `sender_id` (una persona de la bandeja), el mismo UPDATE de la conversación pone `ai_autoreply_disabled = true`. Los envíos sin persona (IA, automatizaciones, flujos, API v1) no pausan.

*Alternativa:* pausar en cada asignación manual. Rechazada: no cubre el job ni las automatizaciones, y un lead asignado por el job a las 3 a. m. se quedaría sin respuesta hasta que el asesor llegue.

**Migración de datos obligatoria:** hay 71 conversaciones asignadas con la IA activa, 68 de ellas son propietarios de la campaña de Angélica. Sin pausarlas, el día del despliegue el bot empezaría a venderles carros a los propietarios. La 539 las pausa (`ai_autoreply_disabled = true`), lo que reproduce exactamente el comportamiento de hoy.

### 2. Reactivación del bot para el lead que vuelve: RPC atómica, medida contra el propio entrante

`reactivate_ai_for_returning_lead(conversation_id, inbound_message_id)` hace en un solo UPDATE: si la IA está pausada, la cuenta tiene N no nulo, y el último mensaje **anterior al entrante** (`created_at <` el del entrante, cualquier remitente) es de hace más de N días, pone `ai_autoreply_disabled = false`, `ai_reply_count = 0`, `ai_handoff_attempts = 0`. Conserva asesor y nota.

**Solo si el asesor es `agent`, o no hay asesor** (decisión del Director del 2026-09-23). Si el hilo es de un `owner`/`admin` vigente —los ~69 propietarios de Angélica—, el bot nunca se reactiva solo: a un propietario que vuelve no se le habla como a un comprador. Un asesor que ya dejó la cuenta cuenta como "sin asesor". La regla vive en la RPC (538), no en TypeScript.

Se mide contra el `created_at` del entrante y no contra `now()` ni contra `last_message_at`: en una ráfaga procesada en paralelo, el segundo mensaje ve al primero como "anterior" y no reactiva de nuevo, cualquiera sea el orden en que se procesen; y un reenvío de Meta (replay) ni llega a esta llamada porque `persistInbound` lo corta antes. Se invoca en `fanOutInbound` antes de los flujos y la IA, best-effort (un fallo no cuesta el mensaje).

No se usa el `referral` (decisión del Tech Lead). N vive en `assignment_settings.bot_reactivate_after_days`, 7 por defecto, nulo = desactivado.

### 3. Toda la asignación automática en una sola función de base de datos

`auto_assign_conversation(conversation_id, origin, preferred_agent, allow_weighted)` bloquea la conversación (`FOR UPDATE`), toma un candado consultivo por cuenta (`pg_advisory_xact_lock`), y resuelve en orden: **conservar asesor vigente → continuidad del contacto → preferido → porcentajes**. Escribe la asignación con `crm.assignment_source` / `crm.assignment_origin` en la transacción, que el trigger de historial (531, ampliado) copia a las columnas nuevas `source` y `origin` y luego limpia.

*Por qué en SQL y no extendiendo `pickHandoffAgent` en TypeScript (el encargo sugería extenderlo):* (a) la cuota solo es correcta si la lectura del historial y la escritura ocurren bajo el mismo candado —dos traspasos simultáneos en TS leerían la misma cuenta y elegirían al mismo asesor—; (b) la herencia al crear conversaciones (decisión 4) necesita la misma regla de continuidad dentro de un trigger, y tener dos implementaciones que deben coincidir es cómo divergen. `pickHandoffAgent` desaparece; `primerNombre` y el tipo `HandoffAgent` se quedan. `src/lib/assignment/auto-assign.ts` envuelve la RPC y traduce su `jsonb` a un tipo con un parser puro probado.

"Asesor **vigente**" para conservar = miembro con rol `owner`, `admin` o `agent` (Angélica es admin y sus 69 conversaciones no deben poder ser tomadas por el job). "Asesor de **continuidad**" = el último `to_agent_id` no nulo del historial de **cualquier** conversación del contacto, solo si sigue siendo `agent` (misma regla de la 531, subida a contacto). Las filas de devolución al bot (`to_agent_id` NULL) se ignoran: antes de este cambio "Reactivar IA" las generaba y no deben romper la continuidad.

`allow_weighted = false` lo usan los flujos: una derivación sin asesor configurado nunca repartió, y no empieza a hacerlo (el job de P4 la recoge si queda olvidada).

### 4. Herencia por contacto: trigger `BEFORE INSERT`

Una conversación nueva sin asesor de un contacto con asesor de continuidad lo hereda en el propio INSERT (`inherit_contact_agent`). Trigger y no código porque hay más de seis caminos que crean conversaciones y el siguiente que se agregue nacería olvidado — mismo argumento que la 531. La herencia no pausa la IA: el cliente que escribe por un canal nuevo lo atiende el bot y, al traspasar, `auto_assign_conversation` conserva al asesor heredado.

### 5. La garantía de "no pisar" también en la base

Trigger `BEFORE UPDATE OF assigned_agent_id` (`protect_sticky_assignment`): si la escritura viene sin sesión (`auth.uid()` NULL: service-role o `psql`), el asesor anterior es vigente y el nuevo es distinto, **conserva el anterior** y emite un `WARNING`. No lanza: un flujo que escribe `status = 'pending'` y asesor en el mismo UPDATE debe seguir pasando a `pending`. Las sesiones no pasan por la guarda porque ahí ya mandan la RLS, el trigger de la 520 y los endpoints (solo admin). Escape explícito para operadores: `SET LOCAL crm.assignment_override = 'on'`.

Igual que la 520 con los `agent`: el código ya respeta la regla (la RPC conserva al vigente), y la base la sostiene frente al camino que alguien agregue mañana.

### 6. Solo owner/admin reasignan; se retira el service-role de la bandeja

`PATCH /assignee` pasa a `requireRole('admin')` y escribe con la sesión (el admin ve toda la cuenta, la RLS lo deja, y el aviso conserva su nombre). `POST /api/ai/autoreply` ya no cambia al asesor al reactivar, así que tampoco necesita service-role: un `agent` que pausa o reactiva su propio hilo deja una fila que sigue viendo. "Tomar el control" con `assign_to_me` solo asigna si la conversación no tenía asesor; nunca reemplaza. Se retiran `escribeConServiceRole`, `esDevolucionAlBot` y `puedeDejarSinAsignar` y el código `ai_already_active` (reactivar dos veces ya es inocuo). Nueva regla pura `puedeControlarIa` (admin, o el `agent` asignado). En la bandeja, `useCan('reassign-conversations')` decide si se muestra el desplegable; el `agent` ve el nombre como texto.

### 7. Porcentajes: tabla propia, reemplazo atómico por RPC y suma validada con constraint trigger diferido

- `assignment_settings` (una fila por cuenta): `stale_assign_after_hours` (1–720, o `null` = desactivado), `stale_assign_enabled_at` (lo mantiene un trigger: se fija al pasar de `null` a un valor, se conserva al cambiar 3 → 5, se borra al desactivar; el cliente no puede forjarlo), `bot_reactivate_after_days`, `weights_updated_at`.
- `assignment_weights` (`account_id`, `user_id`, `percent` 1..100).
- La suma = 100 (o lista vacía) la valida un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`, que corre al confirmar: permite borrar y reinsertar la lista en la misma transacción y rechaza cualquier estado final inválido aunque alguien escriba sin pasar por la API.
- `set_assignment_weights(account_id, jsonb)` (SECURITY DEFINER, exige `is_account_member(…, 'admin')`) reemplaza la lista, valida que cada uno sea `agent` de la cuenta y actualiza `weights_updated_at`. PostgREST no ofrece transacciones de varias sentencias; la RPC sí.
- Algoritmo (déficit de cuota, enteros, sin divisiones): elegir el candidato con mayor `percent·(N+1) − n·P`; desempate por porcentaje, antigüedad del perfil y `user_id`. Con 34/33/33 produce A, B, C, A, B, C. Solo cuentan filas `source = 'weighted'` desde `weights_updated_at`: la continuidad no consume cuota (el lead ya era de alguien), y cambiar los porcentajes reinicia la cuenta, que es lo que un admin espera al mover la perilla.
- Sin lista configurada, o sin candidatos vigentes en ella, se reparte en partes iguales entre los `agent` de la cuenta: una cuenta recién creada no se queda sin reparto.

*Alternativa:* aleatorio ponderado. Rechazado por el encargo (no auditable) y porque en muestras chicas —3 asesores, decenas de leads— se desvía mucho.

### 8. Job de P4: RPC con candado de ejecución y `SKIP LOCKED`

`run_stale_assignment_job(limit)`: `pg_try_advisory_xact_lock` global (si otra ejecución lo tiene, devuelve `skipped`), selecciona candidatas con `FOR UPDATE OF c SKIP LOCKED` y las asigna una por una con `auto_assign_conversation(…, 'stale_job')`, que vuelve a comprobar bajo candado que sigan sin asesor vigente. Candidata: no cerrada, sin asesor vigente, con al menos un entrante del cliente, y con `espera_desde = max(sin_asesor_desde, primer entrante del cliente)`, donde `sin_asesor_desde` es el último cambio de su historial (o su creación si nunca tuvo asesor):

    EXISTS (entrante del cliente)
    espera_desde >= stale_assign_enabled_at
    now() − espera_desde >= X horas

**Solo leads que escriben** (decisión del Tech Lead del 2026-09-23). Una difusión crea una conversación por destinatario, y sin filtro una difusión a 500 contactos producía 500 asignaciones y 500 negocios Prospecto a las 3 horas. El job exige `EXISTS` de un mensaje entrante del cliente, y el reloj corre desde `espera_desde = max(sin_asesor_desde, primer entrante del cliente)`: el lead nace cuando escribe, no cuando la difusión creó el hilo, y nunca antes de la activación (una difusión de antes de activar a la que el cliente responde después sí entra; un cliente que ya había escrito antes, no). Costo medido en el VPS con 322 conversaciones y 3057 mensajes (531-539 con ROLLBACK, activación supuesta hace 7 días): la consulta de candidatas tarda **5 ms**; el primer entrante se lee con un `Index Scan` sobre `idx_messages_conversation_created` con `LIMIT 1`, y el `EXISTS` lo resuelve el planificador con otro índice por conversación (`idx_messages_conversation`), también `Index Scan`, 1 fila por conversación. Una pasada completa que asigna 50 (con negocio, historial y aviso) tarda **60 ms**. Los filtros baratos (no cerrada, sin asesor vigente, regla activa) van antes, así que las subconsultas solo corren para las ~180 conversaciones sin asesor.

**"Nunca las de antes"** (decisión del Director del 2026-09-23, reemplaza el `max(…, activación)` original): lo que ya estaba sin asignar al activar la regla no lo toca este job jamás, ni al activarla ni X horas después; lo asigna un admin a mano. Una que un admin suelte *después* de activar sí entra. Lote de 50 por pasada, ordenado por `sin_asesor_desde`.

**En horas, y activada al desplegar.** El plazo pasó de días a horas y la 539 deja la cuenta de producción en **X = 3 horas**, con la marca de activación en el instante del despliegue.

Ruta `GET /api/assignment/cron` con el mismo `x-cron-secret` que `/api/automations/cron`, y una línea nueva en `deploy/cron/crontab` **cada 5 minutos** (con 3 horas de plazo, 15 minutos era demasiado grueso: un lead podía esperar hasta 3 h 15).

**Efecto combinado, medido con datos reales del VPS (solo lectura, 2026-09-23).** Con 3 horas, prácticamente todo lead nuevo que el bot atiende sin traspasar recibe asesor —y, si su contacto no tiene negocio abierto, un negocio en Ventas / Prospecto— a las 3 horas de quedar sin asesor:

| Dato (desde el inicio de la campaña, 18 al 23/09) | Valor |
|---|---|
| Conversaciones nuevas por día | 19–57 (≈ 39 de media) |
| De ellas, hoy siguen sin asesor | 12–41 por día (≈ 28 de media) |
| Traspasos de la IA en 14 días | 65, de los cuales 56 antes de las 3 h y 9 después |
| Conversaciones creadas sin mensaje del cliente (difusiones) en 14 días | 0 (y aunque las hubiera, ya no entran: ver "Solo leads que escriben") |
| Simulación en el VPS (531-539 con ROLLBACK, activación supuesta hace 7 días) | **172 candidatas en 7 días ≈ 25 asignaciones por día** |

O sea: **≈ 25 asignaciones automáticas y ≈ 25 negocios Prospecto por día**, unas 8 por asesor con el reparto 34/33/33, además de los traspasos de la IA. Los 9 traspasos que hoy llegan después de las 3 h pasarían a llegar por el job, y cuando el bot traspase más tarde conservará al asesor ya asignado. Asignar no pausa al bot: el lead sigue atendido por la IA hasta que el asesor escribe. Una difusión futura no dispara asignaciones: solo entran los destinatarios que respondan, a las 3 horas de su primera respuesta.

"Momento en que quedó sin asesor" para una conversación huérfana (su asesor dejó la cuenta) es el instante de la última asignación, porque la salida del miembro no deja rastro: es una aproximación, y el `max(…, activación)` la acota.

### 9. Negocio en toda asignación: trigger `AFTER` + negocio rico creado antes en el traspaso

- `ensure_open_deal_for_contact(conversation_id, agent_user_id, title, notes)` toma un candado consultivo por **contacto**, no crea nada si el contacto tiene un negocio `open`, y si no, lo inserta en la etapa de menor `position` del embudo por defecto (mismo criterio que `pickDefaultPipeline`), con la moneda de la cuenta, `user_id` = dueño de la conversación y `assigned_to` = `profiles.id` del asesor. La 23505 del índice por conversación se lee como "ya existe".
- Trigger `AFTER INSERT OR UPDATE OF assigned_agent_id` (`create_deal_on_agent_assignment`): cuando el nuevo asesor es `agent`, llama a la función con el título genérico (nombre o teléfono del contacto). `EXCEPTION WHEN OTHERS → WARNING`: nunca aborta la asignación.
- **El orden con el traspaso se resuelve por transacción, no por carrera.** `ai_handoff_assign(conversation_id, summary, deal_title)` elige asesor, **crea primero el negocio rico** (título "Nombre — Vehículo" y la nota), y después hace un único UPDATE con asesor + pausa + nota. Cuando el trigger corre, el contacto ya tiene su negocio abierto y no hace nada. Probado en `supabase/tests/`.
- No hay índice único por contacto a propósito: un cliente puede comprar dos carros y el negocio manual desde la bandeja debe poder crear un segundo. La unicidad por contacto aplica solo a la creación automática, y la da el candado.
- Las asignaciones a `owner`/`admin` no crean negocio por trigger (la campaña de propietarios la llevan administradoras y no son leads de venta). El traspaso de la IA sí lo crea siempre: es intención de compra detectada (P5).

`createHandoffDeal` en TS desaparece; `buildHandoffDealTitle` se queda y le pasa el título a la RPC. `ai_handoff_assign` escribe asesor, pausa y nota en **un** UPDATE para que `notify_conversation_assigned` (521) siga reconociendo el traspaso por `NEW.ai_handoff_summary` y mande la nota al asesor. Cuando el asesor se conserva (el lead que vuelve) no hay cambio de asignación y ese aviso no se dispara, así que la RPC inserta un aviso propio: "Tu cliente pidió un asesor" + nota.

## API para el frontend (pantalla de Ajustes)

Ambas rutas exigen `owner`/`admin` (`403` con `{ error }` para otros roles, `401` sin sesión).

**`GET /api/assignment/settings`** → `200`

```json
{
  "stale_assign_after_hours": 3,
  "stale_assign_enabled_at": "2026-09-23T15:00:00Z",
  "bot_reactivate_after_days": 7,
  "weights_updated_at": "2026-09-23T15:00:00Z",
  "weights": [ { "user_id": "…", "full_name": "Juan…", "percent": 34, "eligible": true } ],
  "agents":  [ { "user_id": "…", "full_name": "Juan…" } ]
}
```

- `weights`: la lista guardada. `eligible = false` cuando esa persona ya no es `agent` de la cuenta (se ignora al repartir; conviene mostrarlo y pedir que se corrija).
- `agents`: todos los `agent` de la cuenta, para poblar el selector.
- Sin fila de configuración: `stale_assign_after_hours: null`, `stale_assign_enabled_at: null`, `bot_reactivate_after_days: 7`, `weights_updated_at: null`, `weights: []`.
- Lista vacía = reparto parejo entre todos los `agent`.

**`PUT /api/assignment/settings`** — cuerpo parcial; lo que no viene no cambia:

```json
{ "weights": [ { "user_id": "…", "percent": 50 }, { "user_id": "…", "percent": 50 } ],
  "stale_assign_after_hours": 3,
  "bot_reactivate_after_days": 7 }
```

`200` con la misma forma que el GET. `400` con `{ error, code }`; la interfaz traduce `code` con `Settings.assignment.errors.<code>` (claves en `es`, `en`, `ko`; helper `assignmentSettingsErrorKey(code)` en `src/lib/assignment/settings.ts`):

| `code` | Cuándo |
|---|---|
| `invalid_body` | El cuerpo no es un objeto JSON o no trae ningún campo conocido |
| `weights_invalid` | `weights` no es un arreglo de `{ user_id: string, percent: number }` |
| `weights_empty` | `weights` es un arreglo vacío |
| `weights_percent_range` | Algún porcentaje no es entero entre 1 y 100 |
| `weights_duplicate` | Un asesor aparece dos veces |
| `weights_sum` | La suma no es exactamente 100 |
| `weights_not_agent` | Algún `user_id` no es miembro de la cuenta con rol `agent` |
| `stale_hours_invalid` | `stale_assign_after_hours` no es entero 1–720 (30 días) ni `null`. El nombre anterior en días (`stale_assign_after_days`) ya no existe y un cuerpo que solo lo traiga es `invalid_body` |
| `reactivate_days_invalid` | `bot_reactivate_after_days` no es entero 1–365 ni `null` |
| `save_failed` (500) | Fallo de la base al leer asesores o guardar; también es el respaldo de `assignmentSettingsErrorKey` para cualquier código desconocido |

Los días se guardan antes que los porcentajes (dos escrituras): si fallan los porcentajes, los días ya quedaron guardados y la respuesta es el error; reenviar el mismo cuerpo es seguro. `stale_assign_enabled_at` no se acepta en el cuerpo: lo fija la base al activar (pasar de `null` a un valor) y lo borra al desactivar. Guardar porcentajes reinicia la cuota (`weights_updated_at`). Rate limit: el cubo `adminAction` de las demás rutas de Ajustes (`429`).

**`GET /api/assignment/cron`** (no es para el frontend) — `x-cron-secret`; `200 { assigned, skipped }`, `401` con secreto incorrecto, `503` si falta `AUTOMATION_CRON_SECRET`.

## Risks / Trade-offs

- ~~La reactivación por inactividad también alcanza a los propietarios~~ → **resuelto por el Director el 2026-09-23**: solo se reactiva con asesor `agent` o sin asesor (decisión 2).
- ~~A los X días de activar P4 se asigna el rezago entero~~ → **resuelto por el Director el 2026-09-23**: "nunca las de antes" (decisión 8).
- **Volumen de P4 a 3 horas** → ≈ 25 asignaciones y ≈ 25 negocios Prospecto por día con el volumen actual (decisión 8). Es el efecto buscado, pero llena el embudo y la tabla de rendimiento con leads que el bot todavía está atendiendo. Si resulta excesivo, se sube X desde Ajustes sin reiniciar la marca de activación.
- **Una cuenta creada después del despliegue no tiene P4**: la 539 siembra solo las cuentas existentes, y sin fila de configuración el job no la mira. Se activa desde Ajustes.
- **El selector "asesor fijo" de Ajustes de IA queda sin efecto** → el reparto ya no lee `handoff_agent_id`. Hoy vale NULL en producción. Frontend debe retirarlo al hacer la pantalla nueva; mientras tanto, cambiarlo no hace nada.
- **Una corrección por SQL sin `crm.assignment_override` se ignora con un WARNING** → documentado en la migración; es el precio de que ningún camino con service-role pise al asesor.
- **El admin que reasigna no mueve el negocio** → el negocio abierto sigue con el asesor anterior. Fuera de alcance; anotado.
- **La continuidad ignora un "soltar" del admin** → si un admin deja una conversación en NULL, el historial sigue nombrando al asesor anterior y el siguiente traspaso vuelve a él. Para sacar a un asesor de un cliente, el admin debe reasignar a otro, no soltar.
- **`changed_at` sigue sin decir quién**: `source`/`origin` NULL = cambio fuera del motor automático (sesión de un admin, SQL).

## Migration Plan

Lote **534-539** (el otro equipo usa 540+). Antes de desplegar comprobar en el VPS `supabase_migrations.schema_migrations`: deben quedar pendientes 531-539 (la 530 no existe a propósito). Este lote **depende** de 531-533 y sale después o junto con ellas.

1. **534** — `assignment_settings`, `assignment_weights`, RLS, `GRANT`, constraint trigger de suma, trigger de activación y `set_assignment_weights`.
2. **535** — `source`/`origin` en `conversation_assignments`, trigger de historial ampliado, funciones de vigencia y continuidad, trigger de herencia y guarda `protect_sticky_assignment`.
3. **536** — `ensure_open_deal_for_contact` y trigger de negocio en asignación.
4. **537** — `auto_assign_conversation`, `ai_handoff_assign` y `run_stale_assignment_job`.
5. **538** — `reactivate_ai_for_returning_lead`.
6. **539** — datos: configuración por cuenta (N = 7 días, **X = 3 horas activada en el instante del despliegue**), porcentajes sembrados (100 % al asesor fijo si es `agent`, si no reparto parejo), y pausa de la IA en las conversaciones asignadas con IA activa.

Con el código del lote. Tras desplegar, **reiniciar el contenedor `cron`** (`docker compose … restart cron`): copia el crontab al arrancar (`docs/self-hosting.md`, `deploy/cron/crontab`), y sin eso el job de P4 no corre. P4 nace activado a 3 horas, pero la marca de activación es el despliegue: nada de lo que ya estaba sin asignar se reparte, ni ese día ni después. Ensayado el 2026-09-23 contra el VPS (531-539 con ROLLBACK): X = 3, activada, pesos 34/33/33, 71 → 0 asignadas con IA activa, 0 negocios, y el job no asigna nada al desplegar.

**Orden de archivo en OpenSpec:** archivar `agent-performance-dashboard` antes que este cambio: los requisitos modificados de `ai-handoff-assignment` y `conversation-visibility` parten de su versión.

**Rollback:** las funciones y triggers se retiran con `DROP TRIGGER`; el código anterior no lee las tablas nuevas. La pausa de la 539 no se deshace sola (es la conducta previa, así que no hace falta).

## Open Questions

**Resueltas por el Director de TI el 2026-09-23:**

- ~~¿La reactivación por inactividad debe excluir a los propietarios?~~ → Solo con asesor `agent` o sin asesor.
- ~~¿El rezago previo a la activación de P4 se asigna?~~ → Nunca. Y P4 pasa a horas, activado a 3 al desplegar, con el cron cada 5 minutos.

**Abiertas:** ninguna.
