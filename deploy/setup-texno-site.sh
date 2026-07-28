#!/usr/bin/env bash
# Configura Nginx + Let's Encrypt para https://texno.site
# Ejecutar en el VPS como usuario con sudo:
#   cd ~/projects/TEXNO && sudo bash deploy/setup-texno-site.sh

set -euo pipefail

DOMAIN="texno.site"
WWW="www.texno.site"
EMAIL="${CERTBOT_EMAIL:-}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}.conf"
CERTBOT_WEBROOT="/var/www/certbot"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta con sudo: sudo bash deploy/setup-texno-site.sh"
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  read -r -p "Email para Let's Encrypt (renovación/certificados): " EMAIL
fi

echo "==> Instalando nginx y certbot (si faltan)..."
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Comprobando DNS de ${DOMAIN}..."
RESOLVED_IP="$(getent ahosts "$DOMAIN" | awk '/STREAM/ {print $1; exit}')"
SERVER_IP="$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || true)"
if [[ -n "$RESOLVED_IP" && -n "$SERVER_IP" && "$RESOLVED_IP" != "$SERVER_IP" ]]; then
  echo "AVISO: ${DOMAIN} resuelve a ${RESOLVED_IP} pero este servidor es ${SERVER_IP}."
  echo "       Corrige el registro A en tu DNS antes de continuar."
  read -r -p "¿Continuar igual? [y/N] " OK
  [[ "${OK:-}" =~ ^[yY]$ ]] || exit 1
fi

echo "==> Preparando webroot para certbot..."
mkdir -p "$CERTBOT_WEBROOT"

echo "==> Configuración HTTP temporal (solo certbot)..."
cat > "/etc/nginx/sites-available/${DOMAIN}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW};

    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        return 200 'TEXNO — esperando certificado SSL\n';
        add_header Content-Type text/plain;
    }
}
EOF

ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"

# Quitar default si choca en puerto 80 (opcional)
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

echo "==> Obteniendo certificado SSL..."
certbot certonly --webroot \
  -w "$CERTBOT_WEBROOT" \
  -d "$DOMAIN" \
  -d "$WWW" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive || {
    echo "Certbot falló. Revisa DNS y que el puerto 80 esté abierto."
    exit 1
  }

echo "==> Instalando configuración HTTPS final..."
cp "${REPO_ROOT}/deploy/nginx/texno.site.conf" "$NGINX_AVAILABLE"

nginx -t
systemctl reload nginx

echo "==> Renovación automática (certbot timer)..."
systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true

echo ""
echo "Listo: https://${DOMAIN}"
echo "Verifica:"
echo "  curl -sI https://${DOMAIN}/api/health"
echo "  pm2 list | grep texno"
echo ""
