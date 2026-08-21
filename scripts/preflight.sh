#!/usr/bin/env bash
# ============================================================================
# Comprueba deploy/.env ANTES de levantar el stack.
#
#   ./scripts/preflight.sh
#
# Existe porque los fallos que detecta no se manifiestan al arrancar, sino
# más tarde y disfrazados de otra cosa: un JWT_SECRET que no corresponde con
# las claves da 401 en todas las peticiones sin decir por qué, y un
# ENCRYPTION_KEY con la longitud equivocada solo falla el día que alguien
# conecta WhatsApp.
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/deploy/.env}"

errors=0
warns=0
fail() { echo "  FALLO   $*" >&2; errors=$((errors+1)); }
warn() { echo "  AVISO   $*" >&2; warns=$((warns+1)); }
ok()   { echo "  ok      $*"; }

[[ -f "$ENV_FILE" ]] || {
  echo "ERROR: no existe $ENV_FILE" >&2
  echo "Genéralo con: ./scripts/generate-secrets.sh" >&2
  exit 1
}

# Lee el archivo sin ejecutarlo: un .env no es un script y no debe evaluarse.
get() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }

echo "Verificando $ENV_FILE"
echo

# --- 1. Valores de plantilla sin reemplazar ---------------------------------
echo "Valores de plantilla:"
plantillas="$(grep -nE '=(your-|change-me|CHANGEME|example|stub-me|TU_)' "$ENV_FILE" || true)"
if [[ -n "$plantillas" ]]; then
  while IFS= read -r l; do fail "sin reemplazar → $l"; done <<< "$plantillas"
else
  ok "ningún valor de ejemplo sobrevivió"
fi

# --- 2. Variables obligatorias con valor ------------------------------------
echo
echo "Variables obligatorias:"
for v in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SECRET_KEY_BASE \
         REALTIME_DB_ENC_KEY VAULT_ENC_KEY PG_META_CRYPTO_KEY \
         DASHBOARD_USERNAME DASHBOARD_PASSWORD \
         SUPABASE_PUBLIC_URL API_EXTERNAL_URL SITE_URL \
         NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
         NEXT_PUBLIC_SITE_URL SUPABASE_SERVICE_ROLE_KEY \
         ENCRYPTION_KEY AUTOMATION_CRON_SECRET DOMAIN LETSENCRYPT_EMAIL; do
  [[ -n "$(get "$v")" ]] || fail "$v está vacía o no existe"
done
[[ $errors -eq 0 ]] && ok "las 21 obligatorias tienen valor"

# --- 3. Longitudes exactas que exige cada servicio --------------------------
echo
echo "Formato de los secretos:"

enc="$(get ENCRYPTION_KEY)"
if [[ "$enc" =~ ^[0-9a-fA-F]{64}$ ]]; then
  ok "ENCRYPTION_KEY: 64 hex (AES-256-GCM)"
else
  fail "ENCRYPTION_KEY debe ser 64 caracteres hexadecimales, es '${#enc}' caracteres"
fi

rt="$(get REALTIME_DB_ENC_KEY)"
[[ ${#rt} -eq 16 ]] && ok "REALTIME_DB_ENC_KEY: 16 caracteres" \
                    || fail "REALTIME_DB_ENC_KEY debe medir EXACTAMENTE 16, mide ${#rt}"

vk="$(get VAULT_ENC_KEY)"
[[ ${#vk} -eq 32 ]] && ok "VAULT_ENC_KEY: 32 caracteres" \
                    || fail "VAULT_ENC_KEY debe medir EXACTAMENTE 32, mide ${#vk}"

skb="$(get SECRET_KEY_BASE)"
[[ ${#skb} -ge 64 ]] && ok "SECRET_KEY_BASE: ${#skb} caracteres (>= 64)" \
                     || fail "SECRET_KEY_BASE debe medir al menos 64, mide ${#skb}"

js="$(get JWT_SECRET)"
[[ ${#js} -ge 32 ]] && ok "JWT_SECRET: ${#js} caracteres (>= 32)" \
                    || fail "JWT_SECRET debe medir al menos 32, mide ${#js}"

pgm="$(get PG_META_CRYPTO_KEY)"
[[ ${#pgm} -ge 32 ]] && ok "PG_META_CRYPTO_KEY: ${#pgm} caracteres (>= 32)" \
                     || fail "PG_META_CRYPTO_KEY debe medir al menos 32, mide ${#pgm}"

# --- 4. Las claves están firmadas con ESTE JWT_SECRET -----------------------
# Es la comprobación que justifica el script. Una clave copiada de otra
# instalación tiene forma de JWT válido y pasa cualquier inspección visual,
# pero el gateway la rechaza y el app devuelve 401 en todo sin explicar nada.
echo
echo "Coherencia de las claves con JWT_SECRET:"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

check_jwt() {
  local name="$1" token="$2" secret="$3" input sig expected role
  input="${token%.*}"
  sig="${token##*.}"
  expected="$(printf '%s' "$input" | openssl dgst -binary -sha256 -hmac "$secret" | b64url)"
  if [[ "$sig" != "$expected" ]]; then
    fail "$name NO está firmada con el JWT_SECRET de este archivo"
    return
  fi
  role="$(printf '%s' "${input#*.}=====" | tr '_-' '/+' | openssl base64 -d -A 2>/dev/null | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')"
  ok "$name: firma válida, role=$role"
}

if command -v openssl >/dev/null; then
  check_jwt ANON_KEY "$(get ANON_KEY)" "$js"
  check_jwt SERVICE_ROLE_KEY "$(get SERVICE_ROLE_KEY)" "$js"
  [[ "$(get NEXT_PUBLIC_SUPABASE_ANON_KEY)" == "$(get ANON_KEY)" ]] \
    && ok "NEXT_PUBLIC_SUPABASE_ANON_KEY coincide con ANON_KEY" \
    || fail "NEXT_PUBLIC_SUPABASE_ANON_KEY difiere de ANON_KEY"
  [[ "$(get SUPABASE_SERVICE_ROLE_KEY)" == "$(get SERVICE_ROLE_KEY)" ]] \
    && ok "SUPABASE_SERVICE_ROLE_KEY coincide con SERVICE_ROLE_KEY" \
    || fail "SUPABASE_SERVICE_ROLE_KEY difiere de SERVICE_ROLE_KEY"
else
  warn "sin openssl no se puede verificar la firma de las claves"
fi

# --- 5. Coherencia de URLs --------------------------------------------------
echo
echo "URLs:"
dom="$(get DOMAIN)"
for v in SUPABASE_PUBLIC_URL API_EXTERNAL_URL NEXT_PUBLIC_SUPABASE_URL; do
  val="$(get "$v")"
  [[ "$val" == "https://supabase.${dom}" ]] && ok "$v = $val" \
    || fail "$v debería ser https://supabase.${dom}, es '$val'"
done
for v in SITE_URL NEXT_PUBLIC_SITE_URL; do
  val="$(get "$v")"
  [[ "$val" == "https://${dom}" ]] && ok "$v = $val" \
    || fail "$v debería ser https://${dom}, es '$val'"
done

# --- 6. Meta: avisa, no bloquea ---------------------------------------------
echo
echo "Meta (no bloquea el arranque del stack):"
[[ -n "$(get META_APP_SECRET)" ]] && ok "META_APP_SECRET definido" \
  || warn "META_APP_SECRET vacío: el webhook rechazará todo mensaje entrante"
[[ -n "$(get META_APP_ID)" ]] && ok "META_APP_ID definido" \
  || warn "META_APP_ID vacío"

# --- 7. Permisos ------------------------------------------------------------
echo
echo "Permisos:"
perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
[[ "$perm" == "600" ]] && ok "$ENV_FILE es 600" \
  || warn "$ENV_FILE tiene permisos $perm; deberían ser 600 (chmod 600)"

echo
if [[ $errors -gt 0 ]]; then
  echo "RESULTADO: $errors fallo(s), $warns aviso(s). NO levantes el stack todavía." >&2
  exit 1
fi
echo "RESULTADO: sin fallos, $warns aviso(s). Puedes levantar el stack."
