## 1. Leer el terreno antes de tocarlo

- [ ] 1.1 Leer la migración 513 y confirmar que `contact_channels` admite dos filas del mismo canal para un mismo contacto (pregunta abierta del diseño)
- [ ] 1.2 Buscar toda lectura que asuma "una identidad por canal por contacto" y anotarla; la decisión 2 la rompe
- [ ] 1.3 Verificar contra la API real que un envío con `recipient` a `CO.4481978948757066` es aceptado, ANTES de construir sobre esa suposición
- [ ] 1.4 Averiguar si se puede mandar una plantilla a un BSUID, que es lo que decide si las difusiones los alcanzan

## 2. Reconocer la identidad al recibir

- [ ] 2.1 Extraer del sobre de WhatsApp el BSUID (`contacts[].user_id`) y el nombre de usuario (`contacts[].profile.username`)
- [ ] 2.2 Armar `sender.externalId` en cascada: teléfono normalizado si lo hay, BSUID si no
- [ ] 2.3 Pasar el BSUID por separado, además del `externalId`, para poder vincularlo aunque la identidad haya salido del teléfono
- [ ] 2.4 Quitar el guardia de diagnóstico que hoy vuelca el sobre: deja de tener sentido cuando el caso está resuelto
- [ ] 2.5 Tests: mensaje sin teléfono con BSUID, mensaje con ambos, mensaje con teléfono y sin BSUID (instalación vieja)

## 3. Resolver el contacto sin duplicarlo ni fusionarlo

- [ ] 3.1 En `resolveContactByChannel`, buscar por el BSUID cuando la identidad exacta del mensaje no encuentra nada
- [ ] 3.2 Condicionar el respaldo difuso por teléfono a que el `externalId` SEA un teléfono — hoy corre siempre en WhatsApp
- [ ] 3.3 Vincular el BSUID como identidad adicional en todos los mensajes que lo traigan, también cuando el contacto se resolvió por teléfono
- [ ] 3.4 Corregir la creación del contacto: `phone` se puebla solo si el `externalId` es un teléfono, no por ser WhatsApp
- [ ] 3.5 Guardar y refrescar el nombre de usuario junto al nombre de perfil
- [ ] 3.6 Tests de los dos sentidos del cambio de identificación: conocido que deja de traer teléfono, y creado por BSUID que empieza a traerlo
- [ ] 3.7 Test de que dos BSUID distintos son dos contactos, y de que un BSUID no coincide con un teléfono por sus dígitos

## 4. Responder a un contacto sin teléfono

- [ ] 4.1 Definir el tipo de destinatario que distingue teléfono de BSUID, y traducirlo a `to` o `recipient` en UN solo punto
- [ ] 4.2 Migrar las siete funciones de envío de `meta-api.ts` a ese tipo
- [ ] 4.3 En `send-message.ts`, resolver el destinatario desde las identidades del contacto en vez de exigir `contact.phone`
- [ ] 4.4 Saltar el reintento por variantes cuando el destinatario es un BSUID
- [ ] 4.5 Revisar los otros caminos de envío: IA, flujos, automatizaciones y difusiones
- [ ] 4.6 Tests: envío a BSUID usa `recipient` y no `to`; envío a teléfono no cambia en nada; sin variantes para BSUID

## 5. Que el asesor lo pueda reconocer

- [ ] 5.1 Decidir qué se muestra donde hoy va el teléfono cuando no lo hay (pregunta abierta del diseño)
- [ ] 5.2 Mostrar el nombre de usuario en la ficha del contacto, la bandeja y la lista
- [ ] 5.3 Distinguir "sin teléfono" de "teléfono vacío por error", para que nadie lo lea como un dato faltante que hay que completar

## 6. Cierre

- [ ] 6.1 Suite completa y `tsc --noEmit`
- [ ] 6.2 Entrada en `CHANGELOG.md`
- [ ] 6.3 Resolver las preguntas abiertas de `design.md` o dejar anotado lo que se decidió
- [ ] 6.4 Verificar de punta a punta con el caso real: que el mensaje entre Y que la respuesta llegue
- [ ] 6.5 Revisar si quedaron contactos duplicados por este motivo y decidir qué hacer con ellos — está fuera del alcance, pero no debería descubrirse solo
