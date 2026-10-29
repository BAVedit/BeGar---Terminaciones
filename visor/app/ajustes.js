/* Ajustes, lista de marcadores del admin, datos de ejemplo y migración de marcadores viejos. */
'use strict';
/* ---------- ajustes y pendientes ---------- */
function abrirCuenta() {
  const pend = pines.filter((x) => x._pendiente).length;
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">${esc(nube.perfil.nombre)}</h2><p>${esc(nube.email)} · ${{ admin: 'Administrador: edita y elimina todo', editor: 'Editor: carga y cierra marcadores', lector: 'Lector: ve avances, fotos e informes' }[miRol()] || miRol()}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <p class="nota">${pend ? `<b>${pend} marcador${pend > 1 ? 'es' : ''} sin subir.</b> Se suben solos cuando vuelva la señal.` : 'Todo sincronizado: lo que cargás lo ven al instante los demás.'}</p>
    <div class="acciones">
      ${pend ? '<button class="btn primario" id="c-subir">Subir ahora</button>' : ''}
      ${esAdmin() ? '<button class="btn" id="c-admin">Administrar marcadores</button>' : ''}
      <button class="btn" id="c-nov">Novedades</button>
      <button class="btn" id="c-salir">Cerrar sesión</button>
    </div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    const sub = $('#c-subir', h); if (sub) sub.onclick = async () => { await nube.vaciarCola(); cerrarHoja(); aviso(pines.some((x) => x._pendiente) ? 'Sin señal: queda en cola' : 'Subido'); };
    $('#c-salir', h).onclick = () => nube.salir();
    if ($('#c-admin', h)) $('#c-admin', h).onclick = () => administrarMarcadores();
    $('#c-nov', h).onclick = () => mostrarNovedades(true);
  });
}

/** Sólo administrador: lista de todos los marcadores para eliminar varios de una vez (pruebas, duplicados). */
function administrarMarcadores(filtro = '') {
  if (!esAdmin()) return;
  const sel = new Set();
  const lista = () => pines.filter((p) => !filtro || `${codigoPin(p)} #${p.n} ${p.texto} ${p.autor} ${p.nivel} ${p.unidad || ''} ${(rubro(p.rubro) || {}).nombre || ''}`.toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">Administrar marcadores</h2><p>Elegí los que querés eliminar, por ejemplo los de prueba. Se borran para todo el equipo.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campo"><label for="am-buscar">Buscar</label><input id="am-buscar" value="${esc(filtro)}" placeholder="Texto, #número, quién lo cargó, nivel…"></div>
    <div class="acciones"><button class="btn" id="am-todos">Elegir todos los de la lista</button><button class="btn" id="am-ninguno">Ninguno</button></div>
    <div class="lista" id="am-lista">${lista().map((p) => `<label class="fila fila-check"><input type="checkbox" data-id="${p.id}">
      <span class="fila-t">${codigoPin(p)} ${esc((p.texto || 'Sin descripción').slice(0, 60))}</span>
      <span class="fila-s"><span>${esc(p.nivel)}${p.unidad ? ' · ' + esc(p.unidad) : ''} · ${esc((rubro(p.rubro) || {}).nombre || p.rubro || '')}</span><span>${esc(p.autor || '')} · ${fechaCorta(p.creado)}</span><span>${esc(estadoNombre(p.estado))}</span>${p.ejemplo ? '<span class="chip">ejemplo</span>' : ''}</span></label>`).join('') || '<p class="nota" style="padding:12px">No hay marcadores con ese filtro.</p>'}</div>
    <button class="btn peligro" id="am-borrar" disabled>Eliminar seleccionados</button>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    const btn = $('#am-borrar', h);
    const contar = () => { btn.disabled = !sel.size; btn.textContent = sel.size ? `Eliminar ${sel.size} marcador${sel.size > 1 ? 'es' : ''}` : 'Eliminar seleccionados'; delete btn.dataset.ok; };
    h.querySelectorAll('[data-id]').forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); contar(); }));
    const marcar = (v) => h.querySelectorAll('[data-id]').forEach((c) => { c.checked = v; v ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); });
    $('#am-todos', h).onclick = () => { marcar(true); contar(); };
    $('#am-ninguno', h).onclick = () => { marcar(false); contar(); };
    let t; $('#am-buscar', h).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { administrarMarcadores(e.target.value); const i = $('#am-buscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 350); };
    btn.onclick = async () => {
      if (!btn.dataset.ok) { btn.dataset.ok = '1'; btn.textContent = `Tocá de nuevo para eliminar ${sel.size}`; return; }
      btn.disabled = true;
      for (const id of sel) await almacen.borrar(id);
      pines = pines.filter((x) => !sel.has(x.id));
      aviso(`${sel.size} marcador${sel.size > 1 ? 'es' : ''} eliminado${sel.size > 1 ? 's' : ''}`);
      administrarMarcadores(filtro); render();
    };
  });
}

function abrirAjustes() {
  if (nube) return abrirCuenta();
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">Ajustes</h2><p>Tu nombre queda como "Relevó" en cada marcador y en las fotos.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campos">
      <div class="campo"><label for="a-nombre">Tu nombre</label><input id="a-nombre" value="${esc(autor())}"></div>
      <div class="campo"><label for="a-rol">Rol</label><select id="a-rol">${['Fiscal / Residente', 'Admin (oficina técnica)', 'Contratista'].map((r) => `<option ${pref('rol') === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    </div>
    <p class="nota">${almacen.persistente ? 'Los marcadores y fotos quedan guardados en este dispositivo y funcionan sin señal.' : 'Este navegador no permite guardar datos: los marcadores se pierden al cerrar.'} Compartirlos entre varias personas es el paso siguiente.</p>
    <div class="acciones">
      <button class="btn primario" id="a-ok">Guardar</button>
      <button class="btn" id="a-admin">Administrar marcadores</button>
      <button class="btn" id="a-nov">Novedades</button>
      <button class="btn" id="a-json">Copiar respaldo</button>
      <button class="btn peligro" id="a-ej">Quitar ejemplos</button>
    </div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    $('#a-ok', h).onclick = () => { pref('autor', $('#a-nombre', h).value.trim() || 'Fiscal de obra'); pref('rol', $('#a-rol', h).value); cerrarHoja(); aviso('Ajustes guardados'); render(); };
    $('#a-admin', h).onclick = () => administrarMarcadores();
    $('#a-nov', h).onclick = () => mostrarNovedades(true);
    $('#a-json', h).onclick = () => navigator.clipboard.writeText(JSON.stringify(pines)).then(() => aviso('Respaldo copiado'), () => aviso('No se pudo copiar'));
    $('#a-ej', h).onclick = async () => {
      for (const p of pines.filter((x) => x.ejemplo)) await almacen.borrar(p.id);
      pines = pines.filter((x) => !x.ejemplo); cerrarHoja(); aviso('Ejemplos eliminados'); render();
    };
  });
}

function abrirPendientes() {
  const p = M.pendientes;
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">Pendientes de la ingesta</h2><p>Lo que hay que resolver con los planos (también en revisar.md).</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="seccion-t">Versiones a confirmar (${p.versiones.length})</div>
    ${p.versiones.map((v) => `<div class="msj"><b class="cod">${esc(v.grupo)}</b>${v.opciones.map((o) => `<small>${esc(o)}</small>`).join('')}</div>`).join('') || '<p class="nota">Ninguna.</p>'}
    <div class="seccion-t">Planos solo en DWG (${p.faltantes_pdf.length})</div>
    ${p.faltantes_pdf.length ? `<div class="tabla-caja"><table><tbody>${p.faltantes_pdf.map((x) => `<tr><td>${esc(x)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="nota">Ninguno.</p>'}
    <div class="seccion-t">Prefijos sin definir</div>
    ${Object.entries(p.prefijos_sin_definir).map(([k, v]) => `<div class="msj"><b class="cod">${esc(k)}</b><small>${esc(v.slice(0, 3).join(' · '))}</small></div>`).join('') || '<p class="nota">Ninguno.</p>'}
  `, (h) => ($('[data-cerrar]', h).onclick = cerrarHoja));
}

/* ---------- datos de ejemplo ---------- */
async function sembrarEjemplos() {
  if (pref('ejemplos') === VERSION_EJEMPLOS) return;
  for (const p of pines.filter((x) => x.ejemplo)) await almacen.borrar(p.id);
  pines = pines.filter((x) => !x.ejemplo);
  pref('ejemplos', VERSION_EJEMPLOS);
  if (pines.length) return; // ya hay datos reales: no mezclar
  const casos = [
    ['N1', '1A', 'pintura', 'abierto', 'Falta segunda mano en muro del living.', 'ESTAR'],
    ['N1', '1A', 'pintura', 'abierto', 'Mancha en cielorraso del baño, retocar.', 'BAÑO'],
    ['N1', '1A', 'carp-aluminio', 'abierto', 'Falta burlete en hoja móvil de la puerta ventana.', 'ESTAR'],
    ['N1', '1C', 'pintura', 'corregido', 'Encuentro muro-cielorraso con fisura, masillar y pintar.', 'DORMITORIO'],
    ['N2', '2B', 'pintura', 'abierto', 'Marco de puerta de entrada sin pintar.', 'COCINA'],
    ['N3', '3A', 'pintura', 'aprobado', 'Retoque en muro del dormitorio.', 'DORMITORIO'],
    ['N1', COMUN, 'pintura', 'abierto', 'Palier: zócalo manchado junto al ascensor.', 'PALIER'],
  ];
  const hace = (d) => new Date(Date.now() - d * 864e5).toISOString();
  let n = 0;
  for (const [nvId, u, rbId, estado, texto, amb] of casos) {
    const rec = recortesNivel(nvId)[0];
    const rb = rubro(rbId);
    if (!rec || !rb) continue;
    let x = 0.5, y = 0.5;
    const locs = localesNivel(rec, nvId).filter((l) => (u === COMUN ? !l.unidad : l.unidad === u));
    const l = locs.find((z) => amb && (z.nombre || '').toUpperCase().includes(amb)) || locs[0];
    const pu = l || (u !== COMUN && posUnidad(rec, nvId, u));
    if (pu) { x = pu.x + (n % 2 ? 0.006 : -0.006); y = pu.y - 0.03; }
    const p = {
      id: uid(), n: ++n, proyecto: M.proyecto.id, rubro: rbId, nivel: nvId, unidad: u, ambiente: l ? capital(l.nombre) || l.texto : (amb ? capital(amb) : 'Palier'),
      recorte: rec.id, huella: rec.huella, x, y, aparicion: null, codigo: null, estado, prioridad: 'Media',
      responsable: responsablesRubro(rb)[0] || '', limite: '', texto, fotos: [], ejemplo: true,
      comentarios: estado === 'abierto' ? [] : [{ texto: `Estado: Pendiente → ${estadoNombre(estado)}`, autor: 'Ejemplo', fecha: hace(1), sistema: true }],
      autor: 'Ejemplo', creado: hace(2), actualizado: hace(1),
    };
    pines.push(p); await almacen.guardar(p);
  }
}

/** Marcadores de versiones anteriores del piloto: adaptarlos al modelo por dpto. */
function migrar(p) {
  if (p.estado === 'proceso') p.estado = 'abierto';
  if (!p.unidad && M.recortes[p.recorte]) Object.assign(p, inferirUbicacion(M.recortes[p.recorte], p.nivel, p.x, p.y));
  return p;
}
