"use client"

import { Users, AlertCircle, RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { AccountRole } from '@/lib/auth/roles'
import type { AgentPerformanceRow, AgentStageBreakdown } from '@/lib/dashboard/types'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface AgentPerformanceTableProps {
  /** Filas ya agregadas por la RPC. `null` mientras carga o tras fallar. */
  rows: AgentPerformanceRow[] | null
  loading: boolean
  /** La RPC lanzó. Se distingue de "no hay filas" para poder reintentar. */
  error?: boolean
  onRetry?: () => void
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Unidad del catálogo con el número ya redondeado para esa unidad. */
export interface ResponseTimeDisplay {
  unit: 'seconds' | 'minutes' | 'hours' | 'days'
  value: string
}

/**
 * Elige la unidad más grande que deje un número legible, para que
 * "10.800 s" se lea como "3.0 h".
 *
 * Devuelve `null` cuando no hay dato, y quien llama decide cómo pintar
 * la ausencia. Nunca devuelve un cero por falta de muestras: un "0 min"
 * se leería como "responde al instante", que es lo contrario de lo que
 * pasó. El spec lo pide explícito —"su tiempo promedio se muestra
 * vacío, no como cero minutos"— y en producción es el caso normal,
 * porque los mensajes anteriores a la migración 531 no tienen autor.
 *
 * Un cero que sí es un cero medido —respondió dentro del mismo segundo—
 * devuelve `0 s`, no `null`: eso sí se midió.
 */
export function formatResponseSeconds(seconds: number | null): ResponseTimeDisplay | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null
  if (seconds < MINUTE) return { unit: 'seconds', value: String(Math.round(seconds)) }
  if (seconds < HOUR) return { unit: 'minutes', value: String(Math.round(seconds / MINUTE)) }
  if (seconds < DAY) return { unit: 'hours', value: (seconds / HOUR).toFixed(1) }
  return { unit: 'days', value: (seconds / DAY).toFixed(1) }
}

/**
 * Deja las filas listas para pintar SIN reordenar a las personas.
 *
 * La RPC ya decide el orden —asesores primero, luego quien aparece por
 * cartera, "Sin asignar" al final— y ese criterio es suyo: reordenar acá
 * por cantidad de clientes convertiría la tabla en un ranking, que no es
 * lo que pide el spec, y además pondría a "Sin asignar" arriba, porque
 * tiene más conversaciones que cualquier persona.
 *
 * Lo único que se garantiza desde la interfaz es esa última parte: una
 * partición estable que manda las filas sin dueño al final sin tocar el
 * orden relativo de nadie. Es la exigencia del spec ("fila adicional")
 * y no depende de que la RPC la mantenga.
 */
export function orderRows(rows: AgentPerformanceRow[]): AgentPerformanceRow[] {
  return [
    ...rows.filter((r) => !r.isUnassigned),
    ...rows.filter((r) => r.isUnassigned),
  ]
}

/**
 * Suma de clientes en gestión de todas las filas.
 *
 * El backend garantiza que cuadra exacto con las conversaciones abiertas
 * de la cuenta. Se muestra al pie porque es el invariante que delata un
 * error de conteo: si la suma no da el total que el operador ve en otra
 * parte del tablero, hay trabajo que se está contando dos veces o
 * ninguna.
 */
export function totalOpenConversations(rows: AgentPerformanceRow[]): number {
  return rows.reduce((sum, r) => sum + r.openConversations, 0)
}

/** Clave del catálogo para cada rol de cuenta. */
const ROLE_LABEL_KEY: Record<AccountRole, 'roleOwner' | 'roleAdmin' | 'roleAgent' | 'roleViewer'> =
  {
    owner: 'roleOwner',
    admin: 'roleAdmin',
    agent: 'roleAgent',
    viewer: 'roleViewer',
  }

/** Clave estable de la fila: la de "Sin asignar" no tiene usuario. */
function rowKey(row: AgentPerformanceRow): string {
  return row.isUnassigned ? '__unassigned__' : (row.agentUserId ?? row.fullName ?? '?')
}

/**
 * Rendimiento del equipo: clientes en gestión, negocios y tiempo
 * promedio de primera respuesta, por persona que atiende.
 *
 * "Persona que atiende" y no "asesor" a propósito: la tabla lista a todo
 * miembro con rol `agent` y además a cualquier `owner`/`admin` con
 * cartera. En producción hay una administradora con 70 conversaciones de
 * la campaña de propietarios, así que un encabezado que dijera "Asesor"
 * mentiría en una de cinco filas. El rol va en una pastilla junto al
 * nombre, que es lo que explica por qué alguien que no es asesor aparece.
 *
 * Presentacional puro — recibe las filas ya agregadas por
 * `loadAgentPerformance`. El montaje lo decide la página con
 * `canEditSettings`, no el largo del arreglo: la carga devuelve `[]`
 * tanto cuando la RPC le niega el acceso a un `agent` como cuando de
 * verdad no hay nadie a quien medir, y desde acá los dos casos se ven
 * iguales.
 *
 * ## Densidad (grupo 4ter)
 *
 * La tarjeta va a **ancho completo**, como el resto del panel. Acotarla
 * con un `max-w` fue un intento fallido: la densidad no es un problema de
 * ancho del contenedor, y comprimirlo solo partió las etiquetas en dos y
 * tres líneas y dejó media pantalla vacía al lado.
 *
 * La densidad se resuelve **distribuyendo**:
 *
 *   - El nombre absorbe el sobrante (`w-full` en su encabezado) y las
 *     tres columnas de cifras se encogen a su contenido, así que quedan
 *     pegadas entre sí al final de la fila y se leen como un bloque.
 *   - Cada una lleva `sm:whitespace-nowrap`: "10 de 13 · 3 sin negocio"
 *     es una sola idea y no debe envolver. El prefijo `sm:` es
 *     deliberado — en la tarjeta de teléfono sí tienen que poder
 *     envolver, o desbordarían a 360 px.
 *   - El desglose por etapas **dejó de ser una columna** y vive bajo el
 *     nombre, en la celda que absorbe el sobrante. Ahí tiene ancho para
 *     fluir en horizontal en vez de apilarse de a una por renglón, la
 *     fila baja de cinco líneas a dos, y el sobrante deja de estar vacío.
 *     Dentro de la celda de Negocios quedaban encajonadas en una columna
 *     del ancho de su propio texto, que era el problema.
 *
 * ## Dos ausencias que NO son ceros
 *
 *   - `dealsByStage === null` es "sin datos": pastilla de borde punteado
 *     con la palabra, en cursiva y `muted`. Un arreglo vacío sí es un
 *     cero medido y se dibuja como "0 de N". Hoy en producción todas las
 *     filas llegan en null, porque la cuenta todavía no tiene negocios.
 *   - `avgFirstResponseSeconds === null` es "sin muestras": guion y el
 *     motivo al lado. Esta columna nace vacía y así debe verse.
 *
 * La regla visual es una sola: lo medido va en número tabular y color de
 * texto normal; lo ausente va en `muted`, con guion o borde punteado, y
 * siempre con una palabra que diga por qué falta. No hay barras ni
 * ninguna codificación proporcional: con 117 contra 12 en la misma
 * columna, cualquier escala dejaría a tres personas como una raya.
 *
 * ## Responsive
 *
 * Una sola tabla semántica que por debajo de `sm` se reparte en tarjetas
 * (`block sm:table-row`), con el rótulo de cada dato al lado del valor y
 * sin cabecera. Las columnas no caben en 360 px, y resolverlo con scroll
 * horizontal escondería justo las métricas, que son las columnas de la
 * derecha. Es el mismo criterio de `mobile-inbox-layout`: recomponer por
 * breakpoint, no desbordar.
 */
export function AgentPerformanceTable({
  rows,
  loading,
  error = false,
  onRetry,
}: AgentPerformanceTableProps) {
  const t = useTranslations('Dashboard.agentPerformance')

  const ordered = rows ? orderRows(rows) : []

  return (
    // Ancho completo, como todas las tarjetas del panel. Acotarlo fue un
    // error: no juntaba las cifras, solo las comprimía hasta partirlas, y
    // dejaba media pantalla vacía al lado — un vacío peor que el de
    // adentro, porque se lee como un error de maquetación.
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      <div className="p-5">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3">
            <EmptyState icon={AlertCircle} title={t('error')} hint={t('errorHint')} />
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted sm:min-h-9"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
                {t('retry')}
              </button>
            )}
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState icon={Users} title={t('empty')} hint={t('emptyHint')} />
        ) : (
          <>
            {/* `block sm:table` es parte del patrón, no un adorno: con
                `tbody`, `tr` y `td` en `block`, una tabla que siguiera
                en `display:table` envolvería las tarjetas en celdas
                anónimas y volvería a imponer el ancho de la fila. */}
            <table className="block w-full border-collapse text-sm sm:table">
              {/* La cabecera desaparece en teléfono: ahí cada dato lleva
                  su rótulo al lado, dentro de la tarjeta. */}
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-border">
                  {/* El nombre absorbe el sobrante para que las tres
                      cifras queden pegadas entre sí, no repartidas. */}
                  <th
                    scope="col"
                    className="w-full pb-2 pr-3 text-left text-xs font-medium text-muted-foreground"
                  >
                    {t('colPerson')}
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap pb-2 pr-4 text-right text-xs font-medium text-muted-foreground"
                  >
                    {t('colClients')}
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap pb-2 pr-4 text-left text-xs font-medium text-muted-foreground"
                  >
                    {t('colDeals')}
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap pb-2 text-right text-xs font-medium text-muted-foreground"
                  >
                    {t('colResponse')}
                  </th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {ordered.map((row) => (
                  <PersonRow key={rowKey(row)} row={row} />
                ))}
              </tbody>
            </table>

            {/* El invariante del backend: la suma de las filas cuadra con
                las conversaciones abiertas de la cuenta. Se muestra para
                que un descuadre se note. */}
            <p className="mt-3 text-xs tabular-nums text-muted-foreground">
              {t('total', { count: totalOpenConversations(ordered) })}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

/**
 * Una fila de la tabla: una persona con cartera, o la fila "Sin asignar"
 * (`row.isUnassigned`), que usa el mismo formato pero sin rol ni tiempo
 * de respuesta, porque no hay nadie a quien medir.
 */
function PersonRow({ row }: { row: AgentPerformanceRow }) {
  const t = useTranslations('Dashboard.agentPerformance')
  const response = formatResponseSeconds(row.avgFirstResponseSeconds)
  // Null solo en "Sin asignar", que no es una persona y ya se explica
  // con su propia etiqueta: ahí no va pastilla de rol.
  const role = row.accountRole

  return (
    <tr
      data-unassigned={row.isUnassigned ? 'true' : undefined}
      className={cn(
        // Tarjeta apilada en teléfono, fila de tabla desde `sm`.
        'mt-2 block rounded-lg border border-border p-3 first:mt-0',
        'sm:mt-0 sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:border-border sm:p-0',
        // "Sin asignar" no es una persona: fondo propio para que no se
        // lea como una fila más del equipo.
        row.isUnassigned && 'bg-muted/50',
      )}
    >
      {/* La celda que absorbe el sobrante. Por eso las pastillas de
          etapa viven acá y no en la de Negocios: ahí quedaban encajonadas
          en una columna del ancho de "10 de 13 · 3 sin negocio" y se
          apilaban una por renglón, estirando la fila a cinco líneas. Con
          el sobrante a disposición fluyen en horizontal y la fila baja a
          dos. De paso el sobrante deja de estar vacío. */}
      <td className="block sm:table-cell sm:py-2.5 sm:pr-6 sm:align-top">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'font-medium text-foreground',
              row.isUnassigned && 'italic text-muted-foreground',
            )}
          >
            {row.isUnassigned ? t('unassigned') : (row.fullName ?? t('unnamedPerson'))}
          </span>
          {role && <RoleBadge role={role} />}
        </span>
        {row.isUnassigned && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t('unassignedHint')}
          </span>
        )}
        {row.dealsByStage !== null && row.dealsByStage.length > 0 && (
          <StageChips stages={row.dealsByStage} />
        )}
      </td>

      {/* Las tres cifras van pegadas al final, cada una con su ancho
          natural gracias a `sm:whitespace-nowrap`: son unidades de
          lectura y ninguna debe envolver. El nowrap lleva prefijo de
          breakpoint a propósito — en la tarjeta de teléfono sí tienen que
          poder envolver, o desbordarían a 360 px. */}
      <td className="mt-2 flex items-baseline gap-2 sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:py-2.5 sm:pr-6 sm:text-right sm:align-top">
        <span className="text-xs text-muted-foreground sm:hidden">{t('colClients')}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {row.openConversations.toLocaleString()}
        </span>
      </td>

      <td className="mt-2 block sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:py-2.5 sm:pr-6 sm:align-top">
        <span className="mb-1 block text-xs text-muted-foreground sm:hidden">
          {t('colDeals')}
        </span>
        <DealsCell row={row} />
      </td>

      <td className="mt-2 flex flex-wrap items-baseline gap-x-2 sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:py-2.5 sm:text-right sm:align-top">
        <span className="text-xs text-muted-foreground sm:hidden">{t('colResponse')}</span>
        {response === null ? (
          // Ausente, no cero. El guion va acompañado del motivo para que
          // nadie lo lea como "responde en cero minutos".
          <span data-state="absent" className="text-muted-foreground">
            <span aria-hidden>—</span>
            <span className="ml-1.5 text-xs">
              {row.isUnassigned ? t('noOneToMeasure') : t('noResponseSamples')}
            </span>
          </span>
        ) : (
          <span data-state="measured" className="tabular-nums text-foreground">
            {t(response.unit, { value: response.value })}
            {/* Espacio real y no solo el margen: sin él el texto sale
                como "3.0 hsobre 7 respuestas" para quien lo lee sin
                estilos, un lector de pantalla incluido. */}
            {' '}
            <span className="text-xs text-muted-foreground">
              {t('samples', { count: row.responseSamples })}
            </span>
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * Celda de Negocios: cuántos de los clientes en gestión tienen negocio y
 * cuántos no. El desglose por etapa va aparte, bajo el nombre, donde hay
 * ancho para que fluya (ver `StageChips`).
 *
 * El formato "10 de 13 · 3 sin negocio" lo eligió el Director, y resuelve
 * una lectura que antes no cuadraba: 13 clientes junto a un desglose que
 * sumaba 10 parecía un error de conteo, cuando lo que dice es que hay 3
 * clientes conversando que nunca entraron al embudo. Eso es trabajo de
 * venta a la vista, no un detalle de implementación, y por eso va
 * destacado en ámbar y no en `muted`.
 *
 * Tres estados deliberadamente distintos: sin datos (`null`), cero
 * medido (arreglo vacío) y el desglose.
 */
function DealsCell({ row }: { row: AgentPerformanceRow }) {
  const t = useTranslations('Dashboard.agentPerformance')

  if (row.dealsByStage === null) {
    return (
      <span
        data-state="no-data"
        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-xs italic text-muted-foreground"
        title={t('noStageDataHint')}
      >
        {t('noStageData')}
      </span>
    )
  }

  // Columna propia de la RPC (3quater), NO `openConversations -
  // openDeals`: los dos conteos se agrupan por claves distintas
  // —`conversations.assigned_agent_id` uno y `deals.assigned_to` el
  // otro—, así que un negocio asignado a alguien cuya conversación es de
  // otro haría que la resta mintiera.
  const without = row.openConversationsWithoutDeal

  return (
    <span data-state={row.dealsByStage.length === 0 ? 'zero' : 'breakdown'} className="block">
      <span>
        <span className="tabular-nums text-foreground">
          {t('dealsOfClients', { deals: row.openDeals, clients: row.openConversations })}
        </span>
        {/* Solo cuando hay alguno: un "0 sin negocio" es ruido. */}
        {without > 0 && (
          <>
            <span className="mx-1.5 text-muted-foreground" aria-hidden>
              ·
            </span>
            <span
              data-state="without-deal"
              className="text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400"
            >
              {t('withoutDeal', { count: without })}
            </span>
          </>
        )}
      </span>
    </span>
  )
}

/**
 * Pastillas de etapa, en un renglón debajo del nombre.
 *
 * Ya no son una columna: subordinadas, más chicas y con el color de la
 * etapa como único adorno. El grupo lleva etiqueta accesible porque
 * perdió el encabezado de columna que antes lo nombraba.
 *
 * Fluyen en horizontal y envuelven solo cuando de verdad no quepan. Cada
 * pastilla es `whitespace-nowrap` para que no se parta por dentro —"●
 * Negociación 1" es una unidad— pero el contenedor sí envuelve, así que
 * en un teléfono se acomodan en varios renglones sin desbordar.
 */
function StageChips({ stages }: { stages: AgentStageBreakdown[] }) {
  const t = useTranslations('Dashboard.agentPerformance')

  return (
    <span
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"
      role="group"
      aria-label={t('colStages')}
    >
      {[...stages]
        .sort((a, b) => a.position - b.position)
        .map((stage) => (
          <span
            key={stage.stageId}
            className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground sm:whitespace-nowrap"
          >
            <span
              className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: stage.color }}
              aria-hidden
            />
            <span className="truncate">{stage.stageName}</span>
            <span className="flex-shrink-0 tabular-nums text-foreground">
              {stage.deals.toLocaleString()}
            </span>
          </span>
        ))}
    </span>
  )
}

/**
 * Pastilla con el rol de la fila.
 *
 * `agent` va en gris: es lo esperable y no necesita explicación.
 * `owner`/`admin` van en violeta —el acento de la marca— porque son la
 * excepción: aparecen por tener cartera, no por ser asesores, y sin esa
 * marca la tabla parecería tener un asesor de más. Violeta y no ámbar
 * para no chocar con "sin negocio", que sí es una señal de atención; un
 * administrador con cartera no es un problema, solo es distinto.
 *
 * El color nunca es el único portador del dato: la palabra del rol está
 * escrita.
 */
function RoleBadge({ role }: { role: AccountRole }) {
  const t = useTranslations('Dashboard.agentPerformance')
  const labelKey = ROLE_LABEL_KEY[role]

  // Un rol que la interfaz no conoce —porque se agregó al enum de la
  // base después— no lleva pastilla en vez de llevar una equivocada.
  // Mapa y no cadena de ternarios justamente por esto: el `else` de un
  // ternario habría rotulado cualquier rol nuevo como "Observador".
  if (!labelKey) return null

  const label = t(labelKey)

  return (
    <span
      data-role={role}
      className={cn(
        'inline-flex flex-shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide',
        role === 'owner' || role === 'admin'
          ? 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}
