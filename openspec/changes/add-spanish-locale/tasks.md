## 1. Base del catálogo

- [x] 1.1 Crear `messages/es.json` como copia exacta de `messages/en.json`, para que el test de paridad pase desde el primer commit y lo pendiente se vea como inglés en pantalla y no como una clave rota
- [x] 1.2 Definir `NEXT_PUBLIC_APP_LOCALE=es` en `.env` y documentarlo en `.env.local.example`
- [x] 1.3 Verificar que `npx vitest run src/i18n/` pasa
- [x] 1.4 Commit

## 2. Traducción del armazón (104 claves)

- [x] 2.1 Traducir el namespace `Sidebar` (26 claves)
- [x] 2.2 Traducir `Header` (15) y `ModeToggle` (1)
- [x] 2.3 Traducir `LoginPage` (13)
- [x] 2.4 Traducir `Dashboard` (49)
- [x] 2.5 Verificar la paridad de catálogos y revisar la aplicación a ojo
- [x] 2.6 Commit

## 3. Traducción de la operación diaria (397 claves)

- [x] 3.1 Traducir `Inbox` (125)
- [x] 3.2 Traducir `Contacts` (173)
- [x] 3.3 Traducir `Pipelines` (99)
- [x] 3.4 Verificar paridad y revisar a ojo
- [x] 3.5 Commit

## 4. Traducción de mensajería y automatización (481 claves)

- [x] 4.1 Traducir `Broadcasts` (149)
- [x] 4.2 Traducir `Automations` (152)
- [x] 4.3 Traducir `Flows` (180)
- [x] 4.4 Verificar paridad y revisar a ojo
- [x] 4.5 Commit

## 5. Traducción de ajustes (450 claves)

- [x] 5.1 Traducir la primera mitad de `Settings`: cuenta, perfil, miembros, roles
- [x] 5.2 Traducir la segunda mitad de `Settings`: WhatsApp, plantillas, IA, base de conocimiento, API
- [x] 5.3 Verificar paridad y revisar a ojo
- [x] 5.4 Commit

## 6. Migración de las pantallas del CRM al catálogo

- [ ] 6.1 Crear el namespace `Inventory` en los tres catálogos y migrar `src/app/(dashboard)/inventory/page.tsx`
- [ ] 6.2 Crear el namespace `Documents` en los tres catálogos y migrar `src/app/(dashboard)/documents/page.tsx`
- [ ] 6.3 Migrar `src/components/contacts/contact-documents.tsx` al namespace `Documents`
- [ ] 6.4 Migrar `src/components/settings/showcase-settings.tsx` al namespace `Settings`
- [ ] 6.5 Migrar las etiquetas de `src/lib/inventory/specs.ts` al catálogo, dejando **sin traducir** los valores que se guardan en base de datos
- [ ] 6.6 Verificar tipos, paridad de catálogos y suite completa
- [ ] 6.7 Commit

## 7. Migración de la vitrina pública al catálogo

- [ ] 7.1 Crear el namespace `Storefront` en los tres catálogos
- [ ] 7.2 Migrar `src/components/storefront/storefront.tsx` y `gallery.tsx`
- [ ] 7.3 Migrar `src/components/storefront/footer.tsx` y `store-nav.tsx`
- [ ] 7.4 Migrar `src/app/page.tsx` (portada) y `src/app/vehiculo/[id]/page.tsx`
- [ ] 7.5 Migrar los textos de `src/lib/showcase/format.ts`
- [ ] 7.6 Confirmar que las imágenes OG (`opengraph-image.tsx`) siguen renderizando: arman su texto como cadena única por la regla de satori, así que la interpolación de traducciones no debe romper eso
- [ ] 7.7 Verificar tipos, paridad de catálogos y suite completa
- [ ] 7.8 Commit

## 8. Verificación final

- [ ] 8.1 Correr `npx tsc --noEmit`, `npm run build` y la suite completa; los 5 fallos ambientales de `currency.test.ts` y `date-utils.test.ts` son preexistentes y no cuentan
- [ ] 8.2 Recorrer la aplicación en español buscando textos que hayan quedado en inglés
- [ ] 8.3 Revisar desbordes de texto en botones, pestañas y encabezados de tabla: el español ocupa entre 15% y 30% más que el inglés
- [ ] 8.4 Verificar la vitrina pública y el detalle de vehículo en español
- [ ] 8.5 Commit de los ajustes que surjan
