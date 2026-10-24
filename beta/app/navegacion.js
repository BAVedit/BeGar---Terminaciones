/* Navegación entre vistas (pila, render, cabecera) y edición de rubros. */
'use strict';
/* ---------- navegación ---------- */
function ir(vista, params = {}, reemplazar = false) {
  if (reemplazar) pila.pop();
  pila.push({ vista, params });
  render();
}
function volver() {
  if (!$('#hoja').hidden) return cerrarHoja();
  if (pila.length > 1) { pila.pop(); render(); }
}
$('#volver').addEventListener('click', volver);
$('#btn-ajustes').addEventListener('click', () => abrirAjustes());

function cabecera(eyebrow, titulo) {
  const raiz = pila.length <= 1;
  $('#barra-logo').hidden = !raiz;
  $('#barra-eyebrow').hidden = raiz;
  $('#barra-eyebrow').textContent = eyebrow;
  $('#barra-h1').textContent = titulo;
  $('#volver').hidden = pila.length <= 1;
  document.title = pila.length <= 1 ? 'Terminaciones Belive Garay' : `${titulo} · Terminaciones`;
}

function render() {
  if (mapa) { mapa.remove(); mapa = null; }
  const { vista, params } = pila[pila.length - 1];
  if (vista !== 'visor') {
    $('#app').classList.remove('completa');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* nada */ }
  }
  const main = $('#vista');
  main.scrollTop = 0;
  ({ edificio: vEdificio, espacio: vEspacio, visor: vVisor, informe: vInforme, pedidos: vPedidos, pedido: vPedido, pruebas: vPruebas }[vista])(main, params);
}

function chipRubro() {
  const rb = rubroActivo();
  return `<button class="chip-rubro" id="cambiar-rubro" aria-label="Cambiar rubro">Relevando: <b>${esc(rb.nombre)}</b> <span aria-hidden="true">▾</span></button>`;
}
function enlazarChipRubro(root) {
  const b = $('#cambiar-rubro', root);
  if (b) b.onclick = () => elegirRubro(() => render());
}
function elegirRubro(alElegir, editando = false) {
  const act = rubroActivo().id;
  const editor = puedeEditar();
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">${editando ? 'Editar rubros' : '¿Qué rubro relevás?'}</h2><p>${editando ? `Tocá un rubro para cambiarle el nombre o el contratista${esAdmin() ? ', o para eliminarlo' : ''}.` : 'Los marcadores nuevos se cargan con este rubro. Se puede cambiar en cada marcador.'}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="lista">${M.rubros.map((r) => `<button class="fila" data-r="${r.id}"><span class="fila-t">${esc(r.nombre)}</span>
      <span class="fila-der">${editando ? '<span class="chip">editar</span>' : r.id === act ? '<span class="chip piloto">actual</span>' : ''}</span>
      <span class="fila-s"><span>${esc(responsablesRubro(r).join(', ') || 'Sin contratista asignado')}</span>${r.propio ? '<span class="chip">agregado</span>' : ''}</span></button>`).join('')}</div>
    ${editor && !editando ? `<div class="acciones"><button class="btn" id="r-nuevo">+ Agregar rubro</button><button class="btn" id="r-editar">Editar rubros</button></div><div class="nuevo-rubro" id="r-nuevo-caja" hidden></div>` : ''}
    ${editando ? '<button class="btn" id="r-listo">Listo</button>' : ''}`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    const nb = $('#r-nuevo', h);
    if (nb) nb.onclick = () => { nb.parentNode.hidden = true; formNuevoRubro($('#r-nuevo-caja', h), (r) => { nb.parentNode.hidden = false; if (r) { pref('rubro', r.id); cerrarHoja(); alElegir(); } }); };
    if ($('#r-editar', h)) $('#r-editar', h).onclick = () => elegirRubro(alElegir, true);
    if ($('#r-listo', h)) $('#r-listo', h).onclick = () => elegirRubro(alElegir);
    h.querySelectorAll('[data-r]').forEach((b) => (b.onclick = editando
      ? () => editarRubro(b.dataset.r, () => elegirRubro(alElegir, true))
      : () => { pref('rubro', b.dataset.r); cerrarHoja(); alElegir(); }));
  });
}

/** Cambiar nombre y contratista de un rubro, o eliminarlo (sus marcadores pasan a otro rubro). */
function editarRubro(id, volver) {
  const rb = rubro(id);
  const resps = responsablesRubro(rb);
  const suyos = () => pines.filter((p) => p.rubro === id);
  const abiertosDe = (resp) => suyos().filter((p) => p.estado !== 'aprobado' && resps.includes(p.responsable) && p.responsable !== resp);
  const otros = M.rubros.filter((r) => r.id !== id);
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">Editar rubro</h2><p>${suyos().length} marcadores en este rubro</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campo"><label for="er-nom">Nombre del rubro</label><input id="er-nom" value="${esc(rb.nombre)}"></div>
    <div class="campo"><label for="er-resp">Contratista o responsable</label><input id="er-resp" value="${esc(resps.join(', '))}" placeholder="Ej.: Juan Carlos"><p class="nota">Si son varios, separalos con coma.</p></div>
    <label class="check" id="er-pasar-caja" hidden><input type="checkbox" id="er-pasar" checked> <span id="er-pasar-txt"></span></label>
    <div class="acciones"><button class="btn primario" id="er-ok">Guardar cambios</button><button class="btn" id="er-no">Volver</button></div>
    <hr class="sep">
    ${otros.length && esAdmin() ? `<button class="btn peligro" id="er-borrar">Eliminar este rubro</button>
    <div class="nuevo-rubro" id="er-borrar-caja" hidden>
      <p><b>¿Eliminar "${esc(rb.nombre)}"?</b> Deja de aparecer en las listas para todo el equipo.</p>
      ${suyos().length ? `<div class="campo"><label for="er-destino">Sus ${suyos().length} marcadores pasan al rubro</label><select id="er-destino">${otros.map((r) => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('')}</select></div>` : ''}
      <div class="acciones"><button class="btn peligro" id="er-borrar-ok">Sí, eliminar</button><button class="btn" id="er-borrar-no">Cancelar</button></div>
    </div>` : ''}`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    $('#er-no', h).onclick = volver;
    const revisarPase = () => {
      const nuevo = listaResponsables($('#er-resp', h).value)[0] || '';
      const n = nuevo && !resps.includes(nuevo) ? abiertosDe(nuevo).length : 0;
      $('#er-pasar-caja', h).hidden = !n;
      $('#er-pasar-txt', h).textContent = `Pasar también a ${nuevo} los ${n} marcadores sin verificar que estaban a nombre de ${resps.join(', ')}`;
    };
    $('#er-resp', h).oninput = revisarPase;
    $('#er-ok', h).onclick = async () => {
      const nombre = limpiarNombre($('#er-nom', h).value);
      if (nombre.length < 3) { aviso('Escribí el nombre del rubro'); return; }
      if (M.rubros.some((r) => r.id !== id && slug(r.nombre) === slug(nombre))) { aviso('Ya hay un rubro con ese nombre'); return; }
      const nuevos = listaResponsables($('#er-resp', h).value);
      const pasar = !$('#er-pasar-caja', h).hidden && $('#er-pasar', h).checked;
      registrarRubro({ id, nombre, responsables: nuevos });
      if (pasar) {
        for (const p of abiertosDe(nuevos[0])) {
          (p.comentarios = p.comentarios || []).push({ texto: `Responsable cambiado de ${p.responsable} a ${nuevos[0]}`, autor: autor(), fecha: hoyISO(), sistema: true });
          p.responsable = nuevos[0]; p.actualizado = hoyISO();
          await almacen.guardar(p);
        }
      }
      aviso('Rubro actualizado');
      volver();
    };
    const bb = $('#er-borrar', h);
    if (bb) {
      bb.onclick = () => { bb.hidden = true; $('#er-borrar-caja', h).hidden = false; $('#er-borrar-caja', h).scrollIntoView({ block: 'nearest' }); };
      $('#er-borrar-no', h).onclick = () => { bb.hidden = false; $('#er-borrar-caja', h).hidden = true; };
      $('#er-borrar-ok', h).onclick = async () => {
        const destino = $('#er-destino', h) ? rubro($('#er-destino', h).value) : null;
        const eraActivo = rubroActivo().id === id;
        for (const p of destino ? suyos() : []) {
          (p.comentarios = p.comentarios || []).push({ texto: `Rubro cambiado de ${rb.nombre} a ${destino.nombre} (rubro eliminado)`, autor: autor(), fecha: hoyISO(), sistema: true });
          p.rubro = destino.id; p.actualizado = hoyISO();
          await almacen.guardar(p);
        }
        registrarRubro({ id, nombre: rb.nombre, responsables: resps, eliminado: true });
        if (eraActivo) pref('rubro', (destino || otros[0]).id);
        aviso(`Rubro "${rb.nombre}" eliminado`);
        volver();
      };
    }
  });
}
