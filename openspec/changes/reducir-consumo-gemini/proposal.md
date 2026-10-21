## Why

Una recarga de 60.000 en Gemini dura ~8,5 días (medido del 08/10 al 16/10/2026: 1.457 llamadas, 26,5 M tokens de entrada, ~18,2 k tokens por llamada). El saldo se ha agotado dos veces en octubre sin que nadie se enterara, y el bot traspasó todo como "fallo del proveedor" durante días. El cliente no quiere pagar más ni contratar nada nuevo, y el precio del modelo se duplica el 01/01/2027: hay que bajar el consumo con lo que ya tenemos.

## What Changes

**Restricción que atraviesa todo el cambio:** se conservan TODAS las reglas de negocio y de conversación vigentes (control de datos del traspaso, perfil de crédito, regla de antigüedad para crédito, traspasos urgentes, enlaces de cada vehículo, anuncios, nombre una sola vez, reactivación del lead que vuelve, avisos de plazo al asesor). No se recorta el contenido del prompt de la cuenta. Ningún cambio requiere un servicio, plan o producto nuevo de Google ni de Meta: todo usa la misma clave de AI Studio y el mismo saldo prepago.

Fase 1 — sin cambio de comportamiento visible:
- Registrar en `ai_usage_log` los tokens de entrada que Gemini sirvió desde su caché implícito, para medir el descuento real.
- Reordenar el prompt del sistema para que el prefijo estable (instrucciones fijas, protocolo de traspaso, prompt de la cuenta, inventario, regla de crédito) sea idéntico entre llamadas; lo variable (anuncio, espera, fotos, extractos, límite en horario) va después.
- Pedir a Gemini razonamiento bajo (`reasoning_effort: low`).
- Cuando Gemini responda que el saldo prepago se agotó (HTTP 402 / error de facturación): no reintentar, y avisar a owner y admin con una notificación del CRM (no por WhatsApp, que Meta cobra).

Fase 2 — menos tokens por llamada:
- El inventario que ve el modelo lleva la referencia de cada vehículo en vez de su URL completa; el código convierte la referencia en el enlace antes de enviar.
- Historial enviado al modelo: de 20 a 12 mensajes.

Fase 3 — presupuesto de respuestas en horario laboral:
- Dentro del horario de atención de la cuenta (con festivos), a partir de la respuesta N (3 por defecto) de la conversación, el bot deja de conversar libremente: completa los datos que exige el traspaso y traspasa en cuanto los tiene. El control de datos NO se relaja.
- **Modifica una regla vigente:** en horario laboral, una conversación traspasada (por cualquier motivo) espera al asesor en silencio; el bot no la retoma. Fuera de horario, el modo espera sigue como hoy.
- Configurable por cuenta: encendido/apagado y N.

Fuera de alcance: caché explícito de Gemini (cobra almacenamiento), cambio de modelo o proveedor, recorte del prompt de la cuenta.

## Capabilities

### New Capabilities
- `ai-token-economy`: forma del prompt y de la llamada que minimiza tokens cobrados sin cambiar lo que el bot sabe (prefijo estable, tokens cacheados medidos, razonamiento bajo, enlaces por referencia, historial de 12).
- `ai-provider-billing-alert`: detección del saldo agotado del proveedor y aviso a owner/admin.
- `ai-business-hours-reply-budget`: tope de respuestas del bot en horario laboral que acelera el traspaso sin saltarse el control de datos.

### Modified Capabilities
- `ai-waiting-agent`: en horario laboral la espera del asesor es silenciosa; fuera de horario no cambia.

## Impact

- Código: `src/lib/ai/defaults.ts` (`buildSystemPrompt`, límite de historial), `src/lib/ai/providers/openai-compatible.ts` y `shared.ts` (uso cacheado, `reasoning_effort`, código de error de facturación), `src/lib/ai/auto-reply.ts` (no reintentar 402, aviso, tope en horario, espera silenciosa), `src/lib/ai/inventory-index.ts` y `vehicle-links.ts` (referencias → enlace), `src/lib/ai/usage.ts` o equivalente (registro), configuración del bot en ajustes.
- Base de datos: migración `557` — columna de tokens cacheados en `ai_usage_log`, columnas de configuración en `ai_configs`, tipo nuevo de notificación (reescribiendo el CHECK completo de `notifications`). La 556 está reservada por `informe-gestion-whatsapp-pdf`.
- Sin dependencias nuevas, sin servicios externos nuevos, sin cambios en Meta ni en el VPS.
- Ahorro esperado: −33 % de tokens por llamada (fase 2) y −28 % de llamadas en el escenario sin control de datos; con el control de datos intacto la fase 3 rinde menos (estimado 10–15 %). El caché implícito se mide en fase 1.
