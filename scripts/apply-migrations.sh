#!/usr/bin/env bash
# ============================================================================
# Aplica supabase/migrations/*.sql en orden sobre la base del stack.
#
#   ./scripts/apply-migrations.sh            aplica lo que falte
#   ./scripts/apply-migrations.sh --dry-run  solo dice qué haría
#
# Requiere haber corrido ./scripts/bootstrap-db.sh antes.
#
# No usa el CLI de Supabase, por dos razones:
#
#   1. No hay que instalar Deno ni el CLI en el servidor. `psql` ya vive
#      dentro del contenedor de la base.
#
#   2. Los nombres de estas migraciones no son los del CLI. Son `001_…`,
#      `030_…`, `514_…`, no los `20240115123045_…` de 14 dígitos que genera
#      él. Hoy funcionaría, pero es una suposición sobre su parser de
#      versiones que no queremos en el camino crítico de un despliegue.
#
# Cada migración va en UNA transacción junto con su registro: si la migración
# falla, no queda a medias ni se marca como aplicada. Se comprobó que ninguna
# usa `CREATE INDEX CONCURRENTLY`, que no puede correr dentro de transacción.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

[[ -d "$MIGRATIONS_DIR" ]] || { echo "ERROR: no existe $MIGRATIONS_DIR" >&2; exit 1; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "ERROR: no existe el contenedor '$CONTAINER'. Levanta el stack primero." >&2
  exit 1
}

psql_q() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }

# El bootstrap tiene que haber corrido: sin la tabla no sabemos qué se aplicó,
# y sin la publicación la migración 001 se cae.
if ! psql_q -c "SELECT to_regclass('supabase_migrations.schema_migrations')" | grep -q .; then
  echo "ERROR: falta supabase_migrations.schema_migrations." >&2
  echo "Corre primero: ./scripts/bootstrap-db.sh" >&2
  exit 1
fi

applied_versions="$(psql_q -c "SELECT version FROM supabase_migrations.schema_migrations")"

total=0; skipped=0; ok=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  [[ -e "$file" ]] || continue
  total=$((total+1))
  base="$(basename "$file")"
  version="${base%%_*}"          # 001_initial_schema.sql -> 001
  name="${base#*_}"; name="${name%.sql}"

  if grep -qx "$version" <<< "$applied_versions"; then
    skipped=$((skipped+1))
    continue
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  aplicaría  $base"
    ok=$((ok+1))
    continue
  fi

  printf '  %-52s ' "$base"

  # La migración y su registro, en la misma transacción. Si algo falla,
  # ON_ERROR_STOP corta, la transacción no se commitea y la versión NO queda
  # registrada — así reintentar después no se salta una migración a medias.
  if {
       echo "BEGIN;"
       cat "$file"
       echo
       printf "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('%s', '%s');\n" \
         "$version" "${name//\'/\'\'}"
       echo "COMMIT;"
     } | docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q > /tmp/migr.$$.log 2>&1
  then
    echo "ok"
    ok=$((ok+1))
  else
    echo "FALLÓ"
    echo
    echo "--- error en $base ---" >&2
    cat /tmp/migr.$$.log >&2
    rm -f /tmp/migr.$$.log
    echo >&2
    echo "La transacción se revirtió: $base NO quedó aplicada ni registrada." >&2
    echo "Las $ok anteriores sí. Corrige el problema y vuelve a ejecutar." >&2
    exit 1
  fi
  rm -f /tmp/migr.$$.log
done

echo
if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run: $total encontradas, $skipped ya aplicadas, $ok pendientes."
  exit 0
fi
echo "Listo: $total encontradas, $skipped ya estaban, $ok aplicadas ahora."
psql_q -c "SELECT '  total registradas: ' || count(*) FROM supabase_migrations.schema_migrations"
