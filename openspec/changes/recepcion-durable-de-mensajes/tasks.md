## 1. Medir antes de fijar números

- [ ] 1.1 Medir cuánto tarda `getMediaUrl` contra Meta en el caso normal, para elegir el tiempo límite de la decisión 5 con un dato y no a ojo
- [ ] 1.2 Confirmar en la documentación vigente de Meta cuál es la ventana de respuesta del webhook y su política de reintentos, y anotarla en `design.md`

## 2. El resultado de la fase de persistencia

- [x] 2.1 Definir en `src/lib/inbound/core.ts` el tipo discriminado con los cuatro desenlaces: guardado, replay, descartado por fallo permanente, fallo transitorio
- [x] 2.2 Hacer que el desenlace "guardado" lleve lo que la fase de difusión necesita, incluida la bandera de conversación recién creada
- [x] 2.3 Escribir los tests del contrato **antes** de cambiar el comportamiento: cada desenlace, con su forma de resultado

## 3. Partir el núcleo en dos fases

- [x] 3.1 Extraer la fase de persistencia: contacto, conversación, contexto de respuesta, insert idempotente del mensaje
- [x] 3.2 Mover al desenlace los ajustes que cuelgan del insert (contador de no leídos, reapertura, respuesta a difusión, atribución de vehículo) sin cambiar su orden actual
- [x] 3.3 Extraer la fase de difusión: `conversation.created` primero, después flujos, automatizaciones, IA y webhooks públicos
- [x] 3.4 Verificar que la fase de difusión no puede propagar excepciones al llamador
- [x] 3.5 Comprobar que el corte de replay del issue #367 sigue cubriendo todo lo que cubría: nada de la difusión vuelve a ocurrir en una reentrega

## 4. El webhook decide la respuesta

- [x] 4.1 Hacer que `processWhatsAppChange` devuelva el desenlace en vez de tragárselo, manteniendo el aislamiento por `change` del lote
- [x] 4.2 Agregar sobre el lote la regla de la decisión 3: se sigue procesando todo, y si alguno falló de forma transitoria la respuesta es `500`
- [x] 4.3 Clasificar como permanentes —y por lo tanto `200`— el número sin configuración, las configuraciones duplicadas y el cuerpo sin mensajes
- [x] 4.4 Esperar la fase de persistencia dentro del `POST` y dejar solo la difusión en `after()`
- [x] 4.5 Reescribir el comentario de la ruta: la razón original del `after()` sigue siendo válida para la difusión, y hay que explicar por qué la persistencia ya no está ahí
- [x] 4.6 Revisar si `maxDuration = 60` sigue siendo el reparto correcto con la nueva frontera

## 5. Medios sin bloquear la confirmación

- [x] 5.1 Ponerle a `verifyAndBuildUrl` el tiempo límite medido en 1.1, cayendo al mismo camino que ya usa cuando la verificación falla
- [x] 5.2 Test: un mensaje con imagen y pie de foto se guarda con su texto cuando la verificación se agota

## 6. Tests del comportamiento nuevo

- [x] 6.1 Persistencia fallida por base inalcanzable → `500`, y ninguna fila escrita
- [x] 6.2 Reintento después de ese fallo → una sola fila, y como máximo una respuesta automática
- [x] 6.3 Fallo en la difusión (IA caída, webhook suscrito caído) → `200`, mensaje guardado
- [x] 6.4 `phone_number_id` desconocido → `200`, registrado en el log, sin reintento
- [x] 6.5 Lote con un mensaje que persiste y otro que falla → `500`, y la reentrega del lote no duplica el que ya estaba
- [x] 6.6 Firma inválida → sigue rechazando sin procesar, sin regresión

## 7. Cierre

- [x] 7.1 Correr la suite completa y `tsc --noEmit`
- [x] 7.2 Entrada en `CHANGELOG.md` describiendo el cambio de contrato: ahora un fallo de recepción se traduce en reintento de Meta
- [x] 7.3 Resolver las preguntas abiertas de `design.md` o dejarlas anotadas con lo que se decidió
- [ ] 7.4 Desplegar después de los arreglos de DNS y de la ruta interna, y verificar con un mensaje real que entra y queda guardado
