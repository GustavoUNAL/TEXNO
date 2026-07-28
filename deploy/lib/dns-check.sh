#!/usr/bin/env bash
# Consulta DNS: autoritativo (Hostinger) vs caché de resolvers públicos.
# Uso: source deploy/lib/dns-check.sh

_dns_extract_a() {
  grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | sort -u
}

# Respuesta real en Hostinger / nameservers del dominio
dns_authoritative_ips() {
  local host="$1"
  local ips=""

  while read -r ns; do
    [[ -z "$ns" ]] && continue
    ips+="$(dig "@${ns}" +short "$host" A 2>/dev/null || true)"$'\n'
  done < <(dig +short "$host" NS 2>/dev/null)

  echo "$ips" | _dns_extract_a
}

# Caché en resolvers públicos (puede tardar en actualizarse)
dns_resolver_ips() {
  local host="$1"
  local ips=""

  ips+="$(dig @8.8.8.8 +short "$host" A 2>/dev/null || true)"$'\n'
  ips+="$(dig @1.1.1.1 +short "$host" A 2>/dev/null || true)"$'\n'
  ips+="$(dig +short "$host" A 2>/dev/null || true)"$'\n'

  echo "$ips" | _dns_extract_a
}

dns_local_ips() {
  dig +short "$1" A 2>/dev/null | _dns_extract_a
}

# Compat: unión autoritativo + resolvers (solo diagnóstico)
dns_public_ips() {
  {
    dns_authoritative_ips "$1"
    dns_resolver_ips "$1"
  } | _dns_extract_a
}
