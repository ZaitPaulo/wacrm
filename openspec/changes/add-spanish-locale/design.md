## Context

`next-intl` llegó con el merge de upstream, ya configurado y en uso por 73 de 145 componentes. `src/i18n/request.ts` resuelve el catálogo por nombre de archivo:

```ts
const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
messages = (await import(`../../messages/${locale}.json`)).default;
```

Es decir, agregar un idioma es agregar un archivo. No hay rutas por idioma, ni selector en la interfaz, ni preferencia por usuario: el idioma es global de la instalación.

`src/i18n/messages.test.ts` (aportado por upstream) verifica que todos los catálogos tengan el mismo conjunto de claves. Es la red de seguridad que impide dejar un idioma a medias sin darse cuenta.

Distribución de las 1.432 claves actuales:

| Namespace | Claves | | Namespace | Claves |
|---|---|---|---|---|
| Settings | 450 | | Pipelines | 99 |
| Flows | 180 | | Dashboard | 49 |
| Contacts | 173 | | Sidebar | 26 |
| Automations | 152 | | Header | 15 |
| Broadcasts | 149 | | LoginPage | 13 |
| Inbox | 125 | | ModeToggle | 1 |

## Goals / Non-Goals

**Goals:**

- Interfaz íntegra en español para el operador.
- Que no quede ningún texto visible fuera del catálogo, ni en el CRM ni en la vitrina.
- Mantener los tres catálogos sincronizados.

**Non-Goals:**

- Selector de idioma en la interfaz, o idioma por usuario/cuenta.
- Traducir contenido cargado por el usuario.
- Rutas por idioma (`/es/`, `/en/`).

## Decisions

### Español latinoamericano neutro

Tuteo y vocabulario regional neutro ("celular" y no "móvil", "computadora" y no "ordenador").

*Por qué:* es la convención en software para la región y no suena ajeno en Colombia. El trato de usted se descartó por resultar distante en una herramienta de uso diario.

### Traducir por namespace, un commit por tanda

El volumen (1.432 claves) hace inviable un solo cambio revisable. El orden va de lo más visible a lo más profundo: Sidebar, Header, ModeToggle, LoginPage, Dashboard, Inbox, Contacts, Pipelines, Broadcasts, Automations, Flows, Settings.

*Por qué:* cada tanda deja la aplicación en un estado usable y revisable. Como el test de paridad exige catálogos completos desde el primer commit, `es.json` se crea copiando `en.json` entero y cada tanda reemplaza su namespace. Así el test pasa siempre y lo que falta se ve como inglés en pantalla, no como una clave rota.

*Alternativa descartada:* traducir todo de una. Un diff de 1.432 líneas es irrevisable, y un error de sintaxis en el JSON rompe la aplicación entera sin pista de dónde está.

### Las etiquetas de especificaciones se traducen, los valores no

`src/lib/inventory/specs.ts` mapea valores a etiquetas (`'automatic'` → `'Automática'`). Se traduce **la etiqueta**; el valor sigue siendo la cadena en inglés que se guarda en base de datos.

*Por qué:* los valores están persistidos en `inventory_vehicles` y son la clave de los filtros de la vitrina. Traducirlos exigiría una migración de datos y rompería los vehículos ya cargados.

### La vitrina pública también va al catálogo

Decisión del usuario, tomada sobre la advertencia que sigue.

**El riesgo:** la vitrina y el CRM tienen audiencias distintas —compradores colombianos frente a operadores— pero pasarán a compartir `NEXT_PUBLIC_APP_LOCALE`. Poner el CRM en inglés le cambiaría el idioma a la tienda, que es lo que ven los clientes.

*Mitigación disponible si llega a hacer falta:* una segunda variable, `NEXT_PUBLIC_STORE_LOCALE`, con su propio proveedor de traducciones para el árbol público. No entra en este cambio; queda anotado como vía de escape. Mientras la instalación esté en español el riesgo no se materializa, porque ambas audiencias comparten idioma.

### Coreano para las pantallas propias

Las claves nuevas necesitan valor en `ko.json` o el test de paridad falla. Se traducen al coreano con el mismo criterio que usó el colaborador que aportó el idioma.

*Por qué no dejarlas en inglés:* el catálogo coreano quedaría con huecos en inglés sin que ninguna prueba lo señale, y ese es exactamente el problema que el test de paridad existe para evitar.

## Risks / Trade-offs

**Conflictos con upstream en cada sync** → Los catálogos son de los archivos que upstream toca más seguido. `es.json` es nuestro y no debería chocar, pero las claves nuevas en `en.json` y `ko.json` sí pueden. Se agregan al final de su namespace para reducir la superficie.

**Traducción sin revisión de un hablante nativo del coreano** → Las claves nuevas en `ko.json` las produce el modelo. Aceptable: son pocas y el coreano no es un idioma en uso en esta instalación.

**El riesgo de idioma de la vitrina** → Descrito arriba, asumido a pedido del usuario, con mitigación identificada.

**Textos más largos en español** → El español ocupa entre 15% y 30% más que el inglés. Puede desbordar botones y encabezados de tabla. Se revisa visualmente al terminar; los casos problemáticos se acortan en la traducción antes que tocar el diseño.

## Migration Plan

Sin migración de datos. Es configuración más archivos de catálogo.

**Rollout:** `NEXT_PUBLIC_APP_LOCALE=es` en el entorno. Los catálogos se resuelven en tiempo de build.

**Rollback:** `NEXT_PUBLIC_APP_LOCALE=en` devuelve todo al inglés sin revertir código, salvo las pantallas propias, que quedan traducidas al inglés desde el catálogo (hoy están en español fijo — ese es el cambio de comportamiento que introduce este trabajo).

## Open Questions

Ninguna. Alcance, variante de español y tratamiento de la vitrina se decidieron con el usuario.
