import type { PipelineStage, PipelineStageTransition } from '@/types'

/**
 * Etapas a las que se puede mover un negocio desde la bandeja.
 *
 * Solo cuenta el embudo de la etapa actual: las etapas y reglas de otros
 * embudos se ignoran, así que se le puede pasar todo lo cargado de golpe.
 * - Si ese embudo tiene al menos una regla, los destinos son exactamente los
 *   de las reglas cuyo origen es la etapa actual (sin reglas de salida = etapa
 *   final, sin destinos).
 * - Si el embudo no tiene ninguna regla, se puede ir a cualquier otra etapa.
 *
 * Devuelve las etapas ordenadas por `position`, nunca incluye la actual, y
 * devuelve [] si la etapa actual no está entre `stages`.
 */
export function getAllowedTargetStages(
  currentStageId: string,
  stages: PipelineStage[],
  transitions: PipelineStageTransition[],
): PipelineStage[] {
  const current = stages.find((s) => s.id === currentStageId)
  if (!current) return []

  const pipelineId = current.pipeline_id
  const candidates = stages.filter(
    (s) => s.pipeline_id === pipelineId && s.id !== currentStageId,
  )
  const pipelineRules = transitions.filter((t) => t.pipeline_id === pipelineId)

  let allowed = candidates
  if (pipelineRules.length > 0) {
    const targets = new Set(
      pipelineRules
        .filter((t) => t.from_stage_id === currentStageId)
        .map((t) => t.to_stage_id),
    )
    allowed = candidates.filter((s) => targets.has(s.id))
  }

  return [...allowed].sort((a, b) => a.position - b.position)
}
