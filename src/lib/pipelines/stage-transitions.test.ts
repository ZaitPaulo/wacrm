import { describe, it, expect } from 'vitest'
import type { PipelineStage, PipelineStageTransition } from '@/types'
import { getAllowedTargetStages } from './stage-transitions'

const CREATED_AT = '2026-09-18T00:00:00Z'
const COLOR = '#888888'
const SALES = 'pipeline-ventas'
const OTHER = 'pipeline-otro'

/** Etapa mínima; el id se deriva del embudo y el nombre. */
function stage(pipelineId: string, name: string, position: number): PipelineStage {
  return { id: `${pipelineId}:${name}`, pipeline_id: pipelineId, name, position, color: COLOR, created_at: CREATED_AT }
}

function rule(from: PipelineStage, to: PipelineStage): PipelineStageTransition {
  return {
    id: `${from.id}->${to.id}`,
    pipeline_id: from.pipeline_id,
    from_stage_id: from.id,
    to_stage_id: to.id,
    created_at: CREATED_AT,
  }
}

// Embudo Ventas tal como está en producción, con la siembra de la migración 528.
const PROSPECTO = stage(SALES, 'Prospecto', 0)
const CONTACTADO = stage(SALES, 'Contactado', 1)
const COTIZADO = stage(SALES, 'Cotizado', 2)
const SEGUIMIENTO = stage(SALES, 'Seguimiento', 3)
const NEGOCIACION = stage(SALES, 'Negociación', 4)
const NO_VIABLE = stage(SALES, 'No viable', 5)
const CERRADO = stage(SALES, 'Cerrado', 6)
const SALES_STAGES = [PROSPECTO, CONTACTADO, COTIZADO, SEGUIMIENTO, NEGOCIACION, NO_VIABLE, CERRADO]

// Desordenadas a propósito: el resultado debe salir por posición.
const SALES_RULES = [
  rule(COTIZADO, NO_VIABLE),
  rule(NEGOCIACION, CERRADO),
  rule(COTIZADO, SEGUIMIENTO),
  rule(PROSPECTO, CONTACTADO),
  rule(CONTACTADO, NO_VIABLE),
  rule(CONTACTADO, COTIZADO),
  rule(COTIZADO, NEGOCIACION),
  rule(SEGUIMIENTO, NO_VIABLE),
  rule(SEGUIMIENTO, NEGOCIACION),
  rule(NEGOCIACION, NO_VIABLE),
]

// Embudo sin reglas propias, con posiciones desordenadas en el arreglo.
const OTHER_C = stage(OTHER, 'C', 2)
const OTHER_A = stage(OTHER, 'A', 0)
const OTHER_B = stage(OTHER, 'B', 1)
const OTHER_STAGES = [OTHER_C, OTHER_A, OTHER_B]

const ALL_STAGES = [...SALES_STAGES, ...OTHER_STAGES]

describe('getAllowedTargetStages', () => {
  it('devuelve los destinos de las reglas de la etapa actual, ordenados por posición', () => {
    expect(getAllowedTargetStages(COTIZADO.id, ALL_STAGES, SALES_RULES)).toEqual([
      SEGUIMIENTO,
      NEGOCIACION,
      NO_VIABLE,
    ])
  })

  it.each([NO_VIABLE, CERRADO])('no ofrece destinos desde una etapa final ($name)', (current) => {
    expect(getAllowedTargetStages(current.id, ALL_STAGES, SALES_RULES)).toEqual([])
  })

  it('en un embudo sin reglas permite todas las demás etapas, por posición', () => {
    expect(getAllowedTargetStages(OTHER_B.id, ALL_STAGES, [])).toEqual([OTHER_A, OTHER_C])
  })

  it('ignora las reglas de otros embudos', () => {
    // Las reglas de Ventas no convierten al otro embudo en "con reglas".
    expect(getAllowedTargetStages(OTHER_A.id, ALL_STAGES, SALES_RULES)).toEqual([OTHER_B, OTHER_C])
  })

  it('nunca incluye la etapa actual', () => {
    const result = getAllowedTargetStages(PROSPECTO.id, SALES_STAGES, [])
    expect(result).not.toContainEqual(PROSPECTO)
    expect(result).toHaveLength(SALES_STAGES.length - 1)
  })

  it('desde Seguimiento no ofrece etapas anteriores (Prospecto, Contactado, Cotizado)', () => {
    const result = getAllowedTargetStages(SEGUIMIENTO.id, ALL_STAGES, SALES_RULES)
    expect(result).toEqual([NEGOCIACION, NO_VIABLE])
    for (const earlier of [PROSPECTO, CONTACTADO, COTIZADO]) {
      expect(result).not.toContainEqual(earlier)
    }
  })

  it('no repite un destino aunque la regla venga duplicada', () => {
    const rules = [...SALES_RULES, { ...rule(PROSPECTO, CONTACTADO), id: 'duplicada' }]
    expect(getAllowedTargetStages(PROSPECTO.id, ALL_STAGES, rules)).toEqual([CONTACTADO])
  })

  it('omite destinos de reglas cuya etapa no vino en la lista de etapas', () => {
    const withoutNoViable = ALL_STAGES.filter((s) => s.id !== NO_VIABLE.id)
    expect(getAllowedTargetStages(NEGOCIACION.id, withoutNoViable, SALES_RULES)).toEqual([CERRADO])
  })

  it('en un embudo de una sola etapa no hay destinos', () => {
    const solo = stage('pipeline-solo', 'Única', 0)
    expect(getAllowedTargetStages(solo.id, [solo], [])).toEqual([])
  })

  it('no altera el orden del arreglo de etapas recibido', () => {
    const input = [...OTHER_STAGES]
    getAllowedTargetStages(OTHER_A.id, input, [])
    expect(input).toEqual(OTHER_STAGES)
  })

  it('devuelve [] si la etapa actual no está entre las etapas', () => {
    expect(getAllowedTargetStages('etapa-inexistente', ALL_STAGES, SALES_RULES)).toEqual([])
  })
})
