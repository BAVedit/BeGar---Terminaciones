/* Informe en pantalla: filtros, alcance, qué incluir, copiar para WhatsApp. */
'use strict';
/* ---------- informe ---------- */
function vInforme(main, params) {
  const f = params.filtro = { rubro: '', resp: '', nivel: '', espacio: '', amb: '', alcance: 'pend', tipo: pref('informe-tipo') || 'completo', pestanas: false, ...params.filtro };
  const planilla = f.tipo === 'checklist'; // checklist simplificada: tabla sin fotos ni planos (Excel / PDF de tabla)
  if (!ALCANCES[f.alcance]) f.alcance = 'pend';
  f.estados = ALCANCES[f.alcance].estados;
  const inc = f.incluir = { fotos: true, plano: true, datos: true, historial: false, ...f.incluir };
  const rb = f.rubro ? rubro(f.rubro) : null;
  const [eNv, eU] = f.espacio ? f.espacio.split('|') : [];
  cabecera(M.proyecto.nombre, f.espacio ? `Informe · ${etiquetaEspacio(eNv, eU)}` : rb ? `Informe · ${rb.nombre}` : 'Informe general');
  const base = pines.filter((p) => (!f.rubro || p.rubro === f.rubro) && (!f.espacio || (p.nivel === eNv && espacioDe(p) === eU)));
  const ordenRubro = (p) => M.rubros.findIndex((r) => r.id === p.rubro);
  const resuelto = (p) => p.estado !== 'abierto';
  const ambientes = [...new Set(base.map((p) => p.ambiente).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (f.amb && !ambientes.includes(f.amb)) f.amb = '';
  const pasaFiltro = (p) => (!f.nivel || f.espacio || p.nivel === f.nivel) && (!f.resp || p.responsable === f.resp) && (!f.amb || p.ambiente === f.amb);
  const lista = base
    .filter((p) => pasaFiltro(p) && f.estados.includes(p.estado))
    .sort((a, b) => M.niveles.findIndex((n) => n.id === a.nivel) - M.niveles.findIndex((n) => n.id === b.nivel)
      || espacioDe(a).localeCompare(espacioDe(b)) || resuelto(a) - resuelto(b) || ordenRubro(a) - ordenRubro(b) || a.n - b.n);
  const resps = [...new Set(base.map((p) => p.responsable).filter(Boolean))];
  // agrupar por nivel + dpto; con pendientes y resueltos juntos, cada dpto se divide en las dos partes
  const grupos = [];
  for (const p of lista) {
    const k = `${p.nivel}|${espacioDe(p)}`;
    let g = grupos[grupos.length - 1];
    if (!g || g.k !== k) grupos.push(g = { k, nv: p.nivel, u: espacioDe(p), ps: [] });
    g.ps.push(p);
  }
  for (const g of grupos) {
    g.pend = g.ps.filter((p) => !resuelto(p)).length;
    g.res = g.ps.length - g.pend;
    g.secciones = f.alcance === 'ambos'
      ? [{ t: 'Pendientes', ps: g.ps.filter((p) => !resuelto(p)) }, { t: 'Resueltos', ps: g.ps.filter(resuelto) }]
      : [{ t: '', ps: g.ps }];
  }
  const espacios = M.niveles.flatMap((n) => [...(n.unidades || []), COMUN].map((u) => ({ k: `${n.id}|${u}`, t: etiquetaEspacio(n.id, u) })));
  const nFotos = lista.reduce((a, p) => a + p.fotos.length, 0);
  main.innerHTML = `<div class="pagina">
    <div class="campo no-imprimir"><span class="lbl">Tipo de informe</span>
      <div class="estados alcance">${[['completo', 'Completo (planos y fotos)'], ['checklist', 'Checklist (planilla)']].map(([id, n]) => `<button type="button" data-tipo="${id}" aria-pressed="${f.tipo === id}">${n}</button>`).join('')}</div></div>
    <div class="campos no-imprimir">
      <div class="campo"><label for="r-rb">Rubro</label><select id="r-rb"><option value="">Todos</option>${M.rubros.map((r) => `<option value="${r.id}" ${f.rubro === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-resp">Responsable</label><select id="r-resp"><option value="">Todos</option>${resps.map((x) => `<option ${f.resp === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-nv">Nivel</label><select id="r-nv" ${f.espacio ? 'disabled' : ''}><option value="">Todos</option>${M.niveles.map((n) => `<option ${f.nivel === n.id ? 'selected' : ''}>${n.id}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-amb">Ambiente</label><select id="r-amb" ${ambientes.length ? '' : 'disabled'}><option value="">Todos</option>${ambientes.map((x) => `<option ${f.amb === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-esp">Dpto / espacio</label><select id="r-esp"><option value="">Todos</option>${espacios.map((x) => `<option value="${esc(x.k)}" ${f.espacio === x.k ? 'selected' : ''}>${esc(x.t)}</option>`).join('')}</select></div>
      <div class="campo todo"><span class="lbl">Marcadores</span><div class="estados alcance">${Object.entries(ALCANCES).map(([id, a]) => `<button type="button" data-alc="${id}" aria-pressed="${f.alcance === id}">${a.nombre}</button>`).join('')}</div></div>
    </div>
    ${planilla ? `<div class="campo no-imprimir"><span class="lbl">Organización</span>
      <div class="incluir"><button type="button" id="r-pest" aria-pressed="${!!f.pestanas}">Una pestaña por contratista</button></div></div>` : `<div class="campo no-imprimir"><span class="lbl">Qué incluir</span>
      <div class="incluir">${INCLUIR.map((o) => `<button type="button" data-inc="${o.id}" aria-pressed="${!!inc[o.id]}">${o.nombre}</button>`).join('')}</div></div>`}
    <div class="campos no-imprimir">
      <div class="campo todo"><label for="r-tit">Título</label><input id="r-tit" value="${esc(f.titulo ?? tituloInforme(rb, f))}"></div>
      <div class="campo todo"><label for="r-nota">Nota para el contratista (opcional)</label><textarea id="r-nota" placeholder="Ej.: plazo para resolver, condiciones de acceso, contacto en obra">${esc(f.nota || '')}</textarea></div>
    </div>
    <div class="acciones no-imprimir">
      ${planilla ? `<button class="btn primario" id="r-xlsx" ${lista.length ? '' : 'disabled'}>Guardar Excel</button>
      <button class="btn" id="r-pdf" ${lista.length ? '' : 'disabled'}>Guardar PDF (tabla)</button>` : `<button class="btn primario" id="r-pdf" ${lista.length ? '' : 'disabled'}>Guardar PDF</button>
      <button class="btn" id="r-word" ${lista.length ? '' : 'disabled'}>Guardar Word</button>`}
      ${navigator.share ? `<button class="btn" id="r-compartir" ${lista.length ? '' : 'disabled'}>Compartir…</button>` : ''}
      <button class="btn" id="r-copiar">Copiar para WhatsApp</button>
    </div>
    <header class="rep-portada">
      <div class="barra-eyebrow" style="opacity:1;color:var(--tenue)">${ALCANCES[f.alcance].eyebrow}</div>
      <h2 id="r-tit-vista">${esc(f.titulo ?? tituloInforme(rb, f))}</h2>
      ${f.nota ? `<p class="nota-rep">${esc(f.nota)}</p>` : ''}
      <p class="nota num">${f.resp ? 'Responsable: <b>' + esc(f.resp) + '</b> · ' : ''}${lista.length} marcadores en ${grupos.length} espacios · ${nFotos} fotos · ${f.estados.map(estadoNombre).join(', ')} · emitido ${fechaCorta(hoyISO())} por ${esc(autor())}</p>
      ${grupos.length ? `<div class="tabla-caja"><table><thead><tr><th>Nivel</th><th>Dpto / espacio</th>${f.alcance === 'ambos' ? '<th class="num">Pendientes</th><th class="num">Resueltos</th><th class="num">Avance</th>' : '<th class="num">Marcadores</th>'}</tr></thead><tbody>
        ${grupos.map((g) => `<tr><td class="cod">${g.nv}</td><td>${esc(g.u)}</td>${f.alcance === 'ambos' ? `<td class="num">${g.pend}</td><td class="num">${g.res}</td><td class="num">${Math.round(100 * g.res / g.ps.length)}%</td>` : `<td class="num">${g.ps.length}</td>`}</tr>`).join('')}</tbody></table></div>` : ''}
    </header>
    ${planilla ? (lista.length ? vistaPlanilla({ f, lista }) : '<p class="vacio-txt">No hay marcadores con esos filtros.</p>') : grupos.map((g) => `
      <section class="rep-grupo">
        <h3 class="rep-grupo-t"><span class="cod">${g.nv}</span> · ${esc(g.u || COMUN)}</h3>
        ${f.alcance === 'ambos' ? `<p class="nota num">${resumenGrupo(g)}</p>` : ''}
        ${g.secciones.map((sc) => `${sc.t ? `<h4 class="rep-seccion-t">${sc.t} (${sc.ps.length})</h4>` : ''}
        <div class="rep">${sc.ps.length ? '' : `<p class="nota">${sc.t === 'Pendientes' ? 'No quedan pendientes.' : 'Todavía no hay resueltos.'}</p>`}${sc.ps.map((p, i) => `${cabContratista(p, sc.ps[i - 1], f) ? `<h5 class="rep-contratista">${esc(cabContratista(p, sc.ps[i - 1], f))}</h5>` : ''}
          <article class="rep-item">
            <div class="rep-cab"><h4>${codigoPin(p)} · ${esc(p.texto || 'Sin descripción')}</h4><span class="estado-pill e-${p.estado}">${estadoNombre(p.estado)}</span></div>
            <p class="nota">${esc(lineaUbicacion(p))}${inc.datos ? `<br>${esc(lineaDatos(p))}` : ''}</p>
            ${inc.plano || (inc.fotos && fotosEtapa(p, 'abierto').length) ? `<div class="rep-fotos">${inc.plano ? `<canvas data-snip="${p.id}" width="${RECORTE_W}" height="${RECORTE_H}" aria-label="Ubicación en el plano"></canvas>` : ''}${inc.fotos ? fotosEtapa(p, 'abierto').map((x) => `<img src="${x.src}" alt="">`).join('') : ''}</div>` : ''}
            ${etapasPosteriores(p).map((e) => `<div class="rep-etapa"><h5><i class="e-${e.id}"></i>${e.nombre}</h5>${p[e.campo] ? `<p>${esc(p[e.campo])}</p>` : ''}
              ${inc.fotos && fotosEtapa(p, e.id).length ? `<div class="rep-fotos">${fotosEtapa(p, e.id).map((x) => `<img src="${x.src}" alt="">`).join('')}</div>` : ''}</div>`).join('')}
            ${inc.historial && (p.comentarios || []).length ? `<div class="hilo">${p.comentarios.map((c) => `<div class="msj${c.sistema ? ' sistema' : ''}">${esc(c.texto)}<small>${esc(c.autor)} · ${fechaHora(c.fecha)}</small></div>`).join('')}</div>` : ''}
          </article>`).join('')}</div>`).join('')}
      </section>`).join('') || '<p class="vacio-txt">No hay marcadores con esos filtros.</p>'}
  </div>`;
  const setF = (k, v) => { f[k] = v; render(); };
  $('#r-rb').onchange = (e) => setF('rubro', e.target.value);
  $('#r-resp').onchange = (e) => setF('resp', e.target.value);
  $('#r-nv').onchange = (e) => setF('nivel', e.target.value);
  $('#r-esp').onchange = (e) => setF('espacio', e.target.value);
  $('#r-amb').onchange = (e) => setF('amb', e.target.value);
  main.querySelectorAll('[data-tipo]').forEach((b) => (b.onclick = () => { pref('informe-tipo', b.dataset.tipo); setF('tipo', b.dataset.tipo); }));
  if ($('#r-pest')) $('#r-pest').onclick = () => setF('pestanas', !f.pestanas);
  main.querySelectorAll('[data-alc]').forEach((b) => (b.onclick = () => setF('alcance', b.dataset.alc)));
  main.querySelectorAll('[data-inc]').forEach((b) => (b.onclick = () => { inc[b.dataset.inc] = !inc[b.dataset.inc]; render(); }));
  $('#r-tit').oninput = (e) => { f.titulo = e.target.value; $('#r-tit-vista').textContent = f.titulo; };
  $('#r-nota').onchange = (e) => { f.nota = e.target.value.trim(); render(); };
  const datosDoc = () => ({ titulo: f.titulo ?? tituloInforme(rb, f), nota: f.nota || '', rb, f, inc, lista, grupos, eyebrow: ALCANCES[f.alcance].eyebrow });
  const conEspera = (btn, fn) => async () => {
    const txt = btn.textContent; btn.disabled = true; btn.textContent = 'Armando…';
    try { await fn(); } catch (e) { console.error(e); aviso('No se pudo armar el archivo'); }
    btn.disabled = false; btn.textContent = txt;
  };
  // antes de armar el archivo se pregunta qué marcadores lleva: pendientes, resueltos o los dos
  const preguntar = (btnId, armar, ext, compartir) => () => {
    const cuenta = (id) => base.filter((p) => pasaFiltro(p) && ALCANCES[id].estados.includes(p.estado)).length;
    abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">¿Qué incluye el informe?</h2><p>${esc(f.espacio ? etiquetaEspacio(eNv, eU) : rb ? rb.nombre : 'Todos los rubros')}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
      <div class="lista">${Object.entries(ALCANCES).map(([id, a]) => `<button class="fila" data-elegir="${id}" ${cuenta(id) ? '' : 'disabled'}><span class="fila-t">${a.nombre}</span>
        <span class="fila-der">${f.alcance === id ? '<span class="chip piloto">actual</span>' : ''}</span><span class="fila-s"><span>${a.ayuda}</span><span class="num">${cuenta(id)} ${cuenta(id) === 1 ? 'marcador' : 'marcadores'}</span></span></button>`).join('')}</div>`, (h) => {
      $('[data-cerrar]', h).onclick = cerrarHoja;
      h.querySelectorAll('[data-elegir]').forEach((b) => (b.onclick = async () => {
        cerrarHoja();
        if (b.dataset.elegir !== f.alcance) { f.alcance = b.dataset.elegir; if (!/^\s*$/.test(f.titulo ?? '') && f.titulo === tituloAnterior) delete f.titulo; render(); }
        const btn = $('#' + btnId);
        if (btn) await conEspera(btn, async () => entregar(await armar(datosDoc2()), nombreArchivo(datosDoc2(), ext), compartir))();
      }));
    });
  };
  const tituloAnterior = tituloInforme(rb, f);
  // después de re-dibujar, los datos salen de la vista nueva
  const datosDoc2 = () => (pila[pila.length - 1].params.datosDoc || datosDoc)();
  params.datosDoc = datosDoc;
  if (lista.length || base.length) {
    const pdf = planilla ? planillaPDF : informePDF;
    $('#r-pdf').disabled = !base.length;
    $('#r-pdf').onclick = preguntar('r-pdf', pdf, 'pdf', false);
    if (planilla) { $('#r-xlsx').disabled = !base.length; $('#r-xlsx').onclick = preguntar('r-xlsx', planillaExcel, 'xlsx', false); }
    else { $('#r-word').disabled = !base.length; $('#r-word').onclick = preguntar('r-word', informeWord, 'docx', false); }
    const comp = $('#r-compartir');
    if (comp) { comp.disabled = !base.length; comp.onclick = preguntar('r-compartir', planilla ? planillaExcel : informePDF, planilla ? 'xlsx' : 'pdf', true); }
  }
  $('#r-copiar').onclick = () => {
    const lineas = [`*${M.proyecto.nombre} · ${rb ? rb.nombre : 'Todos los rubros'}*`, `${f.resp ? 'Responsable: ' + f.resp + ' · ' : ''}${lista.length} ${f.estados.map(estadoNombre).join('/').toLowerCase()} (${fechaCorta(hoyISO())})`];
    for (const g of grupos) {
      lineas.push('', `*${etiquetaEspacio(g.nv, g.u)}*`);
      for (const p of g.ps) lineas.push(`${codigoPin(p)} ${p.texto || 'Sin descripción'}${p.ambiente ? ' (' + p.ambiente + ')' : ''}`);
    }
    const txt = lineas.join('\n');
    navigator.clipboard.writeText(txt).then(() => aviso('Resumen copiado'), () => {
      abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Resumen</h2><p>Seleccioná y copiá el texto.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div><textarea id="r-txt" class="input" style="min-height:260px">${esc(txt)}</textarea>`,
        (h) => { $('[data-cerrar]', h).onclick = cerrarHoja; $('#r-txt', h).select(); });
    });
  };
  main.querySelectorAll('canvas[data-snip]').forEach((cv) => dibujarRecorte(cv, pines.find((p) => p.id === cv.dataset.snip)));
}
