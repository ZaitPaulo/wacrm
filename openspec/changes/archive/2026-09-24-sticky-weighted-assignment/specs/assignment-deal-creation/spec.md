## ADDED Requirements

### Requirement: Toda asignación a un asesor abre el negocio del contacto

Cuando una conversación pasa a tener asignado un miembro con rol `agent` —por cualquier camino: asignación manual de un admin, automatizaciones, flujos, job de conversaciones olvidadas, herencia entre canales—, la base SHALL crear un negocio si **el contacto** no tiene ningún negocio abierto. Un negocio ganado o perdido anterior no lo impide.

El negocio SHALL nacer en la etapa de menor `position` del embudo por defecto (el llamado "Ventas", sin distinguir mayúsculas ni espacios, o el más antiguo), vinculado a la conversación y al contacto, en la moneda de la cuenta, con valor 0 y asignado al asesor por su `profiles.id` (no su `user_id`). El título SHALL ser el nombre del contacto, o su teléfono.

Las asignaciones a `owner`/`admin` no SHALL crear negocio: gestionar una conversación no es atender un lead de venta (la campaña de propietarios la llevan administradoras).

La creación no SHALL poder abortar la asignación, y SHALL ser segura ante concurrencia: dos asignaciones simultáneas del mismo contacto crean un solo negocio.

#### Scenario: El admin asigna un lead

- **WHEN** un admin asigna a Juan una conversación cuyo contacto no tiene negocios
- **THEN** nace un negocio en Ventas / Prospecto asignado al perfil de Juan

#### Scenario: El contacto ya tiene un negocio abierto

- **WHEN** se asigna una conversación de un contacto que tiene un negocio abierto en otra conversación
- **THEN** no se crea otro

#### Scenario: El contacto tuvo un negocio perdido

- **WHEN** se asigna una conversación de un contacto cuyo único negocio está perdido
- **THEN** se crea un negocio nuevo en Prospecto

#### Scenario: Asignación a una administradora

- **WHEN** un admin se asigna a sí mismo una conversación de un propietario
- **THEN** no se crea negocio

### Requirement: El traspaso de la IA conserva su negocio con título rico

Cuando la IA traspasa, el negocio SHALL crearse con el título del traspaso (nombre y vehículo de interés) y la nota del traspaso, en la misma transacción que la asignación y ANTES de escribir el asesor, de modo que el negocio genérico del trigger no lo sustituya. El traspaso SHALL crear el negocio también cuando la conversación ya tenía asesor (el lead que vuelve) y el contacto no tiene uno abierto, y también cuando el asesor es `owner`/`admin`.

#### Scenario: Traspaso de un lead nuevo

- **WHEN** la IA traspasa una conversación sin asesor de un contacto sin negocios, y el bot recogió nombre "Carlos" e interés "Mazda 3 2020"
- **THEN** existe un único negocio abierto, titulado "Carlos — Mazda 3 2020", asignado al asesor elegido

#### Scenario: Traspaso del lead que vuelve

- **WHEN** la IA traspasa una conversación asignada a Juan cuyo contacto perdió su negocio anterior
- **THEN** nace un negocio nuevo en Prospecto asignado a Juan con el título del traspaso
