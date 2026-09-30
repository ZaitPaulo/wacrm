## Why

La revisión de conversaciones del 29/09/2026 encontró que **18 de los 60 traspasos por crédito fueron por carros que los bancos no financian**: Aveo 2013, Sandero 2010, Picanto 2012, entre otros. El bot llegó a decir "todos nuestros vehículos aplican para crédito". Lora Motors confirmó la regla: **el crédito vehicular aplica hasta 10 años de antigüedad desde la matrícula**. El bot no la conoce, y el inventario no guarda la fecha de matrícula, solo el año del modelo.

Además, una regla fija del código ("no prometas seguimientos… como guardar su contacto") hace que el bot responda "por acá no guardamos contactos para avisar después" y tire el lead, cuando un asesor sí puede ayudar a buscar el carro.

## What Changes

- Cada vehículo del índice de inventario que ve el modelo SHALL indicar si aplica para crédito vehicular:
  - "sí" si el modelo tiene menos años que el máximo;
  - "por confirmar" en el año límite, porque depende del mes de matrícula;
  - "no" si es más viejo.

  El máximo sale de `ai_configs.credit_max_vehicle_age_years` (10 por defecto; `NULL` apaga la regla).
- El prompt fijo SHALL indicarle al modelo que ofrezca financiación bancaria solo en vehículos aptos. Para uno no apto, dice que se compra de contado o que el asesor puede revisar otras opciones, como un crédito de libre inversión. En el año límite, aclara que el asesor confirma la fecha de matrícula.
- La regla fija sobre los seguimientos SHALL cambiar. El bot sigue sin prometer avisos automáticos, pero cuando no hay lo que el cliente busca ofrece que un asesor le ayude a encontrarlo, con traspaso de motivo `sin_stock`. Nunca responde que no guardan contactos.

Fuera del código (datos de producción, en `design.md` → "Contenido"), se actualizan el prompt de la cuenta y el documento "Financiación":
- los bancos aliados;
- la compra y la consignación de carros;
- no comprometerse con carros 0 km;
- las respuestas del negocio del 24/09.

## Capabilities

### New Capabilities
- `ai-credit-eligibility`: qué vehículos aplican para crédito vehicular y cómo lo usa el bot.

### Modified Capabilities
- `ai-inventory-context`: la línea de cada vehículo del índice lleva su aptitud para crédito.

## Impact

- **Migración 547**: `ai_configs.credit_max_vehicle_age_years INTEGER DEFAULT 10 CHECK (BETWEEN 1 AND 40)`.
- **Código**:
  - `src/lib/ai/inventory-index.ts`: la marca de crédito y la caché por máximo.
  - `src/lib/ai/config.ts` y `types.ts`: el campo nuevo.
  - `src/lib/ai/defaults.ts`: la regla de crédito y la de seguimientos.
  - `src/lib/ai/auto-reply.ts` y la ruta de borradores: pasan el máximo.
- **Contenido en producción**: `ai_configs.system_prompt` y el documento "Financiación" de `ai_knowledge_documents`. El documento se edita desde Ajustes → IA para que se reindexe.
