<#
.SYNOPSIS
    Crea una carpeta por vehículo, a partir de la lista de precios en Excel,
    para que se carguen ahí las fotos de cada uno.

.DESCRIPTION
    Pensado para correr en el computador del cliente, que no tiene nada
    instalado: ni Node, ni Python, ni siquiera Excel hace falta. Un archivo
    .xlsx es en realidad un .zip con XML adentro, y Windows PowerShell sabe
    abrir ambas cosas sin ayuda de nadie.

    Uso normal: dejar este script en la misma carpeta que el Excel y hacer
    doble clic en "Crear carpetas de fotos.bat".

    Es seguro volver a ejecutarlo. Nunca borra ni sobrescribe una carpeta
    existente, así que si ya hay fotos adentro se quedan donde están, y al
    agregar vehículos nuevos al Excel solo se crean los que falten.

.PARAMETER Excel
    Ruta del archivo .xlsx. Si se omite, busca el más reciente en la carpeta
    del script.

.PARAMETER Destino
    Carpeta donde crear la estructura. Por defecto, "Fotos Vehiculos" junto
    al script.

.EXAMPLE
    .\Crear-Carpetas-Fotos.ps1
    .\Crear-Carpetas-Fotos.ps1 -Excel "C:\Users\Ana\Downloads\lista.xlsx"
#>

[CmdletBinding()]
param(
    [string]$Excel,
    [string]$Destino
)

$ErrorActionPreference = 'Stop'
# Los nombres llevan tildes y la Ñ; sin esto la consola los parte.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RaizScript = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

# ============================================================
# Lectura del .xlsx sin depender de Excel
# ============================================================

<#
    Devuelve una tabla de celdas: [fila][columna] = texto.

    Un .xlsx guarda casi todo el texto en una tabla aparte
    (sharedStrings.xml) y en la hoja solo el índice. Por eso hay que leer
    los dos archivos y cruzarlos.
#>
function Read-XlsxCells {
    param([Parameter(Mandatory)][string]$Ruta)

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    # Se copia a temporal: si el archivo está abierto en Excel, leerlo en
    # sitio falla con "está siendo usado por otro proceso".
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("xlsx_" + [guid]::NewGuid().ToString('N') + '.zip')
    Copy-Item -LiteralPath $Ruta -Destination $temp -Force

    $zip = $null
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($temp)

        function Get-EntryText($nombre) {
            $entry = $zip.Entries | Where-Object { $_.FullName -eq $nombre } | Select-Object -First 1
            if (-not $entry) { return $null }
            $lector = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
            try { return $lector.ReadToEnd() } finally { $lector.Dispose() }
        }

        # --- cadenas compartidas ---
        $compartidas = New-Object System.Collections.Generic.List[string]
        $ssXml = Get-EntryText 'xl/sharedStrings.xml'
        if ($ssXml) {
            $ss = [xml]$ssXml
            foreach ($si in $ss.sst.si) {
                # InnerText y no $si.t: cuando el <t> lleva atributos —y los
                # lleva en cuanto el texto tiene espacios al borde— el acceso
                # por nombre devuelve el XmlElement, cuya conversion a cadena
                # es literalmente "System.Xml.XmlElement". InnerText ademas
                # une por si solo las celdas de formato mixto, que Excel parte
                # en varios <t>.
                $compartidas.Add($si.InnerText)
            }
        }

        # --- primera hoja ---
        $nombreHoja = ($zip.Entries |
            Where-Object { $_.FullName -like 'xl/worksheets/*.xml' } |
            Sort-Object FullName | Select-Object -First 1).FullName
        if (-not $nombreHoja) { throw "El archivo no tiene ninguna hoja de cálculo." }
        $hoja = [xml](Get-EntryText $nombreHoja)

        $celdas = @{}
        foreach ($fila in $hoja.worksheet.sheetData.row) {
            $numeroFila = [int]$fila.r
            $celdas[$numeroFila] = @{}
            foreach ($c in $fila.c) {
                $ref = [string]$c.r
                if (-not $ref) { continue }
                $columna = ($ref -replace '[0-9]', '')

                $valor = ''
                if ($c.t -eq 's') {
                    $idx = [int]$c.v
                    if ($idx -lt $compartidas.Count) { $valor = $compartidas[$idx] }
                } elseif ($c.t -eq 'inlineStr') {
                    $valor = $c.is.InnerText
                } elseif ($null -ne $c.v) {
                    $valor = [string]$c.v
                }

                $valor = ($valor -replace '\s+', ' ').Trim()
                if ($valor -ne '') { $celdas[$numeroFila][$columna] = $valor }
            }
        }
        return $celdas
    }
    finally {
        if ($zip) { $zip.Dispose() }
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}

<#
    Normaliza un encabezado para poder compararlo: sin tildes, sin signos,
    en mayúsculas. Así "Nº DE PLACA", "No. de Placa" y "N DE PLACA" son lo
    mismo — la hoja la escriben personas y cambia entre versiones.
#>
function Normalize-Header {
    param([string]$Texto)
    if (-not $Texto) { return '' }

    # FormD separa la letra de su tilde en dos caracteres; descartando los
    # segundos queda "ANO" tanto para "AÑO" como para "ANO".
    $descompuesto = $Texto.Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $descompuesto.ToCharArray()) {
        $categoria = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
        if ($categoria -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($ch)
        }
    }

    $limpio = $sb.ToString() -replace '[^A-Za-z0-9 ]', ' '
    return ($limpio -replace '\s+', ' ').Trim().ToUpperInvariant()
}

<# Quita lo que Windows no acepta en un nombre de carpeta. #>
function Sanitize-Name {
    param([string]$Texto)
    $limpio = $Texto
    foreach ($ch in [System.IO.Path]::GetInvalidFileNameChars()) {
        $limpio = $limpio.Replace($ch, ' ')
    }
    # Windows tampoco tolera un punto o un espacio al final.
    return ($limpio -replace '\s+', ' ').Trim().TrimEnd('.')
}

# ============================================================
# 1. Localizar el Excel
# ============================================================

if (-not $Excel) {
    $candidatos = Get-ChildItem -LiteralPath $RaizScript -Filter '*.xlsx' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '~$*' } |   # los temporales que abre Excel
        Sort-Object LastWriteTime -Descending
    if (-not $candidatos) {
        Write-Host ""
        Write-Host "  No encontre ningun archivo .xlsx en esta carpeta." -ForegroundColor Red
        Write-Host "  Descarga la lista de precios desde Drive y dejala aqui:" -ForegroundColor Yellow
        Write-Host "  $RaizScript" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    $Excel = $candidatos[0].FullName
    if ($candidatos.Count -gt 1) {
        Write-Host "  Hay varios Excel; uso el mas reciente." -ForegroundColor DarkYellow
    }
}

if (-not (Test-Path -LiteralPath $Excel)) {
    Write-Host "  No existe el archivo: $Excel" -ForegroundColor Red
    exit 1
}

if (-not $Destino) { $Destino = Join-Path $RaizScript 'Fotos Vehiculos' }

Write-Host ""
Write-Host "  Lista de precios : $([System.IO.Path]::GetFileName($Excel))"
Write-Host "  Carpeta destino  : $Destino"
Write-Host ""

# ============================================================
# 2. Encontrar la fila de encabezados y las columnas que interesan
# ============================================================

$celdas = Read-XlsxCells -Ruta $Excel

# La hoja empieza con un título ("FORMATO DE LISTA DE PRECIO..."), así que
# la fila de encabezados no es la primera. Se busca la que contenga a la vez
# MARCA y VEHICULO, en lugar de dar por hecho que es la fila 2: el cliente
# puede insertar filas arriba y el script seguiría funcionando.
$filaEncabezado = $null
foreach ($n in ($celdas.Keys | Sort-Object)) {
    $textos = @($celdas[$n].Values | ForEach-Object { Normalize-Header $_ })
    if (($textos -contains 'MARCA') -and ($textos -contains 'VEHICULO')) {
        $filaEncabezado = $n
        break
    }
}
if (-not $filaEncabezado) {
    Write-Host "  No pude reconocer los encabezados." -ForegroundColor Red
    Write-Host "  Se esperan al menos las columnas MARCA y VEHICULO." -ForegroundColor Yellow
    exit 1
}

# Encabezado normalizado -> letra de columna.
$columnaDe = @{}
foreach ($col in $celdas[$filaEncabezado].Keys) {
    $clave = Normalize-Header $celdas[$filaEncabezado][$col]
    if ($clave -and -not $columnaDe.ContainsKey($clave)) { $columnaDe[$clave] = $col }
}

function Get-Col {
    param([string[]]$Alias)
    foreach ($a in $Alias) { if ($columnaDe.ContainsKey($a)) { return $columnaDe[$a] } }
    return $null
}

$colMarca  = Get-Col @('MARCA')
$colLinea  = Get-Col @('VEHICULO', 'LINEA')
# Ojo: en esta hoja "MODELO" es el AÑO, no la línea del vehículo.
$colAnio   = Get-Col @('MODELO', 'ANO', 'ANIO')
# Y "PLACA" a secas trae la ciudad de matrícula; la placa está en "N DE PLACA".
$colPlaca  = Get-Col @('N DE PLACA', 'NO DE PLACA', 'NUMERO DE PLACA', 'PLACA N')

Write-Host "  Encabezados en la fila $filaEncabezado." -ForegroundColor DarkGray
if (-not $colPlaca) {
    Write-Host "  Aviso: no hay columna de placa; usare un numero correlativo." -ForegroundColor DarkYellow
}

# ============================================================
# 3. Armar la lista de vehículos
# ============================================================

function Cell {
    param([int]$Fila, [string]$Columna)
    if (-not $Columna) { return '' }
    if (-not $celdas.ContainsKey($Fila)) { return '' }
    if (-not $celdas[$Fila].ContainsKey($Columna)) { return '' }
    return $celdas[$Fila][$Columna]
}

$vehiculos = New-Object System.Collections.Generic.List[object]
$correlativo = 0

foreach ($n in ($celdas.Keys | Sort-Object)) {
    if ($n -le $filaEncabezado) { continue }

    $marca = Cell $n $colMarca
    $linea = Cell $n $colLinea
    $anio  = Cell $n $colAnio
    $placa = (Cell $n $colPlaca).ToUpperInvariant() -replace '[^A-Z0-9]', ''

    # Sin marca ni línea no hay vehículo: son las filas de totales, notas o
    # separadores que toda hoja real acumula al final.
    if (-not $marca -and -not $linea) { continue }

    $correlativo++

    $descripcion = (@($marca, $linea, $anio) | Where-Object { $_ }) -join ' '
    # La placa va PRIMERO y es lo que permitira emparejar la carpeta con el
    # vehiculo cuando se suban las fotos: el Excel no trae ningun id, y la
    # placa es el unico dato que no se repite.
    $etiqueta = if ($placa) { $placa } else { 'SIN-PLACA-{0:D2}' -f $correlativo }
    $nombre = Sanitize-Name "$etiqueta - $descripcion"

    $vehiculos.Add([pscustomobject]@{
        Fila        = $n
        Marca       = $marca
        Linea       = $linea
        Anio        = $anio
        Placa       = $placa
        Carpeta     = $nombre
    })
}

if ($vehiculos.Count -eq 0) {
    Write-Host "  El Excel no tiene filas de vehiculos debajo del encabezado." -ForegroundColor Red
    exit 1
}

# Dos filas pueden producir el mismo nombre (misma marca, línea y año, sin
# placa). Se desempata con un sufijo para no perder ninguna.
$vistos = @{}
foreach ($v in $vehiculos) {
    $base = $v.Carpeta
    if ($vistos.ContainsKey($base)) {
        $vistos[$base]++
        $v.Carpeta = "$base ($($vistos[$base]))"
    } else {
        $vistos[$base] = 1
    }
}

# ============================================================
# 4. Crear las carpetas
# ============================================================

if (-not (Test-Path -LiteralPath $Destino)) {
    New-Item -ItemType Directory -Path $Destino | Out-Null
}

$creadas = 0
$existentes = 0
foreach ($v in $vehiculos) {
    $ruta = Join-Path $Destino $v.Carpeta
    if (Test-Path -LiteralPath $ruta) {
        $existentes++
    } else {
        New-Item -ItemType Directory -Path $ruta | Out-Null
        $creadas++
    }
}

# ============================================================
# 5. Manifiesto e instrucciones
# ============================================================

# El manifiesto es lo que hace posible la migracion: como el Excel no trae
# id, hay que poder reconstruir a que vehiculo corresponde cada carpeta sin
# volver a interpretar su nombre.
$manifiesto = Join-Path $Destino '_vehiculos.csv'
$vehiculos |
    Select-Object Carpeta, Placa, Marca, Linea, Anio, Fila |
    Export-Csv -LiteralPath $manifiesto -NoTypeInformation -Encoding UTF8

$leeme = @"
FOTOS DE VEHICULOS
==================

Adentro hay una carpeta por cada vehiculo de la lista de precios.

QUE HAY QUE HACER
-----------------
Meter las fotos de cada vehiculo en la carpeta que le corresponde.
El nombre de la carpeta empieza con la placa, para no confundirse
entre dos carros iguales.

  Ejemplo:  DTX813 - MAZDA 2 GRAND TOURING LX 2018

RECOMENDACIONES
---------------
* Entre 5 y 10 fotos por vehiculo es suficiente.
* La PRIMERA foto en orden alfabetico sera la principal en la pagina.
  Si quieres elegir cual va primero, nombrala "1.jpg", "2.jpg", etc.
* Formatos: JPG, PNG o WEBP.
* No hace falta reducirlas: se optimizan al subirlas.

IMPORTANTE
----------
* No cambies el nombre de las carpetas: es lo que permite saber
  a que vehiculo pertenece cada foto.
* No borres el archivo _vehiculos.csv.
* Si entran vehiculos nuevos, actualiza el Excel y vuelve a ejecutar
  el script: se agregan las carpetas que falten y NO se toca ninguna
  de las que ya tienen fotos.

Generado el $(Get-Date -Format 'dd/MM/yyyy HH:mm') a partir de:
$([System.IO.Path]::GetFileName($Excel))
"@
Set-Content -LiteralPath (Join-Path $Destino 'LEEME.txt') -Value $leeme -Encoding UTF8

# ============================================================
# 6. Resumen
# ============================================================

$sinPlaca = @($vehiculos | Where-Object { -not $_.Placa }).Count

Write-Host ""
Write-Host "  Listo." -ForegroundColor Green
Write-Host "  Vehiculos en la lista : $($vehiculos.Count)"
Write-Host "  Carpetas creadas      : $creadas"
if ($existentes -gt 0) {
    Write-Host "  Ya existian           : $existentes (no se tocaron)" -ForegroundColor DarkGray
}
if ($sinPlaca -gt 0) {
    Write-Host ""
    Write-Host "  Aviso: $sinPlaca vehiculo(s) sin placa en el Excel." -ForegroundColor Yellow
    Write-Host "  Sus carpetas dicen SIN-PLACA-01, SIN-PLACA-02..." -ForegroundColor Yellow
    Write-Host "  Conviene completar la placa en el Excel y volver a ejecutar." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Carpeta: $Destino" -ForegroundColor Cyan
Write-Host ""
