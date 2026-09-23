## MODIFIED Requirements

### Requirement: Las compuertas existentes se conservan

El sistema SHALL mantener sin cambios las condiciones que impiden responder: configuración de IA ausente o inactiva, auto-reply deshabilitado en la cuenta, auto-reply deshabilitado en la conversación (tras un traspaso, porque alguien tomó el hilo o porque un asesor escribió), y límite de respuestas por conversación.

Tener un asesor asignado NO SHALL ser una compuerta: el asesor de un contacto es pegajoso y la IA atiende primero al lead que vuelve (ver `returning-lead-bot-reactivation`). Lo que calla a la IA es `ai_autoreply_disabled`.

Estas comprobaciones SHALL evaluarse **antes** de la ventana de espera, para no mantener ocupada la invocación del webhook en casos que igualmente no responderían.

#### Scenario: Conversación asignada con la IA activa

- **WHEN** llega un mensaje en una conversación asignada a un asesor con `ai_autoreply_disabled = false`
- **THEN** el auto-reply de IA responde normalmente

#### Scenario: Auto-reply deshabilitado tras un traspaso

- **WHEN** llega un mensaje en una conversación donde un traspaso previo deshabilitó el auto-reply
- **THEN** el auto-reply de IA no responde
- **AND** no se espera la ventana de agrupación
