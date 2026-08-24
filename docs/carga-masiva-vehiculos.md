# Carga masiva de vehículos

Cómo migrar el inventario de un cliente al CRM de una sola vez: un archivo con
los datos y una carpeta con las fotos. Después de esta carga el cliente sigue
agregando vehículos desde la interfaz, uno a uno.

Está pensado para correrse **una vez por cliente**, no como una función del
producto.

---

## Lo que se le pide al cliente

Dos cosas:

1. **La tabla de vehículos**, en Excel o Google Sheets. La plantilla está en
   [`plantilla-vehiculos.csv`](./plantilla-vehiculos.csv) y trae dos filas de
   ejemplo que hay que borrar.
2. **Una carpeta de fotos**, con **una subcarpeta por vehículo** nombrada con la
   placa:

   ```
   fotos/
     ABC123/
       1.jpg
       2.jpg
       3.jpg
     XYZ789/
       frente.jpg
       interior.jpg
   ```

   Las fotos se ordenan por nombre de archivo y **la primera es la portada** —
   la que sale en la vitrina y en la miniatura al compartir por WhatsApp. Si el
   cliente tiene una preferida, que la nombre `1` o `a`.

No hace falta que respete la plantilla al pie de la letra: si manda su propio
formato, el mapeo de columnas se hace en la importación. La plantilla existe
para ahorrar ese trabajo, no para imponerlo.

## Las columnas

`placa`, `marca`, `linea` y `anio` son las únicas imprescindibles. El resto
puede ir vacío y se completa después desde la interfaz.

| Columna | Obligatoria | Notas |
|---|---|---|
| `placa` | sí | **Es la llave.** Enlaza cada fila con su carpeta de fotos y evita duplicados al reimportar |
| `marca` | sí | Renault, Chevrolet, Mazda… |
| `linea` | sí | El modelo comercial: "Mazda 3 Grand Touring" |
| `anio` | sí | Cuatro dígitos |
| `precio` | recomendada | Solo números, **sin puntos ni signo de peso**. `78000000`, no `$78.000.000` |
| `kilometraje` | | Solo números |
| `transmision` | | `manual`, `automatica`, `cvt`, `otra` |
| `combustible` | | `gasolina`, `diesel`, `hibrido`, `electrico`, `gas`, `otro` |
| `carroceria` | | `sedan`, `suv`, `hatchback`, `pickup`, `coupe`, `van`, `wagon`, `convertible`, `otro` |
| `color` | | Texto libre |
| `puertas` | | Número |
| `cilindraje` | | Texto: `2000`, `1.6L` |
| `estado` | | `nuevo` o `usado`. Vacío se toma como `usado` |
| `ciudad_placa` | | Ciudad de matrícula |
| `soat_vence` | | Fecha `AAAA-MM-DD` |
| `tecnomecanica_vence` | | Fecha `AAAA-MM-DD` |
| `tiene_prenda` | | `si` / `no` |
| `acepta_retoma` | | `si` / `no`. Vacío se toma como `si` |
| `en_exhibicion` | | `si` / `no` |
| `precio_garantia` | | Solo números |
| `caracteristicas` | | Separadas por `;` — "Sunroof;Camara de reversa" |
| `vin` | | Número de chasis |
| `notas_internas` | | **No se publica en la vitrina.** Es para el equipo |

Los valores en español se traducen a los del esquema durante la importación
(`automatica` → `automatic`, `si` → `true`…). El cliente nunca ve los valores
internos.

## Lo que hace la importación

- **Las fotos se optimizan antes de subir**, igual que en la interfaz:
  redimensionadas a 1920 px de lado mayor y recodificadas a WebP. Una carpeta
  de fotos de celular puede pesar cientos de megas y quedar en pocas decenas.
- **Los vehículos entran como `available`**, así que aparecen en la vitrina
  apenas termina la carga.
- **Reimportar no duplica**: la placa identifica al vehículo dentro de la
  cuenta, de modo que una segunda pasada corrige en vez de crear otra ficha.
  Esto importa porque la primera carga casi nunca es la buena.
- **`public_ref` lo genera la base**, no el archivo. Es el código corto que
  viaja en el mensaje de WhatsApp para atribuir la consulta al vehículo.

## Antes de correrla

- **Respaldo primero.** `./scripts/backup.sh` en el servidor. Una importación
  masiva mal mapeada se deshace restaurando, no a mano.
- **Pasada en seco primero.** Valida el archivo y reporta qué haría, sin
  escribir nada. Ahí es donde salen los precios con puntos, las fechas al revés
  y las placas sin carpeta de fotos.
- **Revisar la vitrina al terminar**, que es donde el cliente lo va a ver.
