#!/usr/bin/env bash
# Repara texno.site: DNS, conflictos Nginx y certificado SSL
#   sudo CERTBOT_EMAIL=tu@email.com bash deploy/fix-texno-site.sh

set -euo pipefail

DOMAIN="texno.site"
WWW="www.texno.site"
EMAIL="${CERTBOT_EMAIL:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS_IP="$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || true)"
# shellcheck source=lib/dns-check.sh
source "${REPO_ROOT}/deploy/lib/dns-check.sh"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta con sudo."
  exit 1
fi

echo "═══════════════════════════════════════════"
echo "  TEXNO — reparación ${DOMAIN}"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. DNS ──────────────────────────────────
echo "▶ 1/4  DNS"
AUTH_IPS="$(dns_authoritative_ips "$DOMAIN")"
CACHE_IPS="$(dns_resolver_ips "$DOMAIN")"
LOCAL_IPS="$(dns_local_ips "$DOMAIN")"
echo "   DNS autoritativo (Hostinger): $(echo "$AUTH_IPS" | paste -sd ', ' -)"
echo "   DNS resolvers (caché):        $(echo "$CACHE_IPS" | paste -sd ', ' -)"
echo "   DNS local VPS:                $(echo "$LOCAL_IPS" | paste -sd ', ' -)"
echo "   IP del VPS:                   ${VPS_IP}"

BAD_AUTH="$(echo "$AUTH_IPS" | grep -v "^${VPS_IP}$" || true)"
if [[ -n "$BAD_AUTH" ]] || [[ -z "$AUTH_IPS" ]]; then
  echo ""
  echo "   ❌ DNS incorrecto en Hostinger."
  echo "   Edita la zona DNS y deja SOLO:  A @ → ${VPS_IP}   A www → ${VPS_IP}"
  exit 1
fi

STALE="$(echo "$CACHE_IPS" | grep -v "^${VPS_IP}$" || true)"
if [[ -n "$STALE" ]]; then
  echo "   ⚠️  Caché antigua en algunos resolvers ($(echo "$STALE" | paste -sd ', ' -))."
  echo "       Hostinger ya está bien; continuamos con el certificado."
fi
echo "   ✓ DNS autoritativo OK"
echo ""

# ── 2. TEXNO local ──────────────────────────
echo "▶ 2/4  TEXNO (PM2 / puerto 3847)"
if ! curl -fsS "http://127.0.0.1:3847/api/health" >/dev/null 2>&1; then
  echo "   TEXNO no responde en 3847. Arrancando…"
  sudo -u ubuntu bash -c "cd ${REPO_ROOT} && npm run pm2:reset" || true
fi
if curl -fsS "http://127.0.0.1:3847/api/health" >/dev/null 2>&1; then
  echo "   ✓ TEXNO OK en localhost:3847"
else
  echo "   ❌ TEXNO no arranca. Ejecuta: cd ${REPO_ROOT} && npm run pm2:reset"
  exit 1
fi
echo ""

# ── 3. Conflictos Nginx ─────────────────────
echo "▶ 3/4  Nginx — buscando conflictos"
CONFLICTS="$(grep -Rsl "server_name.*${DOMAIN}" /etc/nginx/sites-enabled/ 2>/dev/null \
  | grep -v "${DOMAIN}.conf" || true)"

if [[ -n "$CONFLICTS" ]]; then
  echo "   ⚠️  Otros virtual hosts declaran ${DOMAIN}:"
  echo "$CONFLICTS" | sed 's/^/      /'
  echo ""
  echo "   Edita esos archivos y QUITA '${DOMAIN}' y 'www.${DOMAIN}' del server_name."
  echo "   Solo debe quedar en: /etc/nginx/sites-enabled/${DOMAIN}.conf"
  echo ""
  read -r -p "   ¿Continuar igual? [y/N] " OK
  [[ "${OK:-}" =~ ^[yY]$ ]] || exit 1
else
  echo "   ✓ Sin conflictos en sites-enabled"
fi

# Comprobar si HTTPS sirve Next.js (app equivocada)
HTTPS_SERVER="$(curl -skI --max-time 5 "https://${DOMAIN}/" 2>/dev/null | grep -i 'x-nextjs' || true)"
if [[ -n "$HTTPS_SERVER" ]]; then
  echo "   ⚠️  https://${DOMAIN} sirve Next.js (otra app), no TEXNO."
  echo "       Se reinstalará la config correcta tras obtener el certificado."
fi
echo ""

# ── 4. SSL + config final ───────────────────
echo "▶ 4/4  Certificado SSL + Nginx"
if [[ -z "$EMAIL" ]]; then
  read -r -p "   Email Let's Encrypt: " EMAIL
fi

bash "${REPO_ROOT}/deploy/setup-texno-site.sh"

echo ""
echo "═══════════════════════════════════════════"
BODY="$(curl -sk --max-time 10 "https://${DOMAIN}/" 2>/dev/null | head -1 || true)"
if echo "$BODY" | grep -qi "TEXNO\|<!DOCTYPE html"; then
  if curl -sk "https://${DOMAIN}/" 2>/dev/null | grep -q "TEXNO"; then
    echo "  ✓ https://${DOMAIN} → TEXNO"
  else
    echo "  ⚠️  HTTPS responde pero revisa el contenido manualmente."
  fi
else
  echo "  Verifica: curl -sI https://${DOMAIN}/api/health"
fi
echo "═══════════════════════════════════════════"
