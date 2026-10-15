"""Genera una estructura de carpetas de MUESTRA que imita la de Belive Garay,
con PDF sintéticos (texto extraíble) para probar la ingesta sin los planos reales.

Uso:
    python generar_muestra.py --salida ../muestra

Crea:
    muestra/Garay/1. Planos/Vigente/...      (PDF sintéticos + DWG vacíos de relleno)
    muestra/Garay/5. Compras y Contrataciones/02 Contratos y OT/...
Nada de esto es información real de obra.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import pymupdf as fitz

MM = 72 / 25.4  # puntos por mm
A1 = (841 * MM, 594 * MM)


def r(x0, y0, x1, y1):
    return fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


def txt(page, x, y, s, size=7, bold=False):
    page.insert_text((x * MM, y * MM), s, fontsize=size, fontname="hebo" if bold else "helv")


def marco_y_rotulo(page, titulo, lamina):
    page.draw_rect(r(10, 10, 831, 584), width=1.2)
    rot = r(700, 480, 826, 579)
    page.draw_rect(rot, width=0.8)
    txt(page, 704, 492, "CODESARROLLOS - BELIVE GARAY", 8, True)
    txt(page, 704, 506, titulo, 9, True)
    txt(page, 704, 520, f"Lamina: {lamina}", 7)
    txt(page, 704, 532, "Escala 1:100 - MUESTRA SINTETICA", 7)


def planta(page, ox, oy, nivel_txt, n_dptos, etiqueta_dpto):
    """Dibuja una planta esquemática con dptos, aberturas y códigos.
    ox, oy: esquina sup. izq. en mm. Ocupa 560 x 200 mm."""
    W, H_DPTO, H_PAL = 560, 140, 60
    page.draw_rect(r(ox, oy, ox + W, oy + H_DPTO + H_PAL), width=1.6)
    page.draw_line(fitz.Point(ox * MM, (oy + H_DPTO) * MM), fitz.Point((ox + W) * MM, (oy + H_DPTO) * MM), width=1.2)
    ancho = W / n_dptos
    letras = "ABCDE"[:n_dptos]
    for i, L in enumerate(letras):
        x0 = ox + i * ancho
        if i:
            page.draw_line(fitz.Point(x0 * MM, oy * MM), fitz.Point(x0 * MM, (oy + H_DPTO) * MM), width=1.2)
            txt(page, x0 + 1.5, oy + 70, "LH-10", 5)
        # ambientes
        xm = x0 + ancho * 0.55
        page.draw_line(fitz.Point(xm * MM, oy * MM), fitz.Point(xm * MM, (oy + 80) * MM), width=0.6)
        page.draw_line(fitz.Point(x0 * MM, (oy + 80) * MM), fitz.Point((x0 + ancho) * MM, (oy + 80) * MM), width=0.6)
        xb = x0 + ancho * 0.4
        page.draw_line(fitz.Point(xb * MM, (oy + 80) * MM), fitz.Point(xb * MM, (oy + H_DPTO) * MM), width=0.6)
        txt(page, x0 + 6, oy + 40, "ESTAR - COMEDOR", 5.5)
        txt(page, xm + 4, oy + 40, "DORMITORIO", 5.5)
        txt(page, x0 + 4, oy + 110, "BAÑO", 5.5)
        txt(page, xb + 4, oy + 110, "COCINA", 5.5)
        txt(page, xb - 7, oy + 100, "LHM", 5)
        txt(page, x0 + ancho / 2 - 6, oy + 62, etiqueta_dpto(L), 12, True)
        # aberturas en fachada (rectángulos sobre la línea superior)
        pv = "PV07-A" if L in "BD" else ("PV07-B" if L == "C" else "PV-04")
        page.draw_rect(r(x0 + 12, oy - 2, x0 + 40, oy + 2), width=0.8)
        txt(page, x0 + 18, oy + 7, pv, 6, True)
        page.draw_rect(r(xm + 10, oy - 2, xm + 30, oy + 2), width=0.8)
        txt(page, xm + 13, oy + 7, "VA-01", 6, True)
        page.draw_rect(r(xb + 8, oy + H_DPTO - 2, xb + 22, oy + H_DPTO + 2), width=0.8)
        txt(page, xb + 10, oy + H_DPTO - 4, "VA-02", 6, True)
        # puertas
        txt(page, x0 + 4, oy + 132, "A-105", 5.5)
        txt(page, x0 + 4, oy + 92, "A-101", 5.5)
        txt(page, x0 + 4, oy + 98, "B-01", 5)
    # palier / núcleo
    py = oy + H_DPTO
    page.draw_rect(r(ox + 230, py + 8, ox + 270, py + 52), width=0.8)
    txt(page, ox + 236, py + 30, "ES-01", 6, True)
    page.draw_rect(r(ox + 280, py + 8, ox + 305, py + 30), width=0.8)
    txt(page, ox + 283, py + 20, "DU-02", 5.5)
    txt(page, ox + 150, py + 30, "PALIER", 6)
    txt(page, ox + 320, py + 45, "PT-01", 5.5)
    txt(page, ox + 340, py + 20, "C3A", 5)
    page.draw_rect(r(ox + W - 2, py + 10, ox + W + 2, py + 50), width=0.8)
    txt(page, ox + W - 16, py + 30, "MV-01", 6, True)
    # título del nivel debajo de la planta
    txt(page, ox + 180, oy + H_DPTO + H_PAL + 14, nivel_txt, 14, True)


def nomenclados(dst: Path):
    doc = fitz.open()
    p = doc.new_page(width=A1[0], height=A1[1])
    marco_y_rotulo(p, "AR - NOMENCLADOS", "AR-NOM-01")
    planta(p, 40, 40, "Planta Tipo 1 - Nivel 1", 5, lambda L: f"1{L}")
    planta(p, 40, 300, "Planta Tipo 1 - Nivel 2", 5, lambda L: f"2{L}")
    p = doc.new_page(width=A1[0], height=A1[1])
    marco_y_rotulo(p, "AR - NOMENCLADOS", "AR-NOM-02")
    planta(p, 40, 40, "Planta Tipo 2", 4, lambda L: f"DTO {L}")
    planta(p, 40, 300, "Planta Baja", 3, lambda L: f"LOCAL {L}")
    doc.save(dst)


DETALLES = [
    ("PV-04", "Puerta ventana corrediza 2 hojas, aluminio linea Modena, DVH 4+9+4", [("N1", 2), ("N2", 2)], 1),
    ("PV07-A", "Puerta ventana 1 hoja batiente + paño fijo izq., DVH", [("N1", 2), ("N2", 2), ("N3-N5", 6)], 1),
    ("PV07-B", "Puerta ventana 1 hoja batiente + paño fijo der., DVH", [("N1", 1), ("N2", 1), ("N3-N5", 3)], 1),
    ("VA-01", "Ventana corrediza 2 hojas dormitorio, vidrio laminado 3+3", [("N1", 5), ("N2", 5), ("N3-N5", 12)], 0),
    ("VA-02", "Ventana banderola cocina/baño, vidrio esmerilado", [("N1", 5), ("N2", 5), ("N3-N5", 12)], 0),
    ("MV-01", "Muro cortina palier, perfileria oculta, DVH control solar", [("PB-N5", 6)], 2),
]


def ventana(page, x, y, w, h, tipo):
    page.draw_rect(r(x, y, x + w, y + h), width=1.2)
    page.draw_rect(r(x + 2, y + 2, x + w - 2, y + h - 2), width=0.5)
    if tipo == 1:
        page.draw_line(fitz.Point((x + w / 2) * MM, y * MM), fitz.Point((x + w / 2) * MM, (y + h) * MM), width=0.8)
    elif tipo == 2:
        for k in range(1, 4):
            page.draw_line(fitz.Point((x + k * w / 4) * MM, y * MM), fitz.Point((x + k * w / 4) * MM, (y + h) * MM), width=0.8)
            page.draw_line(fitz.Point(x * MM, (y + k * h / 4) * MM), fitz.Point((x + w) * MM, (y + k * h / 4) * MM), width=0.5)
    else:
        page.draw_line(fitz.Point(x * MM, (y + h / 2) * MM), fitz.Point((x + w) * MM, (y + h / 2) * MM), width=0.8)


def carpinteria(dst: Path):
    doc = fitz.open()
    p = doc.new_page(width=A1[0], height=A1[1])
    marco_y_rotulo(p, "ARD - CARPINTERIA DE ALUMINIO Y VIDRIO", "ARD-CAV-01")
    for i, (cod, desc, ubic, tipo) in enumerate(DETALLES):
        col, fila = i % 3, i // 3
        x0, y0 = 30 + col * 220, 30 + fila * 270
        p.draw_rect(r(x0, y0, x0 + 205, y0 + 255), width=0.9)
        txt(p, x0 + 6, y0 + 14, cod, 16, True)
        ventana(p, x0 + 45, y0 + 30, 110, 110, tipo)
        txt(p, x0 + 90, y0 + 150, "ESC 1:25", 6)
        ty = y0 + 168
        cols = [x0 + 5, x0 + 40, x0 + 72, x0 + 100]
        for cx, h in zip(cols, ["UBICACION", "CODIGO", "CANTIDAD", "DESCRIPCION"]):
            txt(p, cx, ty, h, 5.5, True)
        p.draw_line(fitz.Point(x0 * MM, (ty + 2) * MM), fitz.Point((x0 + 205) * MM, (ty + 2) * MM), width=0.4)
        for k, (u, c) in enumerate(ubic):
            yy = ty + 9 + k * 8
            txt(p, cols[0], yy, u, 5.5)
            txt(p, cols[1], yy, cod, 5.5)
            txt(p, cols[2] + 6, yy, str(c), 5.5)
            txt(p, cols[3], yy, desc[:52], 4.6)
    doc.save(dst)


def pdf_simple(dst: Path, titulo: str, lineas: list[str]):
    doc = fitz.open()
    p = doc.new_page()
    p.insert_text((60, 80), titulo, fontsize=16, fontname="hebo")
    for i, l in enumerate(lineas):
        p.insert_text((60, 120 + i * 18), l, fontsize=11)
    p.insert_text((60, 780), "DOCUMENTO DE MUESTRA - no es un contrato real", fontsize=8)
    doc.save(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="../muestra")
    a = ap.parse_args()
    base = Path(a.salida) / "Garay"
    if base.exists():
        shutil.rmtree(base)
    vig = base / "1. Planos" / "Vigente"
    ar = vig / "01. Arquitectura"
    for d in [ar, vig / "02. Estructuras", vig / "03. Instalaciones", vig / "04. Municipal",
              vig / "05. Otros" / "10. Planos Complementarios", vig / "05. Otros" / "14. Modif. Extracción Baños y Cocinas",
              vig / "05. Otros" / "19. Modificación Eléctrica", vig / "05. Otros" / "20. Modificación Puertas Madera"]:
        d.mkdir(parents=True, exist_ok=True)

    nomenclados(ar / "BeGar-AR- Nomenclados_C.pdf")
    carpinteria(ar / "BeGar-ARD- Carpintería de Aluminio y Vidrio_C.pdf")
    vacios = [
        ar / "BeGar-AR- Nomenclados_C.dwg",
        ar / "BeGar-AR- Arquitectónico_C.dwg",
        ar / "BeGar-AR- Cielorraso_C.dwg",
        ar / "BeGar-ARD- Muros Cortina_C.dwg",
        ar / "BeGar-ARD- Puertas de Madera_C.dwg",
        vig / "02. Estructuras" / "BeGar-EH- Pasantes_C.dwg",
        vig / "03. Instalaciones" / "BeGar-IE- Instalación Eléctrica_C.dwg",
        vig / "03. Instalaciones" / "BeGar-TM- Termomecánica_C.dwg",
        vig / "05. Otros" / "14. Modif. Extracción Baños y Cocinas" / "BeGar-TM- Termomecánica_M.dwg",
        vig / "05. Otros" / "19. Modificación Eléctrica" / "BeGar-IE- Instalación Eléctrica_M.dwg",
        vig / "05. Otros" / "10. Planos Complementarios" / "Modelo de Dinteles.dwg",
        vig / "04. Municipal" / "BeGar-MUN- Plano Municipal.dwg",
    ]
    for f in vacios:
        f.write_bytes(b"AC1032 (DWG de relleno, muestra)")
    shutil.copy(ar / "BeGar-AR- Nomenclados_C.pdf",
                vig / "05. Otros" / "20. Modificación Puertas Madera" / "RE- Nomeclados_C.pdf")
    pdf_simple(vig / "05. Otros" / "10. Planos Complementarios" / "Minuta Modificación Carp. Aluminio.pdf",
               "Minuta de modificación - Carpintería de Aluminio",
               ["PV-04 pasa de DVH 4+9+4 a DVH 4+12+4 en N1 y N2.", "VA-02: se agrega mosquitero."])

    ot = base / "5. Compras y Contrataciones" / "02 Contratos y OT"
    for carpeta, docs in {
        "19. Constructora - MENA CC": ["Contrato MENA CC.pdf", "OT-BeGar-019-01 Carp Aluminio y Vidrio.pdf", "Adenda 01.pdf"],
        "23. Inst Eléctricas - Ecoenergía": ["Contrato Ecoenergía.pdf", "OT-BeGar-023-01.pdf"],
        "28. Juan Carlos pintura": ["OT-BeGar-028-01.pdf"],
    }.items():
        (ot / carpeta).mkdir(parents=True, exist_ok=True)
        for d in docs:
            pdf_simple(ot / carpeta / d, d.removesuffix(".pdf"), [f"Contratista: {carpeta.split(' - ')[-1]}", "Obra: Belive Garay"])
    print(f"Muestra generada en {base.resolve()}")


if __name__ == "__main__":
    main()
