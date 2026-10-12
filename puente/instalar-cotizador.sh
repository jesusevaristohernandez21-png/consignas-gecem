#!/bin/bash
# v1.8: dependencias del generador de cotizaciones de Operación GECEM (LibreOffice + Python openpyxl/Pillow).
# Lo lanza actualizar.sh en segundo plano (tarda unos minutos la primera vez). Bitácora: /root/instalar.log
set -e
export DEBIAN_FRONTEND=noninteractive
cd /opt/puente-gecem
if ! command -v soffice >/dev/null || ! python3 -m venv --help >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends libreoffice-calc-nogui fonts-liberation fonts-dejavu-core python3-venv \
    || apt-get install -y --no-install-recommends libreoffice-calc fonts-liberation fonts-dejavu-core python3-venv
fi
[ -x pyenv/bin/python ] || python3 -m venv pyenv
pyenv/bin/pip install -q --upgrade pip >/dev/null 2>&1 || true
pyenv/bin/pip install -q "openpyxl>=3.1,<3.2" pillow
echo "COTIZADOR LISTO: $(soffice --version 2>/dev/null | head -1) · $(pyenv/bin/python -c 'import openpyxl;print("openpyxl", openpyxl.__version__)')"
