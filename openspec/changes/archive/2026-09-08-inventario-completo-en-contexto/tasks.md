## 1. Componer el índice

- [x] 1.1 Tests de `buildInventoryIndex`: una línea por vehículo con ref, marca, modelo, año, precio, kms, transmisión y carrocería; orden por precio ascendente; solo disponibles; campos nulos sin romper la línea
- [x] 1.2 Tests del recorte: por encima del tope se corta y se marca como incompleto; por debajo se declara completo
- [x] 1.3 Implementar `src/lib/ai/inventory-index.ts` leyendo `inventory_vehicles` de la cuenta

## 2. Caché

- [x] 2.1 Tests: dos llamadas seguidas de la misma cuenta consultan una vez; dos cuentas distintas no comparten índice; pasado el intervalo se vuelve a consultar
- [x] 2.2 Implementar el caché en memoria por `account_id`, con intervalo de 60s

## 3. Meterlo en el prompt

- [x] 3.1 Tests de `buildSystemPrompt`: con índice completo aparece la declaración de lista completa; con índice recortado aparece la advertencia; sin índice el prompt queda como antes
- [x] 3.2 `buildSystemPrompt` acepta el índice y lo emite en su propio bloque, con la regla de no afirmar inexistencia sin consultarlo

## 4. Conectarlo a las dos vías de generación

- [x] 4.1 `auto-reply.ts` carga el índice antes de generar y se lo pasa al prompt
- [x] 4.2 La ruta del borrador de la bandeja y la del Playground hacen lo mismo
- [x] 4.3 Tests: el índice llega al `systemPrompt` en ambas vías; un fallo al leer el inventario no tumba la respuesta

## 5. Cierre

- [x] 5.1 Suite completa, typecheck y lint
- [x] 5.2 Verificado contra el inventario real: 123 vehículos, 9.670 caracteres (~2.760 tokens), entran completos bajo el tope de 400
- [x] 5.3 Desplegar — hecho el 2026-09-07 22:29 en el VPS: imagen `wacrm-app` reconstruida sobre `e819243`, con el bloque de inventario dentro de `/app/.next`
- [x] 5.4 Probar el caso que falló: pedir un carro de 25 millones y confirmar que ofrece el Sandero de $22.000.000 — confirmado por el usuario el 2026-09-08
