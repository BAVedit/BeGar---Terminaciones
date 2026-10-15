"""Ingesta de planos y contratos -> inventario + manifest.json + tiles.

Solo LEE las carpetas de origen. Todo lo generado va a --salida.

Uso:
    python ingesta.py --obra "C:/Users/Codesarrollos/Desktop/Garay" --salida ../salida
    python ingesta.py --obra ../muestra/Garay --salida ../salida --decisiones ../muestra/decisiones.json

Salidas en --salida:
    inventario.csv    todos los archivos de planos y contratos (separador ';', abre directo en Excel)
    revisar.md        lo que hay que confirmar: versiones duplicadas, DWG sin PDF, prefijos sin definir,
                      niveles sin plano, recortes propuestos
    manifest.json     lo que consume la app (rubros -> niveles -> planos/recortes, fichas de códigos)
    tiles/            mosaicos deep-zoom de cada recorte
    detalles/         imagen de cada detalle (PV-04, VA-01...)
    documentos/       copia de contratos/OT/adendas en PDF
"""
from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import json
import math
import re
import shutil
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import pymupdf as fitz
from PIL import Image

AQUI = Path(__file__).resolve().parent
Image.MAX_IMAGE_PIXELS = None


# ---------------------------------------------------------------- utilidades

def norm(s: str) -> str:
    """minúsculas, sin acentos, espacios simples."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.lower()).strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def cargar(p: Path):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def sha1_archivo(p: Path) -> str:
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()[:12]


RE_NOMBRE = re.compile(
    r"^(?:(?P<obra>BeGar)-)?(?P<disc>[A-Z]{1,4})(?:_M)?-\s*(?P<nombre>.+?)(?:_(?P<estado>[CRM]))?$")
ESTADOS = {"C": "construcción", "R": "replanteo/revisión", "M": "modificación"}


def parsear_nombre(stem: str):
    m = RE_NOMBRE.match(stem.strip())
    if not m:
        return {"disciplina": "", "nombre": stem.strip(), "estado": ""}
    return {"disciplina": m["disc"], "nombre": m["nombre"].strip(), "estado": m["estado"] or ""}


# ---------------------------------------------------------------- 1. inventario

def inventariar(obra: Path, proy: dict):
    planos_dir = obra / proy["carpeta_planos"]
    contratos_dir = obra / proy["carpeta_contratos"]
    excl = [norm(e) for e in proy.get("carpetas_excluidas", [])]
    filas = []
    for base, tipo in [(planos_dir, "plano"), (contratos_dir, "contrato")]:
        if not base.exists():
            print(f"  ! no existe {base}", file=sys.stderr)
            continue
        for f in sorted(base.rglob("*")):
            if not f.is_file() or f.name.startswith("~$"):
                continue
            rel = f.relative_to(base)
            carpeta = str(rel.parent).replace("\\", "/")
            excluida = any(norm(part) in excl for part in rel.parts[:-1])
            info = parsear_nombre(f.stem) if tipo == "plano" else {"disciplina": "", "nombre": f.stem, "estado": ""}
            st = f.stat()
            filas.append({
                "tipo": tipo,
                "ruta": str(rel).replace("\\", "/"),
                "carpeta": carpeta,
                "archivo": f.name,
                "disciplina": info["disciplina"],
                "nombre": info["nombre"],
                "estado": info["estado"],
                "formato": f.suffix.lower().lstrip("."),
                "modificado": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
                "kb": round(st.st_size / 1024),
                "excluida": excluida,
                "_abs": f,
            })
    return filas


def agrupar_documentos(filas):
    """Un 'documento' = mismo nombre en la misma carpeta (puede tener .dwg y .pdf)."""
    docs = {}
    for f in filas:
        if f["tipo"] != "plano" or f["excluida"] or f["formato"] not in ("pdf", "dwg"):
            continue
        k = (f["carpeta"], f["disciplina"], norm(f["nombre"]), f["estado"])
        d = docs.setdefault(k, {"carpeta": f["carpeta"], "disciplina": f["disciplina"], "nombre": f["nombre"],
                                "estado": f["estado"], "formatos": {}})
        d["formatos"][f["formato"]] = f
    return list(docs.values())


def similar(a: str, b: str) -> bool:
    a, b = norm(a), norm(b)
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.88


def agrupar_versiones(docs):
    """Agrupa documentos que parecen el mismo plano en otra carpeta/estado.
    'RE' (replanteo) se compara contra cualquier disciplina; el resto solo dentro de su disciplina."""
    grupos = []
    for d in sorted(docs, key=lambda d: (d["disciplina"] == "RE", d["carpeta"])):
        for g in grupos:
            g0 = g["docs"][0]
            misma_disc = d["disciplina"] == g0["disciplina"] or "RE" in (d["disciplina"], g0["disciplina"])
            if misma_disc and similar(d["nombre"], g0["nombre"]):
                g["docs"].append(d)
                break
        else:
            grupos.append({"docs": [d]})
    for g in grupos:
        g0 = g["docs"][0]
        g["id"] = slug(f'{g0["disciplina"]}-{g0["nombre"]}')
        g["nombre"] = g0["nombre"]
        g["disciplina"] = g0["disciplina"]
    return grupos


# ---------------------------------------------------------------- 2. análisis de PDF

class Codigos:
    def __init__(self, cfg):
        self.cfg = cfg
        self.rx = re.compile(cfg["regex_codigo"])
        self.muros = cfg["muros"]
        self.detalles = cfg["detalles"]
        self.sin_def = {k: v for k, v in cfg.get("prefijos_sin_definir", {}).items() if not k.startswith("_")}
        self.rx_local = re.compile(cfg["regex_local"]) if cfg.get("regex_local") else None
        self.rx_comun = re.compile(cfg["regex_comun"]) if cfg.get("regex_comun") else None

    def clasificar(self, t: str):
        # rótulos de local: A-103 = dpto A, nivel 1, local 03; PT-100 / PB-101 / AZ-104 = área común
        m = self.rx_local.match(t) if self.rx_local else None
        if m:
            return {"codigo": t, "tipo": "local", "unidad": m["nivel"] + m["unidad"], "prefijo": m["unidad"]}
        m = self.rx_comun.match(t) if self.rx_comun else None
        if m:
            return {"codigo": t, "tipo": "comun", "unidad": None, "prefijo": m["zona"]}
        if t in self.muros:
            return {"codigo": t, "tipo": "muro", "grupo": t, "prefijo": t,
                    "descripcion": self.muros[t], "rubro": self.cfg.get("rubro_muros")}
        m = self.rx.match(t)
        if not m:
            return None
        pre, num, var = m["prefijo"], m["numero"], m["variante"]
        grupo = f"{pre}-{num}"
        if pre in self.detalles:
            d = self.detalles[pre]
            return {"codigo": t, "tipo": "detalle", "grupo": grupo, "prefijo": pre, "variante": var,
                    "descripcion": d["descripcion"], "rubro": d["rubro"]}
        if pre in self.sin_def:
            d = self.sin_def[pre]
            if d:  # ya definido por el usuario
                return {"codigo": t, "tipo": "detalle", "grupo": grupo, "prefijo": pre, "variante": var,
                        "descripcion": d.get("descripcion", ""), "rubro": d.get("rubro")}
            return {"codigo": t, "tipo": "sin_definir", "grupo": grupo, "prefijo": pre, "variante": var,
                    "descripcion": "Prefijo sin definir en la tabla oficial", "rubro": None}
        return {"codigo": t, "tipo": "otro", "prefijo": pre}


def palabras(page):
    """Palabras con bbox; une fragmentos partidos ('PV-' + '04') si están pegados en la misma línea."""
    M = page.rotation_matrix  # coordenadas como se ve la hoja (las láminas de AutoCAD vienen rotadas)
    ws = [(*(fitz.Rect(w[:4]) * M), *w[4:]) for w in page.get_text("words")]
    out = []
    i = 0
    while i < len(ws):
        x0, y0, x1, y1, t, b, l, _ = ws[i]
        # intentar unir con la siguiente palabra de la misma línea si casi no hay espacio
        if i + 1 < len(ws):
            n = ws[i + 1]
            if (n[5], n[6]) == (b, l) and 0 <= n[0] - x1 < 0.25 * (y1 - y0) and (t.endswith("-") or n[4].startswith("-")):
                out.append((x0, min(y0, n[1]), n[2], max(y1, n[3]), t + n[4]))
                i += 2
                continue
        out.append((x0, y0, x1, y1, t))
        i += 1
    return out


def lineas(page):
    """Líneas de texto con tamaño de letra máximo."""
    res = []
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            t = "".join(s["text"] for s in ln["spans"]).strip()
            if t:
                res.append({"texto": t, "bbox": fitz.Rect(ln["bbox"]) * page.rotation_matrix, "pt": max(s["size"] for s in ln["spans"])})
    return res


def detectar_titulos(lns, proy):
    """Devuelve [{bbox, titulo, niveles, compartida}] para los títulos de planta de la hoja."""
    cands = []
    for nv in proy["niveles"]:
        for t in nv["titulos"]:
            cands.append((norm(t), [nv["id"]], False))
    for tipo, nvs in proy["plantas_tipo"].items():
        cands.append((norm(tipo), nvs, len(nvs) > 1))
    cands.sort(key=lambda c: -len(c[0]))
    out = []
    for ln in lns:
        tx = norm(ln["texto"])
        if len(tx) > 45 or ln["pt"] < 8:
            continue
        for c, nvs, comp in cands:
            if tx == c or tx.startswith(c + " ") or tx.endswith(" " + c) or (len(c) > 12 and c in tx):
                out.append({"bbox": ln["bbox"], "titulo": ln["texto"], "niveles": nvs, "compartida": comp})
                break
    return out


def componentes(page, borrar=(), escala=0.2, dilatar=2):
    """Manchas de dibujo conectadas (en puntos PDF). Rasteriza a baja resolución."""
    pix = page.get_pixmap(matrix=fitz.Matrix(escala, escala), colorspace=fitz.csGRAY, alpha=False)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width) < 245  # líneas finas quedan grises
    for r in borrar:
        x0, y0 = int(r.x0 * escala) - 1, int(r.y0 * escala) - 1
        a[max(y0, 0):int(r.y1 * escala) + 2, max(x0, 0):int(r.x1 * escala) + 2] = False
    m = a.copy()
    for _ in range(dilatar):
        m[1:, :] |= m[:-1, :].copy(); m[:-1, :] |= m[1:, :].copy()
        m[:, 1:] |= m[:, :-1].copy(); m[:, :-1] |= m[:, 1:].copy()
    lab = np.zeros(m.shape, dtype=np.int32)
    H, W = m.shape
    comps = []
    for y, x in zip(*np.nonzero(m)):
        if lab[y, x]:
            continue
        n = len(comps) + 1
        pila = [(y, x)]
        lab[y, x] = n
        y0 = y1 = y; x0 = x1 = x
        while pila:
            cy, cx = pila.pop()
            y0, y1, x0, x1 = min(y0, cy), max(y1, cy), min(x0, cx), max(x1, cx)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    pila.append((ny, nx))
        comps.append(fitz.Rect(x0 / escala, y0 / escala, (x1 + 1) / escala, (y1 + 1) / escala))
    area = page.rect.width * page.rect.height
    return [c for c in comps if c.width * c.height < 0.5 * area and c.width > 20 and c.height > 20]


def bandas(titulos, comps, page):
    """Recorte de cada planta: la franja de la hoja entre el título anterior y su propio título
    (los planos se titulan abajo), unida a las manchas de dibujo cuyo centro cae en esa franja."""
    orden = sorted(range(len(titulos)), key=lambda i: titulos[i]["bbox"].y1)
    res = [None] * len(titulos)
    arriba = page.rect.y0
    for i in orden:
        tb = titulos[i]["bbox"]
        dentro = [c for c in comps if c.y0 >= arriba - 20 and c.y1 <= tb.y1 + 20]
        if dentro:
            grande = max(c.width * c.height for c in dentro)
            dentro = [c for c in dentro if c.width * c.height >= 0.002 * grande]
            bb = fitz.Rect(dentro[0])
            for c in dentro[1:]:
                bb |= c
            bb |= tb
            res[i] = (bb + (-10, -10, 10, 10)) & page.rect
        else:
            res[i] = bbox_para_titulo(titulos[i], comps, page)
        arriba = tb.y1
    return res


def nombre_local(r, lns):
    """Nombre del ambiente escrito junto al rótulo del local (ej. 'Dormitorio' arriba de 'A-103')."""
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    mejor, dmin = "", 4 * r.height
    for ln in lns:
        t = ln["texto"].strip()
        if len(t) < 3 or not re.search(r"[a-záéíóúñ]{3}", t, re.I) or re.search(r"\d", t):
            continue
        b = ln["bbox"]
        d = abs((b.x0 + b.x1) / 2 - cx) + abs((b.y0 + b.y1) / 2 - cy)
        if d < dmin:
            mejor, dmin = t, d
    return mejor


def bbox_para_titulo(t, comps, page):
    """La mancha de dibujo inmediatamente arriba del título (los planos se titulan abajo)."""
    tb = t["bbox"]
    cx = (tb.x0 + tb.x1) / 2
    arriba = [c for c in comps if c.y1 <= tb.y0 + 5 and c.x0 - 5 <= cx <= c.x1 + 5]
    if arriba:
        # descartar restos chicos (pedazos de texto, cotas sueltas) y quedarse con la planta más cercana
        grande = max(c.width * c.height for c in arriba)
        arriba = [c for c in arriba if c.width * c.height >= 0.2 * grande]
        c = max(arriba, key=lambda c: c.y1)
    elif comps:  # fallback: la mancha más cercana
        c = min(comps, key=lambda c: abs((c.x0 + c.x1) / 2 - cx) + abs(c.y1 - tb.y0))
    else:
        return page.rect
    m = 8  # margen en pt
    return (c | tb) + (-m, -m, m, m) & page.rect


def leer_planillas(ws, cods: Codigos):
    """Tablas UBICACION / CODIGO / CANTIDAD / DESCRIPCION -> {codigo: [filas]}."""
    res = defaultdict(list)
    heads = [w for w in ws if norm(w[4]).startswith("ubicacion")]
    for h in heads:
        misma = [w for w in ws if abs(w[1] - h[1]) < 3 and 0 <= w[0] - h[0] < 600]
        col = {}
        for w in misma:
            k = norm(w[4])
            for nombre in ("ubicacion", "codigo", "cantidad", "descripcion"):
                if k.startswith(nombre):
                    col[nombre] = w[0]
        if not {"codigo", "cantidad"} <= col.keys():
            continue
        orden = sorted(col.items(), key=lambda kv: kv[1])
        # la tabla termina donde empieza otra tabla en la misma línea (láminas con varias planillas lado a lado)
        vecinas = [o[0] for o in heads if abs(o[1] - h[1]) < 3 and o[0] > h[0]]
        x_fin = min([orden[-1][1] + 400] + vecinas) - 3
        alto = h[3] - h[1]
        cuerpo = sorted((w for w in ws if w[1] > h[3] and h[0] - 5 <= w[0] < x_fin and w[1] - h[3] < 60 * alto),
                        key=lambda w: (w[1] + w[3]) / 2)
        filas = []
        for w in cuerpo:  # agrupar por altura del centro (las celdas pueden tener distinto tamaño de letra)
            yc = (w[1] + w[3]) / 2
            if filas and yc - filas[-1][0] < 0.6 * alto:
                filas[-1][1].append(w)
            else:
                filas.append((yc, [w]))
        ult_y = h[3]
        for _, fila in filas:
            fila = sorted(fila, key=lambda w: w[0])
            if fila[0][1] - ult_y > 4 * alto:
                break  # terminó la tabla
            if any(norm(w[4]).startswith("ubicacion") for w in fila):
                break  # empieza otra tabla
            celdas = defaultdict(list)
            for w in fila:
                nombre = max((n for n, x in orden if w[0] >= x - 3), key=lambda n: col[n], default=orden[0][0])
                celdas[nombre].append(w[4])
            cel = {n: " ".join(v) for n, v in celdas.items()}
            c = cods.clasificar(cel.get("codigo", ""))
            if c and c["tipo"] != "otro":
                res[c["codigo"]].append({"ubicacion": cel.get("ubicacion", ""), "cantidad": cel.get("cantidad", ""),
                                         "descripcion": cel.get("descripcion", "")})
                ult_y = fila[0][3]
    return res


# ---------------------------------------------------------------- 3. render

def render_tiles(page, clip, destino: Path, rcfg):
    lado = max(clip.width, clip.height)
    zoom = min(rcfg["lado_max_px"] / lado, 300 / 72)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    T = rcfg["tile_px"]
    W, H = img.size
    zmax = max(0, math.ceil(math.log2(max(W, H) / T)))
    if destino.exists():
        shutil.rmtree(destino)
    for z in range(zmax, -1, -1):
        f = 2 ** (z - zmax)
        im = img if z == zmax else img.resize((max(1, math.ceil(W * f)), max(1, math.ceil(H * f))), Image.LANCZOS)
        d = destino / str(z)
        d.mkdir(parents=True, exist_ok=True)
        for ty in range(math.ceil(im.height / T)):
            for tx in range(math.ceil(im.width / T)):
                t = im.crop((tx * T, ty * T, min((tx + 1) * T, im.width), min((ty + 1) * T, im.height)))
                if t.size != (T, T):
                    # relleno transparente: fuera del plano se ve el fondo del visor, no un papel blanco
                    fondo = Image.new("RGBA", (T, T), (255, 255, 255, 0))
                    fondo.paste(t, (0, 0))
                    t = fondo
                t.save(d / f"{tx}_{ty}.{rcfg['formato']}", quality=rcfg["calidad"])
    return {"ancho_px": W, "alto_px": H, "zoom_max": zmax, "tile_px": T, "formato": rcfg["formato"]}


def render_imagen(page, clip, destino: Path, lado_max, rcfg):
    zoom = min(lado_max / max(clip.width, clip.height), 300 / 72)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    destino.parent.mkdir(parents=True, exist_ok=True)
    img.save(destino, quality=rcfg["calidad"])


# ---------------------------------------------------------------- principal

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--obra", required=True, help="carpeta raíz de la obra (la que contiene '1. Planos')")
    ap.add_argument("--salida", required=True)
    ap.add_argument("--config", default=str(AQUI / "config"))
    ap.add_argument("--decisiones", help="decisiones.json (por defecto el de --config)")
    ap.add_argument("--sin-tiles", action="store_true", help="solo inventario y análisis, sin rasterizar")
    a = ap.parse_args()

    cfgd = Path(a.config)
    proy = cargar(cfgd / "proyecto.json")
    cods = Codigos(cargar(cfgd / "codigos.json"))
    rubros = cargar(cfgd / "rubros.json")["rubros"]
    decis = cargar(Path(a.decisiones) if a.decisiones else cfgd / "decisiones.json")
    obra, sal = Path(a.obra), Path(a.salida)
    if sal.resolve() == obra.resolve() or obra.resolve() in sal.resolve().parents:
        sys.exit("La salida no puede estar dentro de la carpeta de la obra (solo lectura).")
    sal.mkdir(parents=True, exist_ok=True)
    rcfg = proy["render"]
    ids_nivel = [n["id"] for n in proy["niveles"]]

    print("1/4 Inventario...")
    filas = inventariar(obra, proy)
    docs = agrupar_documentos(filas)
    grupos = agrupar_versiones(docs)
    faltantes = [d for d in docs if "pdf" not in d["formatos"]]

    # vigente por grupo
    pendientes_version = []
    for g in grupos:
        rutas = [d["formatos"].get("pdf", d["formatos"].get("dwg"))["ruta"] for d in g["docs"]]
        g["rutas"] = rutas
        elegido = decis.get("vigentes", {}).get(g["id"])
        if len(g["docs"]) == 1:
            g["vigente"] = g["docs"][0]
            g["estado_vigente"] = "unico"
        elif elegido:
            g["vigente"] = next((d for d, r in zip(g["docs"], rutas) if r == elegido), None)
            g["estado_vigente"] = "confirmado" if g["vigente"] else "decision_invalida"
            if not g["vigente"]:
                pendientes_version.append(g)
        else:
            g["vigente"] = None
            g["estado_vigente"] = "pendiente"
            pendientes_version.append(g)

    with open(sal / "inventario.csv", "w", newline="", encoding="utf-8-sig") as f:
        cols = ["tipo", "ruta", "carpeta", "archivo", "disciplina", "nombre", "estado", "formato", "modificado", "kb",
                "excluida", "tiene_pdf", "faltante_pdf", "grupo_version", "estado_version"]
        w = csv.DictWriter(f, fieldnames=cols, delimiter=";", extrasaction="ignore")
        w.writeheader()
        por_ruta = {}
        for g in grupos:
            for d in g["docs"]:
                for fmt in d["formatos"].values():
                    por_ruta[fmt["ruta"]] = (g, d)
        for fl in filas:
            g, d = por_ruta.get(fl["ruta"], (None, None))
            w.writerow({**fl, "estado": ESTADOS.get(fl["estado"], fl["estado"]),
                        "tiene_pdf": "si" if d and "pdf" in d["formatos"] else ("" if not d else "no"),
                        "faltante_pdf": "FALTA PDF" if d and "pdf" not in d["formatos"] else "",
                        "grupo_version": g["id"] if g and len(g["docs"]) > 1 else "",
                        "estado_version": g["estado_vigente"] if g and len(g["docs"]) > 1 else ""})

    # PDF a procesar: el vigente de cada grupo; si está pendiente, todos los PDF del grupo (marcados)
    a_procesar = []
    for g in grupos:
        cands = [g["vigente"]] if g["vigente"] else g["docs"]
        for d in cands:
            if "pdf" in d["formatos"]:
                pid = g["id"] if (g["vigente"] or len(g["docs"]) == 1) else slug(f'{g["id"]}-{d["carpeta"]}')
                a_procesar.append((pid, g, d))

    print(f"2/4 Analizando {len(a_procesar)} PDF...")
    planos, recortes, codigos = {}, {}, {}
    otros_prefijos = defaultdict(int)
    sin_definir = defaultdict(list)
    for pid, g, d in a_procesar:
        f = d["formatos"]["pdf"]
        pdf = fitz.open(f["_abs"])
        huella = sha1_archivo(f["_abs"])
        planos[pid] = {"id": pid, "nombre": d["nombre"], "disciplina": d["disciplina"],
                       "estado": ESTADOS.get(d["estado"], d["estado"]), "archivo": f["ruta"],
                       "modificado": f["modificado"], "hojas": len(pdf), "huella": huella,
                       "vigente": "si" if g["vigente"] else "pendiente", "grupo": g["id"], "recortes": []}
        for nh, page in enumerate(pdf):
            ws = palabras(page)
            lns = lineas(page)
            titulos = detectar_titulos(lns, proy)
            comps = componentes(page, borrar=[t["bbox"] for t in titulos]) if titulos else []
            planillas = leer_planillas(ws, cods)
            ocurrencias, locales = [], []
            for w in ws:
                c = cods.clasificar(w[4])
                if not c:
                    continue
                if c["tipo"] in ("local", "comun"):
                    locales.append((fitz.Rect(w[:4]), c))
                    continue
                if c["tipo"] == "otro":
                    if w[4] not in ids_nivel:
                        otros_prefijos[c["prefijo"]] += 1
                    continue
                ocurrencias.append((fitz.Rect(w[:4]), c))

            # recortes por nivel
            regiones = []
            for t, bb in zip(titulos, bandas(titulos, comps, page)):
                rid = f'{pid}__{slug(t["titulo"])}'
                if rid in decis.get("recortes", {}):
                    bb = fitz.Rect(decis["recortes"][rid]); origen = "calibrado"
                else:
                    origen = "propuesto"
                regiones.append((rid, bb, t, origen))
            if not titulos and len(ws) > 0:
                # lámina sin plantas (detalles, cortes...): la hoja completa
                regiones.append((f"{pid}__hoja-{nh + 1}", page.rect, {"titulo": f"Hoja {nh + 1}", "niveles": [],
                                                                     "compartida": False}, "hoja"))

            for rid, bb, t, origen in regiones:
                aps, ubic = [], []
                for r, c in ocurrencias:
                    if bb.contains(r):
                        aps.append({"codigo": c["codigo"], "x": (r.x0 - bb.x0) / bb.width, "y": (r.y0 - bb.y0) / bb.height,
                                    "w": r.width / bb.width, "h": r.height / bb.height})
                        if c["tipo"] == "sin_definir" and len(sin_definir[c["prefijo"]]) < 8:
                            sin_definir[c["prefijo"]].append(f'{c["codigo"]} ({d["nombre"]}, {t["titulo"]})')
                for r, c in locales:
                    if not bb.contains(r):
                        continue
                    ubic.append({"texto": c["codigo"], "clase": "local", "unidad": c["unidad"], "zona": c["prefijo"],
                                 "nombre": nombre_local(r, lns),
                                 "x": (r.x0 + r.width / 2 - bb.x0) / bb.width, "y": (r.y0 + r.height / 2 - bb.y0) / bb.height})
                for ln in lns:
                    if not bb.contains(ln["bbox"]):
                        continue
                    tx = ln["texto"].strip()
                    for p in proy["ubicaciones"]["patrones"]:
                        m = re.match(p, tx)
                        if m:
                            gd = m.groupdict()
                            ubic.append({"texto": tx, "num": gd.get("num"), "letra": gd.get("letra"), "clase": "unidad",
                                         "x": (ln["bbox"].x0 + ln["bbox"].width / 2 - bb.x0) / bb.width,
                                         "y": (ln["bbox"].y0 + ln["bbox"].height / 2 - bb.y0) / bb.height})
                            break
                    else:
                        palabras_tx = set(re.findall(r"[a-z]+", norm(tx)))
                        if len(tx) <= 30 and palabras_tx & {norm(x) for x in proy["ubicaciones"]["ambientes"]}:
                            ubic.append({"texto": tx, "clase": "ambiente",
                                         "x": (ln["bbox"].x0 + ln["bbox"].width / 2 - bb.x0) / bb.width,
                                         "y": (ln["bbox"].y0 + ln["bbox"].height / 2 - bb.y0) / bb.height})
                rec = {"id": rid, "plano": pid, "hoja": nh + 1, "titulo": t["titulo"], "niveles": t["niveles"],
                       "compartida": t["compartida"], "bbox_pdf": [round(v, 1) for v in bb], "origen": origen,
                       "huella": hashlib.sha1(f"{huella}{list(bb)}".encode()).hexdigest()[:12],
                       "codigos": aps, "ubicaciones": ubic}
                if not a.sin_tiles:
                    rec["tiles"] = render_tiles(page, bb, sal / "tiles" / rid, rcfg)
                    rec["tiles"]["ruta"] = f"tiles/{rid}"
                recortes[rid] = rec
                planos[pid]["recortes"].append(rid)

            # fichas de códigos: detalle (ocurrencia con letra más grande) + planilla
            mayor = {}
            for r, c in ocurrencias:
                if c["tipo"] == "otro":
                    continue
                pt = r.height
                if c["codigo"] not in mayor or pt > mayor[c["codigo"]][0]:
                    mayor[c["codigo"]] = (pt, r, c)
            es_lamina_detalle = not titulos
            for cod, (pt, r, c) in mayor.items():
                fi = codigos.setdefault(cod, {**{k: v for k, v in c.items() if k != "codigo"}, "codigo": cod,
                                               "detalle": None, "planilla": []})
                if cod in planillas:
                    fi["planilla"] = planillas[cod]
                if es_lamina_detalle and c["tipo"] == "detalle" and pt >= 1.5 * np.median([o[0].height for o in ocurrencias]):
                    caja = [k for k in comps_detalle(page) if k.contains(r) and k.width * k.height > 25 * r.width * r.height]
                    clip = min(caja, key=lambda k: k.width * k.height) if caja else fitz.Rect(r.x0 - 20, r.y0 - 20, r.x0 + 340, r.y0 + 340)
                    clip = (clip + (-6, -6, 6, 6)) & page.rect
                    ruta = f"detalles/{slug(cod)}.{rcfg['formato']}"
                    if not a.sin_tiles:
                        render_imagen(page, clip, sal / ruta, rcfg["detalle_lado_max_px"], rcfg)
                    fi["detalle"] = {"imagen": ruta, "plano": pid, "hoja": nh + 1, "bbox_pdf": [round(v, 1) for v in clip],
                                     "origen": "propuesto"}
        pdf.close()

    print("3/4 Armando manifest...")
    # códigos que solo aparecen en plantas también tienen ficha
    for rec in recortes.values():
        for ap_ in rec["codigos"]:
            if ap_["codigo"] not in codigos:
                c = cods.clasificar(ap_["codigo"])
                codigos[ap_["codigo"]] = {**{k: v for k, v in c.items()}, "detalle": None, "planilla": []}
    # apariciones por nivel (para la ficha: en qué niveles aparece)
    for rec in recortes.values():
        for nv in rec["niveles"]:
            for ap_ in rec["codigos"]:
                codigos[ap_["codigo"]].setdefault("niveles", {}).setdefault(nv, 0)
                codigos[ap_["codigo"]]["niveles"][nv] += 1

    def coincide(nombre_rubro, plano):
        disc, _, nom = nombre_rubro.partition("-") if re.match(r"^[A-Z]{1,4}-", nombre_rubro) else ("", "", nombre_rubro)
        if disc and plano["disciplina"] not in (disc, "RE"):
            return False
        return similar(nom, plano["nombre"])

    contratos_base = proy["carpeta_contratos"]
    docs_contrato = [f for f in filas if f["tipo"] == "contrato"]
    rubros_out = []
    for rb in rubros:
        pls = [pid for pid, p in planos.items() if any(coincide(n, p) for n in rb["planos"])]
        faltan = [n for n in rb["planos"] if not any(coincide(n, p) for p in planos.values())]
        niveles = {nv: [] for nv in ids_nivel}
        laminas = []
        for pid in pls:
            for rid in planos[pid]["recortes"]:
                rec = recortes[rid]
                if rec["niveles"]:
                    for nv in rec["niveles"]:
                        niveles[nv].append(rid)
                else:
                    laminas.append(rid)
        documentos = []
        for f in docs_contrato:
            if any(f["carpeta"].split("/")[0].startswith(pfx) or norm(pfx) in norm(f["carpeta"].split("/")[0])
                   for pfx in rb.get("contratistas", [])):
                destino = Path("documentos") / f["ruta"]
                if f["formato"] == "pdf":
                    (sal / destino).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f["_abs"], sal / destino)
                documentos.append({"carpeta": f["carpeta"], "archivo": f["archivo"], "formato": f["formato"],
                                   "ruta": str(destino).replace("\\", "/") if f["formato"] == "pdf" else None,
                                   "origen": f"{contratos_base}/{f['ruta']}"})
        contratistas = sorted({d["carpeta"].split("/")[0] for d in documentos})
        rubros_out.append({"id": rb["id"], "nombre": rb["nombre"], "piloto": rb.get("piloto", False),
                           "responsables": rb.get("responsables", []),
                           "planos": pls, "planos_faltantes": faltan, "niveles": niveles, "laminas": laminas,
                           "contratistas": contratistas, "documentos": documentos})

    manifest = {
        "version": 1,
        "generado": datetime.now().isoformat(timespec="seconds"),
        "proyecto": {k: proy.get(k) for k in ("id", "nombre", "codigo_archivo", "planos_base")},
        "niveles": proy["niveles"],
        "rubros": rubros_out,
        "planos": planos,
        "recortes": recortes,
        "codigos": dict(sorted(codigos.items())),
        "pendientes": {
            "versiones": [{"grupo": g["id"], "opciones": g["rutas"], "estado": g["estado_vigente"]} for g in pendientes_version],
            "faltantes_pdf": [d["formatos"]["dwg"]["ruta"] for d in faltantes],
            "prefijos_sin_definir": {k: v for k, v in sin_definir.items()},
        },
    }
    with open(sal / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    print("4/4 revisar.md...")
    escribir_revisar(sal, manifest, grupos, faltantes, otros_prefijos, ids_nivel)
    n_tiles = sum(1 for _ in (sal / "tiles").rglob("*.*")) if (sal / "tiles").exists() else 0
    print(f"Listo: {len(filas)} archivos inventariados, {len(planos)} PDF, {len(recortes)} recortes, "
          f"{len(codigos)} códigos, {n_tiles} tiles. Ver {sal / 'revisar.md'}")


_cache_det = {}


def comps_detalle(page):
    """Componentes sin borrar texto (en láminas de detalle cada recuadro es una mancha)."""
    k = (id(page.parent), page.number)
    if k not in _cache_det:
        _cache_det[k] = componentes(page, dilatar=1)
    return _cache_det[k]


def escribir_revisar(sal, mf, grupos, faltantes, otros_prefijos, ids_nivel):
    L = [f"# Revisar — {mf['proyecto']['nombre']}", "", f"Generado: {mf['generado']}", ""]
    L += ["## 1. Versiones duplicadas (elegir la vigente)", "",
          "Completar `decisiones.json` → `vigentes` con `\"<grupo>\": \"<ruta del vigente>\"`. Hasta entonces se procesan todas y la app las marca con ⚠.", ""]
    multi = [g for g in grupos if len(g["docs"]) > 1]
    if not multi:
        L.append("Sin duplicados.")
    for g in multi:
        marca = {"pendiente": "⚠ PENDIENTE", "confirmado": "✓ confirmado", "decision_invalida": "✗ la ruta elegida no existe"}[g["estado_vigente"]]
        L.append(f"- **{g['id']}** — {marca}")
        for d, r in zip(g["docs"], g["rutas"]):
            fm = "+".join(sorted(d["formatos"]))
            mod = max(x["modificado"] for x in d["formatos"].values())
            ok = " ← vigente" if g["vigente"] is d else ""
            L.append(f"  - `{r}` ({fm}, {mod}){ok}")
    L += ["", f"## 2. Planos solo en DWG ({len(faltantes)}) — exportar a PDF", ""]
    L += [f"- `{d['formatos']['dwg']['ruta']}`" for d in faltantes] or ["Ninguno."]
    L += ["", "## 3. Prefijos de código sin definir", "",
          "Completar en `config/codigos.json` → `prefijos_sin_definir` con `{\"descripcion\": ..., \"rubro\": ...}`.", ""]
    for p, ej in mf["pendientes"]["prefijos_sin_definir"].items():
        L.append(f"- **{p}**: " + "; ".join(ej[:4]))
    if otros_prefijos:
        top = sorted(otros_prefijos.items(), key=lambda kv: -kv[1])[:15]
        L += ["", "Otros textos con forma de código que se ignoraron (por si alguno es un código real): "
              + ", ".join(f"`{k}` ×{v}" for k, v in top)]
    L += ["", "## 3b. Rótulos de local que no corresponden al nivel", "",
          "Rótulos como `A-103` llevan el número de nivel. Estos aparecen en un nivel que no es el suyo (posible copia en el dibujo); la app los ignora al ubicar marcadores.", ""]
    raros = []
    for r in mf["recortes"].values():
        for nv in r["niveles"][:1]:
            num = nv[1:] if nv.startswith("N") else None
            for u in r["ubicaciones"]:
                if u["clase"] != "local":
                    continue
                if (u["unidad"] and u["unidad"][:-1] != num) or (not u["unidad"] and u["zona"] != (nv if not num else "PT")):
                    raros.append(f"{nv}: `{u['texto']}`")
    L += [f"- {x}" for x in raros] or ["Ninguno."]
    L += ["", "## 4. Niveles por rubro", "", "| Rubro | " + " | ".join(ids_nivel) + " | Planos que faltan |",
          "|---|" + "---|" * len(ids_nivel) + "---|"]
    for rb in mf["rubros"]:
        celdas = []
        for nv in ids_nivel:
            rs = rb["niveles"][nv]
            celdas.append("—" if not rs else ("◐" if all(mf["recortes"][r]["compartida"] for r in rs) else "●") + str(len(rs)))
        L.append(f"| {rb['nombre']} | " + " | ".join(celdas) + " | " + ", ".join(rb["planos_faltantes"]) + " |")
    L += ["", "● = planta propia del nivel, ◐ = planta tipo compartida, — = sin plano en PDF", "",
          "## 5. Recortes propuestos (verificar en la calibración)", ""]
    for r in mf["recortes"].values():
        L.append(f"- `{r['id']}` — hoja {r['hoja']}, «{r['titulo']}» → {', '.join(r['niveles']) or 'lámina'} "
                 f"({r['origen']}, {len(r['codigos'])} códigos, {len(r['ubicaciones'])} ubicaciones)")
    (sal / "revisar.md").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
