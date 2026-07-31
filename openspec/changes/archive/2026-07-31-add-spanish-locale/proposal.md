## Why

El CRM corre en inglés. El merge con upstream trajo `next-intl` con catálogos en inglés y coreano, pero no en español, y `NEXT_PUBLIC_APP_LOCALE` no está definida, así que la instalación cae al valor por defecto: `en`.

El negocio es una compraventa de vehículos en Colombia: los operadores hablan español y los clientes escriben en español por WhatsApp. Hoy conviven un dashboard en inglés y las pantallas que agregamos nosotros (inventario, documentos, vitrina) con el texto en español escrito directamente en el código — una mezcla incoherente para quien usa el sistema todos los días.

La infraestructura para resolverlo ya está instalada y probada; falta el catálogo.

## What Changes

- Nuevo catálogo `messages/es.json` con las 1.432 claves traducidas al español latinoamericano neutro (tuteo, vocabulario regional neutro).
- `NEXT_PUBLIC_APP_LOCALE=es` pasa a ser el valor de la instalación.
- Las pantallas propias que hoy tienen el texto fijo en el código se migran al catálogo, tanto las del CRM como la vitrina pública. Sus claves nuevas se agregan a los tres idiomas.
- **BREAKING** (de comportamiento): la vitrina pública deja de estar fijada en español y pasa a seguir `NEXT_PUBLIC_APP_LOCALE`. Ver la nota de riesgo en `design.md`.

## Capabilities

### New Capabilities
- `spanish-locale`: el idioma de la interfaz para operadores y para la vitrina pública, y la regla de que ningún texto visible quede fuera del catálogo.

### Modified Capabilities
<!-- Ninguna: `ai-reply-gating` es la única capacidad existente y no la toca este cambio. -->

## Impact

**Archivos nuevos**
- `messages/es.json` — 1.432 claves traducidas, más las que aporten las pantallas migradas.

**Catálogos existentes**
- `messages/en.json` y `messages/ko.json` — reciben las claves nuevas de las pantallas migradas. El test `src/i18n/messages.test.ts` exige paridad entre los tres, así que ninguno puede quedar incompleto.

**Componentes que pasan a leer del catálogo**

Del CRM (los usa el operador):
- `src/app/(dashboard)/inventory/page.tsx`
- `src/app/(dashboard)/documents/page.tsx`
- `src/components/contacts/contact-documents.tsx`
- `src/components/settings/showcase-settings.tsx`
- `src/lib/inventory/specs.ts` — catálogos de etiquetas (transmisión, combustible, carrocería, condición)

De la vitrina (la ven los clientes finales):
- `src/components/storefront/storefront.tsx`, `gallery.tsx`, `footer.tsx`, `store-nav.tsx`
- `src/app/page.tsx` (portada), `src/app/vehiculo/[id]/page.tsx`
- `src/lib/showcase/format.ts`

**Configuración**
- `.env` y `.env.local.example` — `NEXT_PUBLIC_APP_LOCALE=es`.

**Sin cambios**
- `src/i18n/request.ts` — ya resuelve cualquier locale por nombre de archivo y cae a inglés si falta.
- Base de datos: el idioma no se persiste; es configuración de despliegue.

**Fuera de alcance**
- Selector de idioma en la interfaz, o idioma por usuario/cuenta. Hoy es global por instalación y este cambio no lo altera.
- Traducir contenido cargado por el usuario (nombres de vehículos, plantillas de WhatsApp, base de conocimiento).
