/* Vistas: edificio (pantalla de inicio) y dpto / espacio. */
'use strict';
/* ---------- vista: edificio ---------- */
function vEdificio(main) {
  cabecera('Codesarrollos', M.proyecto.nombre);
  const r = resumen(pines);
  const nUnid = M.niveles.reduce((a, n) => a + (n.unidades || []).length, 0);
  const pendDe = (nv, u) => pines.filter((p) => p.nivel === nv && espacioDe(p) === u && p.estado === 'abierto').length;
  const totDe = (nv, u) => pines.filter((p) => p.nivel === nv && espacioDe(p) === u).length;
  const celda = (nv, u, etiqueta) => {
    const pend = pendDe(nv, u), tot = totDe(nv, u);
    const cls = pend ? 'con-pend' : tot ? 'al-dia' : '';
    return `<button class="unidad ${cls} ${u === COMUN && !(nivel(nv).unidades || []).length ? 'ancha' : ''}" data-nv="${nv}" data-u="${esc(u)}" aria-label="${esc(etiqueta)}: ${pend} pendientes">
      <span class="u-nom">${esc(etiqueta)}</span><span class="u-cant num">${pend || (tot ? '✓' : '')}</span></button>`;
  };
  const filas = nivelesEdificio().map((n) => {
    const sinPlano = recortesNivel(n.id).length === 0;
    const celdas = (n.unidades || []).map((u) => celda(n.id, u, u)).join('') + celda(n.id, COMUN, n.unidades.length ? 'Com.' : COMUN);
    return `<div class="piso ${sinPlano ? 'sin-plano' : ''}">
      <div class="piso-id"><b class="cod">${n.id}</b><span>${esc(n.tipo || n.nombre)}</span></div>
      <div class="piso-unidades">${celdas}</div>
    </div>`;
  }).join('');
  main.innerHTML = `
  <div class="pagina">
    <div class="kpis">
      <div class="kpi alerta"><b>${r.pend}</b><span>pendientes</span></div>
      <div class="kpi"><b>${r.real}</b><span>en proceso</span></div>
      <div class="kpi ok"><b>${r.verif}</b><span>verificados</span></div>
    </div>
    ${chipRubro()}
    <div class="seccion-t">Edificio · ${nUnid} dptos + áreas comunes</div>
    <div class="edificio">${filas}</div>
    <p class="nota">Tocá un dpto para ver sus pendientes de todos los rubros y marcar nuevos sobre el plano. Los pisos en gris todavía no tienen plano cargado.</p>
    <div class="seccion-t">Informes por contratista (PDF y Word)</div>
    <p class="nota">Tocá un rubro para armar su informe: elegís qué incluir y lo guardás o compartís en PDF o Word.</p>
    <div class="lista">${M.rubros.map((rb) => ({ rb, r: resumen(pines.filter((p) => p.rubro === rb.id)) })).filter((x) => x.r.total || x.rb.id === rubroActivo().id).map(({ rb, r }) => `
      <button class="fila" data-inf="${rb.id}">
        <span class="fila-t">${esc(rb.nombre)}</span>
        <span class="fila-der">${htmlAvance(r)}</span>
        <span class="fila-s"><span>${esc(responsablesRubro(rb).join(', ') || 'Sin contratista')}</span>${r.pend ? `<span><span class="punto e-abierto"></span> ${r.pend} pendientes</span>` : ''}</span>
      </button>`).join('')}</div>
    <div class="acciones"><button class="btn" id="inf-todos">Informe general</button><button class="btn" id="inf-dpto">Informe por dpto</button><button class="btn" id="ver-pend">Pendientes de la ingesta</button></div>
    ${nube ? '' : '<p class="nota">Los marcadores de ejemplo son de prueba y se pueden quitar desde el ícono de usuario.</p>'}
    <hr class="sep">
    <div class="seccion-t">Pedido de materiales</div>
    <div class="lista"><button class="fila" id="ir-pedidos"><span class="fila-t">Pedidos y remisiones</span><span class="fila-der"><span class="chip piloto">nuevo</span></span>
      <span class="fila-s"><span>Pedidos de los martes y jueves, lo que llegó y lo que falta</span></span></button></div>
    <hr class="sep">
    <div class="seccion-t">Pruebas de dptos</div>
    <div class="lista"><button class="fila" id="ir-pruebas"><span class="fila-t">Checklist de pruebas por nivel</span><span class="fila-der"><span class="chip piloto">nuevo</span></span>
      <span class="fila-s"><span>Tablero, luces, AA, cocina, termocalefón, baños y desagües: aprueba o no aprueba, con hilo de seguimiento</span></span></button></div>
  </div>`;
  enlazarChipRubro(main);
  main.querySelectorAll('.unidad').forEach((b) => (b.onclick = () => ir('espacio', { nivel: b.dataset.nv, unidad: b.dataset.u })));
  main.querySelectorAll('[data-inf]').forEach((b) => (b.onclick = () => ir('informe', { filtro: { rubro: b.dataset.inf } })));
  $('#inf-todos').onclick = () => ir('informe', { filtro: { rubro: '' } });
  $('#inf-dpto').onclick = elegirDptoInforme;
  $('#ver-pend').onclick = abrirPendientes;
  $('#ir-pedidos').onclick = () => ir('pedidos');
  $('#ir-pruebas').onclick = () => ir('pruebas');
}

/** Elegir el dpto para su informe (pendientes y resueltos, para el cierre). */
function elegirDptoInforme() {
  const filas = M.niveles.flatMap((n) => [...(n.unidades || []), COMUN].map((u) => ({ nv: n.id, u, r: resumen(pines.filter((p) => p.nivel === n.id && espacioDe(p) === u)) })))
    .filter((x) => x.r.total);
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Informe por dpto</h2><p>Elegí el dpto o espacio. Después elegís si va con pendientes, resueltos o los dos.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="lista">${filas.map((x) => `<button class="fila" data-esp="${esc(x.nv + '|' + x.u)}"><span class="fila-t">${esc(etiquetaEspacio(x.nv, x.u))}</span>
      <span class="fila-der">${htmlAvance(x.r)}</span><span class="fila-s"><span class="cod">${x.nv}</span><span>${x.r.pend} pendientes · ${x.r.total - x.r.pend} resueltos</span></span></button>`).join('') || '<p class="nota">Todavía no hay marcadores.</p>'}</div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-esp]').forEach((b) => (b.onclick = () => { cerrarHoja(); ir('informe', { filtro: { rubro: '', espacio: b.dataset.esp, alcance: 'ambos' } }); }));
  });
}

function htmlAvance(r) {
  if (!r.total) return '<span class="nota">Sin marcadores</span>';
  return `<div class="avance"><b>${r.pct}%</b><div class="barrita"><i style="width:${r.pct}%"></i></div></div>`;
}

/* ---------- vista: dpto / espacio ---------- */
function vEspacio(main, params) {
  const nv = nivel(params.nivel);
  const u = params.unidad;
  const titulo = etiquetaEspacio(nv.id, u);
  cabecera(`${nv.id} · ${nv.nombre}${nv.tipo ? ' · ' + nv.tipo : ''}`, titulo);
  const todos = pines.filter((p) => p.nivel === nv.id && espacioDe(p) === u);
  const soloPend = params.soloPend ?? false;
  const lista = todos.filter((p) => !soloPend || p.estado === 'abierto');
  const r = resumen(todos);
  const tienePlano = recortesNivel(nv.id).length > 0;
  const grupos = M.rubros.map((rb) => ({ rb, ps: lista.filter((p) => p.rubro === rb.id).sort((a, b) => GRAVEDAD[b.estado] - GRAVEDAD[a.estado] || a.n - b.n) })).filter((g) => g.ps.length);
  const unidades = nv.unidades || [];
  main.innerHTML = `
  <div class="pagina">
    ${unidades.length ? `<div class="selector-nivel">
      <div class="niveles-scroll">${[...unidades, COMUN].map((x) => `<button class="nivel-btn" data-u="${esc(x)}" aria-current="${x === u}">${x === COMUN ? 'Comunes' : esc(x)}</button>`).join('')}</div>
    </div>` : ''}
    <div class="kpis">
      <div class="kpi alerta"><b>${r.pend}</b><span>pendientes</span></div>
      <div class="kpi"><b>${r.real}</b><span>en proceso</span></div>
      <div class="kpi ok"><b>${r.verif}</b><span>verificados</span></div>
    </div>
    <div class="acciones">
      <button class="btn primario ancho" id="abrir-plano" ${tienePlano ? '' : 'disabled'}>${tienePlano ? (puedeEditar() ? 'Abrir plano y marcar' : 'Ver plano') : 'Este nivel todavía no tiene plano'}</button>
      <button class="btn ancho" id="inf-espacio" ${todos.length ? '' : 'disabled'}>Informe de ${esc(titulo)}</button>
    </div>
    ${chipRubro()}
    <nav class="pestanas" role="tablist">
      <button role="tab" data-f="0" aria-selected="${!soloPend}">Todos (${todos.length})</button>
      <button role="tab" data-f="1" aria-selected="${soloPend}">Solo pendientes (${r.pend})</button>
    </nav>
    ${grupos.length ? grupos.map(({ rb, ps }) => `
      <div class="grupo-rubro">
        <div class="grupo-cab"><b>${esc(rb.nombre)}</b><span class="nota">${esc(responsablesRubro(rb).join(', ') || 'Sin contratista')} · ${ps.length}</span></div>
        <div class="lista">${ps.map(filaPin).join('')}</div>
      </div>`).join('') : `<p class="vacio-txt">${todos.length ? 'No quedan pendientes en ' + esc(titulo) + '.' : 'Todavía no hay marcadores en ' + esc(titulo) + '. Abrí el plano y mantené apretado donde va el primero.'}</p>`}
  </div>`;
  enlazarChipRubro(main);
  main.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => ir('espacio', { nivel: nv.id, unidad: b.dataset.u, soloPend }, true)));
  main.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => ir('espacio', { ...params, soloPend: b.dataset.f === '1' }, true)));
  const act = main.querySelector('.nivel-btn[aria-current="true"]');
  if (act) { const sc = act.parentElement; sc.scrollLeft = act.offsetLeft - sc.offsetLeft - (sc.clientWidth - act.offsetWidth) / 2; }
  if (tienePlano) $('#abrir-plano').onclick = () => ir('visor', { nivel: nv.id, unidad: u });
  if (todos.length) $('#inf-espacio').onclick = () => ir('informe', { filtro: { rubro: '', espacio: `${nv.id}|${u}`, alcance: 'ambos' } });
  main.querySelectorAll('[data-pin]').forEach((b) => (b.onclick = () => {
    const p = pines.find((x) => x.id === b.dataset.pin);
    ir('visor', { nivel: p.nivel, unidad: u, capa: p.recorte, abrirPin: p.id });
  }));
}

function filaPin(p) {
  return `<button class="fila" data-pin="${p.id}">
    <span class="fila-t"><i class="punto-rubro" style="background:${colorContratista(contratistaDe(p))}" title="${esc(contratistaDe(p))}"></i>${codigoPin(p)} · ${esc(p.texto || 'Sin descripción')}</span>
    <span class="fila-der"><span class="estado-pill e-${p.estado}">${estadoNombre(p.estado)}</span></span>
    <span class="fila-s">${p.ambiente ? `<span>${esc(p.ambiente)}</span>` : ''}${p.codigo ? `<span class="cod">${esc(p.codigo)}</span>` : ''}
      <span>Resp.: ${esc(p.responsable || 'sin asignar')}</span><span>Relevó: ${esc(p.autor)}</span>
      ${p.fotos.length ? `<span>📷 ${p.fotos.length}</span>` : ''}${p.ejemplo ? '<span class="chip">ejemplo</span>' : ''}</span>
  </button>`;
}
