#!/bin/bash
# Servidor ntfy propio de GECEM (alarmas de las casetas) + Caddy (HTTPS automático) en el mismo VPS del puente.
# Binarios oficiales de GitHub / caddyserver.com (el repositorio apt de ntfy no resolvía desde el VPS). Idempotente.
set -e
IP=$(curl -fsSL -4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DOM="$(echo "$IP" | tr . -).sslip.io"
if ! command -v ntfy >/dev/null; then
  VER=$(curl -fsSL https://api.github.com/repos/binwiederhier/ntfy/releases/latest | grep -m1 '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/')
  echo "ntfy version $VER"
  curl -fsSL "https://github.com/binwiederhier/ntfy/releases/download/v${VER}/ntfy_${VER}_linux_amd64.tar.gz" -o /tmp/ntfy.tgz
  tar -C /tmp -xzf /tmp/ntfy.tgz
  install -m 755 "/tmp/ntfy_${VER}_linux_amd64/ntfy" /usr/local/bin/ntfy
fi
if ! command -v caddy >/dev/null; then
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy && chmod 755 /usr/local/bin/caddy
fi
mkdir -p /var/cache/ntfy /etc/ntfy /etc/caddy /var/lib/caddy
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
cat > /etc/systemd/system/ntfy.service <<CFG
[Unit]
Description=ntfy GECEM (alarmas de caseta)
After=network.target
[Service]
ExecStart=/usr/local/bin/ntfy serve --config /etc/ntfy/server.yml
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
CFG
cat > /etc/systemd/system/caddy.service <<CFG
[Unit]
Description=Caddy (HTTPS para ntfy GECEM)
After=network.target
[Service]
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=always
RestartSec=5
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
CFG
systemctl daemon-reload
systemctl enable ntfy caddy >/dev/null 2>&1 || true
systemctl restart ntfy
systemctl restart caddy
sleep 3
echo "NTFY: https://$DOM  (ntfy $(systemctl is-active ntfy) / caddy $(systemctl is-active caddy))"
curl -s -m 5 http://127.0.0.1:2586/v1/health || true; echo
