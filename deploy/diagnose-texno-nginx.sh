#!/usr/bin/env bash
# Diagnóstico rápido para texno.site + Nginx + Certbot
#   sudo bash deploy/diagnose-texno-nginx.sh

set -euo pipefail

DOMAIN="texno.site"

echo "=== DNS ==="
echo -n "${DOMAIN}:     "; dig +short "$DOMAIN" A | head -1
echo -n "www.${DOMAIN}: "; dig +short "www.${DOMAIN}" A | head -1
echo -n "VPS IP:      "; curl -4 -s ifconfig.me || true
echo ""

echo "=== PM2 texno ==="
pm2 list 2>/dev/null | grep -E "texno|name" || echo "(pm2 no disponible)"
echo ""

echo "=== Puerto 3847 ==="
ss -tlnp | grep :3847 || echo "nada escuchando en 3847"
curl -fsS "http://127.0.0.1:3847/api/health" 2>/dev/null && echo "" || echo "health local falló"
echo ""

echo "=== Nginx: server_name ${DOMAIN} ==="
grep -Rsn "server_name" /etc/nginx/sites-enabled/ 2>/dev/null | grep -E "${DOMAIN}|default_server" || true
echo ""

echo "=== Prueba HTTP challenge ==="
curl -sv "http://${DOMAIN}/.well-known/acme-challenge/ping" 2>&1 | tail -20
echo ""

echo "=== Certificados ==="
ls -la "/etc/letsencrypt/live/${DOMAIN}/" 2>/dev/null || echo "sin certificado aún"
echo ""

echo "=== Últimos errores nginx (${DOMAIN}) ==="
tail -n 10 "/var/log/nginx/${DOMAIN}.bootstrap.error.log" 2>/dev/null || \
tail -n 10 "/var/log/nginx/${DOMAIN}.site.error.log" 2>/dev/null || \
echo "(sin logs)"
