/* Informe para compartir: PDF (jsPDF) y Word (docx), imágenes y recorte del plano. */
'use strict';
/* ---------- informe para compartir: PDF y Word ---------- */
const INCLUIR = [
  { id: 'fotos', nombre: 'Fotos' },
  { id: 'plano', nombre: 'Ubicación en el plano' },
  { id: 'datos', nombre: 'Responsable y fechas' },
  { id: 'historial', nombre: 'Historial' },
];
const ALCANCES = {
  pend: { nombre: 'Solo pendientes', estados: ['abierto'], eyebrow: 'Informe de pendientes', ayuda: 'Lo que falta hacer' },
  res: { nombre: 'Solo resueltos', estados: ['corregido', 'aprobado'], eyebrow: 'Informe de resueltos', ayuda: 'En proceso y verificados' },
  ambos: { nombre: 'Pendientes y resueltos', estados: ['abierto', 'corregido', 'aprobado'], eyebrow: 'Cierre de terminaciones', ayuda: 'Los dos en el mismo archivo, separados' },
};
const tituloInforme = (rb, f) => {
  const [nv, u] = f.espacio ? f.espacio.split('|') : [];
  return `${M.proyecto.nombre} · ${f.espacio ? etiquetaEspacio(nv, u) + (rb ? ' · ' + rb.nombre : '') : rb ? rb.nombre : 'Todos los rubros'}${f.resp ? ' · ' + f.resp : ''}`;
};
/** Encabezado de contratista dentro de un dpto: aparece cada vez que cambia el rubro (solo si el informe no es de un único rubro). */
const cabContratista = (p, ant, f) => {
  if (f.rubro || (ant && ant.rubro === p.rubro)) return '';
  const rb = rubro(p.rubro);
  return `${rb ? rb.nombre : p.rubro} · ${(rb && responsablesRubro(rb).join(', ')) || p.responsable || 'sin contratista'}`;
};
const resumenGrupo = (g) => `${g.pend} pendientes · ${g.res} resueltos · avance ${Math.round(100 * g.res / g.ps.length)}%`;
const lineaUbicacion = (p) => [(rubro(p.rubro) || {}).nombre || p.rubro, p.ambiente, p.codigo, 'Prioridad ' + p.prioridad].filter(Boolean).join(' · ');
const lineaDatos = (p) => `Responsable: ${p.responsable || 'sin asignar'} · Relevó: ${p.autor} el ${fechaCorta(p.creado)}${p.limite ? ' · Límite ' + fechaCorta(p.limite + 'T12:00') : ''}`
  + `${p.realizadoPor ? ` · En proceso (marcó ${p.realizadoPor}) el ${fechaCorta(p.realizadoEn)}` : ''}${p.verificadoPor ? ` · Verificó ${p.verificadoPor} el ${fechaCorta(p.verificadoEn)}` : ''}`;
const nombreArchivo = (d, ext) => `${d.titulo.replace(/[\\/:*?"<>|·]+/g, ' ').replace(/\s+/g, ' ').trim()} ${new Date().toISOString().slice(0, 10)}.${ext}`;
const resumenFiltro = (d) => `${d.f.resp ? 'Responsable: ' + d.f.resp + ' · ' : ''}${d.lista.length} marcadores en ${d.grupos.length} ${d.grupos.length === 1 ? 'espacio' : 'espacios'} · ${ALCANCES[d.f.alcance].nombre.toLowerCase()}`
  + `${d.f.alcance === 'ambos' ? ` (${d.lista.filter((p) => p.estado === 'abierto').length} pendientes, ${d.lista.filter((p) => p.estado !== 'abierto').length} resueltos)` : ''} · emitido ${fechaCorta(hoyISO())} por ${autor()}`;

const cargados = {};
function cargarScript(src) {
  return (cargados[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete cargados[src]; rej(new Error('no cargó ' + src)); };
    document.head.appendChild(s);
  }));
}

/** Imagen (data URL o ruta) → JPEG reducido, con su tamaño. */
function aJPEG(src, lado = 1000, calidad = 0.82) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, lado / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
      res({ url: cv.toDataURL('image/jpeg', calidad), w: cv.width, h: cv.height });
    };
    im.onerror = rej;
    if (/^https?:/.test(src) && !src.startsWith(location.origin)) im.crossOrigin = 'anonymous'; // fotos de la nube
    im.src = src;
  });
}
async function snipJPEG(p) {
  const cv = document.createElement('canvas'); cv.width = RECORTE_W; cv.height = RECORTE_H;
  await dibujarRecorte(cv, p);
  return { url: cv.toDataURL('image/jpeg', 0.85), w: cv.width, h: cv.height };
}
const logoJPEG = () => aJPEG('iconos/codesarrollos-logo.svg', 1424, 0.92).catch(() => null);
const bytes = (dataUrl) => Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));

/** Junta todo lo que va en el documento (imágenes ya convertidas), igual para PDF y Word. */
const jpegs = (fotos) => Promise.all(fotos.map((x) => aJPEG(x.src, 900).catch(() => null))).then((a) => a.filter(Boolean));
async function armarContenido(d) {
  const items = [];
  for (const g of d.grupos) {
    const secciones = [];
    for (const sc of g.secciones) {
      const ps = [];
      for (const p of sc.ps) {
        ps.push({
          p,
          plano: d.inc.plano ? await snipJPEG(p).catch(() => null) : null,
          fotos: d.inc.fotos ? await jpegs(fotosEtapa(p, 'abierto')) : [],
          etapas: await Promise.all(etapasPosteriores(p).map(async (e) => ({ nombre: e.nombre, id: e.id, texto: p[e.campo] || '', fotos: d.inc.fotos ? await jpegs(fotosEtapa(p, e.id)) : [] }))),
        });
      }
      secciones.push({ t: sc.t, ps });
    }
    items.push({ titulo: `${g.nv} · ${g.u || COMUN}`, resumen: d.f.alcance === 'ambos' ? resumenGrupo(g) : '', secciones });
  }
  return { logo: await logoJPEG(), items };
}

/** La fuente estándar del PDF solo tiene Latin-1: flechas, comillas tipográficas y emojis se reemplazan. */
const latin1 = (t) => String(t).replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '');

async function informePDF(d) {
  await cargarScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const c = await armarContenido(d);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, m = 15, ancho = W - 2 * m;
  const ORO = [254, 190, 16], NEGRO = [26, 26, 26], GRIS = [95, 95, 95];
  const COL = { abierto: [214, 69, 61], corregido: [47, 111, 219], aprobado: [46, 155, 87] };
  let y = m;
  let grupoActual = null; // para repetir el encabezado si un espacio sigue en la página siguiente
  const salto = (alto) => {
    if (y + alto <= H - m - 8) return;
    doc.addPage(); y = m;
    if (grupoActual) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
      doc.text(latin1(`${grupoActual} (continuación)`), m, y + 3.5); y += 7;
    }
  };
  const grilla = (celdas) => {
    const gap = 3, wf = (ancho - 2 * gap) / 3;
    for (let i = 0; i < celdas.length; i += 3) {
      const fila = celdas.slice(i, i + 3);
      const hf = Math.max(...fila.map((x) => wf * x.h / x.w));
      salto(hf + 2);
      fila.forEach((x, j) => {
        const xx = m + j * (wf + gap), hh = wf * x.h / x.w;
        doc.addImage(x.url, 'JPEG', xx, y, wf, hh);
        if (x.plano) { doc.setDrawColor(200, 200, 200); doc.rect(xx, y, wf, hh); }
      });
      y += hf + gap;
    }
  };
  const texto = (t, tam, color = NEGRO, estilo = 'normal', sep = 1.5) => {
    doc.setFont('helvetica', estilo); doc.setFontSize(tam); doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(latin1(t), ancho)) { salto(tam * 0.42); doc.text(l, m, y + tam * 0.35); y += tam * 0.42 + sep * 0.3; }
    y += sep;
  };
  if (c.logo) { const h = 12; doc.addImage(c.logo.url, 'JPEG', m, y, h * c.logo.w / c.logo.h, h); y += h + 4; }
  doc.setFillColor(...ORO); doc.rect(m, y, ancho, 1.2, 'F'); y += 6;
  texto(d.eyebrow.toUpperCase(), 9, GRIS, 'bold', 1);
  texto(d.titulo, 18, NEGRO, 'bold', 2);
  texto(resumenFiltro(d), 9.5, GRIS);
  if (d.nota) texto(d.nota, 11, NEGRO, 'normal', 3);
  y += 2;
  c.items.forEach((g, gi) => {
    // cada dpto / espacio arranca en una página nueva (el primero va debajo del encabezado)
    if (gi > 0) { grupoActual = null; doc.addPage(); y = m; } else salto(20);
    texto(g.titulo, 14, NEGRO, 'bold', 0.5);
    grupoActual = g.titulo;
    doc.setFillColor(...ORO); doc.rect(m, y, ancho, 0.8, 'F'); y += 4;
    if (g.resumen) texto(g.resumen, 9.5, GRIS, 'normal', 2);
    for (const sc of g.secciones) {
    if (sc.t) {
      // los resueltos arrancan en otra página, así el pendiente queda separado de lo terminado
      if (sc.t === 'Resueltos' && g.secciones[0].ps.length) { doc.addPage(); y = m; texto(g.titulo, 9.5, GRIS, 'bold', 1.5); } else salto(14);
      texto(`${sc.t} (${sc.ps.length})`, 12, sc.t === 'Pendientes' ? COL.abierto : COL.aprobado, 'bold', 1.5);
      if (!sc.ps.length) texto(sc.t === 'Pendientes' ? 'No quedan pendientes.' : 'Todavía no hay resueltos.', 9.5, GRIS, 'normal', 3);
    }
    for (const [ii, it] of sc.ps.entries()) {
      const p = it.p;
      const cab = cabContratista(p, ii ? sc.ps[ii - 1].p : null, d.f);
      if (cab) { salto(26); y += 1; doc.setFillColor(242, 242, 242); doc.rect(m, y, ancho, 7, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...NEGRO); doc.text(latin1(cab), m + 2.5, y + 4.8); y += 10; }
      salto(18);
      const est = estadoNombre(p.estado);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      const wEst = doc.getTextWidth(est) + 6;
      doc.setFillColor(...(COL[p.estado] || GRIS)); doc.roundedRect(W - m - wEst, y, wEst, 5.5, 2.5, 2.5, 'F');
      doc.setTextColor(255, 255, 255); doc.text(est, W - m - wEst + 3, y + 3.9);
      doc.setFontSize(11.5); doc.setTextColor(...NEGRO);
      const lineas = doc.splitTextToSize(latin1(`${codigoPin(p)} · ${p.texto || 'Sin descripción'}`), ancho - wEst - 4);
      lineas.forEach((l, i) => doc.text(l, m, y + 4 + i * 5)); y += Math.max(6, lineas.length * 5) + 1.5;
      texto(lineaUbicacion(p), 9.5, GRIS, 'normal', 0.5);
      if (d.inc.datos) texto(lineaDatos(p), 9.5, GRIS, 'normal', 1);
      // recorte del plano (el ambiente) primero y después las fotos, en una grilla de 3
      grilla([...(it.plano ? [{ ...it.plano, plano: true }] : []), ...it.fotos]);
      // en proceso y verificado: cada uno con su texto y sus fotos (el antes y el después)
      for (const e of it.etapas) {
        salto(12); y += 1;
        doc.setFillColor(...COL[e.id]); doc.circle(m + 1.5, y + 2.3, 1.4, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NEGRO); doc.text(latin1(e.nombre), m + 5, y + 3.5); y += 6;
        if (e.texto) texto(e.texto, 10, NEGRO, 'normal', 1);
        grilla(e.fotos);
      }
      if (d.inc.historial) for (const h of p.comentarios || []) texto(`${fechaHora(h.fecha)} · ${h.autor}: ${h.texto}`, 9, GRIS, 'normal', 0.3);
      y += 2; doc.setDrawColor(226, 226, 226); salto(4); doc.line(m, y, W - m, y); y += 5;
    }
    }
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text(latin1(`${M.proyecto.nombre} · Codesarrollos`), m, H - 8); doc.text(`Página ${i} de ${n}`, W - m, H - 8, { align: 'right' });
  }
  return doc.output('blob');
}

async function informeWord(d) {
  await cargarScript('vendor/docx.iife.js');
  const X = window.docx;
  const c = await armarContenido(d);
  const ORO = 'FEBE10', GRIS = '5F5F5F';
  const COL = { abierto: 'D6453D', corregido: '2F6FDB', aprobado: '2E9B57' };
  const ancho = 600; // px aprox. del ancho útil de A4
  const img = (x, w) => new X.ImageRun({ type: 'jpg', data: bytes(x.url), transformation: { width: w, height: Math.round(w * x.h / x.w) } });
  const par = (txt, o = {}) => new X.Paragraph({ spacing: { after: o.after ?? 80 }, children: [new X.TextRun({ text: txt, size: (o.tam || 11) * 2, bold: o.bold, color: o.color || '1A1A1A', font: 'Calibri' })] });
  const linea = () => ({ bottom: { style: X.BorderStyle.SINGLE, size: 12, color: ORO, space: 4 } });
  const hijos = [];
  const grilla = (celdas) => {
    if (!celdas.length) return;
    const w = Math.floor((ancho - 16) / 3);
    for (let i = 0; i < celdas.length; i += 3) {
      hijos.push(new X.Table({ width: { size: 100, type: X.WidthType.PERCENTAGE }, borders: X.TableBorders.NONE, rows: [new X.TableRow({
        children: [0, 1, 2].map((j) => new X.TableCell({ width: { size: 33, type: X.WidthType.PERCENTAGE },
          children: [new X.Paragraph({ children: celdas[i + j] ? [img(celdas[i + j], w)] : [] })] })),
      })] }));
    }
    hijos.push(par('', { after: 60 }));
  };
  if (c.logo) hijos.push(new X.Paragraph({ spacing: { after: 120 }, children: [img(c.logo, 230)] }));
  hijos.push(par(d.eyebrow.toUpperCase(), { tam: 9, color: GRIS, bold: true, after: 40 }));
  hijos.push(new X.Paragraph({ border: linea(), spacing: { after: 160 }, children: [new X.TextRun({ text: d.titulo, bold: true, size: 36, font: 'Calibri' })] }));
  hijos.push(par(resumenFiltro(d), { tam: 9.5, color: GRIS, after: 160 }));
  if (d.nota) hijos.push(par(d.nota, { tam: 11, after: 200 }));
  for (const [gi, g] of c.items.entries()) {
    // cada dpto / espacio arranca en una página nueva
    hijos.push(new X.Paragraph({ heading: X.HeadingLevel.HEADING_2, border: linea(), spacing: { before: 240, after: 120 }, pageBreakBefore: gi > 0,
      children: [new X.TextRun({ text: g.titulo, bold: true, size: 28, color: '1A1A1A', font: 'Calibri' })] }));
    if (g.resumen) hijos.push(par(g.resumen, { tam: 9.5, color: GRIS, after: 120 }));
    for (const sc of g.secciones) {
    if (sc.t) {
      hijos.push(new X.Paragraph({ spacing: { before: 200, after: 80 }, keepNext: true, pageBreakBefore: sc.t === 'Resueltos' && g.secciones[0].ps.length > 0, children: [new X.TextRun({ text: `${sc.t} (${sc.ps.length})`, bold: true, size: 24, color: sc.t === 'Pendientes' ? COL.abierto : COL.aprobado, font: 'Calibri' })] }));
      if (!sc.ps.length) hijos.push(par(sc.t === 'Pendientes' ? 'No quedan pendientes.' : 'Todavía no hay resueltos.', { tam: 9.5, color: GRIS, after: 120 }));
    }
    for (const [ii, it] of sc.ps.entries()) {
      const p = it.p;
      const cab = cabContratista(p, ii ? sc.ps[ii - 1].p : null, d.f);
      if (cab) hijos.push(new X.Paragraph({ spacing: { before: 160, after: 60 }, keepNext: true, shading: { type: X.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
        children: [new X.TextRun({ text: cab, bold: true, size: 21, font: 'Calibri' })] }));
      hijos.push(new X.Paragraph({ spacing: { before: 120, after: 60 }, keepNext: true, children: [
        new X.TextRun({ text: `${codigoPin(p)} · ${p.texto || 'Sin descripción'}  `, bold: true, size: 23, font: 'Calibri' }),
        new X.TextRun({ text: ` ${estadoNombre(p.estado)} `, bold: true, size: 18, color: 'FFFFFF', font: 'Calibri', shading: { type: X.ShadingType.CLEAR, fill: COL[p.estado] || GRIS, color: 'auto' } }),
      ] }));
      hijos.push(par(lineaUbicacion(p), { tam: 9.5, color: GRIS, after: 40 }));
      if (d.inc.datos) hijos.push(par(lineaDatos(p), { tam: 9.5, color: GRIS, after: 80 }));
      grilla([...(it.plano ? [it.plano] : []), ...it.fotos]); // el ambiente en el plano, después las fotos
      for (const e of it.etapas) {
        hijos.push(new X.Paragraph({ spacing: { before: 80, after: 40 }, keepNext: true, children: [new X.TextRun({ text: `● ${e.nombre}`, bold: true, size: 20, color: COL[e.id], font: 'Calibri' })] }));
        if (e.texto) hijos.push(par(e.texto, { tam: 10, after: 60 }));
        grilla(e.fotos);
      }
      if (d.inc.historial) for (const h of p.comentarios || []) hijos.push(par(`${fechaHora(h.fecha)} · ${h.autor}: ${h.texto}`, { tam: 9, color: GRIS, after: 20 }));
    }
    }
  }
  const doc = new X.Document({
    creator: autor(), title: d.titulo,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: { default: new X.Footer({ children: [new X.Paragraph({ alignment: X.AlignmentType.RIGHT, children: [
        new X.TextRun({ text: `${M.proyecto.nombre} · Codesarrollos · Página `, size: 16, color: GRIS }),
        new X.TextRun({ children: [X.PageNumber.CURRENT], size: 16, color: GRIS }),
      ] })] }) },
      children: hijos,
    }],
  });
  return X.Packer.toBlob(doc);
}

/** Compartir (WhatsApp, mail, Drive…) si el teléfono lo permite; si no, descargar. */
async function entregar(blob, nombre, compartir) {
  // dentro de claude.ai la página no puede descargar sola: se lo pide al visor (el usuario confirma)
  if (EN_IFRAME && window.claude && window.claude.use) {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (dl) {
      try { await dl.save({ filename: nombre, data: blob }); aviso(`Guardado: ${nombre}`); }
      catch (e) { if (e && e.code !== 'declined') aviso('No se pudo guardar el archivo acá. Probalo desde la app instalada.'); }
      return;
    }
  }
  if (NATIVO) {
    // en la app Android se guarda en el teléfono y se abre el menú de compartir (WhatsApp, Drive, Archivos…)
    try {
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
      const { uri } = await nativo('Filesystem').writeFile({ path: nombre, data, directory: 'CACHE' });
      await nativo('Share').share({ title: nombre, files: [uri], dialogTitle: compartir ? 'Compartir informe' : 'Guardar o enviar informe' });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) aviso('No se pudo abrir el menú para compartir el archivo'); }
    return;
  }
  const tipo = nombre.endsWith('.pdf') ? 'application/pdf' : nombre.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const archivo = new File([blob], nombre, { type: tipo });
  if (compartir && navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: nombre }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  aviso(`Guardado: ${nombre}`);
}

/** Vista del plano alrededor del marcador, armada con los tiles. */
const RECORTE_W = 600, RECORTE_H = 450; // px del plano a resolución completa ≈ un ambiente (cocina, baño)
async function dibujarRecorte(cv, p) {
  const rec = recorte(p.recorte); if (!rec) return;
  const t = rec.tiles;
  const z = t.zoom_max, f = 1; // resolución completa: el recorte es del tamaño de un ambiente
  const W = t.ancho_px * f, H = t.alto_px * f, T = t.tile_px;
  const cx = p.x * W, cy = p.y * H;
  const x0 = Math.max(0, Math.min(cx - cv.width / 2, W - cv.width)), y0 = Math.max(0, Math.min(cy - cv.height / 2, H - cv.height));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  const cargas = [];
  for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + cv.height) / T); ty++) {
    for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + cv.width) / T); tx++) {
      cargas.push(new Promise((res) => {
        const im = new Image();
        im.onload = () => { ctx.drawImage(im, tx * T - x0, ty * T - y0); res(); };
        im.onerror = res;
        im.src = `${DATOS}${t.ruta}/${z}/${tx}_${ty}.${t.formato}`;
      }));
    }
  }
  await Promise.all(cargas);
  const color = colorContratista(contratistaDe(p));
  const px = cx - x0, py = cy - y0;
  ctx.lineWidth = 4; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(px, py, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
  ctx.font = '700 18px "Barlow Semi Condensed", sans-serif'; ctx.fillText(codigoPin(p), px + 26, py - 10);
}
