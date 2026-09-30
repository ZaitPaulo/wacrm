## Why

Lora Motors pidió cambiar el texto del borrador que el CRM arma para publicar vehículos en Facebook e Instagram. Hoy salen dos precios ("PRECIO DE VENTA" y "PRECIO CON GARANTIA"). El cliente quiere un solo precio, el precio con garantía, seguido de "GARANTÍA INCLUIDA POR 12 MESES". Además, el formato está escrito en el código y en el catálogo de traducciones. Cualquier ajuste del negocio (otro plazo de garantía, otro cierre u otros hashtags) hoy obliga a hacer un despliegue. Por eso el texto tiene que poder editarse desde Configuración.

## What Changes

- El borrador de la publicación se arma desde una **plantilla de texto por cuenta**, con variables entre llaves (`{marca}`, `{modelo}`, `{año}`, `{kilometraje}`, `{transmision}`, `{motor}`, `{ciudad_placa}`, `{soat}`, `{tecno}`, `{precio}`, `{precio_sin_garantia}`, `{direccion}`, `{contacto}`, `{nombre}`).
- Una línea de la plantilla que usa un dato que el vehículo o la cuenta no tienen **se omite completa**. Así se conserva la regla vigente de "lo ausente se omite, no se rellena". El SOAT y la tecnomecánica siguen saliendo como "NA" cuando faltan.
- `{precio}` pasa a ser el **precio con garantía**. Si el vehículo no lo tiene cargado, se usa el precio de venta. `{precio_sin_garantia}` queda disponible para quien quiera mostrar el otro precio.
- La plantilla por defecto calca el formato que envió el cliente: los datos del vehículo, `PRECIO DE VENTA:  {precio}`, `GARANTÍA INCLUIDA POR 12 MESES` y, después, el mismo cierre comercial de hoy (financiación, dirección, cita, contacto, hashtags y nombre). El "12 MESES" es texto fijo de la plantilla, no un dato de cada vehículo.
- Aparece una sección nueva en **Configuración** (solo admin) para editar la plantilla, con la lista de variables, una vista previa con un vehículo real y un botón para volver a la plantilla por defecto.
- Al cambiar la plantilla, los borradores pendientes **no editados** se rearman solos al abrir la cola (el mecanismo `refreshPendingCaptions` ya existe). Los que editó una persona no se tocan.
- **BREAKING** (de contenido, no de API): la línea "PRECIO CON GARANTIA" desaparece del texto por defecto y el precio mostrado cambia de valor.

## Capabilities

### New Capabilities
- `social-post-template`: la plantilla editable del texto de la publicación. Cubre dónde vive, quién la edita, las variables, la regla de omisión de líneas, la validación y la vuelta al valor por defecto.

### Modified Capabilities
- `vehicle-post-composition`: el texto propuesto deja de tener un formato fijo y sale de la plantilla de la cuenta. El precio publicado pasa a ser el precio con garantía, y se usa el precio de venta cuando no hay precio con garantía.

## Impact

- **BD**: migración `545_social_post_template.sql`, con una columna `accounts.social_post_template TEXT NULL`. Nula significa usar la plantilla por defecto.
- **Código**: `src/lib/social/caption.ts` (se reescribe como intérprete de la plantilla), `src/lib/social/queue.ts` (lee la columna nueva), `src/app/api/account/route.ts` (GET/PATCH con validación) y una sección nueva en `src/components/settings/` registrada en `settings-sections.ts` y en `settings/page.tsx`.
- **Catálogos**: `messages/{es,en,ko}.json` (la plantilla por defecto y los textos de la sección nueva). Las claves sueltas de `SocialPost` que la plantilla reemplaza se retiran.
- **Tests**: `caption` (intérprete, omisión, precio), `queue.test.ts` y la validación del PATCH.
- **Borradores ya creados**: los pendientes sin editar cambian de texto al abrir la cola. Los publicados no se tocan.
