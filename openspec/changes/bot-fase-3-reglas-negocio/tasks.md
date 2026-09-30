## 1. Migración y configuración

- [x] 1.1 `supabase/migrations/547_ai_credit_max_vehicle_age.sql` (columna con DEFAULT 10 y CHECK entre 1 y 40) y su prueba SQL.
- [x] 1.2 `creditMaxVehicleAgeYears` en `AiConfig` y `loadAiConfig`, con prueba.

## 2. Aptitud para crédito en el índice

- [x] 2.1 Pruebas de `creditEligibility` (sí, por confirmar, no, regla apagada) y de la línea del índice con la marca, más la caché por máximo.
- [x] 2.2 Implementar `creditEligibility` y la marca en `inventory-index.ts`.
- [x] 2.3 Pasar el máximo desde el auto-reply y desde la ruta de borradores.

## 3. Reglas fijas del prompt

- [x] 3.1 Pruebas de `buildSystemPrompt`: con `creditRule` explica la columna y prohíbe ofrecer crédito donde dice "no"; sin ella no la menciona; ya no aparece "keeping their contact on file" y sí la oferta de un asesor con `sin_stock`.
- [x] 3.2 Implementar `creditRule` y la regla de seguimientos en `defaults.ts`.

## 4. Contenido en producción

- [ ] 4.1 Redactar el prompt y el documento "Financiación" nuevos sobre el texto exportado, y revisarlos con el usuario.
- [ ] 4.2 Cargarlos: el documento desde Ajustes → IA (reindexa) y el prompt desde la misma pantalla.

## 5. Verificación

- [x] 5.1 `npx vitest run` completo, `npx tsc --noEmit` y `npx eslint` sobre los archivos tocados.
