#!/usr/bin/env bash
# ============================================================================
# Respaldo del despliegue: la base y los archivos de Storage.
#
#   ./scripts/backup.sh                 respalda y aplica retención
#   BACKUP_DIR=/otro ./scripts/backup.sh
#
# Guarda FUERA del árbol del repo (por defecto /opt/crm-backups) a propósito:
# dentro, un `git clean -xdf` se llevaría por delante los respaldos junto con
# la base que pretenden proteger.
#
# Un respaldo que falla y lo dice es un incidente; uno que falla en silencio
# es una pérdida de datos que se descubre el día que hace falta restaurar.
# Por eso aquí nada se reporta como correcto sin comprobarlo: cada pieza se
# verifica después de escribirla, y si algo falla el script sale con error y
# BORRA los restos, para que no quede un respaldo a medias con aspecto de
# bueno.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/opt/crm-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
STORAGE_DIR="$ROOT/deploy/supabase/volumes/storage"
STAMP="$(date '+%Y%m%d-%H%M%S')"
DEST="$BACKUP_DIR/$STAMP"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
die() {
  echo "ERROR: $*" >&2
  # Restos de un intento fallido: fuera. Un directorio a medias en la carpeta
  # de respaldos es peor que ninguno, porque parece uno bueno.
  [[ -d "$DEST" ]] && rm -rf "$DEST"
  echo "RESPALDO FALLIDO — no hay copia nueva de esta ejecución." >&2
  exit 1
}

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "no existe el contenedor '$DB_CONTAINER'"

mkdir -p "$DEST" || die "no se puede escribir en $BACKUP_DIR"
log "Destino: $DEST"

# --- 1. Base de datos -------------------------------------------------------
# Formato custom (-Fc): comprimido y restaurable con pg_restore de forma
# selectiva, que es lo que quieres cuando hay que recuperar una sola tabla y
# no la instalación entera.
log "Volcando Postgres..."
if ! docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres -Fc \
     > "$DEST/db.dump" 2> "$DEST/db.err"; then
  cat "$DEST/db.err" >&2
  die "pg_dump falló"
fi
rm -f "$DEST/db.err"

# pg_dump puede salir con 0 y dejar un archivo inservible si la redirección
# falló a medias. Se comprueba el tamaño y que pg_restore sepa leerlo.
[[ -s "$DEST/db.dump" ]] || die "el volcado quedó vacío"
docker exec -i "$DB_CONTAINER" pg_restore --list < "$DEST/db.dump" > /dev/null 2>&1 \
  || die "el volcado existe pero pg_restore no puede leerlo"
log "  db.dump  $(du -h "$DEST/db.dump" | cut -f1)  (índice legible)"

# --- 2. Archivos de Storage -------------------------------------------------
# El tar corre DENTRO de un contenedor porque los archivos son del usuario
# del contenedor de Storage: hacerlo desde el host fallaría con "permission
# denied", y con sudo dejaría el respaldo perteneciendo a root.
if [[ -d "$STORAGE_DIR" ]]; then
  log "Empaquetando Storage..."
  docker run --rm \
    -v "$STORAGE_DIR":/data:ro \
    -v "$DEST":/backup \
    alpine:3.22 tar czf /backup/storage.tar.gz -C /data . \
    || die "el empaquetado de Storage falló"
  docker run --rm -v "$DEST":/backup alpine:3.22 tar tzf /backup/storage.tar.gz > /dev/null \
    || die "storage.tar.gz se escribió pero no se puede leer"
  log "  storage.tar.gz  $(du -h "$DEST/storage.tar.gz" | cut -f1)  (índice legible)"
else
  log "  AVISO: no existe $STORAGE_DIR; sin archivos que respaldar todavía"
fi

# --- 3. Manifiesto ----------------------------------------------------------
# Para saber, al restaurar, contra qué versión del código se tomó esto.
{
  echo "fecha:       $(date -Iseconds)"
  echo "commit:      $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo '?')"
  echo "rama:        $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  echo "migraciones: $(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
                        'SELECT count(*) FROM supabase_migrations.schema_migrations' 2>/dev/null || echo '?')"
} > "$DEST/MANIFIESTO.txt"

# --- 4. Retención -----------------------------------------------------------
log "Aplicando retención (${RETENTION_DAYS} días)..."
borrados=0
while IFS= read -r old; do
  [[ -z "$old" ]] && continue
  rm -rf "$old"
  borrados=$((borrados+1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -mtime "+${RETENTION_DAYS}" 2>/dev/null)
log "  $borrados respaldo(s) antiguo(s) eliminado(s)"

echo
log "RESPALDO CORRECTO: $DEST"
echo
echo "  Esto NO es una copia externa. Sigue en el mismo servidor y en el mismo"
echo "  proveedor: si se pierde la cuenta o el disco, se pierden los dos a la"
echo "  vez. Súbelo a un almacenamiento de terceros."
