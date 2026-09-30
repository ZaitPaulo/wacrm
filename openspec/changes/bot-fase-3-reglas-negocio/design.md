## Context

El índice de inventario (`inventory-index.ts`) arma una línea por vehículo disponible y la cachea por cuenta. `inventory_vehicles` tiene `year` (año del modelo) pero no la fecha de matrícula. Las reglas fijas del prompt viven en `buildSystemPrompt` (`defaults.ts`), en inglés. Las reglas del negocio viven en `ai_configs.system_prompt` y en los documentos de política de `ai_knowledge_documents`, en la base de producción.

Lora Motors confirmó el 29/09/2026:
- crédito vehicular hasta 10 años desde la matrícula;
- bancos aliados: Santander, Banco de Bogotá, Vehigrupo, Finanzauto, Sufi (Bancolombia) y BBVA, "entre otros";
- compran algunos carros y otros los reciben en consignación, según el carro;
- el horario ya está bien;
- no comprometerse con carros 0 km.

## Goals / Non-Goals

**Goals:** que el bot no ofrezca crédito vehicular donde los bancos no prestan, que no niegue ayuda cuando no hay lo que buscan, y que el contenido del negocio sea el confirmado.

**Non-Goals:** agregar la fecha de matrícula al inventario (hoy se aproxima con el año del modelo), una UI para el máximo de años (se cambia en la base) y mandar la foto principal como imagen (queda para después).

## Decisions

### 1. Aproximación por año de modelo con año límite "por confirmar"

`creditEligibility(year, maxAge, currentYear)` es una función pura que devuelve `'si' | 'confirmar' | 'no' | null`. El año límite (`A - N`) queda por confirmar porque un carro matriculado a mitad de ese año cruza los 10 años durante el año en curso. Con `A = 2026` y `N = 10`: 2017 o más es sí, 2016 es por confirmar y 2015 o menos es no. Coincide con lo que dicen los asesores ("2016 en adelante", "la 2011 no aplica").

### 2. La marca va en la línea del índice

Se agrega `crédito vehicular: sí|por confirmar|no` al final de cada línea, antes del enlace. La caché se indexa por `accountId:maxAge`, así un cambio del máximo no sirve líneas viejas. `buildInventoryIndex(db, accountId, { creditMaxAgeYears })`.

### 3. Configuración en `ai_configs`

`credit_max_vehicle_age_years INTEGER DEFAULT 10` (migración 547). Es una regla del asistente, no de la asignación. `AiConfig.creditMaxVehicleAgeYears?: number | null` es opcional, para que los fixtures existentes sigan valiendo; ausente se trata como null.

### 4. Reglas fijas del prompt

- Con la regla activa, `buildSystemPrompt` recibe `creditRule: { maxAgeYears }` y explica la columna y qué hacer con cada valor.
- La frase "Do not promise follow-ups… keeping their contact on file" se reemplaza por: no prometer avisos automáticos, y si nada sirve ofrecer que un asesor le ayude a buscarlo (`motivo=sin_stock`), sin decirle nunca al cliente que no guardan contactos.

## Contenido (datos en producción, fuera del despliegue de código)

Se redacta sobre el texto actual, que el usuario exporta con `export_prompt.sql`:
- **Documento "Financiación":** los bancos aliados; crédito solo con bancos y entidades aliadas; la regla de 10 años desde la matrícula; la cuota inicial no es fija, y nunca se dan porcentajes, tasas ni cuotas; la viabilidad empieza con la cédula; documentos para empleado (carta laboral más comprobantes de pago o extractos) y para independiente (cámara de comercio o RUT más extractos); a los reportados, que una empresa aliada puede ayudar y los atiende un asesor.
- **Prompt de la cuenta:**
  - compran algunos carros y otros los reciben en consignación, según el carro, y un asesor lo revisa;
  - no reciben motos, y el bot solo lo dice si el cliente pregunta;
  - no se comprometen con carros 0 km: manejan usados y seminuevos;
  - a otras ciudades se les explica que el banco puede ser a distancia y que el carro se muestra por videollamada, con un asesor;
  - el precio mínimo o los descuentos los define un asesor;
  - si no está el carro que buscan, un asesor ayuda a buscarlo.

El documento se edita desde Ajustes → IA, porque el `PATCH` reindexa. Cambiar solo la fila deja los trozos viejos en el índice.

## Risks / Trade-offs

- **[El año del modelo no es la fecha de matrícula]** → El año límite se marca "por confirmar" y lo decide el asesor. Un carro importado o matriculado tarde puede quedar mal clasificado en un año; el asesor lo corrige.
- **[El año en curso cambia el 1 de enero]** → La función usa el año actual del proceso, así que la clasificación avanza sola. La caché dura minutos.
