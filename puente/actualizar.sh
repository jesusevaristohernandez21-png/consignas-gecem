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
# v1.5: servidor ntfy propio (alarmas de caseta sin la cuota de ntfy.sh)
curl -fsSL "$BASE/instalar-ntfy.sh?t=$(date +%s)" -o instalar-ntfy.sh && { echo "=== ntfy $(date) ===" >> /root/instalar.log; bash -x instalar-ntfy.sh >> /root/instalar.log 2>&1 || echo "AVISO: ntfy no se pudo instalar (ver /log)" | tee -a /root/instalar.log; }
# v1.8: generador de cotizaciones (plantilla Python + LibreOffice). Las dependencias se instalan en segundo plano.
mkdir -p cotizador
for f in generar_cotizacion_gecem.py buscar_imagen.py correr.py logo_gecem.jpeg logo_gecem_servicio.png; do
  curl -fsSL "$BASE/cotizador/$f?t=$(date +%s)" -o "cotizador/$f"
done
curl -fsSL "$BASE/instalar-cotizador.sh?t=$(date +%s)" -o instalar-cotizador.sh
if command -v soffice >/dev/null && [ -x pyenv/bin/python ] && fc-list | grep -qi carlito; then echo "cotizador: dependencias ya instaladas"
else echo "=== cotizador $(date) ===" >> /root/instalar.log
  # Fuera del servicio (systemd-run) para que el reinicio del puente no corte la instalación a la mitad
  systemd-run --unit=gecem-cotizador-$(date +%s) --collect -p StandardOutput=append:/root/instalar.log -p StandardError=append:/root/instalar.log bash /opt/puente-gecem/instalar-cotizador.sh \
    || (nohup bash instalar-cotizador.sh >> /root/instalar.log 2>&1 &)
  echo "cotizador: instalando LibreOffice en segundo plano (ver /log en unos minutos)"; fi
echo "ACTUALIZADO $(date)"
