-- ============================================================
-- 528_pipeline_stage_transitions.sql
--
-- Transiciones permitidas entre etapas de un embudo.
--
-- La bandeja va a dejar cambiar la etapa de un negocio, pero solo hacia
-- las etapas que el embudo permite desde la actual (Cotizado puede pasar
-- a Seguimiento, Negociación o No viable; Cerrado no pasa a ninguna).
-- Cada fila es un par origen → destino dentro de un mismo embudo.
--
-- Reglas de uso (las aplica el cliente, no la base):
--   - Un embudo SIN ninguna regla permite mover a cualquier etapa.
--   - Un embudo CON al menos una regla solo permite los pares listados;
--     una etapa sin reglas de salida queda como final.
--   - Solo la bandeja respeta las reglas. El tablero y el paso
--     `move_deal_stage` de las automatizaciones siguen libres, por eso no
--     hay trigger sobre `deals.stage_id`.
--
-- Por qué `pipeline_id` desnormalizado:
--   Sirve para la RLS (mismo patrón que `pipeline_stages` en 017) y para
--   traer todas las reglas de un embudo en una sola consulta. Que las dos
--   etapas sean de ese embudo lo garantizan FKs compuestas contra un
--   `unique (pipeline_id, id)` nuevo en `pipeline_stages`, sin trigger.
--
-- Rollback: `DROP TABLE pipeline_stage_transitions;` y
-- `ALTER TABLE pipeline_stages DROP CONSTRAINT pipeline_stages_pipeline_id_id_key;`
-- ============================================================

-- ---- unique (pipeline_id, id) en pipeline_stages --------------------
-- `id` ya es único; este par existe solo para que las FKs compuestas de
-- las reglas puedan exigir que la etapa pertenezca al embudo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_stages_pipeline_id_id_key'
      AND conrelid = 'public.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_pipeline_id_id_key UNIQUE (pipeline_id, id);
  END IF;
END $$;

-- ---- tabla ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_stage_transitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  from_stage_id UUID NOT NULL,
  to_stage_id   UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Borrar una etapa borra las reglas donde es origen o destino.
  CONSTRAINT pipeline_stage_transitions_from_fkey
    FOREIGN KEY (pipeline_id, from_stage_id)
    REFERENCES pipeline_stages(pipeline_id, id) ON DELETE CASCADE,
  CONSTRAINT pipeline_stage_transitions_to_fkey
    FOREIGN KEY (pipeline_id, to_stage_id)
    REFERENCES pipeline_stages(pipeline_id, id) ON DELETE CASCADE,
  CONSTRAINT pipeline_stage_transitions_not_self
    CHECK (from_stage_id <> to_stage_id),
  CONSTRAINT pipeline_stage_transitions_pair_key
    UNIQUE (from_stage_id, to_stage_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stage_transitions_pipeline
  ON pipeline_stage_transitions(pipeline_id);

COMMENT ON TABLE pipeline_stage_transitions IS
  'Pares origen → destino permitidos al cambiar la etapa de un negocio desde la bandeja. Un embudo sin filas permite cualquier cambio.';

-- ---- Privilegios de tabla ---------------------------------------------
-- Explícitos: no se puede confiar en los privilegios por defecto del
-- esquema. En el stack local actual una tabla nueva de `postgres` solo le
-- da a `authenticated` TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, y sin
-- SELECT la bandeja trataría el error como "sin reglas" (todo permitido)
-- y el editor de ajustes no podría ni leer ni guardar. Quién ve y quién
-- modifica cada fila lo decide la RLS de abajo; `anon` no necesita nada.
GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_stage_transitions TO authenticated;
GRANT ALL ON pipeline_stage_transitions TO service_role;

-- ---- RLS: miembros leen, admins modifican (igual que pipeline_stages) --
ALTER TABLE pipeline_stage_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_stage_transitions_select ON pipeline_stage_transitions;
CREATE POLICY pipeline_stage_transitions_select ON pipeline_stage_transitions FOR SELECT USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stage_transitions.pipeline_id AND is_account_member(p.account_id))
);

DROP POLICY IF EXISTS pipeline_stage_transitions_modify ON pipeline_stage_transitions;
CREATE POLICY pipeline_stage_transitions_modify ON pipeline_stage_transitions FOR ALL USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stage_transitions.pipeline_id AND is_account_member(p.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stage_transitions.pipeline_id AND is_account_member(p.account_id, 'admin'))
);

-- ---- siembra del embudo "Ventas" -------------------------------------
-- Por nombre y no por id: los ids cambian entre bases y los nombres
-- pueden traer mayúsculas o espacios de más. Si falta el embudo o alguna
-- etapa, el JOIN no produce esa fila y el par se omite en silencio.
-- Idempotente gracias al unique (from_stage_id, to_stage_id).
INSERT INTO pipeline_stage_transitions (pipeline_id, from_stage_id, to_stage_id)
SELECT p.id, f.id, t.id
FROM (VALUES
  ('prospecto',   'contactado'),
  ('contactado',  'cotizado'),
  ('contactado',  'no viable'),
  ('cotizado',    'seguimiento'),
  ('cotizado',    'negociación'),
  ('cotizado',    'no viable'),
  ('seguimiento', 'negociación'),
  ('seguimiento', 'no viable'),
  ('negociación', 'no viable'),
  ('negociación', 'cerrado')
) AS r(from_name, to_name)
JOIN pipelines p       ON lower(trim(p.name)) = 'ventas'
JOIN pipeline_stages f ON f.pipeline_id = p.id AND lower(trim(f.name)) = r.from_name
JOIN pipeline_stages t ON t.pipeline_id = p.id AND lower(trim(t.name)) = r.to_name
ON CONFLICT (from_stage_id, to_stage_id) DO NOTHING;
