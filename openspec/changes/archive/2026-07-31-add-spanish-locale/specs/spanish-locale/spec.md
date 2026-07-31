## ADDED Requirements

### Requirement: Catálogo en español completo

El sistema SHALL proveer un catálogo `messages/es.json` con una traducción al español para cada clave presente en `messages/en.json`.

Las traducciones SHALL usar español latinoamericano neutro: tuteo, y vocabulario entendible en toda la región sin localismos de un solo país.

#### Scenario: Paridad de claves entre catálogos

- **WHEN** se ejecuta la suite de pruebas
- **THEN** el test de paridad de catálogos pasa
- **AND** `es.json` tiene exactamente el mismo conjunto de claves que `en.json` y `ko.json`

#### Scenario: Ningún texto queda sin traducir

- **WHEN** se revisa `messages/es.json`
- **THEN** ningún valor conserva el texto en inglés del catálogo original, salvo nombres propios, marcas y siglas técnicas

### Requirement: El español es el idioma de la instalación

El sistema SHALL usar español como idioma de la interfaz cuando `NEXT_PUBLIC_APP_LOCALE` valga `es`, y esa SHALL ser la configuración por defecto del despliegue.

#### Scenario: Interfaz en español

- **WHEN** un operador abre el dashboard con `NEXT_PUBLIC_APP_LOCALE=es`
- **THEN** la navegación, los encabezados y los formularios se muestran en español

#### Scenario: Locale inexistente

- **WHEN** `NEXT_PUBLIC_APP_LOCALE` apunta a un idioma sin catálogo
- **THEN** la interfaz cae a inglés sin fallar

### Requirement: Ningún texto visible fuera del catálogo

El sistema SHALL obtener del catálogo todo texto que se muestre al usuario, tanto en las pantallas del CRM como en la vitrina pública. Ningún componente SHALL contener cadenas visibles escritas directamente en el código.

Quedan exceptuados los datos cargados por el usuario (nombres de vehículos, plantillas, base de conocimiento), que no son texto de interfaz.

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

### Requirement: Los tres catálogos se mantienen sincronizados

El sistema SHALL agregar toda clave nueva a `es.json`, `en.json` y `ko.json` en el mismo cambio que la introduce.

#### Scenario: Claves nuevas de las pantallas migradas

- **WHEN** una pantalla que tenía texto fijo pasa a leer del catálogo
- **THEN** sus claves nuevas existen en los tres catálogos con su traducción correspondiente
- **AND** el test de paridad sigue pasando
