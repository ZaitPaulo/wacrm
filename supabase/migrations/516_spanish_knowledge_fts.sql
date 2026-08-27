-- ============================================================
-- 516 — El índice del knowledge base pasa a entender español.
--
-- La 515 quitó las tildes de la ecuación, pero se quedó corta: con la
-- configuración `simple` no hay derivación de palabras, así que género y
-- número siguen partiendo la búsqueda. Medido sobre el inventario real:
--
--   consulta        simple    spanish
--   "automatica"        96         96
--   "automatico"         0         96   <- 96 vehículos invisibles
--   "mecanico"           0         40   <- 40 más
--
-- El texto dice "Transmisión: automática" porque concuerda con
-- "transmisión"; el cliente escribe "busco un carro automatico" porque
-- concuerda con "carro". Sin derivación son dos palabras distintas y no
-- se encuentran nunca.
--
-- POR QUÉ AQUÍ SÍ Y EN EL UPSTREAM NO: la migración 030 eligió `simple`
-- a propósito, por ser neutral respecto al idioma, y para un CRM que se
-- instala en cualquier país es la decisión correcta. Este fork atiende a
-- clientes colombianos por WhatsApp y todo su contenido está en español,
-- así que la neutralidad solo cuesta resultados. `spanish` además
-- descarta las palabras vacías del idioma —"quiero", "un", "el"— que en
-- una consulta con OR solo aportaban ruido al ranking.
-- ============================================================

ALTER TABLE ai_knowledge_chunks DROP COLUMN IF EXISTS fts;
ALTER TABLE ai_knowledge_chunks
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', public.immutable_unaccent(content))) STORED;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_idx
  ON ai_knowledge_chunks USING gin (fts);

-- Las dos configuraciones tienen que coincidir: derivar el texto con
-- `spanish` y la consulta con `simple` no encontraría nada.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  WITH q AS (
    SELECT NULLIF(
             replace(
               plainto_tsquery('spanish', public.immutable_unaccent(p_query))::text,
               '&', '|'),
             '')::tsquery AS tsq
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, q.tsq) AS rank
  FROM ai_knowledge_chunks c, q
  WHERE c.account_id = p_account_id
    AND q.tsq IS NOT NULL
    AND c.fts @@ q.tsq
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
