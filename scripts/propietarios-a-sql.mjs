#!/usr/bin/env node
// ============================================================================
// Genera el SQL que asigna el PROPIETARIO de los vehículos existentes
// (inventory_vehicles.owner_contact_id, migración 525) a partir de la lista
// del cliente: una fila por vehículo con el teléfono del dueño y la placa.
//
//   node scripts/propietarios-a-sql.mjs <referencia.csv> <account_id> [--aplicar] > propietarios.sql
//
// El CSV es el de referencia de la campaña de disponibilidad
// (propietarios-referencia-AAAA-MM-DD.csv): necesita las columnas
// `telefono` (con el 57 adelante) y `placa`; el resto se ignora.
//
// El SQL resultante:
//   - empareja la PLACA del vehículo (sin espacios, en mayúsculas) con el
//     TELÉFONO del contacto en su forma normalizada (`phone_normalized`,
//     solo dígitos — la misma clave que usa la deduplicación de contactos);
//   - asigna el propietario SOLO donde el vehículo no tiene uno: nunca pisa
//     una asignación hecha a mano;
//   - lista lo que NO pudo asignar y por qué.
//
// SIN `--aplicar` termina en ROLLBACK: es un simulacro que muestra qué
// asignaría. Hay que revisarlo antes de correrlo con `--aplicar`, que
// termina en COMMIT. Se corre en el servidor con psql, por ejemplo:
//
//   docker exec -i supabase-db psql -U postgres -d postgres < propietarios.sql
// ============================================================================

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [csvPath, accountId, ...flags] = process.argv.slice(2)
const aplicar = flags.includes('--aplicar')

if (!csvPath || !accountId) {
  console.error(
    'Uso: node scripts/propietarios-a-sql.mjs <referencia.csv> <account_id> [--aplicar]',
  )
  process.exit(1)
}
if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
  console.error(`account_id inválido: ${accountId}`)
  process.exit(1)
}

/** Una línea CSV con comillas RFC 4180 ("a,b" y "" como comilla escapada). */
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// El CSV de referencia se escribe con BOM para que Excel respete las tildes.
const text = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')
const [headerLine, ...lines] = text.split(/\r?\n/).filter((l) => l.trim())
const header = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase())
const iTel = header.indexOf('telefono')
const iPlaca = header.indexOf('placa')
if (iTel < 0 || iPlaca < 0) {
  console.error(`El CSV necesita las columnas "telefono" y "placa"; trae: ${header.join(', ')}`)
  process.exit(1)
}

const pares = new Map() // placa → teléfono
const descartadas = []
for (const [n, line] of lines.entries()) {
  const cols = parseCsvLine(line)
  const telefono = (cols[iTel] ?? '').replace(/\D/g, '')
  const placa = (cols[iPlaca] ?? '').replace(/\s/g, '').toUpperCase()
  if (!/^\d{7,15}$/.test(telefono) || !/^[A-Z0-9]{5,8}$/.test(placa)) {
    descartadas.push(`fila ${n + 2}: telefono="${cols[iTel] ?? ''}" placa="${cols[iPlaca] ?? ''}"`)
    continue
  }
  if (pares.has(placa) && pares.get(placa) !== telefono) {
    descartadas.push(`fila ${n + 2}: la placa ${placa} aparece con dos teléfonos distintos`)
    continue
  }
  pares.set(placa, telefono)
}

if (pares.size === 0) {
  console.error('No quedó ninguna fila válida en el CSV.')
  process.exit(1)
}

const values = [...pares]
  .map(([placa, telefono]) => `  ('${placa}', '${telefono}')`)
  .join(',\n')
const acc = `'${accountId}'::uuid`

process.stdout.write(`-- Generado por scripts/propietarios-a-sql.mjs desde ${basename(csvPath)}
-- el ${new Date().toISOString()} — ${pares.size} vehículos.
-- ${aplicar ? 'APLICA los cambios (COMMIT).' : 'SIMULACRO: termina en ROLLBACK. Revisar y volver a generar con --aplicar.'}
${descartadas.map((d) => `-- Descartada ${d}`).join('\n')}

BEGIN;

CREATE TEMP TABLE _propietarios (placa TEXT PRIMARY KEY, telefono TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO _propietarios (placa, telefono) VALUES
${values};

-- Lo que se asigna: solo a vehículos SIN propietario.
UPDATE inventory_vehicles v
   SET owner_contact_id = c.id
  FROM _propietarios p
  JOIN contacts c
    ON c.account_id = ${acc}
   AND c.phone_normalized = p.telefono
 WHERE v.account_id = ${acc}
   AND upper(replace(v.license_plate, ' ', '')) = p.placa
   AND v.owner_contact_id IS NULL
RETURNING v.license_plate AS placa_asignada, c.name AS propietario, c.phone AS telefono;

-- Lo que NO se asignó, y por qué.
SELECT p.placa,
       p.telefono,
       CASE
         WHEN v.id IS NULL THEN 'la placa no está en el inventario'
         WHEN c.id IS NULL THEN 'el teléfono no está en los contactos'
         WHEN v.owner_contact_id <> c.id THEN 'el vehículo ya tiene otro propietario'
       END AS motivo
  FROM _propietarios p
  LEFT JOIN inventory_vehicles v
    ON v.account_id = ${acc}
   AND upper(replace(v.license_plate, ' ', '')) = p.placa
  LEFT JOIN contacts c
    ON c.account_id = ${acc}
   AND c.phone_normalized = p.telefono
 WHERE v.id IS NULL
    OR c.id IS NULL
    OR v.owner_contact_id <> c.id
 ORDER BY motivo, p.placa;

${aplicar ? 'COMMIT;' : 'ROLLBACK;'}
`)

if (descartadas.length > 0) {
  console.error(`${descartadas.length} filas descartadas (ver el encabezado del SQL).`)
}
