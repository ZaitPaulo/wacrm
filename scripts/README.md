# Scripts operativos

Herramientas que no forman parte de la aplicación: se le entregan a un
operador o se corren a mano.

## Carpetas de fotos por vehículo

`Crear-Carpetas-Fotos.ps1` + `Crear carpetas de fotos.bat`

Crea una carpeta por vehículo a partir de la lista de precios en Excel,
para que el cliente deje ahí las fotos de cada uno y después se puedan
migrar al CRM.

### Qué se le manda al cliente

Los **dos archivos juntos**, en una carpeta. Nada más.

El cliente descarga su lista de precios de Drive, la deja en esa misma
carpeta y hace doble clic en el `.bat`. No necesita instalar nada: ni
Node, ni Python, ni siquiera Excel. Un `.xlsx` es un zip con XML adentro
y el PowerShell que trae Windows sabe abrir las dos cosas.

El `.bat` existe porque Windows abre los `.ps1` en el Bloc de notas al
hacer doble clic, y además bloquea los scripts sin firmar. El lanzador
usa `-ExecutionPolicy Bypass`, que aplica solo a esa ejecución y no
cambia ninguna configuración del equipo.

### Qué produce

```
Fotos Vehiculos/
  LEEME.txt                                  instrucciones para el cliente
  _vehiculos.csv                             manifiesto
  DTX813 - MAZDA 2 GRAND TOURING LX 2018/
  JXS532 - MAZDA 2 GRAND TOURING 2022/
  KQS325 - MAZDA 2 TOURING 2022/
```

### Por qué el nombre empieza con la placa

**La lista de precios no tiene ningún identificador de vehículo**, solo
características. Al subir las fotos hay que poder decir a qué unidad
pertenece cada carpeta, y la placa es el único dato que no se repite —
dos Mazda 2 Grand Touring 2022 del mismo color son indistinguibles por
lo demás.

Cuando una fila no trae placa, la carpeta queda como `SIN-PLACA-03` y el
script lo advierte al terminar: es un dato que conviene completar en el
Excel antes de que alguien cargue fotos ahí.

El `_vehiculos.csv` guarda la correspondencia carpeta → marca, línea,
año, placa y fila de origen, para que el importador no tenga que volver
a interpretar el nombre de la carpeta ni releer el Excel.

### Volver a ejecutarlo es seguro

No borra ni sobrescribe carpetas. Si entran vehículos nuevos al Excel,
se crean solo los que faltan y las carpetas que ya tienen fotos quedan
intactas. Está probado con fotos dentro.

### Detalles que el script resuelve

- **La fila de encabezados no es la primera** (arriba hay un título), así
  que la busca por contenido en vez de asumir la fila 2. Si el cliente
  inserta filas, sigue funcionando.
- **`MODELO` en esa hoja es el AÑO**, no la línea. La línea está en
  `VEHICULO`.
- **`PLACA` a secas contiene ciudades** — es la ciudad de matrícula, mal
  rotulada. La placa está en `Nº DE PLACA`.
- Encabezados comparados sin tildes ni signos, para que `Nº DE PLACA`,
  `No. de Placa` y `N DE PLACA` sean lo mismo.
- Nombres saneados de caracteres que Windows no acepta, y desempatados
  con un sufijo si dos filas producen el mismo.
- El Excel se copia a un temporal antes de leerlo, para no fallar si el
  cliente lo tiene abierto.

## Pendiente: subir las fotos al CRM

Falta el importador que recorra la estructura, suba cada imagen al bucket
`showcase-media` y actualice el arreglo `images` del vehículo. El punto de
enlace ya está resuelto por el manifiesto; lo que queda por decidir es
cómo emparejar la placa del Excel con `inventory_vehicles.license_plate`
cuando no coincidan exactamente.
