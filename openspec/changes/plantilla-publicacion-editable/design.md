## Context

`buildVehicleCaption` (`src/lib/social/caption.ts`) arma el borrador con una secuencia fija de `lines.push(t(...))`. Las piezas de texto viven en el catálogo `SocialPost` de `messages/*.json`. Es una función pura con el traductor inyectado, y la usan tanto `syncVehiclePost` (al guardar un vehículo) como `refreshPendingCaptions` (al abrir la cola).

El cliente pide dos cosas:
1. **Un solo precio**, el precio con garantía, seguido de "GARANTÍA INCLUIDA POR 12 MESES".
2. Que el texto **se pueda cambiar desde Configuración** sin pasar por un despliegue.

Restricciones del repo: no se usan Server Actions; los datos de la cuenta se editan por `/api/account` (PATCH con `requireRole('admin')` y lista blanca de campos); las migraciones son `NNN_*.sql`, secuenciales e idempotentes (la última es la 544).

## Goals / Non-Goals

**Goals:**
- Un admin edita el texto completo del borrador: el orden, las etiquetas, el cierre y los hashtags.
- Mantener la regla de que lo ausente se omite, sin exigirle a quien edita una sintaxis de condicionales.
- Mantener la lista cerrada de datos publicables (`VehicleForCaption`). La plantilla solo puede nombrar lo que esa lista expone, y así la defensa del dato reservado queda intacta.
- Que el texto por defecto sea el del cliente desde el día uno, sin configurar nada.

**Non-Goals:**
- Plantillas por red. Se mantiene "un solo texto para todas las redes".
- Condicionales, bucles o formato enriquecido en la plantilla.
- Meses de garantía como dato por vehículo. El plazo es texto fijo en la plantilla, como se acordó.
- Tocar la reescritura con IA ni los límites por red.

## Decisions

### 1. Plantilla por líneas con variables `{nombre}`, y una línea con algún dato ausente se omite entera

El intérprete parte la plantilla por `\n` y reemplaza cada `{variable}`. Si alguna variable de la línea resolvió a vacío, **la línea no sale**. Las líneas sin variables salen siempre, tal cual.

- *Por qué*: reproduce exactamente el comportamiento actual (`if (v.mileage != null) lines.push(...)`) sin pedir sintaxis condicional. "PLACAS DE {ciudad_placa}" desaparece si no hay ciudad, igual que hoy.
- *Alternativa descartada*: un motor tipo Mustache con `{{#campo}}...{{/campo}}`. Es más potente, pero lo edita alguien del negocio en un textarea, y un bloque mal cerrado rompe todas las publicaciones. Tampoco se agrega una dependencia nueva.
- *Consecuencia*: hoy el nombre comercial va en la misma línea que el último hashtag. Con esta regla, `#Vehiculosbarranquilla {nombre}` desaparecería completa en una cuenta sin nombre. Por eso en la plantilla por defecto `{nombre}` va en su propia línea. Es un cambio visual mínimo, y el cliente puede volver a juntarlos si tiene nombre cargado.
- Las líneas en blanco de la plantilla se respetan (sirven para separar bloques). El resultado final se recorta con `trim()`, como hoy.

### 2. Catálogo de variables cerrado, y validado al guardar

| Variable | Valor | Vacío cuando |
|---|---|---|
| `{marca}` `{modelo}` `{año}` | ficha | nunca |
| `{kilometraje}` | `formatNumber(mileage)` | `mileage` nulo |
| `{transmision}` | etiqueta traducida (`MECÁNICO`…) | nula u `other` |
| `{motor}` | `engine_displacement` | nulo |
| `{ciudad_placa}` | `plate_city` | nula |
| `{soat}` `{tecno}` | `03 NOV 2026` o `NA` | **nunca** (NA es la respuesta) |
| `{precio}` | `formatPrice(warranty_price ?? price)` | nunca |
| `{precio_sin_garantia}` | `formatPrice(price)` | nunca |
| `{direccion}` | `public_address` | nula |
| `{contacto}` | `📞 canal` o la invitación genérica | nunca (conserva el fallback actual) |
| `{nombre}` | `public_name` | nulo |

El PATCH de `/api/account` rechaza (400) una plantilla que nombre una variable desconocida y dice cuál es. Así un `{precio_garantia}` mal escrito no llega al feed como texto literal. La lista de variables se exporta desde `caption.ts`, y la usan tanto el intérprete como el validador y la UI.

- Se escribe `{año}` con ñ porque es lo natural para quien edita. `{anio}` se acepta como alias, por si el teclado o el copiado lo dificultan.

### 3. `{precio}` es el precio con garantía, con respaldo al precio de venta

Es lo que pidió el cliente. El respaldo evita dejar un vehículo sin precio cuando no se cargó `warranty_price`. `{precio_sin_garantia}` sigue disponible para que el negocio pueda volver a mostrar los dos precios sin un despliegue.

### 4. Dónde vive: `accounts.social_post_template TEXT NULL`

`NULL` (o texto vacío) significa usar la plantilla por defecto del catálogo (`SocialPost.defaultTemplate` en `messages/*.json`). La plantilla por defecto queda en el catálogo y no en el código, para no fijar un idioma en `caption.ts`, que es la misma razón por la que hoy los meses salen de ahí.

- *Por qué en `accounts` y no en una tabla aparte*: es un valor único por cuenta, igual que `public_*`. Ya tiene RLS, ya pasa por `/api/account` y no necesita un GRANT nuevo, porque es una columna en una tabla existente.
- `ACCOUNT_COLUMNS` en `queue.ts` suma la columna, y `AccountForCaption` suma `social_post_template`.
- Límite de 2000 caracteres en el PATCH (Instagram corta en 2200 y el texto expandido crece poco).

### 5. Los borradores pendientes se actualizan con el mecanismo que ya existe

`refreshPendingCaptions` ya rearma, al abrir la cola, los pendientes sin `edited_caption` cuando cambia la plantilla. No hace falta un disparador nuevo: se guarda la plantilla y, la próxima vez que alguien abre la cola, los borradores muestran el texto nuevo.

### 6. UI: sección nueva "Publicaciones" en Configuración

Es un componente cliente (`social-post-settings.tsx`) con el mismo patrón que `showcase-settings.tsx`: `GET /api/account` al montar y `PATCH` al guardar. Tiene:
- un textarea monoespaciado con la plantilla (o la de defecto si la columna es nula);
- una lista de variables que se insertan con un clic en la posición del cursor;
- una **vista previa** con el primer vehículo disponible, que llama a `buildVehicleCaption` en el cliente con el mismo traductor, porque la función es pura;
- el botón "Restaurar la plantilla por defecto", que guarda `null`.

Va en el grupo `workspace` y es `adminOnly`, junto a Facebook e Instagram.

## Risks / Trade-offs

- [Un vehículo sin `warranty_price` publica "GARANTÍA INCLUIDA" con el precio de venta] → Esa línea es texto fijo y no depende del dato. Se deja como pregunta abierta. Mitigación posible sin cambiar el diseño: el negocio carga el precio con garantía en todos los vehículos que publica, porque la vitrina ya lo usa.
- [Una plantilla mal editada rompe todas las publicaciones pendientes] → Las variables desconocidas se validan al guardar, hay vista previa antes de guardar y el botón de restaurar deja la de defecto. Lo que ya editó una persona nunca se pisa.
- [Un texto expandido supera el límite de la red] → Ya lo cubre la validación de límites al aprobar o editar (`limits.ts`). La plantilla no la esquiva.
- [Cambia el texto de pendientes que alguien ya había leído] → Es el comportamiento que ya existe al cambiar un dato del negocio y está en la spec vigente.

## Migration Plan

1. Migración `545_social_post_template.sql`: `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS social_post_template TEXT;`. Antes de desplegar hay que verificar que no haya otra 545 (ver memoria de colisión de números).
2. Se despliega el código. Con la columna en `NULL`, la cuenta de Lora Motors toma el formato nuevo por defecto sin configurar nada.
3. Rollback: se revierte el código. La columna queda sin uso y no hay que borrarla.

## Open Questions

- ¿Todos los vehículos que se publican tienen `warranty_price` cargado? Si no, ¿se quiere que "GARANTÍA INCLUIDA POR 12 MESES" desaparezca cuando no lo tengan? Eso pediría una variable marcadora (por ejemplo, `{si_garantia}` vacía cuando falta) y se puede sumar después sin romper nada.
