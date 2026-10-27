/* Marcadores: alta y edición (formulario con etapas Pendiente / En proceso / Verificado), editor y compresión de fotos. */
'use strict';
/* ---------- marcadores ---------- */
const opcionesRubro = (actual) => M.rubros.map((r) => `<option value="${r.id}" ${actual === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')
  + (puedeEditar() ? '<option value="__nuevo">+ Agregar rubro…</option>' : '');

function nuevoPin(nv, rec, { x, y }, aparicion, prueba) {
  if (!puedeEditar()) { aviso('Tu usuario es de solo lectura'); return; }
  const rb = (prueba && rubro(prueba.rubro)) || rubroActivo();
  const ub = inferirUbicacion(rec, nv.id, x, y);
  const c = aparicion !== undefined ? rec.codigos[aparicion] : null;
  const p = {
    id: uid(), n: Math.max(0, ...pines.map((q) => q.n)) + 1, cod: proximoCod(rb.id), proyecto: M.proyecto.id,
    rubro: rb.id, nivel: nv.id, unidad: ub.unidad, ambiente: ub.ambiente, recorte: rec.id, huella: rec.huella, x, y,
    aparicion: c ? `${c.codigo}@${aparicion}` : null, codigo: c ? c.codigo : null,
    estado: 'abierto', prioridad: 'Media', responsable: responsablesRubro(rb)[0] || '', limite: '', texto: '',
    fotos: [], comentarios: [], autor: autor(), creado: hoyISO(), actualizado: hoyISO(),
  };
  // marcador de un problema encontrado en Pruebas de dptos: queda vinculado a su hilo
  if (prueba) Object.assign(p, { texto: prueba.texto, prueba: prueba.hilo, responsable: prueba.responsable || p.responsable });
  formPin(p, true, { nv, rec });
}

function abrirPin(p) {
  formPin(structuredClone(p), false, { nv: nivel(p.nivel), rec: recorte(p.recorte) });
}

function formPin(p, esNuevo, { nv, rec }) {
  const desact = p.huella && p.huella !== rec.huella;
  const unidades = [...(nv.unidades || []), COMUN];
  if (!unidades.includes(espacioDe(p))) unidades.unshift(espacioDe(p));
  const cerca = codigosCercanos(rec, p.x, p.y);
  const respOpc = (rbId) => [...new Set([...responsablesRubro(rubro(rbId)), ...M.rubros.flatMap(responsablesRubro), p.responsable].filter(Boolean))];
  abrirHoja(`
    <div class="ficha-cab">
      <div><h2 class="h-hoja">${esNuevo ? 'Nuevo marcador' : 'Marcador ' + codigoPin(p)}</h2>
      <p><span class="cod">${nv.id}</span> · ${esc(etiquetaEspacio(nv.id, espacioDe(p)))}${p.ejemplo ? ' · ejemplo' : ''}</p></div>
      <button class="cerrar" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    ${desact ? '<div class="alerta-plano"><b>Plano actualizado.</b> Verificá que el marcador siga en el lugar correcto.</div>' : ''}
    ${ETAPAS.map((e, i) => `<div class="etapa" data-etapa="${e.id}">
      ${i ? `<h3 class="etapa-t"><i class="e-${e.id}"></i>${e.nombre}</h3>` : ''}
      <div class="campo todo"><span class="lbl">Fotos${i ? ' · ' + e.nombre.toLowerCase() : ' (evidencia)'}</span>
        <div class="fotos" data-fotos="${e.id}"></div></div>
      <div class="campo todo"><label for="f-txt-${e.id}">${e.lbl}</label><textarea id="f-txt-${e.id}" placeholder="${e.ph}">${esc(p[e.campo] || '')}</textarea></div>
    </div>`).join('')}
    <div class="campos">
      <div class="campo"><label for="f-rubro">Rubro</label><select id="f-rubro">${opcionesRubro(p.rubro)}</select></div>
      <div class="campo todo nuevo-rubro" id="f-rubro-nuevo" hidden></div>
      <div class="campo"><label for="f-resp">Responsable de ejecutarlo</label><input id="f-resp" list="f-resp-l" value="${esc(p.responsable)}" placeholder="Contratista o persona"><datalist id="f-resp-l"></datalist></div>
      <div class="campo"><label for="f-unidad">Dpto / espacio</label><select id="f-unidad">${unidades.map((x) => `<option ${espacioDe(p) === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="campo"><label for="f-amb">Ambiente</label><input id="f-amb" value="${esc(p.ambiente || '')}" placeholder="Ej.: Baño, Living"></div>
      <div class="campo"><label for="f-prio">Prioridad</label><select id="f-prio">${PRIORIDADES.map((x) => `<option ${p.prioridad === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="campo"><label for="f-lim">Fecha límite</label><input id="f-lim" type="date" value="${esc(p.limite)}"></div>
      <div class="campo"><label for="f-cod">Código del plano</label><select id="f-cod"><option value="">Ninguno</option>
        ${cerca.map((c) => `<option value="${c.codigo}@${c.i}" ${p.aparicion === `${c.codigo}@${c.i}` ? 'selected' : ''}>${esc(c.codigo)}</option>`).join('')}</select></div>
      <div class="campo"><span class="lbl">Relevó</span><div class="nota" style="padding-top:10px">${esc(p.autor)} · ${fechaHora(p.creado)}</div></div>
      ${p.realizadoPor ? `<div class="campo"><span class="lbl">Pasó a en proceso</span><div class="nota" style="padding-top:10px">${esc(p.realizadoPor)} · ${fechaHora(p.realizadoEn)}</div></div>` : ''}
      ${p.verificadoPor ? `<div class="campo"><span class="lbl">Verificó</span><div class="nota" style="padding-top:10px">${esc(p.verificadoPor)} · ${fechaHora(p.verificadoEn)}</div></div>` : ''}
    </div>
    <div class="campo todo"><span class="lbl">Estado</span>
      <div class="estados" id="f-estado">${ESTADOS.map((e) => `<button type="button" class="e-${e.id}" data-e="${e.id}" aria-pressed="${p.estado === e.id}">${e.nombre}</button>`).join('')}</div></div>
    ${esNuevo ? '' : `<div class="campo todo"><span class="lbl">Seguimiento</span>
      <div class="hilo">${p.comentarios.map((c) => `<div class="msj ${c.sistema ? 'sistema' : ''}${c.consulta ? ' consulta' : ''}">${c.consulta ? '<b class="etq-consulta">Consulta</b> ' : ''}${esc(c.texto)}<small>${esc(c.autor)} · ${fechaHora(c.fecha)}</small></div>`).join('') || '<p class="nota">Sin comentarios.</p>'}</div>
      <div style="display:flex;gap:8px"><input id="f-com" class="input" placeholder="${puedeEditar() ? 'Escribí un comentario' : 'Escribí una consulta'}" style="flex:1"><button class="btn" id="f-com-ok">Enviar</button></div></div>`}
    <div class="acciones">
      <button class="btn primario ancho" id="f-guardar">${esNuevo ? 'Guardar marcador' : 'Guardar cambios'}</button>
      ${esNuevo || !puedeBorrar() ? '' : '<button class="btn peligro" id="f-borrar">Eliminar</button>'}
    </div>
  `, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    // lector: todo bloqueado menos la caja de comentarios, para dejar consultas
    if (!puedeEditar()) h.querySelectorAll('input, select, textarea, .estados button').forEach((e) => { if (e.id !== 'f-com') e.disabled = true; });
    const llenarResp = () => { $('#f-resp-l', h).innerHTML = respOpc($('#f-rubro', h).value).map((x) => `<option value="${esc(x)}">`).join(''); };
    llenarResp();
    let rubroPrevio = p.rubro;
    $('#f-rubro', h).onchange = () => {
      const sel = $('#f-rubro', h);
      if (sel.value === '__nuevo') {
        formNuevoRubro($('#f-rubro-nuevo', h), (r) => {
          sel.innerHTML = opcionesRubro(r ? r.id : rubroPrevio);
          if (r) { rubroPrevio = r.id; llenarResp(); if (r.responsables[0]) $('#f-resp', h).value = r.responsables[0]; }
        });
        return;
      }
      rubroPrevio = sel.value;
      llenarResp();
      const r = responsablesRubro(rubro($('#f-rubro', h).value))[0];
      if (r) $('#f-resp', h).value = r;
    };
    let estado = p.estado;
    // se ven las etapas hasta el estado elegido, y las que ya tienen fotos o texto
    const verEtapas = () => {
      const hasta = ETAPAS.findIndex((e) => e.id === estado);
      ETAPAS.forEach((e, i) => { $(`[data-etapa="${e.id}"]`, h).hidden = i > hasta && !p[e.campo] && !fotosEtapa(p, e.id).length; });
    };
    h.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
      estado = b.dataset.e;
      h.querySelectorAll('[data-e]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      verEtapas();
    }));
    const pintarFotos = (et) => {
      const caja = $(`[data-fotos="${et}"]`, h);
      const idx = p.fotos.map((f, i) => i).filter((i) => etapaFoto(p.fotos[i]) === et);
      caja.innerHTML = idx.map((i, k) => { const f = p.fotos[i]; return `<figure><img src="${f.src}" alt="Foto ${k + 1}"><figcaption>${fechaHora(f.fecha)}</figcaption>
          <button type="button" class="foto-quitar" data-q="${i}" aria-label="Quitar foto ${k + 1}">✕</button>
          <button type="button" class="foto-marcar" data-m="${i}" aria-label="Marcar foto ${k + 1} con círculos o flechas">✎ Marcar</button></figure>`; }).join('')
        + `<label class="foto-add camara">📷<br>Sacar foto<input type="file" accept="image/*" capture="environment" data-cam></label>
           <label class="foto-add">＋<br>De galería<input type="file" accept="image/*" multiple data-gal></label>`;
      const agregar = async (e) => {
        for (const file of e.target.files) {
          try { p.fotos.push({ src: await comprimir(file, `${nv.id} ${$('#f-unidad', h).value === COMUN ? COMUN : $('#f-unidad', h).value} · ${autor()}`), fecha: hoyISO(), autor: autor(), etapa: et }); }
          catch (er) { aviso('No se pudo leer la imagen'); }
        }
        pintarFotos(et);
      };
      $('[data-cam]', caja).onchange = agregar; $('[data-gal]', caja).onchange = agregar;
      caja.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { p.fotos.splice(+b.dataset.q, 1); ETAPAS.forEach((e) => pintarFotos(e.id)); }));
      caja.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => marcarFoto(p.fotos[+b.dataset.m], () => pintarFotos(et))));
    };
    ETAPAS.forEach((e) => pintarFotos(e.id));
    verEtapas();
    const leer = () => {
      const sel = $('#f-cod', h).value;
      if (estado !== p.estado && !esNuevo) p.comentarios.push({ texto: `Estado: ${estadoNombre(p.estado)} → ${estadoNombre(estado)}`, autor: autor(), fecha: hoyISO(), sistema: true });
      // quién cerró: Realizado y Verificado quedan firmados con nombre y fecha
      if (estado !== p.estado && estado === 'corregido') Object.assign(p, { realizadoPor: autor(), realizadoEn: hoyISO() });
      if (estado !== p.estado && estado === 'aprobado') Object.assign(p, { verificadoPor: autor(), verificadoEn: hoyISO() });
      if (estado === 'abierto') { delete p.realizadoPor; delete p.realizadoEn; delete p.verificadoPor; delete p.verificadoEn; }
      Object.assign(p, {
        estado, rubro: $('#f-rubro', h).value, unidad: $('#f-unidad', h).value, ambiente: $('#f-amb', h).value.trim(),
        aparicion: sel || null, codigo: sel ? sel.split('@')[0] : null,
        prioridad: $('#f-prio', h).value, responsable: $('#f-resp', h).value.trim(), limite: $('#f-lim', h).value,
        ...Object.fromEntries(ETAPAS.map((e) => [e.campo, $(`#f-txt-${e.id}`, h).value.trim()])), actualizado: hoyISO(),
      });
      if (!codValido(p)) p.cod = proximoCod(p.rubro, p.id); // cambió de rubro: toma el código siguiente del rubro nuevo
    };
    const persistir = async () => {
      const i = pines.findIndex((x) => x.id === p.id);
      if (i >= 0) pines[i] = p; else pines.push(p);
      await almacen.guardar(p);
    };
    $('#f-guardar', h).onclick = async () => {
      leer();
      if (!p.texto && !p.fotos.length) { aviso('Agregá una descripción o una foto'); return; }
      await persistir(); cerrarHoja();
      aviso(esNuevo ? `Marcador ${p.cod} guardado` : 'Cambios guardados');
      render();
    };
    const com = $('#f-com-ok', h);
    if (com) com.onclick = async () => {
      const t = $('#f-com', h).value.trim(); if (!t) return;
      if (!puedeEditar()) {
        // lector: la consulta va directo a la base (no puede guardar el resto del marcador)
        com.disabled = true;
        try { p.comentarios = await nube.comentar(p.id, t); await almacen.guardarLocal(p); aviso('Consulta enviada'); abrirPin(p); }
        catch (e) { com.disabled = false; aviso('No se pudo enviar: revisá la conexión y probá de nuevo'); }
        return;
      }
      leer(); p.comentarios.push({ texto: t, autor: autor(), fecha: hoyISO() });
      await persistir(); abrirPin(p);
    };
    const del = $('#f-borrar', h);
    if (del) del.onclick = async () => {
      if (!del.dataset.ok) { del.dataset.ok = '1'; del.textContent = 'Tocá de nuevo para eliminar'; return; }
      await almacen.borrar(p.id); pines = pines.filter((x) => x.id !== p.id); cerrarHoja(); aviso('Marcador eliminado'); render();
    };
  });
}

/** Editor para resaltar en una foto: círculos (óvalos) y flechas, en rojo o amarillo. Se guardan dentro de la imagen. */
function marcarFoto(foto, alGuardar) {
  const capa = document.createElement('div');
  capa.className = 'marcador-foto';
  capa.innerHTML = `
    <div class="mf-barra">
      <button type="button" data-h="circulo" aria-pressed="true">◯ Círculo</button>
      <button type="button" data-h="flecha" aria-pressed="false">➜ Flecha</button>
      <button type="button" class="mf-color" data-c="#e0322b" aria-pressed="true" aria-label="Rojo" style="--c:#e0322b"></button>
      <button type="button" class="mf-color" data-c="#febe10" aria-pressed="false" aria-label="Amarillo" style="--c:#febe10"></button>
      <button type="button" id="mf-deshacer" disabled>↶ Deshacer</button>
    </div>
    <div class="mf-lienzo"><canvas></canvas></div>
    <p class="mf-ayuda">Arrastrá el dedo sobre la foto para dibujar.</p>
    <div class="mf-pie"><button type="button" class="btn" id="mf-no">Cancelar</button><button type="button" class="btn primario" id="mf-ok" disabled>Guardar marcas</button></div>`;
  document.body.appendChild(capa);
  const cv = $('canvas', capa), ctx = cv.getContext('2d');
  let herr = 'circulo', color = '#e0322b', trazos = [], actual = null;
  const im = new Image();
  if (/^https?:/.test(foto.src)) im.crossOrigin = 'anonymous';
  const ajustar = () => { // la foto entera, lo más grande que entre en pantalla
    const caja = $('.mf-lienzo', capa), k = Math.min(caja.clientWidth / cv.width, caja.clientHeight / cv.height);
    cv.style.width = Math.floor(cv.width * k) + 'px'; cv.style.height = Math.floor(cv.height * k) + 'px';
  };
  im.onload = () => { cv.width = im.naturalWidth; cv.height = im.naturalHeight; dibujar(); ajustar(); };
  window.addEventListener('resize', ajustar);
  im.onerror = () => { aviso('No se pudo abrir la foto (revisá la conexión)'); capa.remove(); };
  im.src = foto.src;
  const grosor = () => Math.max(4, Math.round(Math.max(cv.width, cv.height) * 0.007));
  const pintar = (t) => {
    ctx.strokeStyle = t.color; ctx.fillStyle = t.color; ctx.lineWidth = grosor(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // borde oscuro debajo para que se vea sobre fondos claros
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = grosor() * 0.8;
    if (t.h === 'circulo') {
      const rx = Math.abs(t.x2 - t.x1) / 2, ry = Math.abs(t.y2 - t.y1) / 2;
      ctx.beginPath(); ctx.ellipse((t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      const a = Math.atan2(t.y2 - t.y1, t.x2 - t.x1), L = grosor() * 4.5;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2 - Math.cos(a) * L * 0.6, t.y2 - Math.sin(a) * L * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(t.x2, t.y2);
      ctx.lineTo(t.x2 - L * Math.cos(a - 0.45), t.y2 - L * Math.sin(a - 0.45));
      ctx.lineTo(t.x2 - L * Math.cos(a + 0.45), t.y2 - L * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0;
  };
  const dibujar = () => { ctx.drawImage(im, 0, 0); [...trazos, ...(actual ? [actual] : [])].forEach(pintar); };
  const aImagen = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); const q = aImagen(e); actual = { h: herr, color, x1: q.x, y1: q.y, x2: q.x, y2: q.y }; };
  cv.onpointermove = (e) => { if (!actual) return; const q = aImagen(e); actual.x2 = q.x; actual.y2 = q.y; dibujar(); };
  cv.onpointerup = cv.onpointercancel = () => {
    if (!actual) return;
    if (Math.hypot(actual.x2 - actual.x1, actual.y2 - actual.y1) > grosor() * 3) trazos.push(actual);
    actual = null; dibujar();
    $('#mf-deshacer', capa).disabled = $('#mf-ok', capa).disabled = !trazos.length;
  };
  capa.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { herr = b.dataset.h; capa.querySelectorAll('[data-h]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  capa.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { color = b.dataset.c; capa.querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $('#mf-deshacer', capa).onclick = () => { trazos.pop(); dibujar(); $('#mf-deshacer', capa).disabled = $('#mf-ok', capa).disabled = !trazos.length; };
  const cerrar = () => { window.removeEventListener('resize', ajustar); capa.remove(); };
  capa.cerrar = cerrar;
  $('#mf-no', capa).onclick = cerrar;
  $('#mf-ok', capa).onclick = () => {
    try { foto.src = cv.toDataURL('image/jpeg', 0.85); }
    catch (e) { aviso('No se pudo guardar sobre esta foto'); return; }
    // es una imagen nueva: en la versión compartida se sube como archivo nuevo
    delete foto.path; delete foto.vence; foto.id = uid(); foto.marcada = true;
    cerrar(); alGuardar(); aviso('Marcas agregadas. Tocá "Guardar cambios" para conservarlas.');
  };
}

/** Reduce la foto a 1600 px y le estampa fecha, hora, ubicación y autor (registro fotográfico). */
function comprimir(file, leyenda, lado = 1600, calidad = 0.75) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const fs = Math.max(14, Math.round(c.width / 40));
      const txt = `${fechaHora(hoyISO())} · ${leyenda}`;
      g.font = `600 ${fs}px "Barlow Semi Condensed", sans-serif`;
      const w = g.measureText(txt).width + fs;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, c.height - fs * 1.8, Math.min(c.width, w), fs * 1.8);
      g.fillStyle = '#fff'; g.fillText(txt, fs / 2, c.height - fs * 0.6);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen')); };
    img.src = url;
  });
}
