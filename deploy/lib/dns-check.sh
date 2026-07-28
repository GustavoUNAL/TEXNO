#!/usr/bin/env bash
# Consulta DNS público (autoritativo + 8.8.8.8), no caché local del VPS.
# Uso: source deploy/lib/dns-check.sh

dns_public_ips() {
  local host="$1"
  local ips=""

  while read -r ns; do
    [[ -z "$ns" ]] && continue
    ips+="$(dig "@${ns}" +short "$host" A 2>/dev/null || true)"$'\n'
  done < <(dig +short "$host" NS 2>/dev/null)

  ips+="$(dig @8.8.8.8 +short "$host" A 2>/dev/null || true)"$'\n'
  ips+="$(dig @1.1.1.1 +short "$host" A 2>/dev/null || true)"$'\n'

  echo "$ips" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | sort -u
}

dns_local_ips() {
  dig +short "$1" A 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | sort -u
}
