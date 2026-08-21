#!/usr/bin/env bash
# ============================================================================
# Restaura un respaldo hecho con scripts/backup.sh.
#
#   ./scripts/restore.sh /opt/crm-backups/20260821-031500
#   ./scripts/restore.sh <dir> --dry-run     solo comprueba que es restaurable
#
# DESTRUCTIVO: reemplaza la base y los archivos actuales. Pide confirmación
# escrita salvo que se pase --yes.
#
# Este script es la mitad que importa del plan de respaldo. Un respaldo que
# nunca se restauró no es un respaldo: es un archivo del que se supone algo.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
STORAGE_DIR="$ROOT/deploy/supabase/volumes/storage"

SRC="${1:-}"
DRY_RUN=0
ASSUME_YES=0
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes)     ASSUME_YES=1 ;;
    *) echo "opción desconocida: $arg" >&2; exit 1 ;;
  esac
done

[[ -n "$SRC" ]] || { echo "Uso: $0 <directorio-de-respaldo> [--dry-run] [--yes]" >&2; exit 1; }
[[ -d "$SRC" ]] || { echo "ERROR: no existe $SRC" >&2; exit 1; }
[[ -f "$SRC/db.dump" ]] || { echo "ERROR: falta $SRC/db.dump" >&2; exit 1; }
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || {
  echo "ERROR: no existe el contenedor '$DB_CONTAINER'. Levanta el stack primero." >&2; exit 1; }

echo "Respaldo: $SRC"
[[ -f "$SRC/MANIFIESTO.txt" ]] && sed 's/^/  /' "$SRC/MANIFIESTO.txt"
echo

# --- Comprobar que es legible ANTES de destruir nada ------------------------
echo "Comprobando integridad..."
tablas="$(docker exec -i "$DB_CONTAINER" pg_restore --list < "$SRC/db.dump" 2>/dev/null | grep -c 'TABLE DATA' || true)"
[[ "${tablas:-0}" -gt 0 ]] || { echo "ERROR: el volcado no contiene datos de tablas" >&2; exit 1; }
echo "  db.dump: legible, $tablas tabla(s) con datos"

if [[ -f "$SRC/storage.tar.gz" ]]; then
  ficheros="$(docker run --rm -v "$SRC":/backup:ro alpine:3.22 tar tzf /backup/storage.tar.gz | wc -l)"
  echo "  storage.tar.gz: legible, $ficheros entrada(s)"
else
  echo "  storage.tar.gz: no está en este respaldo"
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo
  echo "Dry run: el respaldo es restaurable. No se ha tocado nada."
  exit 0
fi

# --- Confirmación -----------------------------------------------------------
if [[ $ASSUME_YES -eq 0 ]]; then
  echo
  echo "Esto REEMPLAZA la base de datos y los archivos actuales del servidor."
  read -rp "Escribe RESTAURAR para continuar: " ok
  [[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
fi

# --- 1. Base ----------------------------------------------------------------
# --clean --if-exists borra los objetos antes de recrearlos, para que no
# queden restos de la instalación anterior mezclados con los del respaldo.
#
# Los errores de pg_restore NO son fatales por sí solos: al restaurar sobre
# una base con los roles y esquemas de Supabase ya creados, se queja de
# objetos que no puede borrar o que ya existen. Lo que importa es lo de
# después, no el código de salida.
echo
echo "Restaurando la base..."
docker exec -i "$DB_CONTAINER" pg_restore -U postgres -d postgres \
  --clean --if-exists --no-owner --no-acl < "$SRC/db.dump" 2>&1 \
  | grep -vE "does not exist|already exists" | tail -20 || true

# --- 2. Storage -------------------------------------------------------------
if [[ -f "$SRC/storage.tar.gz" ]]; then
  echo "Restaurando los archivos de Storage..."
  # Dentro de un contenedor, por el mismo motivo que en el respaldo: los
  # archivos son del usuario del contenedor de Storage.
  docker run --rm \
    -v "$STORAGE_DIR":/data \
    -v "$SRC":/backup:ro \
    alpine:3.22 sh -c 'rm -rf /data/* && tar xzf /backup/storage.tar.gz -C /data'
fi

# --- 3. Verificación --------------------------------------------------------
# No basta con que los comandos no fallaran: hay que mirar si los datos están.
echo
echo "Verificando lo restaurado:"
q() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tAc "$1" 2>/dev/null || echo '?'; }
echo "  usuarios:     $(q 'SELECT count(*) FROM auth.users')"
echo "  perfiles:     $(q 'SELECT count(*) FROM public.profiles')"
echo "  contactos:    $(q 'SELECT count(*) FROM public.contacts')"
echo "  mensajes:     $(q 'SELECT count(*) FROM public.messages')"
echo "  vehículos:    $(q 'SELECT count(*) FROM public.inventory_vehicles')"
echo "  objetos:      $(q 'SELECT count(*) FROM storage.objects')"
echo "  migraciones:  $(q 'SELECT count(*) FROM supabase_migrations.schema_migrations')"

echo
echo "Reinicia los servicios que cachean conexiones o metadatos:"
echo "  cd deploy/supabase && docker compose restart rest realtime storage auth"
echo
echo "Y entra al CRM a comprobar de verdad: inicia sesión, abre una"
echo "conversación y descarga una foto. Los números de arriba dicen que hay"
echo "filas, no que la aplicación funcione con ellas."
