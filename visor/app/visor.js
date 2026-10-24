/* Vista del plano: mapa Leaflet, marcadores en el plano, modo de agregar. */
'use strict';
/* ---------- vista: visor ---------- */
function vVisor(main, params) {
  const nv = nivel(params.nivel);
  const recs = recortesNivel(nv.id);
  const rec = recs.find((x) => x.id === params.capa) || recs[0];
  const u = params.unidad;
  cabecera(`${nv.id} · ${nv.nombre}`, u ? etiquetaEspacio(nv.id, u) : nv.id);
  const habilitados = M.niveles.map((n) => recortesNivel(n.id).length > 0);
  const idx = M.niveles.findIndex((n) => n.id === nv.id);
  const prev = M.niveles.map((n, i) => i).filter((i) => i < idx && habilitados[i]).pop();
  const next = M.niveles.map((n, i) => i).filter((i) => i > idx && habilitados[i])[0];
  const r = resumen(pines.filter((p) => p.nivel === nv.id));

  main.innerHTML = `
  <div class="visor">
    <div class="visor-cab">
      <div class="selector-nivel">
        <button class="flecha" id="nv-prev" aria-label="Nivel anterior" ${prev === undefined ? 'disabled' : ''}>◀</button>
        <div class="niveles-scroll" id="nv-scroll">${M.niveles.map((n, i) => `<button class="nivel-btn" data-nv="${n.id}" aria-current="${n.id === nv.id}" ${habilitados[i] ? '' : 'disabled'}>${n.id}</button>`).join('')}</div>
        <button class="flecha" id="nv-next" aria-label="Nivel siguiente" ${next === undefined ? 'disabled' : ''}>▶</button>
      </div>
      <div class="nivel-actual"><b>${nv.id}</b><span>${esc(nv.nombre)}${nv.tipo ? ' · ' + esc(nv.tipo) : ''}${rec.compartida ? ' · planta compartida, marcadores propios de ' + nv.id : ''}</span>
        <span class="num">${r.pend} pendientes en el piso</span></div>
      <div class="capas">${chipRubro()}${recs.length > 1 ? recs.map((x) => `<button class="capa-btn" data-capa="${x.id}" aria-pressed="${x.id === rec.id}">${esc(nombrePlano(x))}</button>`).join('') : ''}</div>
    </div>
    <div class="mapa-caja">
      <div id="mapa" style="-webkit-user-select:none;user-select:none;-webkit-touch-callout:none"></div>
      <div class="etiqueta-nivel">${nv.id}${u ? ` <small>${esc(etiquetaEspacio(nv.id, u))}</small>` : ''}</div>
      <div class="herr-sup">
        <button id="t-encuadre" aria-label="Ver la planta entera" title="Ver la planta entera">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
        <button id="t-completa" aria-pressed="false">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg><span>Pantalla completa</span></button>
      </div>
      <div class="modo-pin-aviso" id="modo-aviso" hidden>Tocá el plano donde va el marcador</div>
      <div class="herr">
        <button id="t-codigos" aria-pressed="false">Códigos</button>
        <button class="principal" id="t-pin" aria-pressed="false">+ Marcador</button>
      </div>
    </div>
  </div>`;
  const irNivel = (id) => ir('visor', { nivel: id }, true);
  main.querySelectorAll('[data-nv]').forEach((b) => (b.onclick = () => irNivel(b.dataset.nv)));
  if (prev !== undefined) $('#nv-prev').onclick = () => irNivel(M.niveles[prev].id);
  if (next !== undefined) $('#nv-next').onclick = () => irNivel(M.niveles[next].id);
  const sc = $('#nv-scroll'); const act = sc.querySelector('[aria-current="true"]');
  if (act) sc.scrollLeft = act.offsetLeft - sc.offsetLeft - (sc.clientWidth - act.offsetWidth) / 2;
  main.querySelectorAll('[data-capa]').forEach((b) => (b.onclick = () => ir('visor', { ...params, capa: b.dataset.capa, abrirPin: null }, true)));
  enlazarChipRubro(main);
  montarMapa(nv, rec, params);
}

function montarMapa(nv, rec, params) {
  const t = rec.tiles;
  const Z = t.zoom_max;
  mapa = L.map('mapa', {
    crs: L.CRS.Simple, minZoom: -2, maxZoom: Z + 2, zoomSnap: 0.25, zoomDelta: 0.5,
    attributionControl: false, zoomControl: false, bounceAtZoomLimits: false,
  });
  const pt = (x, y) => mapa.unproject([x * t.ancho_px, y * t.alto_px], Z);
  const limites = L.latLngBounds(pt(0, 1), pt(1, 0));
  L.tileLayer(`${DATOS}${t.ruta}/{z}/{x}_{y}.${t.formato}`, {
    tileSize: t.tile_px, minNativeZoom: 0, maxNativeZoom: Z, maxZoom: Z + 2, minZoom: -2, noWrap: true, bounds: limites,
  }).addTo(mapa);
  mapa.setMaxBounds(limites.pad(0.25));
  const pu = params.unidad && posUnidad(rec, nv.id, params.unidad);
  if (pu && !params.abrirPin) mapa.setView(pt(pu.x, pu.y), Z - 1.5, { animate: false });
  else if (vistasMapa[rec.id]) mapa.setView(vistasMapa[rec.id].centro, vistasMapa[rec.id].zoom, { animate: false });
  else mapa.fitBounds(limites, { padding: [0, 0] });
  // pantalla completa: solo la planta (oculta barra y selector de nivel; usa la API del navegador si se puede)
  const app = $('#app'), btnC = $('#t-completa');
  const marcarCompleta = (on) => {
    app.classList.toggle('completa', on);
    btnC.setAttribute('aria-pressed', on);
    btnC.querySelector('span').textContent = on ? 'Salir' : 'Pantalla completa';
    setTimeout(() => { if (mapa) { mapa.invalidateSize(); if (!pu || !on) mapa.fitBounds(limites, { padding: [0, 0] }); } }, 60);
  };
  marcarCompleta(app.classList.contains('completa'));
  btnC.onclick = () => {
    const on = !app.classList.contains('completa');
    marcarCompleta(on);
    if (NATIVO) { const so = nativo('ScreenOrientation'); (on ? so.lock({ orientation: 'landscape' }) : so.unlock()).catch(() => {}); return; }
    try {
      if (!EN_IFRAME && on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      if (!on && document.fullscreenElement) { try { screen.orientation?.unlock?.(); } catch (e) { /* nada */ } document.exitFullscreen?.().catch(() => {}); }
    } catch (e) { /* sin API de pantalla completa: alcanza con ocultar la barra */ }
  };
  document.onfullscreenchange = () => { if (!document.fullscreenElement && app.classList.contains('completa')) marcarCompleta(false); };
  $('#t-encuadre').onclick = () => mapa.fitBounds(limites, { padding: [0, 0] });
  mapa.on('moveend', () => (vistasMapa[rec.id] = { centro: mapa.getCenter(), zoom: mapa.getZoom() }));
  const aNorm = (ll) => { const p = mapa.project(ll, Z); return { x: p.x / t.ancho_px, y: p.y / t.alto_px }; };

  let modoPin = false;
  const btnPin = $('#t-pin');
  function setModo(v) { modoPin = v; btnPin.setAttribute('aria-pressed', v); btnPin.textContent = v ? 'Cancelar' : '+ Marcador'; $('#modo-aviso').hidden = !v; }
  // desde Pruebas de dptos: el primer marcador lleva los datos del hilo
  const crearPin = (pos, ap) => { const pr = params.prueba; params.prueba = null; $('#modo-aviso').textContent = 'Tocá el plano donde va el marcador'; nuevoPin(nv, rec, pos, ap, pr || undefined); };

  // códigos de los planos (apagados por defecto: el relevamiento es por marcador)
  const capaCod = L.layerGroup();
  const pinesNivel = pines.filter((p) => p.nivel === nv.id && p.recorte === rec.id);
  rec.codigos.forEach((c, i) => {
    const f = M.codigos[c.codigo] || {};
    const relevante = f.rubro === rubroActivo().id;
    const est = peorEstado(pinesNivel.filter((p) => p.aparicion === `${c.codigo}@${i}`));
    const m = c.h * 0.6;
    L.rectangle(L.latLngBounds(pt(c.x - m, c.y + c.h + m), pt(c.x + c.w + m, c.y - m)), {
      className: `hs ${relevante ? 'hs-rel' : 'hs-otro'} ${est ? 'e-' + est : ''}`, weight: relevante ? 2 : 1,
    }).on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      if (modoPin) { setModo(false); return crearPin({ x: c.x + c.w / 2, y: c.y - c.h * 0.2 }, i); }
      abrirFicha(c.codigo, { nv, rec });
    }).addTo(capaCod);
  });
  $('#t-codigos').onclick = (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    on ? capaCod.addTo(mapa) : capaCod.remove();
  };

  // leyenda de colores por contratista; tocar uno deja solo ese en primer plano
  const contratistas = [...new Set(pinesNivel.map(contratistaDe))].sort((a, b) => (a === SIN_CONTRATISTA) - (b === SIN_CONTRATISTA) || a.localeCompare(b));
  const soloRubro = params.soloRubro && contratistas.includes(params.soloRubro) ? params.soloRubro : ''; // contratista elegido en la referencia
  if (contratistas.length) {
    const ley = document.createElement('div');
    ley.className = 'leyenda-pines';
    const rubrosDe = (c) => [...new Set(pinesNivel.filter((p) => contratistaDe(p) === c).map((p) => (rubro(p.rubro) || {}).nombre || p.rubro))].join(', ');
    ley.innerHTML = contratistas.map((c) => `<button data-sr="${esc(c)}" aria-pressed="${soloRubro === c}" class="${soloRubro && soloRubro !== c ? 'apagado' : ''}"><i style="background:${colorContratista(c)}"></i>${esc(c)}<small>${esc(rubrosDe(c))}</small></button>`).join('')
      + `<div class="ley-est"><span><i class="e-abierto"></i>Pendiente</span><span><i class="e-corregido"></i>En proceso</span><span><i class="e-aprobado">✓</i>Verificado</span></div>`;
    L.DomEvent.disableClickPropagation(ley); L.DomEvent.disableScrollPropagation(ley);
    $('.mapa-caja').appendChild(ley);
    ley.querySelectorAll('[data-sr]').forEach((b) => (b.onclick = () => ir('visor', { ...params, abrirPin: null, soloRubro: soloRubro === b.dataset.sr ? '' : b.dataset.sr }, true)));
  }
  for (const p of pinesNivel) {
    const desact = p.huella && p.huella !== rec.huella;
    const atenuado = params.unidad && espacioDe(p) !== params.unidad;
    const otroRubro = soloRubro && contratistaDe(p) !== soloRubro;
    const col = colorContratista(contratistaDe(p));
    const ico = L.divIcon({ className: `pin-ico e-${p.estado}${desact ? ' alerta' : ''}${atenuado || otroRubro ? ' tenue' : ''}`,
      html: `<div style="--c:${col}"><span style="color:${tintaSobre(col)}" class="l${Math.min(5, codigoPin(p).length)}">${codigoPin(p)}</span></div><i class="pin-est" title="${estadoNombre(p.estado)}">${p.estado === 'aprobado' ? '✓' : ''}</i>`, iconSize: [32, 32], iconAnchor: [16, 38] });
    L.marker(pt(p.x, p.y), { icon: ico, keyboard: true, title: `${codigoPin(p)} ${p.texto}` }).on('click', () => abrirPin(p)).addTo(mapa);
  }

  btnPin.onclick = () => setModo(!modoPin);
  mapa.on('click', (e) => { if (!modoPin) return; setModo(false); crearPin(aNorm(e.latlng)); });
  if (params.prueba) { setModo(true); $('#modo-aviso').textContent = 'Tocá el plano donde está el problema'; }

  // mantener apretado = nuevo marcador
  const cont = mapa.getContainer();
  let timer = null, inicio = null;
  const cancelar = () => { clearTimeout(timer); timer = null; };
  cont.addEventListener('pointerdown', (e) => {
    if (e.isPrimary === false) return cancelar();
    inicio = { x: e.clientX, y: e.clientY };
    cancelar();
    timer = setTimeout(() => {
      timer = null;
      const r = cont.getBoundingClientRect();
      if (navigator.vibrate) try { navigator.vibrate(30); } catch (er) { /* sin vibración */ }
      crearPin(aNorm(mapa.containerPointToLatLng([inicio.x - r.left, inicio.y - r.top])));
    }, 550);
  });
  cont.addEventListener('pointermove', (e) => { if (timer && inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 8) cancelar(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => cont.addEventListener(ev, cancelar));
  cont.addEventListener('touchstart', (e) => { if (e.touches.length > 1) cancelar(); }, { passive: true });
  cont.addEventListener('contextmenu', (e) => e.preventDefault());

  if (params.abrirPin) {
    const p = pines.find((x) => x.id === params.abrirPin);
    if (p) { mapa.setView(pt(p.x, p.y), Math.max(mapa.getZoom(), Z - 1.5), { animate: false }); abrirPin(p); }
    params.abrirPin = null;
  }
}
