#!/usr/bin/env bash
# Diagnóstico rápido para texno.site + Nginx + Certbot
#   sudo bash deploy/diagnose-texno-nginx.sh

set -euo pipefail

DOMAIN="texno.site"

echo "=== DNS ==="
echo "${DOMAIN} (local resolver):"
dig +short "$DOMAIN" A | sort -u | sed 's/^/  A /'
echo "www.${DOMAIN}:"
dig +short "www.${DOMAIN}" A | sort -u | sed 's/^/  A /'
echo "${DOMAIN} AAAA:"
dig +short "$DOMAIN" AAAA | sort -u | sed 's/^/  AAAA /' || true
echo ""
echo "Google DNS (8.8.8.8):"
dig @8.8.8.8 +short "$DOMAIN" A | sort -u | sed 's/^/  A /'
echo "Cloudflare DNS (1.1.1.1):"
dig @1.1.1.1 +short "$DOMAIN" A | sort -u | sed 's/^/  A /'
echo -n "VPS IP:      "; curl -4 -s ifconfig.me || true
echo ""

IP_COUNT="$(dig +short "$DOMAIN" A | sort -u | wc -l | tr -d ' ')"
if [[ "${IP_COUNT:-0}" -gt 1 ]]; then
  echo "⚠️  MÚLTIPLES IPs para ${DOMAIN} — esto rompe Let's Encrypt (secondary validation)."
  echo "    Deja solo la IP de este VPS en el registrador DNS."
  echo ""
fi

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
