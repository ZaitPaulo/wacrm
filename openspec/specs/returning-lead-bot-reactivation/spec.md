# returning-lead-bot-reactivation Specification

## Purpose
TBD - created by archiving change sticky-weighted-assignment. Update Purpose after archive.
## Requirements
### Requirement: Tener asesor no calla al bot

La elegibilidad de la IA en una conversación SHALL depender solo de `ai_autoreply_disabled` (además de las compuertas de cuenta y de tope). Tener un asesor asignado no SHALL impedir que la IA responda.

"Reactivar IA" (`POST /api/ai/autoreply/[id]` con `paused: false`) SHALL reactivar la IA y reiniciar su tope de respuestas sin tocar al asesor.

#### Scenario: Lead con asesor y bot activo

- **WHEN** entra un mensaje en una conversación asignada a Juan con `ai_autoreply_disabled = false`
- **THEN** la IA responde

#### Scenario: Reactivar conserva al asesor

- **WHEN** Juan reactiva la IA en una conversación suya
- **THEN** la IA queda activa y la conversación sigue asignada a Juan

### Requirement: El asesor que escribe pausa al bot

Cuando una persona envía un mensaje desde la bandeja (un saliente con `sender_id`), la conversación SHALL quedar con `ai_autoreply_disabled = true`. Los envíos sin persona detrás —IA, automatizaciones, flujos, difusiones, API v1— no pausan.

#### Scenario: El asesor contesta

- **WHEN** Juan envía un mensaje en una conversación con la IA activa
- **THEN** la IA queda pausada en esa conversación

### Requirement: El despliegue no cambia el comportamiento de los hilos con asesor

La migración SHALL pausar la IA en toda conversación que hoy tenga asesor y la IA activa (71 en producción el 2026-09-23), porque hasta hoy el asesor era lo que callaba al bot.

#### Scenario: Conversación de la campaña de propietarios

- **WHEN** se aplica la migración sobre una conversación asignada a un admin con `ai_autoreply_disabled = false`
- **THEN** queda con `ai_autoreply_disabled = true` y su asesor intacto

### Requirement: El bot se reactiva para el lead que vuelve

Cuando entra un mensaje del cliente en una conversación con la IA pausada cuyo asesor es un miembro con rol `agent` —o que no tiene asesor vigente—, y el último mensaje anterior de la conversación —de cualquier remitente— tiene más de N días, el sistema SHALL reactivar la IA para ese entrante: `ai_autoreply_disabled = false`, `ai_reply_count = 0` y `ai_handoff_attempts = 0`, igual que "Reactivar IA". El asesor y la nota del traspaso se conservan.

N SHALL ser configurable por cuenta (entero de 1 a 365, o nulo = desactivado), con 7 días por defecto. El `referral` de un anuncio NO SHALL usarse como disparador.

La decisión SHALL tomarse de forma atómica en la base y SHALL medir la inactividad contra la fecha del propio entrante, de modo que en una ráfaga solo el primer mensaje reactive.

#### Scenario: Vuelve a las tres semanas

- **WHEN** un cliente con asesor y la IA pausada escribe tras 21 días sin mensajes en la conversación
- **THEN** la IA se reactiva y responde; al traspasar, el hilo sigue con su asesor

#### Scenario: Propietario de una administradora

- **WHEN** un propietario cuya conversación está asignada a una `admin` con la IA pausada escribe tras 20 días de silencio
- **THEN** la IA sigue pausada: con asesor `owner`/`admin` el bot nunca se reactiva solo

#### Scenario: Sin asesor

- **WHEN** un cliente sin asesor y con la IA pausada escribe tras 20 días de silencio
- **THEN** la IA se reactiva

#### Scenario: Negociación viva

- **WHEN** un cliente escribe dos días después del último mensaje de su asesor, aunque venga de un anuncio
- **THEN** la IA sigue pausada

#### Scenario: Reactivación desactivada

- **WHEN** la cuenta tiene N nulo
- **THEN** ningún entrante reactiva la IA

#### Scenario: Ráfaga tras la inactividad

- **WHEN** un cliente manda tres mensajes seguidos después de 10 días de silencio
- **THEN** solo el primero cumple la condición de inactividad

