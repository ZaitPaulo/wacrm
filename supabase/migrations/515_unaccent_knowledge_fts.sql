-- ============================================================
-- 515 — La búsqueda del knowledge base deja de depender de las tildes.
--
-- El índice se construía con `to_tsvector('simple', content)`, que trata
-- "automática" y "automatica" como palabras distintas. En el inventario
-- real eso partía la búsqueda en dos: 96 vehículos dicen "Transmisión:
-- automática" y ninguno aparecía ante la consulta "automatico". Lo mismo
-- con "mecanica", "financiacion" o "sabados".
--
-- Importa más de lo que parece porque hoy la recuperación es SOLO léxica
-- —la cuenta no tiene clave de embeddings—, y porque quien escribe es un
-- cliente por WhatsApp, donde las tildes son la excepción, no la regla.
--
-- Se normalizan los dos lados: el texto indexado y la consulta. Normalizar
-- uno solo deja el problema igual de roto, nada más que al revés.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- `unaccent(text)` NO es IMMUTABLE: resuelve el diccionario en tiempo de
-- ejecución, y una columna generada exige inmutabilidad. La forma de dos
-- argumentos fija el diccionario, con lo que la llamada pasa a ser
-- determinista; envolverla así es el patrón estándar para este caso.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

REVOKE ALL ON FUNCTION public.immutable_unaccent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.immutable_unaccent(text) TO authenticated, service_role;

-- Recrear la columna generada. `DROP` se lleva por delante el índice GIN
-- que la usaba, así que se vuelve a crear justo después.
ALTER TABLE ai_knowledge_chunks DROP COLUMN IF EXISTS fts;
ALTER TABLE ai_knowledge_chunks
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', public.immutable_unaccent(content))) STORED;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_idx
  ON ai_knowledge_chunks USING gin (fts);

-- El otro lado: la consulta del cliente entra sin normalizar. Si solo se
-- normalizara el índice, "automática" con tilde dejaría de encontrar lo
-- que antes sí encontraba.
--
-- Y DE PASO SE CAMBIA EL OPERADOR. `plainto_tsquery` une los términos con
-- AND, o sea que exigía que TODAS las palabras del cliente estuvieran en
-- el mismo trozo de texto. Nadie escribe así: "carro automatico
-- barranquilla" devolvía cero resultados —los documentos dicen "Vehículo",
-- no "carro"— y una sola palabra de más dejaba al bot sin nada que citar.
-- Con OR entran los trozos que coinciden en algo y `ts_rank` los ordena
-- por cuántos términos aciertan, que es lo que hace útil un buscador para
-- recuperación: el que más coincide sube, y el LIMIT corta la cola.
--
-- `NULLIF` cubre la consulta que se queda sin términos (solo signos, o
-- palabras vacías): sin él, la tsquery vacía haría fallar la llamada en
-- vez de devolver cero filas.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  WITH q AS (
    SELECT NULLIF(
             replace(
               plainto_tsquery('simple', public.immutable_unaccent(p_query))::text,
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
