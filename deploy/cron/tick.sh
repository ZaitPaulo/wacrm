#!/bin/sh
# ============================================================================
# Golpea una ruta de cron del app por la RED INTERNA de Docker.
#
#   tick.sh /api/automations/cron
#
# Va a http://app:3000 y no al dominio público a propósito: la petición no
# sale a internet, no pasa por Caddy y no depende de que el DNS o el
# certificado estén bien. Un problema de TLS no debería parar las
# automatizaciones.
# ============================================================================
set -u

PATH_TO_HIT="$1"
URL="http://app:3000${PATH_TO_HIT}"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"

if [ -z "${AUTOMATION_CRON_SECRET:-}" ]; then
  echo "$STAMP  ERROR  AUTOMATION_CRON_SECRET no está en el entorno; $PATH_TO_HIT devolvería 503"
  exit 1
fi

# busybox wget trae --header, así que no hace falta instalar curl en la imagen.
# Un HTTP != 2xx hace que wget salga con error y escriba el motivo en stderr.
if RESPONSE="$(wget -q -O- --header="x-cron-secret: ${AUTOMATION_CRON_SECRET}" "$URL" 2>&1)"; then
  echo "$STAMP  ok     $PATH_TO_HIT  $RESPONSE"
else
  # Los dos fallos que importan y cómo se distinguen:
  #   401 -> el secreto del cron no coincide con el del app
  #   503 -> el app arrancó sin AUTOMATION_CRON_SECRET definido
  echo "$STAMP  FALLO  $PATH_TO_HIT  $RESPONSE"
  exit 1
fi
