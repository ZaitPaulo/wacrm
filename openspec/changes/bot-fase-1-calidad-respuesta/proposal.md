## Why

La revisión de las 513 conversaciones del bot, del 02/09 al 29/09/2026, encontró fallas que le llegan directo al cliente y que se corrigen solo con código, sin esperar decisiones del negocio:

- Al traspasar, el bot descarta la respuesta que el modelo ya había escrito, así que la última pregunta del cliente queda sin contestar.
- El 26/09 el bot le mandó a un cliente su propio razonamiento en inglés, con las reglas internas del traspaso.
- 22 conversaciones se traspasaron por un fallo pasajero de Gemini, incluso cuando el cliente solo se estaba despidiendo.
- El aviso de traspaso no dice cuándo lo contactan. En 75 casos el cliente siguió escribiendo sin que nadie le contestara.
- Salieron 10 plantillas "Hola 1, ¿sigues buscando vehículo?", porque el selector de plantillas obliga a llenar el nombre a mano.

## What Changes

- Al traspasar, la conversación SHALL recibir primero el texto que el modelo escribió junto al pedido de traspaso, si escribió algo, y después el aviso de traspaso.
- Toda respuesta generada por la IA SHALL pasar por un filtro de salida antes de enviarse. Si el filtro detecta fugas de las instrucciones internas, el sistema regenera una vez. Si la fuga persiste, envía un mensaje seguro. Nunca envía el texto filtrado.
- Ante un fallo transitorio del proveedor (tiempo agotado, error de red, límite de uso o respuesta vacía), el auto-reply SHALL reintentar la generación una vez antes de recurrir al traspaso por fallo técnico. Una clave inválida no se reintenta.
- El aviso de traspaso SHALL decir cuándo lo contacta el asesor, según el horario de atención de la cuenta. En horario: "en los próximos minutos". Fuera de horario: el día y la hora de la próxima apertura.
- El selector de plantillas de la bandeja y de la ficha del contacto SHALL llenar de antemano la variable del saludo con el primer nombre del contacto. También SHALL impedir enviar una variable cuyo valor sea solo números o un solo carácter.

## Capabilities

### New Capabilities
- `ai-reply-safety`: el texto de la IA pasa un filtro de fugas antes de salir, y un fallo pasajero del proveedor se reintenta antes de traspasar.
- `inbox-template-variables`: cómo se llenan y se validan las variables de una plantilla que un asesor envía a mano desde la bandeja o la ficha del contacto.

### Modified Capabilities
- `ai-handoff-assignment`: el aviso al cliente dice también cuándo lo contactan, y el traspaso ya no descarta la respuesta que el modelo escribió junto al pedido.

## Impact

- **Código**:
  - `src/lib/ai/auto-reply.ts`: el camino del traspaso, el envío y el `catch` del proveedor.
  - `src/lib/ai/generate.ts`: el reintento.
  - Módulo nuevo `src/lib/ai/output-guard.ts`.
  - `src/lib/handoff/notify-customer.ts`: el horario, leído con `src/lib/outbound/business-hours.ts`.
  - `src/components/inbox/template-picker.tsx` y quienes lo usan (`message-thread.tsx`, `contact-detail-view.tsx`).
  - `messages/es.json` y `messages/en.json`: los textos nuevos del aviso y del selector.
- **Base de datos**: ninguna migración. El horario se lee de `accounts.business_hours`, `quiet_hours_enabled` y `holiday_calendar`, que ya existen.
- **Costo**: el reintento y la regeneración suman como máximo una llamada extra a Gemini, solo cuando hay fallo o fuga.
- **Flujos** (`src/lib/flows/engine.ts`): usan el mismo aviso de traspaso, así que también dirán cuándo contactan al cliente. No hace falta tocarlos.
