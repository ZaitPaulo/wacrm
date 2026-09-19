## Why

El 2026-09-14 el cliente definió qué pasa con los vehículos de la consulta de disponibilidad a unos 90 dueños: **si el dueño dice que ya no está disponible, o no responde en dos meses, el vehículo sale de la vitrina.** Hoy el CRM no puede hacer ninguna de las dos cosas. No sabe de quién es cada vehículo —`inventory_vehicles` solo registra al comprador (`sold_to_contact_id`)— y ni un "NO" ni el silencio tocan el inventario.

El costo de no hacerlo es concreto: un carro que el dueño ya vendió por su cuenta sigue publicado en la vitrina y el bot lo sigue ofreciendo, porque tanto la vitrina (`src/lib/showcase/data.ts`) como el índice de inventario del bot (`src/lib/ai/inventory-index.ts`) muestran todo lo que esté `available`. Cada cliente que pregunta por él es una conversación perdida.

## What Changes

- Cada vehículo puede tener un **propietario**: un contacto del CRM. Se elige en el formulario del vehículo, y los vehículos que ya existen lo toman de la lista del cliente (placa → teléfono).
- Paso nuevo de automatización, **"Ocultar el vehículo del contacto"**: pasa a `hidden` el vehículo disponible del que el contacto es propietario, lo saca de la base de conocimiento del bot y le deja una nota interna con la fecha y el motivo. Si el contacto es propietario de **más de un** vehículo disponible, no oculta ninguno —no hay forma de saber de cuál habla— y lo deja registrado. Se usa en la automatización del botón NO, que sigue asignándole la conversación a Angélica.
- Una difusión puede activar la **baja por silencio**: pasado un plazo (60 días por defecto) **desde el envío original**, a cada destinatario que no escribió nada desde entonces se le ocultan todos sus vehículos disponibles. Lo corre el mismo cron que manda los recordatorios. Se activa en el último paso del asistente; el detalle de la difusión muestra cuándo se aplica y cuántos vehículos ocultó, y "Cancelar seguimiento" también la cancela.
- Ocultar es reversible: el vehículo sigue en el inventario y se vuelve a publicar cambiando su estado, como cualquier otro.
- El plazo del recordatorio no cambia: sigue siendo un selector con 2 días por defecto.

**Fuera de alcance**

- Volver a publicar solo el vehículo si el dueño responde después de la baja. Lo hace una persona.
- Retirar las publicaciones que ya se hicieron en Facebook o Instagram.
- Ver y editar el propietario desde la ficha del contacto. En este cambio se edita desde el vehículo.
- Más de un propietario por vehículo.

## Capabilities

### New Capabilities

- `vehicle-owner`: el propietario de un vehículo — qué es, cómo se asigna y se quita, cómo se carga para los vehículos existentes, y qué pasa si el contacto se borra.
- `vehicle-auto-delisting`: cuándo el sistema oculta por su cuenta los vehículos de un propietario (su respuesta "NO", o su silencio pasado el plazo de una difusión), qué deja registrado y cómo se cancela.

### Modified Capabilities

Ninguna en `openspec/specs/`. La baja por silencio se apoya en el cambio `seguimiento-automatico-de-difusiones` —mismo cron, misma definición de "no respondió"—, que todavía no está archivado; por eso sus requisitos van como capacidad nueva y no como delta de `broadcast-follow-up`.

## Impact

- **Depende de `seguimiento-automatico-de-difusiones`**, implementado en `develop` y sin desplegar: su migración 524, la ruta `/api/broadcasts/cron`, el paso 4 del asistente y el detalle de la difusión. Se despliegan juntos, o este después.
- **Migración nueva**: `inventory_vehicles.owner_contact_id` (FK a `contacts`, `ON DELETE SET NULL`), el plazo de la baja en `broadcasts`, su resultado en `broadcast_recipients`, y la función que aplica las bajas vencidas.
- `src/lib/automations/`: el paso nuevo en el motor, su validación y sus tipos; `src/components/automations/automation-builder.tsx`: el paso en el editor.
- `src/lib/inventory/`: ocultar vehículos (estado, nota interna y `syncVehicleKnowledge`, que ya borra la ficha del bot de todo lo que no esté `available`); `payload.ts` acepta `owner_contact_id`.
- `src/app/(dashboard)/inventory/page.tsx`: el campo "Propietario" en el formulario del vehículo.
- `src/lib/whatsapp/broadcast-follow-up.ts`, `step4-schedule-send.tsx` y la página de detalle de la difusión.
- Un script que genera, desde `propietarios-referencia-2026-09-14.csv`, el SQL para cargar el propietario de los vehículos existentes. Correrlo en producción requiere autorización explícita.
- Traducciones (es / en / ko).
