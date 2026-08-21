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
# Copia externa. Vacio = solo respaldo local. Se lee de deploy/.env mas abajo.
REMOTE_RETENTION_DAYS="${REMOTE_RETENTION_DAYS:-30}"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
STORAGE_DIR="$ROOT/deploy/supabase/volumes/storage"
STAMP="$(date '+%Y%m%d-%H%M%S')"
DEST="$BACKUP_DIR/$STAMP"

# Monitorización opcional (Healthchecks.io o equivalente). Si BACKUP_PING_URL
# está definida, se avisa al empezar y al terminar. Sirve para el fallo que de
# verdad duele: no el respaldo que grita, sino el que dejó de ejecutarse hace
# tres semanas —cron parado, disco lleno, servidor reinstalado— sin que nadie
# lo note. Ningún log detecta eso; un servicio que espera una señal, sí.
# Corriendo desde cron no hay entorno cargado, asi que la URL se lee de
# deploy/.env. Se extrae con sed en vez de hacer `source`: un .env es datos,
# y evaluarlo como script convierte cualquier valor raro en ejecucion.
if [[ -f "$ROOT/deploy/.env" ]]; then
  [[ -n "${BACKUP_PING_URL:-}" ]] || BACKUP_PING_URL="$(sed -n 's/^BACKUP_PING_URL=//p' "$ROOT/deploy/.env" | head -1)"
  [[ -n "${RCLONE_REMOTE:-}" ]] || RCLONE_REMOTE="$(sed -n 's/^RCLONE_REMOTE=//p' "$ROOT/deploy/.env" | head -1)"
fi
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

ping() {
  [[ -n "${BACKUP_PING_URL:-}" ]] || return 0
  wget -qO- --timeout=10 "${BACKUP_PING_URL}${1:-}" >/dev/null 2>&1 || true
}

log() { echo "[$(date '+%H:%M:%S')] $*"; }
die() {
  ping "/fail"
  echo "ERROR: $*" >&2
  # Restos de un intento fallido: fuera. Un directorio a medias en la carpeta
  # de respaldos es peor que ninguno, porque parece uno bueno.
  [[ -d "$DEST" ]] && rm -rf "$DEST"
  echo "RESPALDO FALLIDO — no hay copia nueva de esta ejecución." >&2
  exit 1
}

ping "/start"
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

# --- 5. Copia externa -------------------------------------------------------
# Va DENTRO de este script, y no como paso aparte despues, a proposito: si la
# subida falla, el respaldo entero cuenta como fallido y salta el aviso. Un
# respaldo local que existe pero nunca salio del servidor es exactamente la
# ilusion que una copia externa deberia eliminar.
if [[ -n "$RCLONE_REMOTE" ]]; then
  command -v rclone >/dev/null || die "RCLONE_REMOTE está definido pero rclone no está instalado"

  log "Subiendo a $RCLONE_REMOTE..."
  rclone copy "$DEST" "$RCLONE_REMOTE/$STAMP"     --transfers 4 --checkers 8 --retries 3 --low-level-retries 10     || die "la subida a $RCLONE_REMOTE falló"

  # No basta con que rclone salga con 0: se comprueba que los archivos estan
  # ARRIBA, y que db.dump —el que de verdad importa— es uno de ellos.
  subidos="$(rclone lsf "$RCLONE_REMOTE/$STAMP" 2>/dev/null || true)"
  grep -q '^db.dump$' <<< "$subidos" || die "la subida terminó pero db.dump no está en el remoto"
  log "  $(wc -l <<< "$subidos") archivo(s) confirmado(s) en el remoto"

  # Retención remota, aparte de la local: el disco del servidor y la cuota de
  # la nube no tienen por qué aguantar lo mismo.
  log "Retención remota (${REMOTE_RETENTION_DAYS} días)..."
  rclone delete "$RCLONE_REMOTE" --min-age "${REMOTE_RETENTION_DAYS}d" --rmdirs 2>/dev/null || true
else
  log "AVISO: sin RCLONE_REMOTE, este respaldo NO sale del servidor"
fi

ping
echo
log "RESPALDO CORRECTO: $DEST"
if [[ -n "$RCLONE_REMOTE" ]]; then
  echo "  Copia externa en $RCLONE_REMOTE/$STAMP"
else
  echo
  echo "  Esto NO es una copia externa. Sigue en el mismo servidor y en el mismo"
  echo "  proveedor: si se pierde la cuenta o el disco, se pierden los dos a la"
  echo "  vez. Configura RCLONE_REMOTE en deploy/.env."
fi
