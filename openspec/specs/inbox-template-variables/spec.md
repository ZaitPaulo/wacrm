# inbox-template-variables Specification

## Purpose
TBD - created by archiving change bot-fase-1-calidad-respuesta. Update Purpose after archive.
## Requirements
### Requirement: La variable del saludo viene llena con el nombre del contacto

Cuando un asesor elige una plantilla para enviarla a un contacto, desde la bandeja o desde la ficha del contacto, el selector SHALL llenar de antemano cada variable del cuerpo que siga inmediatamente a un saludo (`Hola`, `Hola,`, `Buen día`, `Buenos días`, `Buenas tardes`, `Buenas noches`, `Buenas`) con el primer nombre del contacto. El primer nombre es la primera palabra de `contacts.name` que tenga al menos dos letras, con la primera letra en mayúscula y el resto en minúscula.

El valor llenado de antemano SHALL poder editarse. Si el contacto no tiene un nombre utilizable (vacío, solo emojis o símbolos, o solo números), la variable SHALL quedar vacía para que el asesor la escriba.

#### Scenario: Contacto con nombre

- **WHEN** el asesor elige la plantilla "Hola {{1}}, ¿sigues buscando vehículo?…" para el contacto "JEFERSON veroes"
- **THEN** la variable `{{1}}` aparece llena con "Jeferson"

#### Scenario: Contacto sin nombre utilizable

- **WHEN** el contacto se llama "⭐"
- **THEN** la variable `{{1}}` aparece vacía

#### Scenario: Variable que no es un saludo

- **WHEN** la plantilla es "Tu cita es el {{1}}"
- **THEN** la variable `{{1}}` aparece vacía

### Requirement: No se envía una variable con un valor de relleno

El selector MUST NOT habilitar el envío mientras alguna variable del cuerpo tenga un valor que, sin espacios, sea solo dígitos o un solo carácter. Junto a esa variable, SHALL mostrar un aviso que pida escribir el valor real (por ejemplo, el nombre del cliente).

#### Scenario: Se escribe "1" como nombre

- **WHEN** el asesor escribe "1" en la variable `{{1}}`
- **THEN** el botón de enviar queda deshabilitado
- **AND** se muestra el aviso junto a la variable

#### Scenario: Un nombre real

- **WHEN** el asesor escribe "Ana" en la variable `{{1}}`
- **THEN** el botón de enviar se habilita

