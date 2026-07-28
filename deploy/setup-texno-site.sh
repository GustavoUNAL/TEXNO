#!/usr/bin/env bash
# Configura Nginx + Let's Encrypt para https://texno.site
# Ejecutar en el VPS:
#   cd ~/projects/TEXNO && sudo CERTBOT_EMAIL=tu@email.com bash deploy/setup-texno-site.sh

set -euo pipefail

DOMAIN="texno.site"
WWW="www.texno.site"
EMAIL="${CERTBOT_EMAIL:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/dns-check.sh
source "${REPO_ROOT}/deploy/lib/dns-check.sh"
NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}.conf"
CERTBOT_WEBROOT="/var/www/certbot"
ACME_DIR="${CERTBOT_WEBROOT}/.well-known/acme-challenge"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta con sudo: sudo bash deploy/setup-texno-site.sh"
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  read -r -p "Email para Let's Encrypt: " EMAIL
fi

echo "==> Instalando nginx y certbot (si faltan)..."
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx curl

echo "==> Comprobando DNS de ${DOMAIN}..."
RESOLVED_IPS="$(dns_public_ips "$DOMAIN" | tr '\n' ' ')"
WWW_IPS="$(dns_public_ips "$WWW" | tr '\n' ' ')"
LOCAL_IPS="$(dns_local_ips "$DOMAIN" | tr '\n' ' ')"
SERVER_IP="$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || true)"
echo "    ${DOMAIN} A (público): ${RESOLVED_IPS:-?}"
echo "    ${WWW} A (público):     ${WWW_IPS:-?}"
echo "    ${DOMAIN} A (caché VPS): ${LOCAL_IPS:-?}"
echo "    VPS IPv4:               ${SERVER_IP:-?}"

IP_COUNT="$(dns_public_ips "$DOMAIN" | wc -l | tr -d ' ')"
if [[ "${IP_COUNT:-0}" -gt 1 ]]; then
  echo ""
  echo "ERROR: ${DOMAIN} tiene ${IP_COUNT} registros A distintos en DNS público."
  echo "       Deja SOLO esta IP en Hostinger: ${SERVER_IP}"
  echo "       IPs actuales: $(dns_public_ips "$DOMAIN" | paste -sd ', ' -)"
  exit 1
fi

if [[ -n "$RESOLVED_IPS" && -n "$SERVER_IP" && "$RESOLVED_IPS" != *"$SERVER_IP"* ]]; then
  echo "AVISO: el DNS no apunta a este servidor."
  read -r -p "¿Continuar? [y/N] " OK
  [[ "${OK:-}" =~ ^[yY]$ ]] || exit 1
fi

echo "==> Buscando conflictos en Nginx..."
if grep -Rsl "server_name.*${DOMAIN}" /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "${DOMAIN}.conf"; then
  echo "AVISO: otro virtual host ya declara ${DOMAIN}."
  echo "       Revisa esos archivos antes de continuar."
  read -r -p "¿Continuar? [y/N] " OK
  [[ "${OK:-}" =~ ^[yY]$ ]] || exit 1
fi

echo "==> Preparando webroot ACME..."
mkdir -p "$ACME_DIR"
chown -R www-data:www-data "$CERTBOT_WEBROOT"
chmod -R 755 "$CERTBOT_WEBROOT"

echo "==> Configuración HTTP temporal..."
cat > "$NGINX_AVAILABLE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW};

    access_log /var/log/nginx/${DOMAIN}.bootstrap.access.log;
    error_log  /var/log/nginx/${DOMAIN}.bootstrap.error.log;

    location ^~ /.well-known/acme-challenge/ {
        alias ${ACME_DIR}/;
        default_type text/plain;
        allow all;
    }

    location / {
        return 200 'TEXNO bootstrap\n';
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx

echo "==> Prueba local del challenge (debe devolver OK)..."
echo "local-test" > "${ACME_DIR}/ping"
chown www-data:www-data "${ACME_DIR}/ping"
sleep 1

for HOST in "$DOMAIN" "$WWW"; do
  BODY="$(curl -fsS "http://${HOST}/.well-known/acme-challenge/ping" 2>/dev/null || true)"
  if [[ "$BODY" != "local-test" ]]; then
    echo "FALLO: http://${HOST}/.well-known/acme-challenge/ping → '${BODY:-error}'"
    echo "Últimas líneas del log de Nginx:"
    tail -n 15 "/var/log/nginx/${DOMAIN}.bootstrap.error.log" 2>/dev/null || true
    echo ""
    echo "Posibles causas:"
    echo "  • Cloudflare proxy (nube naranja) → pon DNS solo en gris"
    echo "  • Otro server block captura ${DOMAIN}"
    echo "  • Firewall bloqueando puerto 80"
    echo ""
    echo "Diagnóstico: sudo bash deploy/diagnose-texno-nginx.sh"
    exit 1
  fi
  echo "    OK  http://${HOST}/.well-known/acme-challenge/ping"
done

obtain_cert() {
  certbot certonly --nginx \
    -d "$DOMAIN" \
    -d "$WWW" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive
}

obtain_cert_webroot() {
  certbot certonly --webroot \
    -w "$CERTBOT_WEBROOT" \
    -d "$DOMAIN" \
    -d "$WWW" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive
}

echo "==> Obteniendo certificado SSL..."
if ! obtain_cert; then
  echo "==> Reintentando con webroot..."
  obtain_cert_webroot
fi

echo "==> Instalando configuración HTTPS final..."
cp "${REPO_ROOT}/deploy/nginx/texno.site.conf" "$NGINX_AVAILABLE"
nginx -t
systemctl reload nginx

systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true

echo ""
echo "Listo: https://${DOMAIN}"
echo "  curl -sI https://${DOMAIN}/api/health"
echo ""
