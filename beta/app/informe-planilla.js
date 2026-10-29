/* Informe tipo checklist (planilla sin fotos ni planos) para contratistas: Excel (ExcelJS) y PDF de tabla (jsPDF). */
'use strict';
/* ---------- informe checklist: Excel y PDF tabulado ---------- */
const COLUMNAS_PLANILLA = [
  { t: 'ID', w: 9 },
  { t: 'Dpto / unidad', w: 14 },
  { t: 'Ambiente / sector', w: 16 },
  { t: 'Descripción del detalle', w: 46 },
  { t: 'Contratista responsable', w: 24 },
  { t: 'Fecha de captura', w: 12 },
  { t: 'Estado', w: 12 },
  { t: 'Observaciones / firma de recepción', w: 34 },
];
const COLOR_ESTADO_XL = { abierto: 'D6453D', corregido: '2F6FDB', aprobado: '2E9B57' };

/** Contratista y gremio de un marcador, como se muestra en la planilla. */
const contratistaPlanilla = (p) => {
  const rb = rubro(p.rubro);
  return `${contratistaDe(p)}${rb ? ' · ' + rb.nombre : ''}`;
};
/** Una fila por marcador, en el orden de la planilla. */
const filaPlanilla = (p) => [codigoPin(p), etiquetaEspacio(p.nivel, espacioDe(p)), p.ambiente || '', p.texto || 'Sin descripción',
  contratistaPlanilla(p), fechaCorta(p.creado), estadoNombre(p.estado), ''];
/** Grupos de la planilla: uno solo, o uno por contratista (pestañas / páginas separadas). Dentro, por nivel y dpto. */
function gruposPlanilla(d) {
  const orden = (a, b) => M.niveles.findIndex((n) => n.id === a.nivel) - M.niveles.findIndex((n) => n.id === b.nivel)
    || espacioDe(a).localeCompare(espacioDe(b)) || (a.ambiente || '').localeCompare(b.ambiente || '') || a.n - b.n;
  if (!d.f.pestanas) return [{ nombre: 'Checklist', ps: [...d.lista].sort((a, b) => contratistaDe(a).localeCompare(contratistaDe(b)) || orden(a, b)) }];
  const por = new Map();
  for (const p of d.lista) { const c = contratistaDe(p); if (!por.has(c)) por.set(c, []); por.get(c).push(p); }
  return [...por.entries()].sort((a, b) => (a[0] === SIN_CONTRATISTA) - (b[0] === SIN_CONTRATISTA) || a[0].localeCompare(b[0]))
    .map(([nombre, ps]) => ({ nombre, ps: ps.sort(orden) }));
}
/** Datos del encabezado: proyecto, dirección (si está cargada en proyecto.json), emisión y usuario. */
const metaPlanilla = (d) => [
  ['Proyecto / obra', M.proyecto.nombre],
  ...(M.proyecto.direccion ? [['Dirección', M.proyecto.direccion]] : []),
  ['Fecha de emisión', fechaCorta(hoyISO())],
  ['Emitido por', autor()],
  ['Filtro', resumenFiltro(d)],
];
const nombreHojaXL = (t, usados) => {
  let n = String(t).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Hoja';
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${n.slice(0, 27)} (${i})`;
  usados.add(n.toLowerCase());
  return n;
};

async function planillaExcel(d) {
  await cargarScript('vendor/exceljs.min.js');
  const wb = new window.ExcelJS.Workbook();
  wb.creator = autor(); wb.created = new Date();
  const logo = await aJPEG('iconos/codesarrollos-logo.svg', 900, 0.92).catch(() => null);
  const idLogo = logo ? wb.addImage({ base64: logo.url, extension: 'jpeg' }) : null;
  const borde = { style: 'thin', color: { argb: 'FFD9D9D9' } };
  const usados = new Set();
  for (const g of gruposPlanilla(d)) {
    const ws = wb.addWorksheet(nombreHojaXL(g.nombre, usados), {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: `&L${M.proyecto.nombre} · Codesarrollos&RPágina &P de &N` },
    });
    // anchos según el contenido (con mínimo y máximo), así el texto largo se envuelve en vez de cortarse
    const filas = g.ps.map(filaPlanilla);
    ws.columns = COLUMNAS_PLANILLA.map((c, i) => ({ width: Math.min(c.w + 14, Math.max(c.w, ...filas.map((f) => String(f[i]).length * 0.9))) }));
    // encabezado institucional: logo y datos de la obra
    let r = 1;
    if (idLogo !== null) { ws.addImage(idLogo, { tl: { col: 0, row: 0 }, ext: { width: 230, height: Math.round(230 * logo.h / logo.w) } }); r = 5; }
    ws.getCell(r, 1).value = d.titulo; ws.getCell(r, 1).font = { bold: true, size: 15 };
    ws.mergeCells(r, 1, r, COLUMNAS_PLANILLA.length); r++;
    if (d.f.pestanas) { ws.getCell(r, 1).value = `Contratista: ${g.nombre}`; ws.getCell(r, 1).font = { bold: true, size: 12 }; ws.mergeCells(r, 1, r, COLUMNAS_PLANILLA.length); r++; }
    // etiqueta en las dos primeras columnas (son angostas) y el dato en el resto
    for (const [k, v] of [...metaPlanilla(d), ...(d.nota ? [['Nota', d.nota]] : [])]) {
      ws.getCell(r, 1).value = k; ws.getCell(r, 1).font = { bold: true, color: { argb: 'FF5F5F5F' } }; ws.mergeCells(r, 1, r, 2);
      ws.getCell(r, 3).value = v; ws.getCell(r, 3).alignment = { wrapText: true, vertical: 'top' }; ws.mergeCells(r, 3, r, COLUMNAS_PLANILLA.length); r++;
    }
    r++;
    // tabla con la paleta de la empresa en el encabezado
    const cab = ws.getRow(r);
    COLUMNAS_PLANILLA.forEach((c, i) => {
      const cel = cab.getCell(i + 1);
      cel.value = c.t;
      cel.font = { bold: true, color: { argb: 'FF1A1A1A' } };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEBE10' } };
      cel.alignment = { vertical: 'middle', wrapText: true };
      cel.border = { top: borde, left: borde, bottom: borde, right: borde };
    });
    cab.height = 30;
    ws.views = [{ state: 'frozen', ySplit: r }];
    ws.pageSetup.printTitlesRow = `${r}:${r}`;
    g.ps.forEach((p, k) => {
      const fila = ws.getRow(r + 1 + k);
      filaPlanilla(p).forEach((v, i) => {
        const cel = fila.getCell(i + 1);
        cel.value = v;
        cel.alignment = { vertical: 'top', wrapText: true };
        cel.border = { top: borde, left: borde, bottom: borde, right: borde };
        if (k % 2) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      });
      fila.getCell(7).font = { bold: true, color: { argb: 'FF' + (COLOR_ESTADO_XL[p.estado] || '5F5F5F') } };
      // alto aproximado para que se vea el texto envuelto
      const lineas = Math.max(1, ...filaPlanilla(p).map((v, i) => Math.ceil(String(v).length / Math.max(1, ws.getColumn(i + 1).width * 1.1))));
      fila.height = Math.max(22, lineas * 15);
    });
    ws.autoFilter = { from: { row: r, column: 1 }, to: { row: r + g.ps.length, column: COLUMNAS_PLANILLA.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function planillaPDF(d) {
  await cargarScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const W = 297, H = 210, m = 10, ancho = W - 2 * m;
  const NEGRO = [26, 26, 26], GRIS = [95, 95, 95], ORO = [254, 190, 16];
  const COL = { abierto: [214, 69, 61], corregido: [47, 111, 219], aprobado: [46, 155, 87] };
  const total = COLUMNAS_PLANILLA.reduce((a, c) => a + c.w, 0);
  const anchos = COLUMNAS_PLANILLA.map((c) => ancho * c.w / total);
  const logo = await aJPEG('iconos/codesarrollos-logo.svg', 900, 0.92).catch(() => null);
  let y = m;
  const encabezado = (g, primera) => {
    if (primera && logo) { doc.addImage(logo.url, 'JPEG', m, y, 52, 52 * logo.h / logo.w); y += 52 * logo.h / logo.w + 3; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(primera ? 14 : 11); doc.setTextColor(...NEGRO);
    doc.text(latin1(d.titulo), m, y + 5); y += 7;
    doc.setDrawColor(...ORO); doc.setLineWidth(0.8); doc.line(m, y, W - m, y); y += 4;
    if (d.f.pestanas) { doc.setFontSize(11); doc.text(latin1(`Contratista: ${g.nombre}`), m, y + 4); y += 7; }
    if (primera) {
      doc.setFontSize(8.5);
      for (const [k, v] of metaPlanilla(d)) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS); doc.text(latin1(k + ':'), m, y + 3);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...NEGRO);
        const l = doc.splitTextToSize(latin1(v), ancho - 32); doc.text(l, m + 32, y + 3); y += 4 * l.length;
      }
      if (d.nota) { const l = doc.splitTextToSize(latin1(d.nota), ancho); doc.text(l, m, y + 4); y += 4 * l.length + 1; }
      y += 3;
    }
  };
  const cabTabla = () => {
    doc.setFillColor(...ORO); doc.rect(m, y, ancho, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NEGRO);
    let x = m;
    COLUMNAS_PLANILLA.forEach((c, i) => { doc.text(doc.splitTextToSize(latin1(c.t), anchos[i] - 2), x + 1.2, y + 3.3); x += anchos[i]; });
    y += 8;
  };
  gruposPlanilla(d).forEach((g, gi) => {
    if (gi) { doc.addPage(); y = m; }
    encabezado(g, gi === 0 || d.f.pestanas);
    cabTabla();
    g.ps.forEach((p, k) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const celdas = filaPlanilla(p).map((v, i) => doc.splitTextToSize(latin1(v), anchos[i] - 2.4));
      const alto = Math.max(9, ...celdas.map((l) => l.length * 3.6 + 2.6));
      if (y + alto > H - m - 6) { doc.addPage(); y = m; cabTabla(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); }
      if (k % 2) { doc.setFillColor(247, 247, 247); doc.rect(m, y, ancho, alto, 'F'); }
      let x = m;
      celdas.forEach((l, i) => {
        if (i === 6) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...(COL[p.estado] || GRIS)); } else { doc.setFont('helvetica', 'normal'); doc.setTextColor(...NEGRO); }
        doc.text(l, x + 1.2, y + 4);
        x += anchos[i];
      });
      doc.setDrawColor(217, 217, 217); doc.setLineWidth(0.2);
      let xx = m; doc.rect(m, y, ancho, alto); anchos.slice(0, -1).forEach((a) => { xx += a; doc.line(xx, y, xx, y + alto); });
      y += alto;
    });
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(latin1(`${M.proyecto.nombre} · Codesarrollos · emitido ${fechaCorta(hoyISO())} por ${autor()}`), m, H - 5); doc.text(`Página ${i} de ${n}`, W - m, H - 5, { align: 'right' });
  }
  return doc.output('blob');
}

/** Vista previa en pantalla de la checklist: la misma tabla que va al archivo. */
function vistaPlanilla(d) {
  return gruposPlanilla(d).map((g) => `<section class="rep-grupo">
    ${d.f.pestanas ? `<h3 class="rep-grupo-t">${esc(g.nombre)} <small class="nota">(${g.ps.length})</small></h3>` : ''}
    <div class="tabla-caja planilla"><table><thead><tr>${COLUMNAS_PLANILLA.map((c) => `<th>${esc(c.t)}</th>`).join('')}</tr></thead><tbody>
      ${g.ps.map((p) => `<tr>${filaPlanilla(p).map((v, i) => i === 6 ? `<td><span class="estado-pill e-${p.estado}">${esc(v)}</span></td>` : `<td${i === 0 ? ' class="cod"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></section>`).join('');
}
