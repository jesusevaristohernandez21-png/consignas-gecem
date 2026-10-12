#!/bin/bash
# Instalador del puente de WhatsApp de Consignas GECEM (Ubuntu 22.04 / 24.04, como root)
# Uso:  bash instalar.sh "URL_EXEC_DE_APPS_SCRIPT" "CLAVE_PT-XXXX"
set -e
EXEC_URL="$1"; PUENTE_KEY="$2"
if [ -z "$EXEC_URL" ] || [ -z "$PUENTE_KEY" ]; then echo "Uso: bash instalar.sh URL_EXEC CLAVE"; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg fonts-liberation
# Google Chrome (en Ubuntu 22.04/24.04 el "chromium" de apt es un snap y no arranca como servicio)
if ! command -v google-chrome-stable >/dev/null; then
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb && apt-get install -y /tmp/chrome.deb || echo "AVISO: no se pudo instalar Google Chrome; se usará el Chromium de puppeteer"
fi
# Node 20
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
# dependencias de Chromium headless
apt-get install -y libnss3 libatk-bridge2.0-0 libxkbcommon0 libgbm1 libasound2t64 2>/dev/null || apt-get install -y libnss3 libatk-bridge2.0-0 libxkbcommon0 libgbm1 libasound2
mkdir -p /opt/puente-gecem && cd /opt/puente-gecem
BASE="https://raw.githubusercontent.com/jesusevaristohernandez21-png/consignas-gecem/main/puente"
curl -fsSL "$BASE/package.json" -o package.json
curl -fsSL "$BASE/index.js" -o index.js
curl -fsSL "$BASE/wwebjs-2.3000.patch" -o wwebjs-2.3000.patch
apt-get install -y patch >/dev/null
PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev 2>&1 | tail -2
# parche de compatibilidad con WhatsApp Web 2.3000.x (whatsapp-web.js 1.34.7)
patch -p1 -N -d node_modules/whatsapp-web.js < wwebjs-2.3000.patch || true
CHROME=$(command -v google-chrome-stable || true)
# si el binario no arranca, se deja vacío y puppeteer usa su propio Chromium
if [ -n "$CHROME" ] && ! "$CHROME" --version >/dev/null 2>&1; then CHROME=""; fi
echo "Chrome: ${CHROME:-(puppeteer)}" 
cat > /etc/puente-gecem.env <<ENV
EXEC_URL=$EXEC_URL
PUENTE_KEY=$PUENTE_KEY
PORT=3000
CHROME_PATH=$CHROME
DATOS=/opt/puente-gecem/datos
ENV
cat > /etc/systemd/system/puente-gecem.service <<SVC
[Unit]
Description=Puente WhatsApp Consignas GECEM
After=network-online.target
[Service]
WorkingDirectory=/opt/puente-gecem
EnvironmentFile=/etc/puente-gecem.env
ExecStart=/usr/bin/node /opt/puente-gecem/index.js
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
SVC
systemctl daemon-reload
systemctl enable puente-gecem >/dev/null
systemctl restart puente-gecem
# abrir el puerto del QR si hay ufw
command -v ufw >/dev/null && ufw allow 3000/tcp >/dev/null 2>&1 || true
IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
echo
echo "=============================================================="
echo " Listo. Abre en tu celular o PC:"
echo "   http://$IP:3000/qr?k=$PUENTE_KEY"
echo " y escanea el QR con el celular GECEM Evidencias."
echo " Ver registro:  journalctl -u puente-gecem -f"
echo "=============================================================="
