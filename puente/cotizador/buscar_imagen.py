# -*- coding: utf-8 -*-
"""Auto-match de imagenes de producto por nombre de archivo.
Compara el MODELO compacto (solo letras/numeros, sin guiones) contra el nombre
del archivo. Si existe la exacta la usa; si no, toma la MAS CERCANA por similitud."""
import os, re, unicodedata, difflib

CARPETAS = [
    r"C:\Users\WorkStation\Desktop\fotos_cotizaciones_gecem",
    r"G:\Mi unidad\fotos cotizaciones claude",
    os.path.join(os.path.expanduser("~"), "Desktop", "fotos_cotizaciones_gecem"),
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "imagenes_productos"),
]
_env = os.environ.get("GECEM_IMG_DIRS")
if _env:
    CARPETAS = [p for p in _env.split(";") if p] + CARPETAS

EXTS = (".jpg", ".jpeg", ".png", ".webp", ".avif")
_SKIP_DIR = ("_files", ".tmp.driveupload", "__pycache__")
_UMBRAL_CERCANO = 0.62   # similitud minima para aceptar "la mas cercana"


def _compact(s):
    """Solo letras y numeros en minuscula, sin acentos ni separadores."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def buscar_imagen(*claves, carpetas=None):
    carpetas = carpetas or CARPETAS
    modelo = claves[0] if claves else ""
    mk = _compact(modelo)
    if len(mk) < 4:
        return None
    mejor, mejor_score = None, 0.0
    for carpeta in carpetas:
        if not carpeta or not os.path.isdir(carpeta):
            continue
        for root, dirs, files in os.walk(carpeta):
            dirs[:] = [d for d in dirs if not any(s in d for s in _SKIP_DIR)]
            for fn in files:
                if not fn.lower().endswith(EXTS):
                    continue
                fk = _compact(os.path.splitext(fn)[0])
                if not fk:
                    continue
                if mk in fk:
                    sc = 2.0 + len(mk) / max(len(fk), 1)      # modelo contenido = exacta
                elif len(fk) >= 5 and fk in mk:
                    sc = 1.5 + len(fk) / len(mk)
                else:
                    sc = difflib.SequenceMatcher(None, mk, fk).ratio()  # cercania
                if sc > mejor_score:
                    mejor, mejor_score = os.path.join(root, fn), sc
    if mejor_score >= 2.0:                # match exacto (modelo contenido)
        return mejor
    return mejor if mejor_score >= _UMBRAL_CERCANO else None
