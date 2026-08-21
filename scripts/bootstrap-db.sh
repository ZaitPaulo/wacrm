#!/usr/bin/env bash
# ============================================================================
# Deja la base lista para recibir las migraciones.
#
#   ./scripts/bootstrap-db.sh
#
# Idempotente: se puede correr las veces que haga falta.
#
# Hace dos cosas, y la segunda es la que importa:
#
#   1. Crea `supabase_migrations.schema_migrations`, la misma tabla que usa
#      el CLI de Supabase, para que `supabase db push` siga siendo utilizable
#      desde una máquina de desarrollo.
#
#   2. Crea la publicación `supabase_realtime` si falta. En Supabase Cloud
#      viene creada de fábrica; en un stack autoalojado, no. Y
#      `001_initial_schema.sql` hace `ALTER PUBLICATION supabase_realtime ADD
#      TABLE messages`, que falla si la publicación no existe — o sea que sin
#      este paso la PRIMERA migración se cae y no arranca nada.
# ============================================================================
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "ERROR: no existe el contenedor '$CONTAINER'." >&2
  echo "Levanta el stack primero: cd deploy/supabase && docker compose up -d" >&2
  exit 1
}

psql_run() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "Preparando la base en '$CONTAINER'..."

psql_run <<'SQL'
-- Registro de migraciones aplicadas. Mismo esquema y tabla que el CLI.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version     text PRIMARY KEY,
  name        text,
  statements  text[],
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- La publicación de Realtime. Sin ella la migración 001 falla.
-- CREATE PUBLICATION no admite IF NOT EXISTS, de ahí el bloque.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
    RAISE NOTICE 'publicación supabase_realtime creada';
  ELSE
    RAISE NOTICE 'publicación supabase_realtime ya existía, sin cambios';
  END IF;
END
$$;
SQL

echo
echo "Estado:"
psql_run -tA -c "SELECT '  publicación supabase_realtime: ' || CASE WHEN EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN 'ok' ELSE 'FALTA' END;"
psql_run -tA -c "SELECT '  migraciones registradas: ' || count(*) FROM supabase_migrations.schema_migrations;"
echo
echo "Base lista. Siguiente: ./scripts/apply-migrations.sh"
