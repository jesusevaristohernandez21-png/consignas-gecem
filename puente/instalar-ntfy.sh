#!/bin/bash
# Servidor ntfy propio de GECEM (alarmas de las casetas) + Caddy (HTTPS automático) en el mismo VPS del puente.
# Se puede correr las veces que sea (idempotente). Lo llama actualizar.sh.
set -e
export DEBIAN_FRONTEND=noninteractive
IP=$(curl -fsSL -4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DOM="$(echo "$IP" | tr . -).sslip.io"
mkdir -p /etc/apt/keyrings
if ! command -v ntfy >/dev/null; then
  curl -fsSL https://archive.heckel.io/apt/pubkey.txt | gpg --dearmor --yes -o /etc/apt/keyrings/archive.heckel.io.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/archive.heckel.io.gpg] https://archive.heckel.io/apt debian main" > /etc/apt/sources.list.d/archive.heckel.io.list
fi
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
fi
apt-get update -y >/dev/null
command -v ntfy >/dev/null || apt-get install -y ntfy >/dev/null
command -v caddy >/dev/null || apt-get install -y caddy >/dev/null
mkdir -p /var/cache/ntfy /etc/ntfy
cat > /etc/ntfy/server.yml <<CFG
# ntfy de GECEM — sin límites de cuota (es nuestro). Caddy le pone HTTPS en https://$DOM
base-url: "https://$DOM"
listen-http: "127.0.0.1:2586"
behind-proxy: true
cache-file: "/var/cache/ntfy/cache.db"
cache-duration: "24h"
attachment-cache-dir: "/var/cache/ntfy/attachments"
upstream-base-url: "https://ntfy.sh"
visitor-request-limit-burst: 1000
visitor-request-limit-replenish: "1s"
visitor-message-daily-limit: 0
visitor-subscription-limit: 200
visitor-subscriber-rate-limiting: false
keepalive-interval: "45s"
CFG
cat > /etc/caddy/Caddyfile <<CFG
$DOM {
  reverse_proxy 127.0.0.1:2586
}
CFG
systemctl enable ntfy >/dev/null 2>&1 || true
systemctl restart ntfy
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
echo "NTFY: https://$DOM  ($(systemctl is-active ntfy) / caddy $(systemctl is-active caddy))"
