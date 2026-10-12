#!/bin/bash
# Actualiza el puente ya instalado: baja index.js y package.json, fija whatsapp-web.js 1.34.7 y aplica el parche
# de compatibilidad con WhatsApp Web 2.3000.x (ids `$1` en vez de `_serialized`). Lo llama /actualizar o se corre a mano.
set -e
cd /opt/puente-gecem
BASE="https://raw.githubusercontent.com/jesusevaristohernandez21-png/consignas-gecem/main/puente"
curl -fsSL "$BASE/package.json?t=$(date +%s)" -o package.json
curl -fsSL "$BASE/index.js?t=$(date +%s)" -o index.js.new && mv index.js.new index.js
curl -fsSL "$BASE/wwebjs-2.3000.patch?t=$(date +%s)" -o wwebjs-2.3000.patch
command -v patch >/dev/null || (apt-get update -y >/dev/null && apt-get install -y patch >/dev/null)
PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev 2>&1 | tail -1
if ! grep -q "widSerialized" node_modules/whatsapp-web.js/src/util/Injected/Utils.js; then
  patch -p1 -N -d node_modules/whatsapp-web.js < wwebjs-2.3000.patch && echo "parche aplicado"
else echo "parche ya estaba"; fi
echo "ACTUALIZADO $(date)"
