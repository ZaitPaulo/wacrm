# app-shell-viewport Specification

## Purpose
Cómo el contenedor del panel calcula su alto para que la barra de direcciones retráctil de los navegadores móviles no desplace el documento ni recorte lo que está pegado al borde inferior.
## Requirements

### Requirement: El panel ocupa el viewport dinámico
El contenedor raíz del panel SHALL calcular su alto con el viewport **dinámico** (`dvh`), no con `vh`. Ninguna pantalla del panel SHALL producir desplazamiento del documento por la barra de direcciones del navegador móvil.

En la práctica: el contenedor de `dashboard-shell.tsx` usa `h-dvh`, y cualquier pantalla que reste el alto del header lo hace sobre `100dvh`.

#### Scenario: Barra de direcciones visible
- **WHEN** un asesor abre cualquier pantalla del panel en Chrome Android con la barra de direcciones a la vista
- **THEN** el header de la aplicación —con el botón de menú ☰— se ve sin necesidad de desplazar
- **AND** el documento no se puede desplazar verticalmente fuera del área de contenido

#### Scenario: Barra de direcciones oculta
- **WHEN** el asesor se desplaza y el navegador oculta la barra de direcciones
- **THEN** el panel crece hasta ocupar el alto recuperado, sin dejar franja en blanco

#### Scenario: Escritorio
- **WHEN** se abre el panel en un navegador de escritorio
- **THEN** el alto es el mismo que antes del cambio, porque `100dvh` y `100vh` coinciden cuando no hay barra retráctil

### Requirement: La bandeja llena el alto disponible
La pantalla de bandeja SHALL ocupar el alto restante bajo el header de la aplicación, sin desbordarlo ni dejarlo corto, de modo que el composer quede siempre apoyado en el borde inferior del área visible.

#### Scenario: Composer al fondo
- **WHEN** el asesor abre una conversación en un teléfono
- **THEN** el campo de escritura y el botón de enviar quedan completamente visibles en el borde inferior
- **AND** no quedan recortados por el borde de la pantalla ni por la barra de navegación del sistema
