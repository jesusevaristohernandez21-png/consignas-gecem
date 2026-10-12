# -*- coding: utf-8 -*-
"""
Generador de cotizaciones GECEM CCTV Queretaro.
Reconstruido a partir de la plantilla real (logo, cinta azul, tabla con imagen,
resaltado rojo de keywords, condiciones de pago, terminos).

Uso:
    from generar_cotizacion_gecem import cotizar
    cotizar({folio, fecha, titulo, subtitulo, items[], salida_xlsx, salida_pdf})
    opcional: terminos_extra = ["texto", ...] se agregan al final de TERMINOS Y CONDICIONES
    opcional: terminos_rojo  = ["texto", ...] aclaraciones en ROJO y negritas al final de TERMINOS
    opcional: vigencia = "texto" reemplaza la linea de validez (por defecto 30 dias naturales)
    opcional: ingeniero = "Ing. Nombre Apellido" reemplaza el nombre del Departamento de Ingenieria
    item = {descripcion, marca_modelo, cantidad, precio, imagen(opcional)}
    item de SECCION = {seccion: "TITULO DEL BLOQUE", color: "1B3A6B"} -> banda de color a todo lo ancho
                      y un SUBTOTAL propio al cerrar el bloque
"""
import os, re, shutil, subprocess, tempfile, math
from io import BytesIO
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from PIL import Image as PILImage

# ---------------- Constantes de marca ----------------
AZUL_OSCURO = "1B3A6B"
AZUL_MEDIO  = "2E5A9E"
ROJO_FOLIO  = "C8102E"
ROJO_FEAT   = "C00000"
GRIS_TXT    = "2C2C2C"
GRIS_FILA   = "EAF1FA"
GRIS_TOT    = "F2F2F2"
BLANCO      = "FFFFFF"

BASE   = os.path.dirname(os.path.abspath(__file__))
ASSETS = BASE if os.path.exists(os.path.join(BASE, "logo_gecem.jpeg")) else os.path.join(BASE, "assets")
LOGO_PRINCIPAL = os.path.join(ASSETS, "logo_gecem.jpeg")
LOGO_SERVICIO  = os.path.join(ASSETS, "logo_gecem_servicio.png")
LOGO_W, LOGO_H = 269, 125   # tamano FIJO del logo (px). No cambiar.
IMG_MAX_PX = 100            # tamano de la imagen de producto (px)

# Anchos de columna. Suma A:F calibrada para llenar casi todo el ancho de la
# hoja carta con margenes estrechos (escala 100%, sin fit-to-width).
ANCHOS = {"A": 4, "B": 20, "C": 48, "D": 10.5, "E": 11, "F": 13, "G": 2}
MARGEN_LR = 0.12           # margen izquierdo/derecho estrecho (pulgadas)

# Keywords a resaltar en ROJO + BOLD dentro de descripciones (case-insensitive)
KEYWORDS = [
    "audio bidireccional", "audio integrado", "microfono",
    "dual light", "luz blanca", "colorvu", "vision a color", "color 24/7",
    "acusense", "acusearch", "wizsense",
    "reconocimiento facial", "deteccion facial", "deteccion inteligente",
    "deteccion de personas", "deteccion de vehiculos", "smart detection",
]

DATOS = {
    "tel":   "442 337 1119",
    "email": "gecemcctvqueretaro@gmail.com",
    "dir":   "Plaza Acurama, Bernardo Quintana, Queretaro",
    "ing":   "Ing. Jesus Evaristo Hernandez",
}

try:
    from buscar_imagen import buscar_imagen
except Exception:
    def buscar_imagen(*a, **k):
        return None


# ---------------- Sanitizado Aspel ADM ----------------
# Aspel ADM rechaza ciertos caracteres. Se limpian SIEMPRE en todo texto
# (descripcion, marca/modelo, titulo, subtitulo). Se conservan acentos y ñ.
_ASPEL_MAP = {
    "|": "/", "\u2022": "-", "\u00b7": "-",           # pipe, bullet, middle-dot
    "\u2014": "-", "\u2013": "-", "\u2010": "-", "\u2011": "-",  # em/en/guiones
    "\u00d7": "x", "\u2205": "diam ", "\u00d8": "diam ", "\u2300": "diam ",         # x mult, diametro
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"',  # comillas dobles
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",  # comillas simples
    "\u00b4": "'", "`": "'",
    "\u00ae": "", "\u00a9": "", "\u2122": "", "\u2117": "",      # R C TM P
    "\u00bd": "1/2", "\u00bc": "1/4", "\u00be": "3/4",
    "\u2153": "1/3", "\u2154": "2/3",
    "\u2026": "...",
    "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u200b": "",   # espacios raros
}

def _limpiar_aspel(text):
    if not isinstance(text, str):
        return text
    for k, v in _ASPEL_MAP.items():
        text = text.replace(k, v)
    text = re.sub(r"\s*\u00b0", " grados", text)   # grado -> " grados"
    text = text.replace("grados grados", "grados")
    return text


# ---------------- Utilidades ----------------
def _rich(text, phrases):
    """Resalta en rojo+bold SOLO las frases indicadas; conserva saltos de linea."""
    low = text.lower()
    spans = []
    for kw in phrases:
        kw = kw.lower()
        i = 0
        while True:
            j = low.find(kw, i)
            if j == -1:
                break
            spans.append((j, j + len(kw)))
            i = j + len(kw)
    if not spans:
        return text
    spans.sort()
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    normal = InlineFont(rFont="Arial", sz=10, color="00" + GRIS_TXT)
    rojo   = InlineFont(rFont="Arial", sz=10, b=True, color="00" + ROJO_FEAT)
    blocks, pos = [], 0
    for s, e in merged:
        if s > pos:
            blocks.append(TextBlock(normal, text[pos:s]))
        blocks.append(TextBlock(rojo, text[s:e]))
        pos = e
    if pos < len(text):
        blocks.append(TextBlock(normal, text[pos:]))
    return CellRichText(blocks)


def _to_pdf(xlsx_path, pdf_path):
    """Convierte XLSX -> PDF con LibreOffice headless (multiplataforma)."""
    candidatos = ["libreoffice", "soffice",
                  r"C:\Program Files\LibreOffice\program\soffice.exe",
                  r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"]
    exe = next((c for c in candidatos if shutil.which(c) or os.path.exists(c)), None)
    if not exe:
        print("AVISO: LibreOffice no encontrado, no se genero PDF.")
        return None
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([exe, "--headless", "--convert-to", "pdf", "--outdir", tmp, xlsx_path],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        gen = os.path.join(tmp, os.path.splitext(os.path.basename(xlsx_path))[0] + ".pdf")
        if os.path.exists(gen):
            shutil.move(gen, pdf_path)
            return pdf_path
    return None


def _img_escalada(ruta, box_w=IMG_MAX_PX, box_h=IMG_MAX_PX):
    """Convierte a PNG en memoria, aplana transparencias sobre blanco y escala
    la imagen para LLENAR la celda (encaja dentro de box_w x box_h, lo mas
    grande posible conservando proporcion)."""
    pil = PILImage.open(ruta)
    if pil.mode in ("RGBA", "LA", "P"):
        pil = pil.convert("RGBA")
        fondo = PILImage.new("RGBA", pil.size, (255, 255, 255, 255))
        fondo.paste(pil, mask=pil.split()[-1])
        pil = fondo.convert("RGB")
    else:
        pil = pil.convert("RGB")
    w, h = pil.size
    f = min(box_w / w, box_h / h)
    pil = pil.resize((max(1, int(w * f)), max(1, int(h * f))))
    bio = BytesIO()
    pil.save(bio, format="PNG")
    bio.seek(0)
    xi = XLImage(bio)
    xi.format = "png"
    return xi


_EMU = 9525  # EMU por pixel


def _insertar_img_centrada(ws, ruta, fila, alto_pts, tam=IMG_MAX_PX):
    """Inserta la imagen a tamano fijo (tam px) CENTRADA (horizontal y vertical)
    dentro de la celda de imagen (columna B, fila dada)."""
    xi = _img_escalada(ruta, tam, tam)
    iw, ih = int(xi.width), int(xi.height)
    cell_w = ANCHOS["B"] * 7          # ancho celda B en px (aprox)
    cell_h = alto_pts * 4 / 3         # alto de la fila en px
    off_x = max(0, (cell_w - iw) / 2)
    off_y = max(0, (cell_h - ih) / 2)
    marker = AnchorMarker(col=1, colOff=int(off_x * _EMU), row=fila - 1, rowOff=int(off_y * _EMU))
    xi.anchor = OneCellAnchor(_from=marker, ext=XDRPositiveSize2D(cx=iw * _EMU, cy=ih * _EMU))
    ws.add_image(xi)


# ---------------- Generador principal ----------------
def cotizar(cfg):
    items = cfg["items"]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Cotización"

    for col, w in ANCHOS.items():
        ws.column_dimensions[col].width = w

    thin = Side(style="thin", color="B8C4D9")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def put(coord, val, sz=10, b=False, color=GRIS_TXT, fill=None,
            align="left", wrap=False, italic=False, merge=None):
        if merge:
            ws.merge_cells(merge)
        c = ws[coord]
        c.value = val
        c.font = Font(name="Arial", size=sz, bold=b, italic=italic,
                      color="00" + color if color else None)
        if fill:
            c.fill = PatternFill("solid", fgColor=fill)
        c.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
        return c

    # --- Encabezado: logo + bloque cotizacion ---
    if os.path.exists(LOGO_PRINCIPAL):
        logo = XLImage(LOGO_PRINCIPAL)
        logo.width, logo.height = LOGO_W, LOGO_H
        ws.add_image(logo, "A1")
    for r in (1, 2, 3, 4, 5):
        ws.row_dimensions[r].height = 21.75
    put("D1", cfg.get("encabezado", "COTIZACIÓN"), sz=20, b=True, color=AZUL_OSCURO, align="right", merge="D1:F1")
    put("D2", "Folio: " + cfg["folio"], sz=10, b=True, color=ROJO_FOLIO, align="right", merge="D2:F2")
    put("D3", "Fecha: " + cfg["fecha"], sz=10, color=GRIS_TXT, align="right", merge="D3:F3")
    put("D4", "Departamento de Ingeniería:", sz=9, color=GRIS_TXT, align="right", merge="D4:F4")
    put("D5", _limpiar_aspel(cfg.get("ingeniero", DATOS["ing"])), sz=11, b=True, color=AZUL_OSCURO, align="right", merge="D5:F5")

    ws.row_dimensions[6].height = 3.75
    put("A7", f'{DATOS["dir"]}  -  Tel. {DATOS["tel"]}  -  {DATOS["email"]}',
        sz=9, color=GRIS_TXT, align="center", merge="A7:F7")
    ws.row_dimensions[7].height = 18
    put("A8", "PROVEEDOR DE SISTEMAS DE SEGURIDAD ELECTRONICA  -  DISTRIBUIDOR HIKVISION",
        sz=10, b=True, color=BLANCO, fill=AZUL_MEDIO, align="center", merge="A8:F8")
    ws.row_dimensions[8].height = 19.5
    ws.row_dimensions[9].height = 7.5

    # --- Titulo + subtitulo ---
    put("A10", _limpiar_aspel(cfg["titulo"]), sz=14, b=True, color=BLANCO, fill=AZUL_OSCURO,
        align="center", wrap=True, merge="A10:F10")
    ws.row_dimensions[10].height = 31.5
    put("A11", _limpiar_aspel(cfg.get("subtitulo", "")), sz=9, color=BLANCO, fill=AZUL_MEDIO,
        align="center", italic=True, wrap=True, merge="A11:F11")
    _sub_txt = _limpiar_aspel(cfg.get("subtitulo", ""))
    _sub_lineas = max(1, math.ceil(len(_sub_txt) / 168.0))
    ws.row_dimensions[11].height = 18 if _sub_lineas <= 1 else 8 + _sub_lineas * 12.0

    # --- Encabezado de tabla ---
    hr = 12
    for col, txt in zip("ABCDEF", ["#", "IMAGEN", "DESCRIPCIÓN", "CANT.", "P/U", "IMPORTE"]):
        c = put(f"{col}{hr}", txt, sz=10, b=True, color=BLANCO, fill=GRIS_TXT, align="center")
        c.border = border
    ws.row_dimensions[hr].height = 25.5

    # --- Filas de items ---
    r = hr + 1
    fila_ini = r
    _sec_nombre = None
    _sec_color = AZUL_MEDIO
    _sec_filas = []
    _sec_subs = []
    _num = 0

    def _cerrar_seccion():
        nonlocal r, _sec_nombre, _sec_filas
        if _sec_nombre and _sec_filas:
            put(f"A{r}", _limpiar_aspel("SUBTOTAL " + _sec_nombre), sz=10, b=True,
                color=_sec_color, fill=GRIS_TOT, align="right", merge=f"A{r}:E{r}")
            cF = ws[f"F{r}"]
            cF.value = "=" + "+".join(f"F{x}" for x in _sec_filas)
            cF.number_format = r"\$#,##0"
            cF.font = Font(name="Arial", size=10, bold=True, color="00" + _sec_color)
            cF.fill = PatternFill("solid", fgColor=GRIS_TOT)
            cF.alignment = Alignment(horizontal="right", vertical="center")
            for col in "ABCDEF":
                ws[f"{col}{r}"].border = border
            ws.row_dimensions[r].height = 19
            _sec_subs.append(r)
            r += 1
        _sec_filas = []

    for it in items:
        if it.get("seccion"):
            _cerrar_seccion()
            _sec_nombre = it["seccion"]
            _sec_color = it.get("color", AZUL_MEDIO)
            put(f"A{r}", _limpiar_aspel(it["seccion"]), sz=11, b=True, color=BLANCO,
                fill=_sec_color, align="center", merge=f"A{r}:F{r}")
            for col in "ABCDEF":
                ws[f"{col}{r}"].border = border
            ws.row_dimensions[r].height = 22.5
            r += 1
            continue
        _num += 1
        i = _num
        _sec_filas.append(r)
        put(f"A{r}", i, sz=11, b=True, color=AZUL_OSCURO, fill=GRIS_FILA, align="center")
        # descripcion + marca/modelo (primero, para dimensionar la celda/imagen)
        texto = _limpiar_aspel(it["descripcion"].rstrip()) + "\n\nMarca: " + _limpiar_aspel(it.get("marca_modelo", ""))
        alto = max(110, min(230, 26 + len(texto) * 0.28))
        # imagen (llena toda el area de la celda de imagen)
        img_ruta = it.get("imagen")
        if not img_ruta:
            if it.get("img_clave"):
                if str(it["img_clave"]).strip() in ("-", "none", "None", "NONE", "sin", "SIN"):
                    img_ruta = None                          # forzar SIN imagen
                else:
                    img_ruta = buscar_imagen(it["img_clave"])   # palabra clave tiene precedencia
            elif "GECEM" in it.get("marca_modelo", "").upper():
                img_ruta = LOGO_SERVICIO if os.path.exists(LOGO_SERVICIO) else None
            else:
                modelo = ""
                m = re.search(r"Modelo:\s*(.+)$", it.get("marca_modelo", ""))
                if m:
                    modelo = m.group(1).strip()
                marca = it.get("marca_modelo", "").split("-")[0].strip()
                img_ruta = buscar_imagen(modelo, marca, it["descripcion"][:40])
        if img_ruta and os.path.exists(img_ruta):
            try:
                _insertar_img_centrada(ws, img_ruta, r, alto)
            except Exception:
                pass
        cC = ws[f"C{r}"]
        rojo = it.get("rojo")  # lista de frases a resaltar; si no hay, sin rojo
        cC.value = _rich(texto, rojo) if rojo else texto
        cC.font = Font(name="Arial", size=10, color="00" + GRIS_TXT)
        cC.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        # cant / pu / importe
        put(f"D{r}", it["cantidad"], sz=10, b=True, color=GRIS_TXT, align="center")
        cE = put(f"E{r}", it["precio"], sz=10, b=True, color=GRIS_TXT, align="right")
        cE.number_format = r"\$#,##0"
        cF = ws[f"F{r}"]
        cF.value = f"=D{r}*E{r}"
        cF.number_format = r"\$#,##0"
        cF.font = Font(name="Arial", size=10, bold=True, color="00" + GRIS_TXT)
        cF.alignment = Alignment(horizontal="right", vertical="center")
        for col in "ABCDEF":
            ws[f"{col}{r}"].border = border
        ws.row_dimensions[r].height = alto
        r += 1
    _cerrar_seccion()
    fila_fin = r - 1

    # --- Totales ---
    def tot(label, formula, sz, txt_color, fill):
        put(f"A{r}", label, sz=sz, b=True, color=txt_color, fill=fill, align="right", merge=f"A{r}:E{r}")
        cF = ws[f"F{r}"]
        cF.value = formula
        cF.number_format = r"\$#,##0"
        cF.font = Font(name="Arial", size=sz, bold=True, color="00" + (AZUL_OSCURO if fill == GRIS_TOT else BLANCO))
        cF.fill = PatternFill("solid", fgColor=fill)
        cF.alignment = Alignment(horizontal="right", vertical="center")

    _f_sub = ("=" + "+".join(f"F{x}" for x in _sec_subs)) if _sec_subs else f"=SUM(F{fila_ini}:F{fila_fin})"
    tot("SUBTOTAL", _f_sub, 11, GRIS_TXT, GRIS_TOT); sub_r = r; r += 1
    base_r = sub_r
    _dpct = cfg.get("descuento_pct", 0)
    _dmon = cfg.get("descuento_monto", 0)
    if _dmon:
        # Descuento por monto fijo (precio cerrado negociado). Etiqueta opcional: "descuento_etiqueta".
        _etq = cfg.get("descuento_etiqueta", "DESCUENTO")
        tot(_etq, f"=-{float(_dmon)}", 11, ROJO_FEAT, GRIS_TOT); _desc_r = r; r += 1
        tot("SUBTOTAL CON DESCUENTO", f"=F{sub_r}+F{_desc_r}", 11, GRIS_TXT, GRIS_TOT); base_r = r; r += 1
    elif _dpct:
        tot(f"DESCUENTO ({int(_dpct)}%)", f"=-F{sub_r}*{_dpct/100.0}", 11, ROJO_FEAT, GRIS_TOT); _desc_r = r; r += 1
        tot("SUBTOTAL CON DESCUENTO", f"=F{sub_r}+F{_desc_r}", 11, GRIS_TXT, GRIS_TOT); base_r = r; r += 1
    if cfg.get("sin_iva"):
        tot("TOTAL", f"=F{base_r}", 14, BLANCO, AZUL_OSCURO); r += 2
    else:
        tot("IVA (16%)", f"=F{base_r}*0.16", 11, GRIS_TXT, GRIS_TOT); iva_r = r; r += 1
        tot("TOTAL", f"=F{base_r}+F{iva_r}", 14, BLANCO, AZUL_OSCURO); r += 2

    # --- Condiciones de pago ---
    # "bloque_pago_titulo" y "bloque_pago_lineas" permiten reusar este bloque para otra cosa
    # (p.ej. los datos del cliente en una constancia de garantia).
    _bp_tit = cfg.get("bloque_pago_titulo", "CONDICIONES DE PAGO")
    _bp_lin = cfg.get("bloque_pago_lineas", ["Anticipo: ___________________",
                                             "Finiquito: ___________________",
                                             "Forma de pago: ___________________"])
    if _bp_tit:
        put(f"A{r}", _bp_tit, sz=11, b=True, color=BLANCO, fill=AZUL_MEDIO, align="center", merge=f"A{r}:F{r}"); r += 1
        for t in _bp_lin:
            put(f"A{r}", _limpiar_aspel(t), sz=10, color=GRIS_TXT, align="left", merge=f"A{r}:F{r}"); r += 1
        r += 1

    # --- Terminos y condiciones ---
    put(f"A{r}", cfg.get("terminos_titulo", "TÉRMINOS Y CONDICIONES"), sz=11, b=True, color=BLANCO, fill=AZUL_MEDIO, align="center", merge=f"A{r}:F{r}"); r += 1
    # "terminos_base" sustituye por completo las 4 lineas estandar de cotizacion.
    _tbase = cfg.get("terminos_base")
    if _tbase is None:
        _tbase = [
            _limpiar_aspel(cfg.get("vigencia", "Validez de la cotizacion: 30 dias naturales a partir de la fecha de emision.")),
            "Garantia: 12 meses sobre equipos e instalacion contra defectos de fabricacion.",
            "Tiempo de entrega: 1 a 4 dias habiles posteriores a la confirmacion del anticipo.",
            "Precios sujetos a impuestos vigentes y tipo de cambio al momento de la compra.",
        ]
    else:
        _tbase = [_limpiar_aspel(t) for t in _tbase]
    for t in _tbase + [_limpiar_aspel(t) for t in cfg.get("terminos_extra", [])]:
        put(f"A{r}", "-  " + t, sz=10, color=GRIS_TXT, align="left", merge=f"A{r}:F{r}"); r += 1
    # Aclaraciones importantes en ROJO + bold (cfg "terminos_rojo": lista de textos)
    for t in cfg.get("terminos_rojo", []):
        t = _limpiar_aspel(t)
        put(f"A{r}", "-  " + t, sz=10, b=True, color=ROJO_FEAT, align="left", wrap=True, merge=f"A{r}:F{r}")
        ws.row_dimensions[r].height = 15 * max(1, -(-len(t) // 105)) + 3
        r += 1
    r += 1
    put(f"A{r}", "Gracias por su preferencia. GECEM CCTV Queretaro",
        sz=12, b=True, color=AZUL_OSCURO, align="center", merge=f"A{r}:F{r}")

    # --- Escala 100% + margenes estrechos: la tabla llena el ancho de la hoja ---
    ws.print_area = f"A1:F{r}"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 0
    ws.page_setup.fitToHeight = 0
    if ws.sheet_properties.pageSetUpPr is not None:
        ws.sheet_properties.pageSetUpPr.fitToPage = False
    ws.page_setup.scale = 100
    ws.page_margins.left = ws.page_margins.right = MARGEN_LR
    ws.page_margins.top = ws.page_margins.bottom = 0.2
    ws.page_margins.header = ws.page_margins.footer = 0.1

    salida_xlsx = cfg["salida_xlsx"]
    wb.save(salida_xlsx)
    pdf = _to_pdf(salida_xlsx, cfg["salida_pdf"]) if cfg.get("salida_pdf") else None
    return {"xlsx": salida_xlsx, "pdf": pdf}
