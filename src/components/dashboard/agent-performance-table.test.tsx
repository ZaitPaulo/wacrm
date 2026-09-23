import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'next-intl'

// El catálogo real, no un mock que devuelva la clave: así estas pruebas
// también fallan si una clave no existe o si un plural ICU está mal
// escrito, que es justo lo que `icu-safety.test.ts` no puede ver desde
// afuera del componente.
const MESSAGES = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'es.json'), 'utf8'),
)

vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({
        locale: 'es',
        messages: MESSAGES,
        namespace,
        onError: (err) => {
          throw err
        },
      }),
  }
})

import {
  AgentPerformanceTable,
  formatResponseSeconds,
  orderRows,
  totalOpenConversations,
} from './agent-performance-table'
import { canEditSettings } from '@/lib/auth/roles'
import type { AgentPerformanceRow, AgentStageBreakdown } from '@/lib/dashboard/types'

const t = createTranslator({
  locale: 'es',
  messages: MESSAGES,
  namespace: 'Dashboard.agentPerformance',
})

/**
 * Fila con los valores que la RPC devuelve en el caso normal de
 * producción: negocios sin datos y tiempo de respuesta ausente. Cada
 * prueba pisa solo lo que le interesa.
 */
function row(over: Partial<AgentPerformanceRow> = {}): AgentPerformanceRow {
  return {
    agentUserId: 'u-1',
    agentProfileId: 'p-1',
    fullName: 'Juan Marino Arias Medina',
    accountRole: 'agent',
    isUnassigned: false,
    openConversations: 13,
    openConversationsWithoutDeal: 0,
    openDeals: 0,
    dealsByStage: null,
    avgFirstResponseSeconds: null,
    responseSamples: 0,
    ...over,
  }
}

/** La fila de trabajo sin dueño, tal como la arma la RPC. */
function unassigned(over: Partial<AgentPerformanceRow> = {}): AgentPerformanceRow {
  return row({
    agentUserId: null,
    agentProfileId: null,
    fullName: null,
    accountRole: null,
    isUnassigned: true,
    openConversations: 108,
    avgFirstResponseSeconds: null,
    responseSamples: 0,
    ...over,
  })
}

function stage(over: Partial<AgentStageBreakdown> = {}): AgentStageBreakdown {
  return {
    stageId: 's-1',
    stageName: 'Prospecto',
    color: '#7c3aed',
    pipelineId: 'pipe-1',
    position: 1,
    deals: 3,
    ...over,
  }
}

function render(props: Partial<React.ComponentProps<typeof AgentPerformanceTable>> = {}) {
  return renderToStaticMarkup(
    React.createElement(AgentPerformanceTable, {
      rows: [],
      loading: false,
      ...props,
    }),
  )
}

/**
 * Cuántas filas de datos tiene la tabla. Cuenta solo dentro de `tbody`:
 * el `thead` también aporta un `<tr>` y lo haría dar uno de más.
 */
function dataRowCount(html: string): number {
  const body = /<tbody[^>]*>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? ''
  return (body.match(/<tr[\s>]/g) ?? []).length
}

/**
 * El contenido de la última celda de cada fila: la del tiempo de
 * respuesta. Se mira aislada porque buscar "0 s" en el HTML completo da
 * falsos positivos — las clases de Tailwind traen `sm:mt-0 sm:...`.
 */
function responseCells(html: string): string[] {
  const body = /<tbody[^>]*>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? ''
  return [...body.matchAll(/<td[^>]*>((?:(?!<\/td>)[\s\S])*)<\/td>/g)]
    .map((m) => m[1])
    .filter((cell) => cell.includes('data-state="absent"') || cell.includes('data-state="measured"'))
}

/**
 * El estado real de la cuenta de producción al 2026-09-21, en el orden
 * en que lo devuelve la RPC. Tres asesores, una administradora con
 * cartera y el trabajo sin dueño.
 */
const PRODUCTION_ROWS: AgentPerformanceRow[] = [
  row({ agentUserId: 'u-juan', fullName: 'Juan Marino Arias Medina', openConversations: 13 }),
  row({ agentUserId: 'u-brayan', fullName: 'Brayan Hernández Gómez', openConversations: 12 }),
  row({ agentUserId: 'u-robinson', fullName: 'Robinson orozco', openConversations: 12 }),
  // Angélica es `admin`, no `agent`: sale por cartera, y por eso la
  // tabla no puede titularse "por asesor".
  row({
    agentUserId: 'u-angelica',
    fullName: 'Angelica Maria Molero',
    openConversations: 70,
    accountRole: 'admin',
  }),
  unassigned(),
]

// ============================================================
// Requirement: El dashboard muestra el rendimiento por asesor
// ============================================================

describe('tabla de rendimiento — filas (tareas 4.1, 4.4)', () => {
  // Scenario: Tabla con tres asesores
  it('pinta una fila por persona con sus tres métricas', () => {
    const html = render({
      rows: [
        row({ agentUserId: 'u-1', fullName: 'Juan Marino Arias Medina', openConversations: 13 }),
        row({ agentUserId: 'u-2', fullName: 'Brayan Hernández Gómez', openConversations: 12 }),
        row({ agentUserId: 'u-3', fullName: 'Robinson orozco', openConversations: 12 }),
      ],
    })

    expect(html).toContain('Juan Marino Arias Medina')
    expect(html).toContain('Brayan Hernández Gómez')
    expect(html).toContain('Robinson orozco')
    // Tres filas de datos, ninguna de ellas la de sin asignar.
    expect(dataRowCount(html)).toBe(3)
    expect(html).not.toContain(t('unassigned'))
  })

  // Scenario: Asesor sin clientes asignados
  it('mantiene en la tabla a quien no tiene ningún cliente, con cero', () => {
    const html = render({
      rows: [
        row({ agentUserId: 'u-1', fullName: 'Con carga', openConversations: 12 }),
        row({ agentUserId: 'u-2', fullName: 'Sin nada', openConversations: 0 }),
      ],
    })

    expect(html).toContain('Sin nada')
    expect(html).toMatch(/Sin nada[\s\S]*?>0</)
  })

  it('pone una etiqueta cuando la persona no tiene nombre cargado', () => {
    const html = render({ rows: [row({ fullName: null })] })
    expect(html).toContain(t('unnamedPerson'))
  })

  it('no habla de "asesor" en los encabezados, porque no toda fila lo es', () => {
    const html = render({ rows: PRODUCTION_ROWS })

    expect(html).toContain(t('colPerson'))
    // La palabra sólo puede aparecer como rol de una fila concreta, nunca
    // como rótulo de la columna ni en el título de la tabla.
    expect(t('title')).not.toMatch(/asesor/i)
    expect(t('colPerson')).not.toMatch(/asesor/i)
  })
})

// ============================================================
// Requirement: Lo que no tiene asesor se ve en su propia fila
// ============================================================

describe('fila "Sin asignar" (tarea 4.5)', () => {
  // Scenario: Conversaciones sin dueño
  it('muestra sus conversaciones abiertas como clientes en gestión', () => {
    const html = render({ rows: [row({ openConversations: 13 }), unassigned()] })

    expect(html).toContain(t('unassigned'))
    expect(html).toContain('108')
    expect(html).toContain(t('unassignedHint'))
  })

  // Scenario: La fila sin asignar no mide tiempo
  it('deja su tiempo de respuesta vacío y no en cero', () => {
    const html = render({ rows: [unassigned()] })

    const [cell] = responseCells(html)
    expect(cell).toContain('data-state="absent"')
    expect(cell).toContain(t('noOneToMeasure'))
    expect(cell).toContain('—')
    expect(cell).not.toContain(t('seconds', { value: '0' }))
    expect(cell).not.toContain(t('minutes', { value: '0' }))
    expect(cell).not.toContain('data-state="measured"')
  })

  // Scenario: No queda nada sin dueño
  it('se muestra con cero cuando todo tiene dueño, y no desaparece', () => {
    const html = render({
      rows: [row({ openConversations: 13 }), unassigned({ openConversations: 0 })],
    })

    expect(html).toContain(t('unassigned'))
    expect(html).toMatch(new RegExp(`${t('unassigned')}[\\s\\S]*?>0<`))
  })

  it('se distingue de las demás filas, no es una persona más del equipo', () => {
    const html = render({ rows: [row(), unassigned()] })

    // Marca en el DOM + fondo propio + cursiva en el nombre.
    expect(html).toContain('data-unassigned="true"')
    expect(html).toMatch(/data-unassigned="true"[^>]*class="[^"]*bg-muted\/50/)
  })

  it('queda al final aunque la RPC la devuelva primera', () => {
    const ordered = orderRows([
      unassigned(),
      row({ agentUserId: 'u-1', fullName: 'Juan' }),
      row({ agentUserId: 'u-2', fullName: 'Brayan' }),
    ])

    expect(ordered.map((r) => r.fullName)).toEqual(['Juan', 'Brayan', null])
  })

  it('no reordena a las personas entre sí: respeta el orden de la RPC', () => {
    // Angélica lleva 70 y va cuarta; un ranking la habría subido al tope,
    // y "Sin asignar" con 108 habría encabezado la tabla.
    const ordered = orderRows(PRODUCTION_ROWS)

    expect(ordered.map((r) => r.openConversations)).toEqual([13, 12, 12, 70, 108])
  })
})

// ============================================================
// Requirement: Las métricas nacen vacías y se declaran así
// ============================================================

describe('ausencia frente a cero — negocios por etapa (tarea 4.3)', () => {
  // Scenario: Cuenta sin negocios
  it('dice "sin datos" cuando dealsByStage es null, y no pinta etapas en cero', () => {
    const html = render({ rows: [row({ dealsByStage: null })] })

    expect(html).toContain(t('noStageData'))
    expect(html).toContain('data-state="no-data"')
    // Borde punteado: la marca visual de "esto no se midió".
    expect(html).toMatch(/data-state="no-data"[^>]*class="[^"]*border-dashed/)
    expect(html).not.toContain('data-state="zero"')
    // Tampoco se cuela el "0 de 13": cuando no hay datos del desglose no
    // se pinta ninguna cifra de negocios.
    expect(html).not.toContain(t('dealsOfClients', { deals: 0, clients: 13 }))
  })

  it('un arreglo vacío sí es un cero medido y se pinta distinto', () => {
    const html = render({ rows: [row({ dealsByStage: [], openDeals: 0 })] })

    expect(html).toContain('data-state="zero"')
    expect(html).toContain(t('dealsOfClients', { deals: 0, clients: 13 }))
    expect(html).not.toContain(t('noStageData'))
    expect(html).not.toContain('border-dashed')
  })

  it('los dos estados no se confunden: null y [] dan marcados distintos', () => {
    const sinDatos = render({ rows: [row({ dealsByStage: null })] })
    const cero = render({ rows: [row({ dealsByStage: [] })] })

    expect(sinDatos).not.toEqual(cero)
    expect(sinDatos).toContain('data-state="no-data"')
    expect(cero).toContain('data-state="zero"')
  })

  it('desglosa las etapas por posición, con su color y su cuenta', () => {
    const html = render({
      rows: [
        row({
          openDeals: 5,
          dealsByStage: [
            stage({ stageId: 's-2', stageName: 'Negociación', position: 2, deals: 2 }),
            stage({ stageId: 's-1', stageName: 'Prospecto', position: 1, deals: 3 }),
          ],
        }),
      ],
    })

    expect(html).toContain('data-state="breakdown"')
    expect(html.indexOf('Prospecto')).toBeLessThan(html.indexOf('Negociación'))
    expect(html).toContain('#7c3aed')
  })
})

describe('ausencia frente a cero — tiempo de respuesta (tarea 4.3)', () => {
  // Scenario: Asesor que nunca respondió
  it('deja el tiempo vacío, nunca en cero minutos, cuando no hay muestras', () => {
    const html = render({
      rows: [row({ avgFirstResponseSeconds: null, responseSamples: 0 })],
    })

    const [cell] = responseCells(html)
    expect(cell).toContain('data-state="absent"')
    expect(cell).toContain(t('noResponseSamples'))
    expect(cell).toContain('—')
    expect(cell).not.toContain(t('minutes', { value: '0' }))
    expect(cell).not.toContain(t('seconds', { value: '0' }))
    expect(cell).not.toContain('data-state="measured"')
  })

  it('muestra el promedio y sobre cuántas respuestas se calculó', () => {
    // 10.800 s = las casi 3 horas que mide el asesor en producción.
    const html = render({
      rows: [row({ avgFirstResponseSeconds: 10800, responseSamples: 7 })],
    })

    const [cell] = responseCells(html)
    expect(cell).toContain('data-state="measured"')
    expect(cell).toContain(t('hours', { value: '3.0' }))
    expect(cell).toContain(t('samples', { count: 7 }))
  })

  it('un cero medido de verdad sí se muestra como cero', () => {
    const html = render({
      rows: [row({ avgFirstResponseSeconds: 0, responseSamples: 4 })],
    })

    const [cell] = responseCells(html)
    expect(cell).toContain('data-state="measured"')
    expect(cell).toContain(t('seconds', { value: '0' }))
    expect(cell).not.toContain(t('noResponseSamples'))
    expect(cell).not.toContain('—')
  })
})

describe('formatResponseSeconds', () => {
  it('devuelve null para la ausencia, nunca un cero', () => {
    expect(formatResponseSeconds(null)).toBeNull()
    expect(formatResponseSeconds(Number.NaN)).toBeNull()
    expect(formatResponseSeconds(-1)).toBeNull()
  })

  it('distingue el cero medido de la ausencia', () => {
    expect(formatResponseSeconds(0)).toEqual({ unit: 'seconds', value: '0' })
  })

  it('escala a la unidad legible', () => {
    expect(formatResponseSeconds(16)).toEqual({ unit: 'seconds', value: '16' })
    expect(formatResponseSeconds(59)).toEqual({ unit: 'seconds', value: '59' })
    expect(formatResponseSeconds(60)).toEqual({ unit: 'minutes', value: '1' })
    expect(formatResponseSeconds(3599)).toEqual({ unit: 'minutes', value: '60' })
    expect(formatResponseSeconds(3600)).toEqual({ unit: 'hours', value: '1.0' })
    expect(formatResponseSeconds(10800)).toEqual({ unit: 'hours', value: '3.0' })
    expect(formatResponseSeconds(86400)).toEqual({ unit: 'days', value: '1.0' })
    expect(formatResponseSeconds(86400 * 3.5)).toEqual({ unit: 'days', value: '3.5' })
  })
})

// ============================================================
// Requirement: la tabla indica el rol de cada fila
// ============================================================

describe('rol de cada fila', () => {
  it('marca el rol cuando la RPC lo trae', () => {
    const html = render({
      rows: [
        row({ fullName: 'Juan', accountRole: 'agent' }),
        row({
          agentUserId: 'u-a',
          fullName: 'Angelica Maria Molero',
          openConversations: 70,
          accountRole: 'admin',
        }),
      ],
    })

    expect(html).toContain('data-role="agent"')
    expect(html).toContain(t('roleAgent'))
    expect(html).toContain('data-role="admin"')
    expect(html).toContain(t('roleAdmin'))
  })

  it('destaca a quien aparece por cartera sin ser asesor', () => {
    const html = render({
      rows: [row({ openConversations: 70, accountRole: 'admin' })],
    })

    // Violeta, el acento de la marca, y NO ámbar: el ámbar quedó
    // reservado para "sin negocio", que sí es una señal de atención. Un
    // administrador con cartera no es un problema, solo es distinto.
    expect(html).toMatch(/data-role="admin"[^>]*class="[^"]*violet/)
    expect(html).not.toMatch(/data-role="admin"[^>]*class="[^"]*amber/)
    // El color no es el único portador: la palabra del rol está escrita.
    expect(html).toContain(t('roleAdmin'))
  })

  it('no pone pastilla de rol en la fila sin asignar', () => {
    const html = render({ rows: [unassigned()] })
    expect(html).not.toContain('data-role=')
  })

  it('rotula owner y viewer con su propia palabra', () => {
    const html = render({
      rows: [
        row({ agentUserId: 'u-o', fullName: 'Dueña', accountRole: 'owner' }),
        row({ agentUserId: 'u-v', fullName: 'Supervisor', accountRole: 'viewer' }),
      ],
    })

    expect(html).toContain(t('roleOwner'))
    expect(html).toContain(t('roleViewer'))
  })

  // El rol sale de un enum de la base. Si mañana se le agrega uno, la
  // tabla no debe romperse ni —peor— rotularlo con el nombre de otro
  // rol: sin pastilla es honesto, "Observador" sería mentira.
  it('no se rompe ni inventa un nombre si la base trae un rol nuevo', () => {
    const html = render({
      rows: [
        {
          ...row({ fullName: 'Rol del futuro' }),
          accountRole: 'supervisor',
        } as unknown as AgentPerformanceRow,
      ],
    })

    expect(html).toContain('Rol del futuro')
    expect(html).toContain('13')
    expect(html).not.toContain('data-role=')
    expect(html).not.toContain(t('roleViewer'))
  })
})

// ============================================================
// Requirement: La tabla de rendimiento es de owner y admin
// ============================================================

describe('quién ve la tabla (tarea 4.2)', () => {
  // El montaje va por `canEditSettings` y NO por el largo del arreglo:
  // `loadAgentPerformance` devuelve `[]` tanto cuando la RPC le niega el
  // acceso a un `agent` como cuando no hay nadie a quien medir.
  it('owner y admin pueden ver la tabla; agent y viewer no', () => {
    expect(canEditSettings('owner')).toBe(true)
    expect(canEditSettings('admin')).toBe(true)
    expect(canEditSettings('agent')).toBe(false)
    expect(canEditSettings('viewer')).toBe(false)
  })

  it('la página monta la tabla tras ese permiso y no tras el largo de las filas', () => {
    const page = readFileSync(
      join(process.cwd(), 'src', 'app', '(dashboard)', 'dashboard', 'page.tsx'),
      'utf8',
    )

    expect(page).toContain("useCan('edit-settings')")
    expect(page).toMatch(/showAgentPerformance\s*&&\s*\(?\s*<AgentPerformanceTable/)
    expect(page).not.toMatch(/agentPerformance(\?\.)?\.length\s*>\s*0\s*&&\s*<AgentPerformanceTable/)
  })
})

// ============================================================
// Estados de carga, error y vacío (tarea 4.8)
// ============================================================

describe('estados de la tabla (tarea 4.8)', () => {
  it('muestra esqueletos mientras carga, sin tabla ni ceros', () => {
    const html = render({ rows: null, loading: true })

    expect(html).toContain('animate-pulse')
    expect(html).not.toContain('<table')
    expect(html).not.toContain(t('empty'))
  })

  it('al fallar avisa y ofrece reintentar, en vez de una tabla vacía', () => {
    const html = render({ rows: null, loading: false, error: true, onRetry: () => {} })

    expect(html).toContain(t('error'))
    expect(html).toContain(t('errorHint'))
    expect(html).toContain(t('retry'))
    expect(html).not.toContain('<table')
    // El error nunca se confunde con "no hay nadie a quien medir".
    expect(html).not.toContain(t('empty'))
  })

  it('el botón de reintentar tiene área táctil de teléfono', () => {
    const html = render({ rows: null, loading: false, error: true, onRetry: () => {} })
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11/)
  })

  it('sin filas muestra el estado vacío y no una tabla con encabezados solos', () => {
    const html = render({ rows: [], loading: false })

    expect(html).toContain(t('empty'))
    expect(html).toContain(t('emptyHint'))
    expect(html).not.toContain('<table')
  })
})

// ============================================================
// Responsive (tarea 4.7)
// ============================================================

describe('responsive a ancho de teléfono (tarea 4.7)', () => {
  const html = render({ rows: PRODUCTION_ROWS })

  it('no resuelve el ancho con scroll horizontal', () => {
    expect(html).not.toContain('overflow-x')
    expect(html).not.toMatch(/class="[^"]*min-w-\[/)
  })

  it('a ancho de teléfono nada fuerza el nowrap: todos llevan prefijo sm:', () => {
    // El nowrap es necesario en escritorio —las etiquetas de cifras son
    // unidades de lectura y no deben partirse— pero a 360 px desbordaría.
    // De ahí que todos vayan con prefijo de breakpoint. Un
    // `whitespace-nowrap` pelado en el cuerpo sí sería un desborde.
    const body = /<tbody[^>]*>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? ''

    expect(body).toContain('sm:whitespace-nowrap')
    expect(body).not.toMatch(/(?<![\w:-])whitespace-nowrap/)
    expect(html).toMatch(/<thead[^>]*class="[^"]*hidden\b/)
  })

  it('apila cada fila como tarjeta bajo sm y vuelve a fila de tabla desde sm', () => {
    expect(html).toMatch(/<tr[^>]*class="[^"]*\bblock\b[^"]*"/)
    expect(html).toMatch(/<tr[^>]*class="[^"]*sm:table-row\b/)
    // Toda la cadena tabla → tbody → tr → td conmuta en el mismo
    // breakpoint; si la tabla se quedara en `display:table`, las
    // tarjetas volverían a quedar encajonadas en celdas anónimas.
    expect(html).toMatch(/<table[^>]*class="[^"]*\bblock\b[^"]*sm:table\b/)
    expect(html).toMatch(/<tbody[^>]*class="[^"]*\bblock\b[^"]*sm:table-row-group\b/)
    expect(html).toMatch(/<td[^>]*class="[^"]*sm:table-cell\b/)
  })

  it('esconde la cabecera en teléfono, donde cada dato lleva su rótulo', () => {
    expect(html).toMatch(/<thead[^>]*class="[^"]*hidden sm:table-header-group/)
    // Los rótulos móviles existen y se apagan desde sm.
    expect(html).toMatch(new RegExp(`class="[^"]*sm:hidden[^"]*">${t('colClients')}<`))
    expect(html).toMatch(new RegExp(`class="[^"]*sm:hidden[^"]*">${t('colResponse')}<`))
  })

  it('deja que los nombres largos de etapa se recorten en vez de empujar la fila', () => {
    const withStages = render({
      rows: [row({ dealsByStage: [stage({ stageName: 'Esperando documentos del propietario' })] })],
    })
    expect(withStages).toMatch(/class="truncate"/)
  })
})

// ============================================================
// Grupo 4ter — densidad, el dato que no cuadraba y el texto del bot
// ============================================================

describe('densidad del bloque (tarea 4ter.1)', () => {
  // Acotar el contenedor fue la corrección equivocada: no juntaba las
  // cifras, las comprimía hasta partirlas, y dejaba media pantalla vacía
  // al lado. La tarjeta va a ancho completo, como el resto del panel.
  it('va a ancho completo, como las demás tarjetas del panel', () => {
    const html = render({ rows: PRODUCTION_ROWS })
    expect(html).not.toMatch(/<section class="[^"]*max-w-/)
  })

  it('deja que el nombre absorba el sobrante para que las cifras queden juntas', () => {
    const html = render({ rows: PRODUCTION_ROWS })
    const head = /<thead[\s\S]*?<\/thead>/.exec(html)?.[0] ?? ''
    // `<th\s` y no `<th`: sin el espacio el patrón also captura
    // `<thead class="…">`, que daría un encabezado de más.
    const headers = [...head.matchAll(/<th\s[^>]*class="([^"]*)"/g)].map((m) => m[1])

    // Solo la primera columna crece; las tres numéricas se encogen a su
    // contenido y por eso terminan pegadas entre sí.
    expect(headers).toHaveLength(4)
    expect(headers[0]).toContain('w-full')
    expect(headers.slice(1).some((c) => c.includes('w-full'))).toBe(false)
  })

  it('el desglose por etapas ya no es una columna', () => {
    const html = render({ rows: PRODUCTION_ROWS })
    const head = /<thead[\s\S]*?<\/thead>/.exec(html)?.[0] ?? ''

    // Cuatro encabezados, y ninguno es el de etapas: las pastillas
    // viven dentro de la celda de Negocios.
    expect(head).toContain(t('colDeals'))
    expect(head).not.toContain(t('colStages'))
  })

  it('las etapas van en la celda que absorbe el sobrante, no en la de Negocios', () => {
    const html = render({
      rows: [
        row({
          openDeals: 10,
          dealsByStage: [
            stage({ stageId: 's-1', stageName: 'Prospecto', position: 1, deals: 4 }),
            stage({ stageId: 's-2', stageName: 'Contactado', position: 2, deals: 3 }),
          ],
        }),
      ],
    })

    const cells = [...html.matchAll(/<td[^>]*>((?:(?!<\/td>)[\s\S])*)<\/td>/g)].map((m) => m[1])

    // Primera celda: el nombre, el grupo de etapas y su etiqueta
    // accesible — es la que lleva `w-full` y por eso tienen ancho para
    // fluir en horizontal.
    expect(cells[0]).toContain('Juan Marino Arias Medina')
    expect(cells[0]).toContain('Prospecto')
    expect(cells[0]).toContain(`aria-label="${t('colStages')}"`)
    expect(cells[0]).toContain('role="group"')

    // La celda de Negocios queda solo con las cifras: encajonadas ahí,
    // las pastillas se apilaban de a una por renglón.
    const dealsCell = cells.find((c) => c.includes('data-state="breakdown"')) ?? ''
    expect(dealsCell).toContain(t('dealsOfClients', { deals: 10, clients: 13 }))
    expect(dealsCell).not.toContain('Prospecto')
  })

  it('las pastillas fluyen en horizontal y solo envuelven si no caben', () => {
    const html = render({
      rows: [
        row({
          openDeals: 10,
          dealsByStage: [
            stage({ stageId: 's-1', stageName: 'Prospecto', position: 1, deals: 4 }),
            stage({ stageId: 's-2', stageName: 'Contactado', position: 2, deals: 3 }),
            stage({ stageId: 's-3', stageName: 'Cotizado', position: 3, deals: 2 }),
            stage({ stageId: 's-4', stageName: 'Negociación', position: 4, deals: 1 }),
          ],
        }),
      ],
    })

    const group = /<span class="([^"]*)" role="group"/.exec(html)?.[1] ?? ''

    // Fila de flex que envuelve: horizontal mientras quepa. Lo que NO
    // debe haber es un contenedor que las ponga una por renglón.
    expect(group).toContain('flex')
    expect(group).toContain('flex-wrap')
    expect(group).not.toContain('flex-col')
    expect(group).not.toContain('block')
  })

  it('ninguna de las cuatro frases de cifras envuelve en escritorio', () => {
    const html = render({
      rows: [
        row({
          openConversations: 13,
          openDeals: 10,
          openConversationsWithoutDeal: 3,
          dealsByStage: [stage({ deals: 10 })],
          avgFirstResponseSeconds: 3600,
          responseSamples: 8,
        }),
        unassigned(),
      ],
    })

    const body = /<tbody[^>]*>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? ''
    // Por posición y no por texto: el `aria-label` del grupo de etapas
    // ("Negocios por etapa") contiene el rótulo de la columna Negocios y
    // haría coincidir la celda del nombre.
    const rows = body.split('<tr').slice(1)
    expect(rows).toHaveLength(2)

    for (const tr of rows) {
      const attrs = [...tr.matchAll(/<td([^>]*)>/g)].map((m) => m[1])
      expect(attrs).toHaveLength(4)

      // La primera celda es la que absorbe el sobrante: ahí sí se
      // envuelve, porque lleva el nombre y las pastillas.
      expect(attrs[0]).not.toContain('whitespace-nowrap')

      // Las tres de cifras no envuelven en escritorio: "10 de 13 · 3 sin
      // negocio" es una sola idea, igual que "no hay a quién medir".
      for (const a of attrs.slice(1)) {
        expect(a).toContain('sm:whitespace-nowrap')
      }
    }
  })
})

describe('el dato que no cuadraba: negocios sobre clientes (tarea 4ter.2)', () => {
  it('dice "10 de 13" en vez de un 10 suelto que parecía un error de conteo', () => {
    const html = render({
      rows: [
        row({
          openConversations: 13,
          openDeals: 10,
          dealsByStage: [stage({ deals: 10 })],
        }),
      ],
    })

    expect(html).toContain(t('dealsOfClients', { deals: 10, clients: 13 }))
  })

  it('muestra los clientes sin negocio, destacados', () => {
    const html = render({
      rows: [
        row({
          openConversations: 13,
          openDeals: 10,
          openConversationsWithoutDeal: 3,
          dealsByStage: [stage({ deals: 10 })],
        }),
      ],
    })

    expect(html).toContain('data-state="without-deal"')
    expect(html).toContain(t('withoutDeal', { count: 3 }))
    // Ámbar: son clientes activos sin registrar, información de venta.
    expect(html).toMatch(/data-state="without-deal"[^>]*class="[^"]*amber/)
  })

  it('no dice nada cuando no hay ninguno sin negocio: un "0 sin negocio" es ruido', () => {
    const html = render({
      rows: [
        row({
          openConversations: 10,
          openDeals: 10,
          openConversationsWithoutDeal: 0,
          dealsByStage: [stage({ deals: 10 })],
        }),
      ],
    })

    expect(html).not.toContain('data-state="without-deal"')
  })

  // La instrucción fue explícita: no calcularlo como openConversations -
  // openDeals, porque los dos conteos se agrupan por claves distintas
  // (deals.assigned_to contra conversations.assigned_agent_id) y la
  // resta puede mentir. Se verifica sobre la fuente porque lo que hay que
  // impedir es que alguien "simplifique" la columna a una resta: con el
  // campo ya en el tipo, ninguna aserción sobre el render lo detectaría.
  it('no calcula el dato restando, lo lee de la columna de la RPC', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'dashboard', 'agent-performance-table.tsx'),
      'utf8',
    )

    expect(src).toContain('row.openConversationsWithoutDeal')
    expect(src).not.toMatch(/openConversations\s*-\s*(row\.)?openDeals/)
  })

  it('también lo dice en la fila "Sin asignar", que lleva el mismo criterio', () => {
    const html = render({
      rows: [
        unassigned({
          openConversations: 108,
          openDeals: 10,
          openConversationsWithoutDeal: 98,
          dealsByStage: [stage({ deals: 10 })],
        }),
      ],
    })

    expect(html).toContain(t('dealsOfClients', { deals: 10, clients: 108 }))
    expect(html).toContain(t('withoutDeal', { count: 98 }))
  })

  it('respeta la columna aunque no coincida con la resta', () => {
    // El caso que motivó la columna: 13 conversaciones, 10 negocios, y
    // sin embargo 4 sin negocio, porque uno de esos negocios está
    // asignado a otra persona. La resta habría dicho 3.
    const html = render({
      rows: [
        row({
          openConversations: 13,
          openDeals: 10,
          openConversationsWithoutDeal: 4,
          dealsByStage: [stage({ deals: 10 })],
        }),
      ],
    })

    expect(html).toContain(t('withoutDeal', { count: 4 }))
    expect(html).not.toContain(t('withoutDeal', { count: 3 }))
  })
})

describe('el texto de "Sin asignar" (tarea 4ter.3)', () => {
  // Verificado contra producción: de las 117 conversaciones abiertas sin
  // asignar, las 117 tienen la autorespuesta activa. El texto viejo
  // —"que no está atendiendo nadie"— describía como abandono lo que es
  // la cola del bot.
  it('dice que las atiende el bot, no que no las atiende nadie', () => {
    const html = render({ rows: [unassigned({ openConversations: 117 })] })

    expect(html).toContain('bot')
    expect(html).not.toMatch(/no está atendiendo nadie/)
    expect(html).toContain('117')
  })

  it('el catálogo no describe esas conversaciones como abandonadas', () => {
    expect(t('unassignedHint')).toBe('Conversaciones abiertas que está atendiendo el bot')
  })
})

// ============================================================
// El invariante del total
// ============================================================

describe('total de conversaciones abiertas', () => {
  it('suma todas las filas, incluida la de sin asignar', () => {
    // 13 + 12 + 12 + 70 + 108 = 215, el total de la cuenta hoy.
    expect(totalOpenConversations(PRODUCTION_ROWS)).toBe(215)
  })

  it('lo muestra al pie de la tabla', () => {
    const html = render({ rows: PRODUCTION_ROWS })
    expect(html).toContain(t('total', { count: 215 }))
  })

  it('no lo muestra cuando no hay filas', () => {
    const html = render({ rows: [], loading: false })
    expect(html).not.toContain('215')
  })
})
