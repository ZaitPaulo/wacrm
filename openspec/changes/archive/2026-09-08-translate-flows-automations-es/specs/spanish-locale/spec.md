## MODIFIED Requirements

### Requirement: Ningún texto visible fuera del catálogo

El sistema SHALL obtener del catálogo todo texto que se muestre al usuario, tanto en las pantallas del CRM como en la vitrina pública. Ningún componente SHALL contener cadenas visibles escritas directamente en el código.

Quedan exceptuados los datos cargados por el usuario —nombres de vehículos, plantillas de mensaje de Meta, base de conocimiento— y el contenido semilla que, al usarse, se copia a una fila editable del operador. Ese contenido no es texto de interfaz: pasa a pertenecerle al operador, que puede reescribirlo.

La excepción SHALL entenderse de forma acotada. En particular **no** ampara:

- Los mensajes de validación que el sistema le muestra al operador.
- Los nombres y descripciones con que la galería presenta las plantillas semilla, que sí son texto de interfaz aunque vivan en el mismo módulo que el contenido semilla.
- Los `aria-label`, los textos de marcador de posición y los mensajes de error.

#### Scenario: Pantallas del CRM migradas

- **WHEN** se abre inventario, documentos, la pestaña de documentos del contacto o los ajustes de la vitrina
- **THEN** todos sus textos provienen del catálogo activo

#### Scenario: Etiquetas de especificaciones de vehículos

- **WHEN** se muestran las especificaciones de un vehículo (transmisión, combustible, carrocería, condición)
- **THEN** sus etiquetas provienen del catálogo
- **AND** los valores que se guardan en base de datos permanecen sin traducir

#### Scenario: Vitrina pública migrada

- **WHEN** un cliente abre la vitrina o el detalle de un vehículo
- **THEN** todos los textos de interfaz provienen del catálogo activo

#### Scenario: Textos accesibles y marcadores de posición

- **WHEN** se recorren los editores de flujos y de automatizaciones
- **THEN** sus `aria-label` y marcadores de posición provienen del catálogo

#### Scenario: Mensajes de error de carga

- **WHEN** falla la carga de un flujo, de su lista o de sus ejecuciones
- **THEN** el mensaje que ve el operador proviene del catálogo, y el detalle técnico queda en la consola

## ADDED Requirements

### Requirement: Los mensajes de validación provienen del catálogo

La validación de flujos y de automatizaciones SHALL identificar cada problema con un código estable y los datos necesarios para redactarlo, en lugar de devolver la frase ya escrita. La traducción SHALL ocurrir donde el problema se muestra.

Esta separación es necesaria porque la misma validación corre en el servidor —donde no hay un idioma de usuario— y en el cliente, y hoy ambos caminos devuelven inglés al operador.

#### Scenario: Problema de validación en el panel del editor de flujos

- **WHEN** un flujo tiene un nodo inalcanzable y el operador abre el panel de validación
- **THEN** el problema se describe en español

#### Scenario: El servidor rechaza la activación

- **WHEN** el operador activa una automatización inválida y el rechazo llega desde el servidor
- **THEN** el aviso que ve el operador está en español

#### Scenario: Problemas con datos variables

- **WHEN** el problema menciona un valor concreto, como el nombre de un nodo o un límite numérico
- **THEN** ese valor aparece dentro del mensaje traducido, sin quedar como texto suelto en inglés

### Requirement: La galería de plantillas se presenta en el idioma de la interfaz

Los nombres y las descripciones con que la galería presenta las plantillas semilla SHALL provenir del catálogo.

El contenido de la plantilla —los mensajes que se le envían al cliente— SHALL permanecer como dato semilla y SHALL copiarse tal cual al clonarse, sin pasar por el catálogo: una vez clonado le pertenece al operador y este puede editarlo.

#### Scenario: Galería en español

- **WHEN** el operador abre el diálogo de nuevo flujo o la sección de plantillas de automatizaciones
- **THEN** los nombres y descripciones de las tarjetas provienen del catálogo

#### Scenario: El contenido clonado no se traduce en tiempo de render

- **WHEN** el operador clona una plantilla y luego edita uno de sus mensajes
- **THEN** su edición persiste y no la sobrescribe el catálogo

#### Scenario: Plantilla sin traducción en el catálogo activo

- **WHEN** se agrega una plantilla cuyo nombre aún no está en el catálogo del idioma activo
- **THEN** la galería sigue mostrando la tarjeta sin romperse
