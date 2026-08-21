#!/usr/bin/env bash
# ============================================================================
# Programa el respaldo diario en el crontab del usuario actual.
#
#   ./scripts/install-backup-cron.sh            instala (3:15 cada día)
#   ./scripts/install-backup-cron.sh --show     muestra lo que hay
#   ./scripts/install-backup-cron.sh --remove   lo quita
#
# ---------------------------------------------------------------------------
# POR QUÉ ESTE NO VA EN EL COMPOSE, Y EL DE LAS AUTOMATIZACIONES SÍ
#
# El contenedor `cron` del compose hace peticiones HTTP al app y no necesita
# nada más. El respaldo, en cambio, necesita `docker exec` sobre la base y
# `docker run` para empaquetar Storage — o sea, hablar con el demonio de
# Docker.
#
# Meterlo en un contenedor obligaría a montarle /var/run/docker.sock, y quien
# alcanza ese socket puede arrancar un contenedor privilegiado que monte el
# disco del host: es acceso root a la máquina entera. Cambiar esa garantía por
# la comodidad de verlo en `docker compose ps` es un mal negocio, y más en el
# servicio cuyo trabajo es proteger los datos.
#
# Contrapartida asumida: esto vive fuera del compose, así que hay que
# reinstalarlo si se reprovisiona el servidor. De ahí que exista este script
# y que quede documentado en docs/self-hosting.md.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="# crm-backup (instalado por scripts/install-backup-cron.sh)"
SCHEDULE="${BACKUP_SCHEDULE:-15 3 * * *}"
LOG="${BACKUP_LOG:-/opt/crm-backups/backup.log}"
LINE="${SCHEDULE} ${ROOT}/scripts/backup.sh >> ${LOG} 2>&1"

current() { crontab -l 2>/dev/null || true; }
without_ours() { current | grep -vF "$MARKER" | grep -vF "${ROOT}/scripts/backup.sh" || true; }

case "${1:-install}" in
  --show)
    echo "Crontab actual de $(whoami):"
    current | sed 's/^/  /'
    exit 0
    ;;
  --remove)
    without_ours | crontab -
    echo "Respaldo diario desprogramado."
    exit 0
    ;;
  install|"")
    ;;
  *)
    echo "Opción desconocida: $1" >&2; exit 1 ;;
esac

[[ -x "$ROOT/scripts/backup.sh" ]] || { echo "ERROR: falta scripts/backup.sh o no es ejecutable" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")" || { echo "ERROR: no se puede crear $(dirname "$LOG")" >&2; exit 1; }

{ without_ours; echo "$MARKER"; echo "$LINE"; } | crontab -

echo "Respaldo diario programado:"
echo "  $LINE"
echo
echo "A las 3:15, hora del servidor ($(date '+%Z, ahora son las %H:%M'))."
echo
echo "Comprueba mañana que corrió:  tail -20 $LOG"
echo
echo "Y ojo con lo que este cron NO cubre: si deja de ejecutarse —disco lleno,"
echo "servidor reprovisionado, crontab perdido— el log simplemente deja de"
echo "crecer y nadie se entera. Para eso define BACKUP_PING_URL en deploy/.env"
echo "con una comprobación de Healthchecks.io o similar, que avisa por la"
echo "ausencia de la señal."
