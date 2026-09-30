## 1. Base de datos

- [x] 1.1 Verificar que no exista otra migración 545 (ni en `develop` ni en `main`) y crear `supabase/migrations/545_social_post_template.sql`: `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS social_post_template TEXT;` con encabezado explicativo e idempotente
- [ ] 1.2 Aplicar la migración en el stack local y comprobar que `GET /api/account` sigue respondiendo

## 2. Intérprete de la plantilla (`src/lib/social/caption.ts`)

- [x] 2.1 Exportar el catálogo cerrado de variables (`CAPTION_VARIABLES`, con el alias `anio` → `año`) y una función `unknownTemplateVariables(template)` que devuelva las variables fuera del catálogo
- [x] 2.2 Sumar `social_post_template: string | null` a `AccountForCaption` y reescribir `buildVehicleCaption` como intérprete por líneas: resolver variables, omitir la línea si alguna resolvió vacía, respetar las líneas fijas y en blanco, y aplicar `trim()` al final
- [x] 2.3 `{precio}` = `formatPrice(warranty_price ?? price)` y `{precio_sin_garantia}` = `formatPrice(price)`. `{soat}`/`{tecno}` con `formatDocDate` (NA) y `{contacto}` con `buildContactLine`
- [x] 2.4 Usar `SocialPost.defaultTemplate` del catálogo cuando la plantilla de la cuenta sea nula o vacía
- [x] 2.5 Tests en `caption.test.ts`: plantilla por defecto contra el texto esperado del cliente (Spark GT), omisión de línea sin dato, SOAT NA, precio con garantía, respaldo a precio de venta, `{precio_sin_garantia}`, plantilla propia, variables desconocidas detectadas y ausencia de datos reservados

## 3. Catálogos

- [x] 3.1 Agregar `SocialPost.defaultTemplate` en `messages/es.json` con el formato acordado (datos, `PRECIO DE VENTA:  {precio}`, `GARANTÍA INCLUIDA POR 12 MESES`, separador, financiación, `{direccion}`, cita, `{contacto}`, hashtags y `{nombre}` en su propia línea), y sus equivalentes en `en.json` y `ko.json`
- [x] 3.2 Retirar las claves de `SocialPost` que la plantilla vuelve obsoletas (`warrantyPrice`, `salePrice`, `title`, etc.) y conservar `transmission.*`, `monthsShort`, `notAvailable`, `contact` y `contactGeneric`
- [x] 3.3 Agregar los textos de la sección nueva de Configuración (título, descripción, variables, vista previa, restaurar, errores) en los tres catálogos

## 4. Cola y API

- [x] 4.1 Sumar `social_post_template` a `ACCOUNT_COLUMNS` en `src/lib/social/queue.ts` y ajustar `queue.test.ts`
- [x] 4.2 `src/app/api/account/route.ts`: devolver `social_post_template` en el GET y aceptarlo en el PATCH (solo admin). Si es vacío, se guarda `null`. Se rechaza con 400 si no es texto, si supera los 2000 caracteres o si contiene variables desconocidas (nombrándolas)
- [x] 4.3 Tests del PATCH: plantilla válida, variable desconocida, vacía → null y agente → 403

## 5. Configuración (UI)

- [x] 5.1 Registrar la sección `social-posts` (grupo `workspace`, `adminOnly`) en `settings-sections.ts` y montarla en `settings/page.tsx`
- [x] 5.2 Crear `src/components/settings/social-post-settings.tsx`, siguiendo el patrón de `showcase-settings.tsx`: textarea monoespaciado, variables insertables en el cursor, vista previa con el primer vehículo disponible (llamando a `buildVehicleCaption` en el cliente), guardar y restaurar por defecto
- [x] 5.3 Actualizar `settings-sections.test.ts` por la sección nueva

## 6. Verificación

- [x] 6.1 `npm run lint`, `npx tsc --noEmit` y la suite de tests en verde
- [ ] 6.2 Prueba manual local: abrir la cola y comprobar que un pendiente sin editar muestra el formato nuevo con el precio con garantía; editar la plantilla, guardar y comprobar que el pendiente se rearma y que uno editado a mano no cambia
