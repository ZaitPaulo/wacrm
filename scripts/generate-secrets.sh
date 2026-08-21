#!/usr/bin/env bash
# ============================================================================
# Genera el .env del despliegue autoalojado, con secretos nuevos.
#
#   ./scripts/generate-secrets.sh
#
# Escribe deploy/.env y NO lo sobreescribe si ya existe: regenerar los
# secretos de una instalación en marcha deja la base inaccesible y las
# credenciales de Meta ilegibles. Para rotar, ver docs/self-hosting.md.
#
# Cada valor se genera con la longitud y el formato que exige quien lo
# consume. No son preferencias: Realtime rechaza una clave que no mida
# exactamente 16 caracteres, y el cifrado de tokens de Meta espera 64 hex.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env"

if [[ -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE ya existe." >&2
  echo >&2
  echo "Regenerar los secretos de una instalación en marcha rompe el acceso a" >&2
  echo "la base y deja ilegibles las credenciales de Meta ya guardadas." >&2
  echo "Si de verdad quieres empezar de cero, mueve el archivo a un lado." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "ERROR: hace falta openssl" >&2; exit 1; }

# --- El dominio se pide, no se adivina -------------------------------------
DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  read -rp "Dominio del despliegue (ej. loramotors.co): " DOMAIN
fi
[[ -n "$DOMAIN" ]] || { echo "ERROR: el dominio es obligatorio" >&2; exit 1; }

APP_URL="https://${DOMAIN}"
SUPABASE_URL="https://supabase.${DOMAIN}"

# --- Firma de JWT HS256 -----------------------------------------------------
# Las claves anon y service_role son JWT firmados con JWT_SECRET. Tienen que
# estar firmados con el MISMO secreto que usa el stack, o el gateway rechaza
# todas las peticiones del app con un 401 que no dice por qué.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

sign_jwt() {
  local role="$1" secret="$2" iat exp header payload input sig
  iat="$(date +%s)"
  exp="$(( iat + 60*60*24*365*10 ))"   # 10 años: no queremos una caída por caducidad
  header='{"alg":"HS256","typ":"JWT"}'
  payload="{\"role\":\"${role}\",\"iss\":\"supabase\",\"iat\":${iat},\"exp\":${exp}}"
  input="$(printf '%s' "$header" | b64url).$(printf '%s' "$payload" | b64url)"
  sig="$(printf '%s' "$input" | openssl dgst -binary -sha256 -hmac "$secret" | b64url)"
  printf '%s.%s' "$input" "$sig"
}

# --- Secretos ---------------------------------------------------------------
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 32)"              # 64 chars; exige >= 32
ANON_KEY="$(sign_jwt anon "$JWT_SECRET")"
SERVICE_ROLE_KEY="$(sign_jwt service_role "$JWT_SECRET")"
SECRET_KEY_BASE="$(openssl rand -base64 48 | tr -d '\n')"   # exige >= 64 chars
REALTIME_DB_ENC_KEY="$(openssl rand -hex 8)"      # EXACTAMENTE 16
VAULT_ENC_KEY="$(openssl rand -hex 16)"           # EXACTAMENTE 32
PG_META_CRYPTO_KEY="$(openssl rand -base64 24 | tr -d '\n')"
S3_PROTOCOL_ACCESS_KEY_ID="$(openssl rand -hex 16)"
S3_PROTOCOL_ACCESS_KEY_SECRET="$(openssl rand -hex 32)"
DASHBOARD_USERNAME="admin"
DASHBOARD_PASSWORD="$(openssl rand -base64 18 | tr -d '\n/+=')"

# Del app, no del stack de Supabase:
ENCRYPTION_KEY="$(openssl rand -hex 32)"          # 64 hex, AES-256-GCM de los tokens de Meta
AUTOMATION_CRON_SECRET="$(openssl rand -hex 32)"

mkdir -p "$ROOT/deploy"
umask 077   # el archivo nace 600: son secretos, no configuración

cat > "$ENV_FILE" <<EOF
# ============================================================================
# GENERADO POR scripts/generate-secrets.sh — NO SE VERSIONA
#
# Guarda una copia FUERA del servidor, en un gestor de contraseñas.
# ENCRYPTION_KEY merece atención especial: si se pierde, las credenciales de
# Meta guardadas quedan ilegibles y hay que reconectar WhatsApp en cada cuenta.
# ============================================================================

# --- Qué composes forman el stack (lo lee Docker Compose) -------------------
COMPOSE_FILE=docker-compose.yml:docker-compose.crm.yml

# --- Postgres ---------------------------------------------------------------
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# --- Claves de Supabase -----------------------------------------------------
# ANON_KEY y SERVICE_ROLE_KEY están firmadas con este JWT_SECRET. Si cambias
# el secreto, hay que regenerar las dos o el gateway devuelve 401 a todo.
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY=3600
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}

# Claves opacas nuevas de Supabase. Se dejan VACIAS a proposito: el app lee
# NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY y las pasa a
# @supabase/ssr, asi que las JWT de arriba funcionan sin tocar src/. Migrar a
# claves asimetricas es un cambio aparte, con su propia rotacion.
# Van declaradas aunque vacias para que Compose no avise en cada comando: un
# warning que sale siempre es un warning que se deja de leer.
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

# --- Secretos internos del stack --------------------------------------------
SECRET_KEY_BASE=${SECRET_KEY_BASE}
REALTIME_DB_ENC_KEY=${REALTIME_DB_ENC_KEY}
VAULT_ENC_KEY=${VAULT_ENC_KEY}
PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY}
S3_PROTOCOL_ACCESS_KEY_ID=${S3_PROTOCOL_ACCESS_KEY_ID}
S3_PROTOCOL_ACCESS_KEY_SECRET=${S3_PROTOCOL_ACCESS_KEY_SECRET}

# --- URLs públicas ----------------------------------------------------------
SUPABASE_PUBLIC_URL=${SUPABASE_URL}
API_EXTERNAL_URL=${SUPABASE_URL}
SITE_URL=${APP_URL}
ADDITIONAL_REDIRECT_URLS=

# --- Studio -----------------------------------------------------------------
# Studio da acceso total a la base. Va detrás de Basic Auth en el proxy.
DASHBOARD_USERNAME=${DASHBOARD_USERNAME}
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
STUDIO_DEFAULT_ORGANIZATION=LoraMotors
STUDIO_DEFAULT_PROJECT=CRM

# --- Auth -------------------------------------------------------------------
# Autoconfirmación activada porque no hay relay SMTP todavía. Consecuencia
# conocida: el reseteo de contraseña por correo NO funciona; se hace desde
# Studio. Ver design.md, decisión 8.
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
MAILER_URLPATHS_INVITE=/auth/v1/verify
MAILER_URLPATHS_RECOVERY=/auth/v1/verify
MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
SMTP_ADMIN_EMAIL=admin@${DOMAIN}
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=LoraMotors

# --- PostgREST --------------------------------------------------------------
PGRST_DB_SCHEMAS=public,storage,graphql_public
PGRST_DB_EXTRA_SEARCH_PATH=public,extensions
PGRST_DB_MAX_ROWS=1000

# --- Storage ----------------------------------------------------------------
STORAGE_TENANT_ID=loramotors
GLOBAL_S3_BUCKET=stub
IMGPROXY_AUTO_WEBP=true

# --- Servicios apagados (valores presentes para que Compose valide) ---------
FUNCTIONS_VERIFY_JWT=false
POOLER_TENANT_ID=loramotors
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_DB_POOL_SIZE=5
POOLER_PROXY_PORT_TRANSACTION=6543
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
REGION=local

# Asistente SQL de Studio. Opcional y sin relacion con la IA del CRM, que es
# bring-your-own-key por cuenta desde la interfaz.
OPENAI_API_KEY=

# ============================================================================
# Del app Next.js — no los consume el stack de Supabase
# ============================================================================

# OJO: los NEXT_PUBLIC_* se hornean en el bundle EN TIEMPO DE BUILD.
# Cambiar cualquiera de estos exige reconstruir la imagen (--build),
# no basta con reiniciar el contenedor.
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
NEXT_PUBLIC_SITE_URL=${APP_URL}
NEXT_PUBLIC_APP_LOCALE=es

SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}

# Si se pierde, las credenciales de Meta guardadas quedan ilegibles y hay que
# reconectar WhatsApp en cada cuenta. 64 caracteres hexadecimales.
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Sin esto, /api/automations/cron y /api/flows/cron devuelven 503 y los pasos
# Wait de las automatizaciones se quedan colgados para siempre.
AUTOMATION_CRON_SECRET=${AUTOMATION_CRON_SECRET}

# --- Meta: se rellenan a mano desde Meta for Developers ---------------------
# El webhook rechaza toda petición sin firma válida, así que META_APP_SECRET
# es obligatorio para recibir mensajes.
META_APP_ID=
META_APP_SECRET=

# --- Dominio (lo usan el Caddyfile y los scripts) ---------------------------
DOMAIN=${DOMAIN}
EOF

# El stack se levanta desde deploy/supabase/, y Compose lee el .env del
# directorio del proyecto. Un enlace evita mantener dos copias divergentes
# del mismo secreto, que es como se acaba con un JWT_SECRET distinto en cada
# archivo y un 401 imposible de explicar.
ln -sfn ../.env "$ROOT/deploy/supabase/.env"

echo "Escrito: $ENV_FILE (permisos 600)"
echo "Enlace : deploy/supabase/.env -> ../.env"
echo
echo "FALTA RELLENAR A MANO: META_APP_ID y META_APP_SECRET"
echo "GUARDA UNA COPIA FUERA DEL SERVIDOR antes de seguir."
