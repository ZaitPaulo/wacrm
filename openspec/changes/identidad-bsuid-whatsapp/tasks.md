## 1. Leer el terreno antes de tocarlo

- [x] 1.1 Leer la migración 513 y confirmar que `contact_channels` admite dos filas del mismo canal para un mismo contacto — **sí**: el único índice único es `(account_id, channel, external_id)`
- [x] 1.2 Buscar toda lectura que asuma "una identidad por canal por contacto" — dos hallazgos: `outbound/gate.ts:229` usa `.maybeSingle()` y revienta con dos filas (hay que arreglarlo, tareas del grupo 4), y `api/contacts/identity-links/route.ts:42,58,74` listaría `whatsapp` repetido (cosmético, deduplicar)
- [x] 1.3 Verificar que Meta acepta `recipient` — **sí**, establecido por contraste de errores; ver los hallazgos del diseño. Queda sin probar con un BSUID REAL, que exige mandarle un mensaje a una persona de verdad
- [x] 1.4 Averiguar si se puede mandar una plantilla a un BSUID — **sí**, salvo plantillas de autenticación one-tap, zero-tap y copy-code
- [x] 1.5 Decidir si el webhook `user_id_update` entra en este cambio — **queda FUERA**, con la limitación anotada en el diseño. No es una regresión: hoy un cambio de número ya produce un contacto nuevo

## 2. Reconocer la identidad al recibir

- [x] 2.1 Extraer del sobre de WhatsApp el BSUID (`contacts[].user_id`) y el nombre de usuario (`contacts[].profile.username`)
- [x] 2.2 Armar `sender.externalId` en cascada: teléfono normalizado si lo hay, BSUID si no
- [x] 2.3 Pasar el BSUID por separado, además del `externalId`, para poder vincularlo aunque la identidad haya salido del teléfono
- [x] 2.4 Quitar el guardia de diagnóstico que hoy vuelca el sobre: deja de tener sentido cuando el caso está resuelto
- [x] 2.5 Tests: mensaje sin teléfono con BSUID, mensaje con ambos, mensaje con teléfono y sin BSUID (instalación vieja)

## 3. Resolver el contacto sin duplicarlo ni fusionarlo

- [x] 3.1 En `resolveContactByChannel`, buscar por el BSUID cuando la identidad exacta del mensaje no encuentra nada
- [x] 3.2 Condicionar el respaldo difuso por teléfono a que el `externalId` SEA un teléfono — hoy corre siempre en WhatsApp
- [x] 3.3 Vincular el BSUID como identidad adicional en todos los mensajes que lo traigan, también cuando el contacto se resolvió por teléfono
- [x] 3.4 Corregir la creación del contacto: `phone` se puebla solo si el `externalId` es un teléfono, no por ser WhatsApp
- [x] 3.5 Guardar y refrescar el nombre de usuario junto al nombre de perfil — **BLOQUEADA**: `contacts` no tiene columna para eso ni campos libres, así que guardarlo pide una migración que el diseño descartó. Decisión pendiente
- [x] 3.6 Tests de los dos sentidos del cambio de identificación: conocido que deja de traer teléfono, y creado por BSUID que empieza a traerlo
- [x] 3.7 Test de que dos BSUID distintos son dos contactos, y de que un BSUID no coincide con un teléfono por sus dígitos

## 4. Responder a un contacto sin teléfono

- [x] 4.1 Definir el tipo de destinatario que distingue teléfono de BSUID, y traducirlo a `to` o `recipient` en UN solo punto
- [x] 4.2 Migrar las siete funciones de envío de `meta-api.ts` a ese tipo
- [x] 4.3 En `send-message.ts`, resolver el destinatario desde las identidades del contacto en vez de exigir `contact.phone`
- [x] 4.4 Saltar el reintento por variantes cuando el destinatario es un BSUID
- [x] 4.5 Revisar los otros caminos de envío — IA (`engineSendText`), flujos y automatizaciones pasan todos por `resolveOutboundTarget`, así que el arreglo del gate los cubre. **Las difusiones NO**: `broadcast-core.ts` recibe una lista de teléfonos del llamador y descarta lo que no sea E.164, así que un contacto sin número no puede estar en ella. Limitación anotada en el diseño
- [x] 4.6 Tests: envío a BSUID usa `recipient` y no `to`; envío a teléfono no cambia en nada; sin variantes para BSUID

## 5. Que el asesor lo pueda reconocer

- [x] 5.1 Decidir qué se muestra donde hoy va el teléfono cuando no lo hay (pregunta abierta del diseño)
- [x] 5.2 Mostrar el nombre de usuario en la ficha del contacto, la bandeja y la lista
- [x] 5.3 Distinguir "sin teléfono" de "teléfono vacío por error", para que nadie lo lea como un dato faltante que hay que completar

## 6. Cierre

- [x] 6.1 Suite completa y `tsc --noEmit`
- [x] 6.2 Entrada en `CHANGELOG.md`
- [x] 6.3 Resolver las preguntas abiertas de `design.md` o dejar anotado lo que se decidió
- [ ] 6.4 Verificar de punta a punta con el caso real (`CO.4481978948757066`, autorizado por el usuario): que el mensaje entre Y que la respuesta llegue
- [x] 6.5 Revisar si quedaron contactos duplicados por este motivo — **ninguno**: producción tiene 6 contactos, todos con identidad por teléfono y ninguno sin número. Estos contactos nunca llegaron a crearse, así que se arranca en limpio
