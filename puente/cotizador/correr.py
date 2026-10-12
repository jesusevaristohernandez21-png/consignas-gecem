# -*- coding: utf-8 -*-
"""v1.8 — Corre la plantilla GECEM con un cfg que manda la app Operación.
Uso: python correr.py cfg.json <carpeta_imagenes> <carpeta_salida>
Cada item puede traer "img" (nombre de la foto en la carpeta, sin .jpg)."""
import json, os, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from generar_cotizacion_gecem import cotizar

cfg = json.load(open(sys.argv[1], encoding="utf-8"))
imgdir, salida = sys.argv[2], sys.argv[3]
for it in cfg.get("items", []):
    sl = it.pop("img", None)
    if sl:
        p = os.path.join(imgdir, sl + ".jpg")
        if os.path.exists(p):
            it["imagen"] = p
        else:
            it["img_clave"] = "-"
nombre = cfg.pop("nombre", None) or cfg["folio"]
cfg["salida_xlsx"] = os.path.join(salida, nombre + ".xlsx")
cfg["salida_pdf"] = os.path.join(salida, nombre + ".pdf")
print(json.dumps(cotizar(cfg)))
