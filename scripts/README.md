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

### Qué pestaña lee

La **primera visible en el orden de las lengüetas**, saltando las ocultas.
Y lo imprime en pantalla (`Pestana leida : ...`), que es lo único que
delata una elección equivocada antes de mirar los nombres de las carpetas.

Esto no es trivial: el nombre del archivo interno (`sheet1.xml`,
`sheet2.xml`…) es un número de creación y **no corresponde al orden de
las pestañas**. Si alguna vez se borró una hoja o se reordenaron
arrastrando, deja de coincidir — en la lista del cliente se nota, porque
su única pestaña tiene `sheetId="2"`. Quedarse con "el primer archivo de
hoja" puede leer la pestaña de vendidos, o una oculta, y terminar sin
error.

Si la lista buena no es la primera visible, hay dos formas de forzarla:

```powershell
.\Crear-Carpetas-Fotos.ps1 -Hoja "LISTA DE PRECIO ACTUALIZADA"
```

o, para el cliente, descomentando la línea `set HOJA=` del `.bat`. Con un
nombre inexistente falla enumerando las pestañas del libro.

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

## Propietario de los vehículos existentes

`propietarios-a-sql.mjs` (migración 525)

Genera el SQL que asigna `inventory_vehicles.owner_contact_id` a los
vehículos que ya están cargados, a partir del CSV de referencia de la
campaña de disponibilidad (`propietarios-referencia-AAAA-MM-DD.csv`, con
columnas `telefono` y `placa`):

```bash
node scripts/propietarios-a-sql.mjs propietarios-referencia-2026-09-14.csv <account_id> > propietarios.sql
docker exec -i supabase-db psql -U postgres -d postgres < propietarios.sql
```

- **Por defecto es un simulacro**: el SQL termina en `ROLLBACK` y solo
  muestra qué asignaría y qué no pudo asignar. Se revisa, y después se
  vuelve a generar con `--aplicar`, que termina en `COMMIT`.
- Empareja la placa (sin espacios, en mayúsculas) con el teléfono en su
  forma normalizada (`contacts.phone_normalized`, solo dígitos), así que
  el teléfono tiene que venir con el 57 adelante.
- **Nunca pisa un propietario asignado a mano**: solo llena los vacíos.
- Lista cada placa que no asignó y por qué: no está en el inventario, el
  teléfono no está en los contactos, o el vehículo ya tiene otro dueño.
- Hay que correrlo **después** de importar los contactos: sin el contacto
  no hay a quién asignar.

## Pendiente: subir las fotos al CRM

Falta el importador que recorra la estructura, suba cada imagen al bucket
`showcase-media` y actualice el arreglo `images` del vehículo. El punto de
enlace ya está resuelto por el manifiesto; lo que queda por decidir es
cómo emparejar la placa del Excel con `inventory_vehicles.license_plate`
cuando no coincidan exactamente.
