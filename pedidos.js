/* Pedido de materiales: pedidos de los martes y jueves (BEGAR-PM-15, 16…) y recepción con remisiones.
   - Fase 1: el pedido, con un renglón por material (rubro, unidad, cantidad, prioridad, comentarios).
   - Fase 2: cada remisión que llega (fotos, número, proveedor y cuánto entró de cada renglón).
   Lo recibido, lo que falta y el estado se calculan de las remisiones, nunca se cargan a mano.
   Solo el administrador carga y edita; el resto de los miembros ve los pedidos y comenta.
   En la versión compartida se guarda en la tabla "pedidos" (supabase/4-pedidos.sql); sin nube, en el teléfono. */
'use strict';

const PRIORIDADES_PEDIDO = ['Urgente', 'Alta', 'Normal', 'Baja'];
const UNIDADES = ['unidad', 'bolsa', 'm', 'm²', 'm³', 'kg', 'l', 'rollo', 'caja', 'barra', 'juego', 'balde', 'lata', 'placa'];
const ESTADOS_PEDIDO = {
  enviado: { nombre: 'Enviado', c: 'var(--proceso)' },
  recepcion: { nombre: 'En recepción', c: 'var(--corregido)' },
  terminado: { nombre: 'Terminado', c: 'var(--aprobado)' },
  anulado: { nombre: 'Anulado', c: 'var(--tenue)' },
};
const ESTADOS_RENGLON = {
  pendiente: { nombre: 'Pendiente', c: 'var(--abierto)' },
  parcial: { nombre: 'Parcial', c: 'var(--proceso)' },
  completo: { nombre: 'Completo', c: 'var(--aprobado)' },
  demas: { nombre: 'Recibido de más', c: 'var(--corregido)' },
  pasa: { nombre: 'Pasa al próximo pedido', c: 'var(--tenue)' },
  cancelado: { nombre: 'Cancelado', c: 'var(--tenue)' },
};
const DIAS_PEDIDO = [2, 4]; // martes y jueves
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

let pedidos = [];
let pedidosCargados = false;
const puedePedir = () => esAdmin();

/* ---------- cálculos ---------- */
const codigoPedido = (p) => (p.n ? `BEGAR-PM-${p.n}` : 'PM (sin subir)');
const fechaLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diaDe = (iso) => new Date(iso + 'T12:00').getDay();
const fechaDia = (iso) => { try { return new Date(iso + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (e) { return iso; } };
/** Semana de lunes a sábado que contiene la fecha, como en la planilla ("19/10 a 24/10"). */
function semanaDe(iso) {
  const d = new Date(iso + 'T12:00');
  const lun = new Date(d); lun.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sab = new Date(lun); sab.setDate(lun.getDate() + 5);
  const dm = (x) => `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `${dm(lun)} a ${dm(sab)}`;
}
const num = (x) => { const v = parseFloat(String(x ?? '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const cant = (v) => (Math.round(v * 100) / 100).toLocaleString('es-AR');
const recibidoDe = (p, it) => (p.remisiones || []).reduce((a, r) => a + num((r.items || {})[it.id]), 0);
function estadoRenglon(p, it) {
  if (it.cierre) return it.cierre.tipo;
  const rec = recibidoDe(p, it), c = num(it.cantidad);
  if (rec <= 0) return 'pendiente';
  if (rec < c) return 'parcial';
  return rec > c ? 'demas' : 'completo';
}
const renglonResuelto = (p, it) => !['pendiente', 'parcial'].includes(estadoRenglon(p, it));
function estadoPedido(p) {
  if (p.anulado) return 'anulado';
  if (p.terminado || (p.items.length && p.items.every((it) => renglonResuelto(p, it)))) return 'terminado';
  return (p.remisiones || []).length ? 'recepcion' : 'enviado';
}
const enCurso = (p) => ['enviado', 'recepcion'].includes(estadoPedido(p));
const proveedoresDe = (p, it) => [...new Set((p.remisiones || []).filter((r) => num((r.items || {})[it.id]) > 0).map((r) => r.proveedor).filter(Boolean))];
const pill = (e) => `<span class="estado-pill" style="--c:${e.c}">${esc(e.nombre)}</span>`;
const prioridadDe = (p, it) => it.prioridad || p.prioridad;

/** Materiales ya pedidos: lo que se cargó una vez queda como sugerencia con su rubro y unidad. */
function catalogo() {
  const m = new Map();
  for (const p of pedidos) for (const it of p.items) {
    const k = normNombre(it.material);
    if (!k) continue;
    const x = m.get(k) || { material: it.material, veces: 0 };
    Object.assign(x, { material: it.material, rubro: it.rubro, unidad: it.unidad, veces: x.veces + 1 });
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.veces - a.veces || a.material.localeCompare(b.material));
}
/** Renglones marcados "pasa al próximo pedido" que todavía no se pasaron. */
const renglonesQuePasan = () => pedidos.filter((p) => !p.anulado).flatMap((p) => p.items
  .filter((it) => it.cierre && it.cierre.tipo === 'pasa' && !it.cierre.a)
  .map((it) => ({ p, it, falta: Math.max(0, num(it.cantidad) - recibidoDe(p, it)) })));

/* ---------- almacenamiento ---------- */
const almacenPedidos = {
  local() { try { return JSON.parse(pref('pedidos') || '[]'); } catch (e) { return []; } },
  guardarLocal() {
    // en la versión compartida, las fotos ya subidas no se guardan en el teléfono (se firman al abrirlas)
    const liviano = pedidos.map((p) => (nube && !p._pendiente ? { ...p, ...mapaFotos(p, (f) => (f.path ? { ...f, src: undefined, vence: undefined } : f)) } : p));
    try { pref('pedidos', JSON.stringify(liviano)); } catch (e) { console.warn('pedidos sin guardar en el teléfono', e); }
  },
  async cargar() {
    pedidos = this.local();
    if (nube) {
      try {
        const { data, error } = await nube.sb.from('pedidos').select('*').eq('proyecto', M.proyecto.id);
        if (error) throw error;
        const locales = new Map(pedidos.map((p) => [p.id, p]));
        pedidos = data.filter((r) => !r.borrado).map((r) => {
          const l = locales.get(r.id);
          locales.delete(r.id);
          return l && l._pendiente && l.actualizado > (r.datos.actualizado || '') ? l : deFilaPedido(r, l);
        });
        for (const l of locales.values()) if (l._pendiente) pedidos.push(l); // cargados sin señal
        this.guardarLocal();
        this.subirPendientes();
      } catch (e) { console.warn('pedidos: sin conexión, se muestran los del teléfono', e); }
    }
    pedidosCargados = true;
  },
  async guardar(p) {
    p.actualizado = hoyISO();
    const i = pedidos.findIndex((x) => x.id === p.id);
    if (i >= 0) pedidos[i] = p; else pedidos.push(p);
    // sin nube el número lo pone el teléfono (en la versión compartida, la base)
    if (!nube && !p.n) p.n = Math.max(14, ...pedidos.map((x) => x.n || 0)) + 1;
    if (nube) p._pendiente = true;
    this.guardarLocal();
    if (nube) await this.subirPendientes();
  },
  async subirPendientes() {
    if (!nube) return true;
    let ok = true;
    for (const p of pedidos.filter((x) => x._pendiente)) {
      try {
        await subirFotosPedido(p);
        const fila = { id: p.id, proyecto: p.proyecto, fecha: p.fecha, prioridad: p.prioridad, estado: estadoPedido(p), borrado: !!p.borrado,
          datos: { ...p, _pendiente: undefined, ...mapaFotos(p, ({ src, vence, ...f }) => f) } };
        const { data, error } = await nube.sb.from('pedidos').upsert(fila).select('n').single();
        if (error) throw error;
        delete p._pendiente;
        if (data && data.n) p.n = data.n;
      } catch (e) {
        ok = false;
        console.warn('pedido sin subir', e);
        if (e && (e.code === '42501' || /row-level|permiso/i.test(e.message || ''))) { delete p._pendiente; aviso('Solo el administrador carga pedidos'); }
        else if (e && /relation|does not exist|schema cache/i.test(e.message || '')) aviso('Falta crear la tabla de pedidos en Supabase (supabase/4-pedidos.sql)');
      }
    }
    this.guardarLocal();
    return ok;
  },
};

/** Aplica fn a cada foto del pedido (adjuntos y fotos de remisiones) y devuelve las listas nuevas. */
function mapaFotos(p, fn) {
  return {
    adjuntos: (p.adjuntos || []).map(fn),
    remisiones: (p.remisiones || []).map((r) => ({ ...r, fotos: (r.fotos || []).map(fn), fotosMaterial: (r.fotosMaterial || []).map(fn) })),
  };
}
const todasLasFotos = (p) => [...(p.adjuntos || []), ...(p.remisiones || []).flatMap((r) => [...(r.fotos || []), ...(r.fotosMaterial || [])])];

async function subirFotosPedido(p) {
  for (const f of todasLasFotos(p)) {
    if (f.path || !f.src || !f.src.startsWith('data:')) continue;
    const blob = await (await fetch(f.src)).blob();
    const path = `${p.proyecto}/pedidos/${p.id}/${f.id || (f.id = uid())}.jpg`;
    const { error } = await nube.sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error && !/exists/i.test(error.message)) throw error;
    f.path = path;
  }
}
async function firmarFotosPedido(p) {
  if (!nube) return;
  const faltan = todasLasFotos(p).filter((f) => f.path && (!f.src || (f.vence && f.vence < Date.now())));
  if (!faltan.length) return;
  const { data } = await nube.sb.storage.from('fotos').createSignedUrls(faltan.map((f) => f.path), 7 * 864e2);
  (data || []).forEach((d, j) => { if (d.signedUrl) { faltan[j].src = d.signedUrl; faltan[j].vence = Date.now() + 6 * 864e5; } });
}
function deFilaPedido(r, local) {
  const p = { ...r.datos, n: r.n, creadoPor: r.creado_por };
  // conservar las imágenes que este teléfono ya tiene
  const ya = new Map((local ? todasLasFotos(local) : []).filter((f) => f.src).map((f) => [f.path || f.id, f]));
  return { ...p, ...mapaFotos(p, (f) => { const l = ya.get(f.path) || ya.get(f.id); return l ? { ...f, src: l.src, vence: l.vence } : f; }) };
}

/** Cambios en vivo: un pedido o una remisión cargados en otro teléfono aparecen sin recargar. */
function escucharPedidos() {
  if (!nube || escucharPedidos.hecho) return;
  escucharPedidos.hecho = true;
  nube.sb.channel('pedidos-' + M.proyecto.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `proyecto=eq.${M.proyecto.id}` }, (ev) => {
      const r = ev.new; if (!r || !r.id || !r.datos) return;
      const i = pedidos.findIndex((x) => x.id === r.id);
      if (i >= 0 && pedidos[i]._pendiente) return;
      if (r.borrado) { if (i >= 0) pedidos.splice(i, 1); }
      else if (i >= 0) pedidos[i] = deFilaPedido(r, pedidos[i]); else pedidos.push(deFilaPedido(r));
      almacenPedidos.guardarLocal();
      const v = pila[pila.length - 1];
      if (v && (v.vista === 'pedidos' || v.vista === 'pedido')) refrescarSiSePuede();
    })
    .subscribe();
  addEventListener('online', () => almacenPedidos.subirPendientes());
}

/* ---------- vista: lista de pedidos ---------- */
async function vPedidos(main, params) {
  cabecera('Pedido de materiales', 'Pedidos');
  if (!pedidosCargados) {
    main.innerHTML = '<p class="vacio-txt">Cargando pedidos…</p>';
    await almacenPedidos.cargar();
    escucharPedidos();
    if (pila[pila.length - 1].vista !== 'pedidos') return; // se fue a otra pantalla mientras cargaba
  }
  const filtro = params.filtro || 'curso';
  const hoy = fechaLocal();
  const esDia = DIAS_PEDIDO.includes(diaDe(hoy));
  const activos = pedidos.filter((p) => !p.borrado);
  const curso = activos.filter(enCurso);
  const porRecibir = curso.reduce((a, p) => a + p.items.filter((it) => !renglonResuelto(p, it)).length, 0);
  const pasan = renglonesQuePasan();
  const lista = activos.filter((p) => (filtro === 'curso' ? enCurso(p) : filtro === 'terminados' ? !enCurso(p) : true))
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.n || 1e9) - (a.n || 1e9));
  main.innerHTML = `
  <div class="pagina">
    <div class="dia-pedido ${esDia ? 'si' : ''}"><b>${esDia ? `Hoy ${DIAS[diaDe(hoy)]} es día de pedido` : `Hoy ${DIAS[diaDe(hoy)]} no es día de pedido`}</b>
      <span>${esDia ? 'Cargá el pedido de la semana.' : 'Los pedidos son martes y jueves. Hoy solo se carga un pedido de prioridad Alta o Urgente.'}</span></div>
    <div class="kpis">
      <div class="kpi"><b>${curso.length}</b><span>pedidos en curso</span></div>
      <div class="kpi alerta"><b>${porRecibir}</b><span>renglones por recibir</span></div>
      <div class="kpi ok"><b>${activos.length - curso.length}</b><span>terminados</span></div>
    </div>
    ${puedePedir() ? `<div class="acciones"><button class="btn primario ancho" id="ped-nuevo">+ Nuevo pedido</button><button class="btn" id="ped-resumen">Resumen</button></div>
      ${pasan.length ? `<p class="nota"><b>${pasan.length} ${pasan.length === 1 ? 'renglón pasa' : 'renglones pasan'} al próximo pedido:</b> se agregan solos cuando cargues el pedido nuevo.</p>` : ''}`
    : '<div class="acciones"><button class="btn" id="ped-resumen">Resumen</button></div><p class="nota">Los pedidos los carga el administrador. Podés verlos y dejar comentarios.</p>'}
    <div class="estados alcance" id="ped-filtro">
      ${[['curso', 'En curso'], ['terminados', 'Terminados'], ['todos', 'Todos']].map(([id, n]) => `<button type="button" data-f="${id}" aria-pressed="${filtro === id}">${n}</button>`).join('')}
    </div>
    <div class="lista">${lista.map(filaPedido).join('') || `<p class="nota" style="padding:14px 16px">${filtro === 'curso' ? 'No hay pedidos en curso.' : 'Todavía no hay pedidos.'}</p>`}</div>
  </div>`;
  main.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { pila[pila.length - 1].params.filtro = b.dataset.f; render(); }));
  main.querySelectorAll('[data-ped]').forEach((b) => (b.onclick = () => ir('pedido', { id: b.dataset.ped })));
  const nb = $('#ped-nuevo', main); if (nb) nb.onclick = () => formPedido(null);
  $('#ped-resumen', main).onclick = elegirResumen;
}

function filaPedido(p) {
  const e = estadoPedido(p);
  const res = p.items.filter((it) => renglonResuelto(p, it)).length;
  const rubros = [...new Set(p.items.map((it) => (rubro(it.rubro) || {}).nombre || it.rubro))];
  return `<button class="fila" data-ped="${p.id}">
    <span class="fila-t"><span class="cod">${esc(codigoPedido(p))}</span></span>
    <span class="fila-der">${pill(ESTADOS_PEDIDO[e])}</span>
    <span class="fila-s"><span>${esc(fechaDia(p.fecha))}</span><span>${res} de ${p.items.length} renglones</span>
      ${['Urgente', 'Alta'].includes(p.prioridad) ? `<span class="chip aviso-c">${esc(p.prioridad)}</span>` : ''}
      ${(p.remisiones || []).length ? `<span>📄 ${p.remisiones.length} ${p.remisiones.length === 1 ? 'remisión' : 'remisiones'}</span>` : ''}
      ${(p.comentarios || []).length ? `<span>💬 ${p.comentarios.length}</span>` : ''}
      ${p._pendiente ? '<span class="chip">sin subir</span>' : ''}</span>
    <span class="fila-s"><span>${esc(rubros.join(' · '))}</span></span>
  </button>`;
}

/* ---------- vista: un pedido ---------- */
async function vPedido(main, { id }) {
  if (!pedidosCargados) { main.innerHTML = '<p class="vacio-txt">Cargando pedido…</p>'; await almacenPedidos.cargar(); escucharPedidos(); }
  const p = pedidos.find((x) => x.id === id);
  if (!p) { cabecera('Pedido de materiales', 'Pedido'); main.innerHTML = '<div class="pagina"><p class="vacio-txt">No se encontró el pedido.</p></div>'; return; }
  cabecera('Pedido de materiales', codigoPedido(p));
  const e = estadoPedido(p);
  const abierto = enCurso(p);
  const admin = puedePedir();
  const pintar = () => {
    main.innerHTML = `
    <div class="pagina">
      <div class="ped-cab">
        <div>${pill(ESTADOS_PEDIDO[e])} ${['Urgente', 'Alta'].includes(p.prioridad) ? `<span class="chip aviso-c">${esc(p.prioridad)}</span>` : `<span class="chip">${esc(p.prioridad)}</span>`}</div>
        <p class="nota">Solicitud del <b>${esc(fechaDia(p.fecha))}</b> · semana ${esc(semanaDe(p.fecha))} · ${esc(p.solicitante || p.autor || '')}</p>
        ${p.terminado && p.terminado.manual ? `<p class="nota">Dado por terminado por ${esc(p.terminado.autor)} el ${fechaCorta(p.terminado.fecha)}.</p>` : ''}
        ${p.anulado ? `<p class="nota">Anulado por ${esc(p.anulado.autor)} el ${fechaCorta(p.anulado.fecha)}${p.anulado.motivo ? ': ' + esc(p.anulado.motivo) : ''}.</p>` : ''}
      </div>
      <div class="acciones">
        ${admin && abierto ? '<button class="btn primario ancho" id="pd-remision">Cargar remisión</button>' : ''}
        <button class="btn" id="pd-pdf">PDF del pedido</button>
        ${admin && !p.anulado ? '<button class="btn" id="pd-editar">Editar</button>' : ''}
      </div>
      <div class="seccion-t">Materiales (${p.items.length})</div>
      <div class="lista">${p.items.map((it) => filaRenglon(p, it, admin && abierto)).join('')}</div>
      ${p.justificacion ? `<div class="seccion-t">Justificación de compra</div><p class="ped-texto">${esc(p.justificacion)}</p>` : ''}
      ${p.observaciones || (p.adjuntos || []).length ? `<div class="seccion-t">Observaciones</div>
        ${p.observaciones ? `<p class="ped-texto">${conEnlaces(p.observaciones)}</p>` : ''}
        ${(p.adjuntos || []).length ? `<div class="fotos">${p.adjuntos.map((f) => fotoMini(f)).join('')}</div>` : ''}` : ''}
      <div class="seccion-t">Remisiones (${(p.remisiones || []).length})</div>
      ${(p.remisiones || []).map((r) => tarjetaRemision(p, r, admin)).join('') || '<p class="nota">Todavía no llegó nada. Cuando llegue material, tocá "Cargar remisión".</p>'}
      <div class="seccion-t">Comentarios</div>
      <div class="hilo">${(p.comentarios || []).map((c) => `<div class="msj ${c.sistema ? 'sistema' : ''}">${esc(c.texto)}<small>${esc(c.autor)} · ${fechaHora(c.fecha)}</small></div>`).join('') || '<p class="nota">Sin comentarios.</p>'}</div>
      <div style="display:flex;gap:8px"><input id="pd-com" class="input" placeholder="Escribí un comentario" style="flex:1"><button class="btn" id="pd-com-ok">Enviar</button></div>
      ${admin && !p.anulado ? `<hr class="sep"><div class="acciones">
        ${abierto ? '<button class="btn" id="pd-terminar">Dar por terminado</button>' : ''}
        ${p.terminado && p.terminado.manual ? '<button class="btn" id="pd-reabrir">Reabrir pedido</button>' : ''}
        ${!(p.remisiones || []).length ? '<button class="btn peligro" id="pd-anular">Anular pedido</button>' : ''}
      </div>` : ''}
    </div>`;
    enlazar();
  };
  const enlazar = () => {
    const on = (sel, fn) => { const b = $(sel, main); if (b) b.onclick = fn; };
    on('#pd-remision', () => formRemision(p));
    on('#pd-editar', () => formPedido(p));
    on('#pd-pdf', () => pdfPedidos([p], { titulo: codigoPedido(p), unico: true }));
    on('#pd-terminar', () => terminarPedido(p));
    on('#pd-reabrir', async () => { delete p.terminado; registrar(p, 'Pedido reabierto'); await almacenPedidos.guardar(p); render(); });
    on('#pd-anular', () => anularPedido(p));
    on('#pd-com-ok', async () => {
      const t = $('#pd-com', main).value.trim(); if (!t) return;
      const b = $('#pd-com-ok', main); b.disabled = true;
      try {
        if (nube && !p._pendiente) { p.comentarios = await nube.sb.rpc('comentar_pedido', { pedido: p.id, texto: t }).then(({ data, error }) => { if (error) throw error; return data; }); almacenPedidos.guardarLocal(); }
        else { (p.comentarios = p.comentarios || []).push({ texto: t, autor: autor(), fecha: hoyISO() }); await almacenPedidos.guardar(p); }
        render();
      } catch (er) { b.disabled = false; aviso('No se pudo enviar: revisá la conexión y probá de nuevo'); }
    });
    main.querySelectorAll('[data-pasa]').forEach((b) => (b.onclick = () => cerrarRenglon(p, b.dataset.pasa, 'pasa')));
    main.querySelectorAll('[data-cancela]').forEach((b) => (b.onclick = () => cerrarRenglon(p, b.dataset.cancela, 'cancelado')));
    main.querySelectorAll('[data-reabre]').forEach((b) => (b.onclick = async () => {
      const it = p.items.find((x) => x.id === b.dataset.reabre);
      if (it.cierre && it.cierre.a) { aviso('Ya se pasó a otro pedido'); return; }
      delete it.cierre; registrar(p, `${it.material}: vuelve a quedar pendiente`); await almacenPedidos.guardar(p); render();
    }));
    main.querySelectorAll('[data-rem-editar]').forEach((b) => (b.onclick = () => formRemision(p, p.remisiones.find((r) => r.id === b.dataset.remEditar))));
    main.querySelectorAll('[data-foto]').forEach((b) => (b.onclick = () => verFoto(b.dataset.foto)));
  };
  pintar();
  // las fotos de la nube se firman después de mostrar el pedido
  if (nube && todasLasFotos(p).some((f) => f.path && !f.src)) {
    try { await firmarFotosPedido(p); almacenPedidos.guardarLocal(); if (pila[pila.length - 1].params.id === id && $('#hoja').hidden) pintar(); } catch (er) { /* sin señal: quedan sin imagen */ }
  }
}

function filaRenglon(p, it, editable) {
  const e = estadoRenglon(p, it);
  const rec = recibidoDe(p, it), c = num(it.cantidad), falta = Math.max(0, c - rec);
  const provs = proveedoresDe(p, it);
  const pr = prioridadDe(p, it);
  return `<div class="fila renglon">
    <span class="fila-t">${esc(it.material)}</span>
    <span class="fila-der">${pill(ESTADOS_RENGLON[e])}</span>
    <span class="fila-s"><span>${esc((rubro(it.rubro) || {}).nombre || it.rubro)}</span>${it.prioridad && it.prioridad !== p.prioridad ? `<span class="chip ${['Urgente', 'Alta'].includes(pr) ? 'aviso-c' : ''}">${esc(pr)}</span>` : ''}${it.viene ? `<span>viene del ${esc(it.viene.codigo)}</span>` : ''}</span>
    <span class="cantidades num"><span>Pedido <b>${cant(c)}</b> ${esc(it.unidad)}</span><span>Recibido <b>${cant(rec)}</b></span><span class="${falta && !it.cierre ? 'falta' : ''}">Falta <b>${cant(falta)}</b></span></span>
    ${provs.length ? `<span class="fila-s"><span>Proveedor: ${esc(provs.join(', '))}</span></span>` : ''}
    ${it.oc || it.comentario ? `<span class="fila-s">${it.oc ? `<span>Compras: ${esc(it.oc)}</span>` : ''}${it.comentario ? `<span>${esc(it.comentario)}</span>` : ''}</span>` : ''}
    ${it.cierre ? `<span class="fila-s"><span>${it.cierre.tipo === 'pasa' ? (it.cierre.a ? `Pasó al ${esc(it.cierre.codigo || 'pedido siguiente')}` : 'Se agrega al próximo pedido') : 'Cancelado'}${it.cierre.motivo ? ': ' + esc(it.cierre.motivo) : ''}</span>
      ${editable || (puedePedir() && !it.cierre.a) ? `<button type="button" class="btn-txt" data-reabre="${it.id}">Deshacer</button>` : ''}</span>`
    : editable && falta > 0 ? `<span class="fila-s"><button type="button" class="btn-txt" data-pasa="${it.id}">Pasa al próximo pedido</button><button type="button" class="btn-txt" data-cancela="${it.id}">Cancelar lo que falta</button></span>` : ''}
  </div>`;
}

function tarjetaRemision(p, r, admin) {
  const items = p.items.filter((it) => num((r.items || {})[it.id]) > 0);
  return `<div class="remision">
    <div class="remision-cab"><b>Remisión ${esc(r.numero || 's/n')}</b><span>${esc(fechaDia(r.fecha))}</span></div>
    <p class="nota">Proveedor: <b>${esc(r.proveedor || 'sin indicar')}</b> · recibió ${esc(r.autor || '')}</p>
    ${(r.fotos || []).length ? `<div class="fotos">${r.fotos.map((f) => fotoMini(f, 'Remisión')).join('')}</div>` : ''}
    <ul class="remision-items">${items.map((it) => `<li><span>${esc(it.material)}</span><b class="num">${cant(num(r.items[it.id]))} ${esc(it.unidad)}</b></li>`).join('') || '<li><span>Sin cantidades cargadas</span></li>'}</ul>
    ${(r.fotosMaterial || []).length ? `<span class="lbl-mini">Material descargado</span><div class="fotos">${r.fotosMaterial.map((f) => fotoMini(f, 'Material')).join('')}</div>` : ''}
    ${r.observaciones ? `<p class="ped-texto">${esc(r.observaciones)}</p>` : ''}
    ${admin ? `<div class="acciones"><button class="btn" data-rem-editar="${r.id}">Editar remisión</button></div>` : ''}
  </div>`;
}

const fotoMini = (f, leyenda = '') => (f.src
  ? `<figure><button type="button" class="foto-ver" data-foto="${esc(f.src)}" aria-label="Ver foto ${esc(leyenda)}"><img src="${esc(f.src)}" alt="${esc(leyenda)}"></button>${f.fecha ? `<figcaption>${fechaCorta(f.fecha)}</figcaption>` : ''}</figure>`
  : '<figure><div class="foto-falta">Foto sin cargar</div></figure>');

/** Links de compra tocables dentro de las observaciones. */
const conEnlaces = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.length > 48 ? u.slice(0, 45) + '…' : u}</a>`).replace(/\n/g, '<br>');

function verFoto(src) {
  const capa = document.createElement('div');
  capa.className = 'foto-grande';
  capa.innerHTML = `<img src="${esc(src)}" alt="Foto"><button class="cerrar" aria-label="Cerrar">✕</button>`;
  const cerrar = () => capa.remove();
  capa.onclick = cerrar;
  capa.cerrar = cerrar;
  document.body.appendChild(capa);
}

function registrar(p, texto) {
  (p.comentarios = p.comentarios || []).push({ texto, autor: autor(), fecha: hoyISO(), sistema: true });
}

function cerrarRenglon(p, itId, tipo) {
  const it = p.items.find((x) => x.id === itId);
  const falta = Math.max(0, num(it.cantidad) - recibidoDe(p, it));
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">${tipo === 'pasa' ? 'Pasa al próximo pedido' : 'Cancelar lo que falta'}</h2>
      <p>${esc(it.material)}: faltan ${cant(falta)} ${esc(it.unidad)}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <p class="nota">${tipo === 'pasa' ? 'Se agrega solo al próximo pedido que cargues, con la cantidad que falta. En este pedido queda resuelto.' : 'Este renglón queda cerrado: no se espera recibir lo que falta.'}</p>
    <div class="campo todo"><label for="cr-mot">Motivo (opcional)</label><input id="cr-mot" placeholder="${tipo === 'pasa' ? 'Ej.: el proveedor no tenía stock' : 'Ej.: se compró en otro lado'}"></div>
    <div class="acciones"><button class="btn primario ancho" id="cr-ok">Confirmar</button></div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    $('#cr-ok', h).onclick = async () => {
      it.cierre = { tipo, motivo: $('#cr-mot', h).value.trim(), fecha: hoyISO(), autor: autor() };
      registrar(p, `${it.material}: ${tipo === 'pasa' ? `faltan ${cant(falta)} ${it.unidad}, pasa al próximo pedido` : `se cancelan ${cant(falta)} ${it.unidad}`}${it.cierre.motivo ? ' (' + it.cierre.motivo + ')' : ''}`);
      await almacenPedidos.guardar(p); cerrarHoja(); render();
    };
  });
}

function terminarPedido(p) {
  const faltan = p.items.filter((it) => !renglonResuelto(p, it));
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Dar por terminado</h2><p>${esc(codigoPedido(p))}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    ${faltan.length ? `<p class="nota">Quedan <b>${faltan.length} ${faltan.length === 1 ? 'renglón' : 'renglones'}</b> sin recibir completos. ¿Qué pasa con lo que falta?</p>
      <div class="estados alcance" id="tp-op" style="grid-template-columns:1fr 1fr"><button type="button" data-op="pasa" aria-pressed="true">Pasa al próximo pedido</button><button type="button" data-op="cancelado" aria-pressed="false">Se cancela</button></div>` : '<p class="nota">Todo lo pedido ya está recibido.</p>'}
    <div class="acciones"><button class="btn primario ancho" id="tp-ok">Dar por terminado</button></div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    let op = 'pasa';
    h.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => { op = b.dataset.op; h.querySelectorAll('[data-op]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
    $('#tp-ok', h).onclick = async () => {
      for (const it of faltan) it.cierre = { tipo: op, motivo: 'pedido dado por terminado', fecha: hoyISO(), autor: autor() };
      p.terminado = { manual: true, fecha: hoyISO(), autor: autor() };
      registrar(p, `Pedido dado por terminado${faltan.length ? ` (${faltan.length} ${faltan.length === 1 ? 'renglón' : 'renglones'}: ${op === 'pasa' ? 'pasan al próximo pedido' : 'cancelados'})` : ''}`);
      await almacenPedidos.guardar(p); cerrarHoja(); aviso('Pedido terminado'); render();
    };
  });
}

function anularPedido(p) {
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Anular pedido</h2><p>${esc(codigoPedido(p))}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <p class="nota">El pedido queda en la lista como anulado, con su número, para no saltear la numeración.</p>
    <div class="campo todo"><label for="an-mot">Motivo</label><input id="an-mot" placeholder="Ej.: cargado por error"></div>
    <div class="acciones"><button class="btn peligro ancho" id="an-ok">Anular</button></div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    $('#an-ok', h).onclick = async () => {
      p.anulado = { motivo: $('#an-mot', h).value.trim(), fecha: hoyISO(), autor: autor() };
      // si traía renglones de otro pedido, vuelven a quedar para el próximo
      for (const it of p.items.filter((x) => x.viene)) {
        const o = pedidos.find((x) => x.id === it.viene.id); const oi = o && o.items.find((x) => x.id === it.viene.item);
        if (oi && oi.cierre) { delete oi.cierre.a; delete oi.cierre.codigo; await almacenPedidos.guardar(o); }
      }
      registrar(p, 'Pedido anulado' + (p.anulado.motivo ? ': ' + p.anulado.motivo : ''));
      await almacenPedidos.guardar(p); cerrarHoja(); aviso('Pedido anulado'); render();
    };
  });
}

/* ---------- formulario: nuevo pedido / editar ---------- */
function formPedido(original) {
  const esNuevo = !original;
  const p = esNuevo
    ? { id: uid(), proyecto: M.proyecto.id, n: null, fecha: fechaLocal(), prioridad: 'Normal', justificacion: '', observaciones: '', adjuntos: [], items: [], remisiones: [], comentarios: [],
      solicitante: autor(), autor: autor(), creado: hoyISO() }
    : JSON.parse(JSON.stringify(original));
  const pasan = esNuevo ? renglonesQuePasan() : [];
  if (esNuevo) {
    for (const { p: o, it, falta } of pasan) {
      p.items.push({ id: uid(), material: it.material, rubro: it.rubro, unidad: it.unidad, cantidad: String(falta), prioridad: it.prioridad || '', oc: '', comentario: '',
        viene: { id: o.id, item: it.id, codigo: codigoPedido(o) } });
    }
    if (!p.items.length) p.items.push(nuevoRenglon());
  }
  const cat = catalogo();
  const rubrosOpc = (act) => `<option value="">Elegí…</option>${M.rubros.map((r) => `<option value="${r.id}" ${act === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}`;
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">${esNuevo ? 'Nuevo pedido' : 'Editar ' + esc(codigoPedido(p))}</h2>
      <p>${esNuevo ? 'El número (BEGAR-PM) lo pone la app al guardar.' : esc(fechaDia(p.fecha))}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campos">
      <div class="campo"><label for="pf-fecha">Fecha de solicitud</label><input id="pf-fecha" type="date" value="${esc(p.fecha)}"></div>
      <div class="campo"><label for="pf-prio">Prioridad</label><select id="pf-prio">${PRIORIDADES_PEDIDO.map((x) => `<option ${p.prioridad === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <p class="nota campo todo" id="pf-dia"></p>
    </div>
    ${pasan.length ? `<p class="nota"><b>${pasan.length} ${pasan.length === 1 ? 'renglón viene' : 'renglones vienen'} de pedidos anteriores</b> con la cantidad que faltaba. Podés cambiarlos o quitarlos.</p>` : ''}
    <div class="seccion-t">Materiales</div>
    <div id="pf-items" class="renglones"></div>
    <button class="btn" id="pf-mas">+ Agregar material</button>
    <datalist id="pf-cat">${cat.map((c) => `<option value="${esc(c.material)}">`).join('')}</datalist>
    <datalist id="pf-uni">${UNIDADES.map((u) => `<option value="${u}">`).join('')}</datalist>
    <div class="campo todo"><label for="pf-just">Justificación de compra</label><textarea id="pf-just" placeholder="Ej.: terminaciones de pisos, colocación de artefactos de luz">${esc(p.justificacion)}</textarea></div>
    <div class="campo todo"><label for="pf-obs">Observaciones</label><textarea id="pf-obs" placeholder="Links de compra de distintos proveedores, aclaraciones…">${esc(p.observaciones)}</textarea></div>
    <div class="campo todo"><span class="lbl">Fotos de referencia</span><div class="fotos" id="pf-fotos"></div></div>
    <div class="acciones"><button class="btn primario ancho" id="pf-ok">${esNuevo ? 'Guardar pedido' : 'Guardar cambios'}</button></div>
  `, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    const revisarDia = () => {
      const f = $('#pf-fecha', h).value, d = f ? diaDe(f) : null;
      const ok = d === null || DIAS_PEDIDO.includes(d);
      $('#pf-dia', h).innerHTML = d === null ? '' : ok ? `Pedido del ${DIAS[d]}.` : `<b>El ${DIAS[d]} no es día de pedido:</b> solo se puede cargar con prioridad Alta o Urgente.`;
    };
    $('#pf-fecha', h).onchange = revisarDia; revisarDia();
    const leerItems = () => {
      h.querySelectorAll('[data-it]').forEach((fila) => {
        const it = p.items.find((x) => x.id === fila.dataset.it);
        const v = (k) => $(`[data-k="${k}"]`, fila).value.trim();
        Object.assign(it, { material: v('material'), rubro: v('rubro'), unidad: v('unidad'), cantidad: v('cantidad'), prioridad: v('prioridad'), oc: v('oc'), comentario: v('comentario') });
      });
    };
    const pintarItems = () => {
      const recibidos = (it) => (original ? recibidoDe(original, it) : 0);
      $('#pf-items', h).innerHTML = p.items.map((it, i) => `<div class="renglon-form" data-it="${it.id}">
        <div class="renglon-cab"><b>${i + 1}.</b>${it.viene ? `<span class="chip">viene del ${esc(it.viene.codigo)}</span>` : ''}${recibidos(it) ? `<span class="chip">recibido ${cant(recibidos(it))}</span>` : ''}
          ${recibidos(it) ? '' : `<button type="button" class="btn-txt" data-quitar="${it.id}" aria-label="Quitar material ${i + 1}">Quitar</button>`}</div>
        <div class="campos">
          <div class="campo todo"><label>Descripción del material</label><input data-k="material" list="pf-cat" value="${esc(it.material)}" placeholder="Ej.: Cemento, Klaukol porcelanato"></div>
          <div class="campo"><label>Rubro</label><select data-k="rubro">${rubrosOpc(it.rubro)}</select></div>
          <div class="campo"><label>Unidad</label><input data-k="unidad" list="pf-uni" value="${esc(it.unidad)}" placeholder="unidad, bolsa, m³…"></div>
          <div class="campo"><label>Cantidad</label><input data-k="cantidad" inputmode="decimal" value="${esc(it.cantidad)}" placeholder="0"></div>
          <div class="campo"><label>Prioridad</label><select data-k="prioridad"><option value="">La del pedido</option>${PRIORIDADES_PEDIDO.map((x) => `<option ${it.prioridad === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="campo"><label>Comentario de compras (OC)</label><input data-k="oc" value="${esc(it.oc)}" placeholder="Ej.: oc-7711 bapesa"></div>
          <div class="campo"><label>Mi comentario</label><input data-k="comentario" value="${esc(it.comentario)}"></div>
        </div></div>`).join('');
      h.querySelectorAll('[data-k="material"]').forEach((inp) => (inp.onchange = () => {
        // material ya pedido antes: completa rubro y unidad si están vacíos
        const c = cat.find((x) => normNombre(x.material) === normNombre(inp.value));
        if (!c) return;
        const fila = inp.closest('[data-it]');
        const rs = $('[data-k="rubro"]', fila), un = $('[data-k="unidad"]', fila);
        if (!rs.value && c.rubro) rs.value = c.rubro;
        if (!un.value && c.unidad) un.value = c.unidad;
      }));
      h.querySelectorAll('[data-quitar]').forEach((b) => (b.onclick = () => { leerItems(); p.items = p.items.filter((x) => x.id !== b.dataset.quitar); if (!p.items.length) p.items.push(nuevoRenglon()); pintarItems(); }));
    };
    pintarItems();
    $('#pf-mas', h).onclick = () => {
      leerItems(); p.items.push(nuevoRenglon()); pintarItems();
      const ult = h.querySelector('[data-it]:last-child [data-k="material"]'); if (ult) { ult.scrollIntoView({ block: 'center' }); ult.focus(); }
    };
    fotosEditables($('#pf-fotos', h), p.adjuntos, () => `${codigoPedido(p)} · referencia`);
    $('#pf-ok', h).onclick = async () => {
      leerItems();
      p.items = p.items.filter((it) => it.material || num(it.cantidad));
      const mal = p.items.find((it) => !it.material || !it.rubro || !it.unidad || num(it.cantidad) <= 0);
      if (!p.items.length) { p.items.push(nuevoRenglon()); pintarItems(); aviso('Agregá al menos un material'); return; }
      if (mal) { pintarItems(); aviso(`Completá material, rubro, unidad y cantidad${mal.material ? ' de ' + mal.material : ''}`); return; }
      const fecha = $('#pf-fecha', h).value, prioridad = $('#pf-prio', h).value;
      if (!fecha) { aviso('Poné la fecha de solicitud'); return; }
      if (!DIAS_PEDIDO.includes(diaDe(fecha)) && !['Urgente', 'Alta'].includes(prioridad)) {
        aviso(`El ${DIAS[diaDe(fecha)]} no es día de pedido: solo con prioridad Alta o Urgente`); return;
      }
      Object.assign(p, { fecha, prioridad, justificacion: $('#pf-just', h).value.trim(), observaciones: $('#pf-obs', h).value.trim() });
      if (!esNuevo) registrar(p, 'Pedido editado');
      const b = $('#pf-ok', h); b.disabled = true; b.textContent = 'Guardando…';
      await almacenPedidos.guardar(p);
      // los renglones que vinieron de otro pedido quedan anotados allá
      for (const it of p.items.filter((x) => x.viene)) {
        const o = pedidos.find((x) => x.id === it.viene.id); const oi = o && o.items.find((x) => x.id === it.viene.item);
        if (oi && oi.cierre && !oi.cierre.a) { oi.cierre.a = p.id; oi.cierre.codigo = codigoPedido(p); await almacenPedidos.guardar(o); }
      }
      cerrarHoja();
      aviso(p._pendiente ? 'Pedido guardado en el teléfono: se sube cuando haya señal' : `${codigoPedido(p)} guardado`);
      if (esNuevo) ir('pedido', { id: p.id }); else render();
    };
  });
}
const nuevoRenglon = () => ({ id: uid(), material: '', rubro: '', unidad: '', cantidad: '', prioridad: '', oc: '', comentario: '' });

/** Fotos con cámara o galería, con fecha y leyenda impresas (igual que en los marcadores). */
function fotosEditables(caja, lista, leyenda) {
  const pintar = () => {
    caja.innerHTML = lista.map((f, i) => `<figure><img src="${esc(f.src || '')}" alt="Foto ${i + 1}"><figcaption>${fechaCorta(f.fecha)}</figcaption>
        <button type="button" class="foto-quitar" data-q="${i}" aria-label="Quitar foto ${i + 1}">✕</button></figure>`).join('')
      + `<label class="foto-add camara">📷<br>Sacar foto<input type="file" accept="image/*" capture="environment"></label>
         <label class="foto-add">＋<br>De galería<input type="file" accept="image/*" multiple></label>`;
    caja.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = async (e) => {
      for (const file of e.target.files) {
        try { lista.push({ id: uid(), src: await comprimir(file, `${leyenda()} · ${autor()}`), fecha: hoyISO(), autor: autor() }); }
        catch (er) { aviso('No se pudo leer la imagen'); }
      }
      pintar();
    }));
    caja.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { lista.splice(+b.dataset.q, 1); pintar(); }));
  };
  pintar();
}

/* ---------- formulario: remisión ---------- */
function formRemision(p, existente) {
  const esNueva = !existente;
  const r = esNueva
    ? { id: uid(), numero: '', proveedor: '', fecha: fechaLocal(), fotos: [], fotosMaterial: [], observaciones: '', items: {}, autor: autor(), creado: hoyISO() }
    : JSON.parse(JSON.stringify(existente));
  const otras = (p.remisiones || []).filter((x) => x.id !== r.id);
  const recibidoOtras = (it) => otras.reduce((a, x) => a + num((x.items || {})[it.id]), 0);
  // en una remisión nueva van los renglones que esperan material; al editar, también los que ya tenía
  const renglones = p.items.filter((it) => (esNueva ? !renglonResuelto(p, it) : (!it.cierre || num(r.items[it.id]) > 0)));
  const proveedores = [...new Set(pedidos.flatMap((x) => (x.remisiones || []).map((y) => y.proveedor)).filter(Boolean))].sort();
  abrirHoja(`
    <div class="ficha-cab"><div><h2 class="h-hoja">${esNueva ? 'Cargar remisión' : 'Editar remisión'}</h2><p>${esc(codigoPedido(p))}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campo todo"><span class="lbl">Foto de la remisión</span><div class="fotos" id="rf-fotos"></div></div>
    <div class="campos">
      <div class="campo"><label for="rf-num">N.º de remisión</label><input id="rf-num" value="${esc(r.numero)}" placeholder="Ej.: 0001-00012345"></div>
      <div class="campo"><label for="rf-prov">Proveedor</label><input id="rf-prov" list="rf-prov-l" value="${esc(r.proveedor)}" placeholder="El que figura en la remisión"><datalist id="rf-prov-l">${proveedores.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="campo"><label for="rf-fecha">Fecha de entrega</label><input id="rf-fecha" type="date" value="${esc(r.fecha)}"></div>
    </div>
    <div class="seccion-t">¿Cuánto llegó?</div>
    <p class="nota">Viene completado con lo que falta de cada material: corregí solo lo que no coincide. Dejá 0 si no llegó.</p>
    <div class="lista">${renglones.map((it) => {
      const falta = Math.max(0, num(it.cantidad) - recibidoOtras(it));
      const val = esNueva ? cant(falta) : cant(num(r.items[it.id]));
      return `<div class="fila recibe"><span class="fila-t">${esc(it.material)}</span>
        <span class="fila-s"><span>Pedido ${cant(num(it.cantidad))} ${esc(it.unidad)} · faltaban ${cant(falta)}</span></span>
        <label class="recibe-cant"><input data-rec="${it.id}" inputmode="decimal" value="${val}" aria-label="Cantidad recibida de ${esc(it.material)}"><span>${esc(it.unidad)}</span></label></div>`;
    }).join('') || '<p class="nota" style="padding:14px 16px">No quedan materiales por recibir en este pedido.</p>'}</div>
    <div class="campo todo"><span class="lbl">Fotos del material descargado</span><div class="fotos" id="rf-mat"></div></div>
    <div class="campo todo"><label for="rf-obs">Observaciones</label><textarea id="rf-obs" placeholder="Ej.: 2 bolsas rotas, faltó una caja">${esc(r.observaciones)}</textarea></div>
    <div class="acciones"><button class="btn primario ancho" id="rf-ok">${esNueva ? 'Guardar remisión' : 'Guardar cambios'}</button>
      ${esNueva ? '' : '<button class="btn peligro" id="rf-borrar">Quitar remisión</button>'}</div>
  `, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    fotosEditables($('#rf-fotos', h), r.fotos, () => `${codigoPedido(p)} · remisión`);
    fotosEditables($('#rf-mat', h), r.fotosMaterial, () => `${codigoPedido(p)} · material recibido`);
    $('#rf-ok', h).onclick = async () => {
      if (!r.fotos.length) { aviso('Sacale una foto a la remisión'); return; }
      const items = {};
      h.querySelectorAll('[data-rec]').forEach((inp) => { const v = num(inp.value); if (v > 0) items[inp.dataset.rec] = v; });
      if (!Object.keys(items).length) { aviso('Poné cuánto llegó de al menos un material'); return; }
      Object.assign(r, { numero: $('#rf-num', h).value.trim(), proveedor: $('#rf-prov', h).value.trim(), fecha: $('#rf-fecha', h).value || fechaLocal(),
        observaciones: $('#rf-obs', h).value.trim(), items });
      const antes = estadoPedido(p);
      p.remisiones = [...otras, r].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
      registrar(p, `${esNueva ? 'Remisión cargada' : 'Remisión editada'}: ${r.numero || 's/n'}${r.proveedor ? ' de ' + r.proveedor : ''}`);
      const b = $('#rf-ok', h); b.disabled = true; b.textContent = 'Guardando…';
      await almacenPedidos.guardar(p);
      cerrarHoja();
      const ahora = estadoPedido(p);
      aviso(ahora === 'terminado' && antes !== 'terminado' ? `Llegó todo: ${codigoPedido(p)} terminado` : p._pendiente ? 'Remisión guardada en el teléfono: se sube cuando haya señal' : 'Remisión guardada');
      render();
    };
    const del = $('#rf-borrar', h);
    if (del) del.onclick = async () => {
      if (!del.dataset.ok) { del.dataset.ok = '1'; del.textContent = 'Tocá de nuevo para quitarla'; return; }
      p.remisiones = otras;
      registrar(p, `Remisión quitada: ${r.numero || 's/n'}`);
      await almacenPedidos.guardar(p); cerrarHoja(); aviso('Remisión quitada'); render();
    };
  });
}

/* ---------- resumen y PDF ---------- */
function elegirResumen() {
  const hoy = fechaLocal();
  const lunes = (() => { const d = new Date(hoy + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fechaLocal(d); })();
  const mes = hoy.slice(0, 8) + '01';
  const rangos = [['semana', 'Esta semana', lunes], ['mes', 'Este mes', mes], ['todo', 'Todos', '']];
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Resumen de pedidos</h2><p>Cada material con lo pedido, lo recibido y el proveedor de la remisión.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campo todo"><span class="lbl">Período</span><div class="estados alcance" id="rs-rango">${rangos.map(([id, n], i) => `<button type="button" data-rg="${id}" aria-pressed="${i === 0}">${n}</button>`).join('')}</div></div>
    <div class="campo todo"><label for="rs-rubro">Rubro</label><select id="rs-rubro"><option value="">Todos los rubros</option>${M.rubros.map((r) => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" id="rs-pend"> <span>Solo lo que falta recibir</span></label>
    <p class="nota" id="rs-cuenta"></p>
    <div class="acciones"><button class="btn primario ancho" id="rs-pdf">PDF</button><button class="btn" id="rs-comp">Compartir</button></div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    let rango = 'semana';
    const elegidos = () => {
      const desde = rangos.find((x) => x[0] === rango)[2];
      return pedidos.filter((p) => !p.borrado && !p.anulado && (!desde || (p.fecha || '') >= desde))
        .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.n || 0) - (b.n || 0));
    };
    const opciones = () => ({ rubro: $('#rs-rubro', h).value, soloFalta: $('#rs-pend', h).checked });
    const contar = () => {
      const o = opciones();
      const n = elegidos().reduce((a, p) => a + p.items.filter((it) => (!o.rubro || it.rubro === o.rubro) && (!o.soloFalta || !renglonResuelto(p, it))).length, 0);
      $('#rs-cuenta', h).textContent = `${n} ${n === 1 ? 'material' : 'materiales'} en ${elegidos().length} ${elegidos().length === 1 ? 'pedido' : 'pedidos'}.`;
    };
    h.querySelectorAll('[data-rg]').forEach((b) => (b.onclick = () => { rango = b.dataset.rg; h.querySelectorAll('[data-rg]').forEach((x) => x.setAttribute('aria-pressed', x === b)); contar(); }));
    $('#rs-rubro', h).onchange = contar; $('#rs-pend', h).onchange = contar; contar();
    const sacar = (compartir) => async () => {
      const o = opciones();
      const rb = o.rubro ? rubro(o.rubro).nombre : '';
      const nombre = rangos.find((x) => x[0] === rango)[1];
      await pdfPedidos(elegidos(), { ...o, titulo: `Resumen de pedidos · ${nombre}${rb ? ' · ' + rb : ''}`, compartir });
    };
    $('#rs-pdf', h).onclick = sacar(false); $('#rs-comp', h).onclick = sacar(true);
  });
}

/** PDF con el formato de la planilla FL CO COM 10: un pedido, o el resumen de varios. */
async function pdfPedidos(lista, { titulo, unico = false, rubro: soloRubro = '', soloFalta = false, compartir = false }) {
  aviso('Armando el PDF…');
  try {
    await cargarScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const W = 297, H = 210, m = 12, ancho = W - 2 * m;
    const ORO = [254, 190, 16], NEGRO = [26, 26, 26], GRIS = [95, 95, 95], LINEA = [205, 205, 205], FONDO = [242, 242, 242];
    const logo = await logoJPEG();
    let y = m;
    const txt = (t, x, yy, tam, estilo = 'normal', color = NEGRO, opc = {}) => { doc.setFont('helvetica', estilo); doc.setFontSize(tam); doc.setTextColor(...color); doc.text(latin1(t), x, yy, opc); };
    const encabezado = (p) => {
      if (logo) { const hl = 10; doc.addImage(logo.url, 'JPEG', m, y, hl * logo.w / logo.h, hl); }
      txt(unico ? 'SOLICITUD DE PEDIDO DE MATERIALES' : titulo, W / 2, y + 6, 13, 'bold', NEGRO, { align: 'center' });
      if (unico) txt(codigoPedido(p), W - m, y + 4, 11, 'bold', NEGRO, { align: 'right' });
      txt(unico ? 'FL CO COM 10' : `Emitido ${fechaCorta(hoyISO())}`, W - m, y + 9, 8, 'normal', GRIS, { align: 'right' });
      y += 13;
      doc.setFillColor(...ORO); doc.rect(m, y, ancho, 1, 'F'); y += 6;
      if (unico) {
        const dato = (k, v, x) => { txt(k, x, y, 8.5, 'bold', GRIS); txt(v, x + 34, y, 10, 'normal'); };
        dato('OBRA:', M.proyecto.nombre, m); dato('FECHA DE SOLICITUD:', fechaCorta(p.fecha + 'T12:00'), m + 150); y += 6;
        dato('SOLICITANTE:', p.solicitante || p.autor || '', m); dato('SEMANA:', semanaDe(p.fecha), m + 150); y += 6;
        dato('PRIORIDAD:', p.prioridad, m); dato('ESTADO:', ESTADOS_PEDIDO[estadoPedido(p)].nombre, m + 150); y += 7;
      } else {
        txt(`${M.proyecto.nombre}${soloFalta ? ' · solo lo que falta recibir' : ''}`, m, y, 10, 'normal', GRIS); y += 7;
      }
    };
    // columnas: en el resumen se agrega el número de pedido
    const cols = [
      ...(unico ? [] : [{ t: 'Pedido', w: 26 }]),
      { t: 'Descripción', w: unico ? 70 : 60 }, { t: 'Rubro', w: 36 }, { t: 'Unidad', w: 18 }, { t: 'Cant. solicitada', w: 20, der: true },
      { t: 'Recibido', w: 18, der: true }, { t: 'Falta', w: 16, der: true }, { t: 'Proveedor (remisión)', w: 36 },
    ];
    const usado = cols.reduce((a, c) => a + c.w, 0);
    cols.push({ t: 'Comentarios', w: ancho - usado });
    const cabTabla = () => {
      doc.setFillColor(...FONDO); doc.rect(m, y, ancho, 8, 'F');
      let x = m;
      for (const c of cols) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
        doc.text(doc.splitTextToSize(latin1(c.t.toUpperCase()), c.w - 3), c.der ? x + c.w - 1.5 : x + 1.5, y + 3.3, { align: c.der ? 'right' : 'left' });
        x += c.w;
      }
      y += 8;
    };
    const fila = (celdas, p) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const lineas = celdas.map((v, i) => doc.splitTextToSize(latin1(v), cols[i].w - 3));
      const alto = Math.max(...lineas.map((l) => l.length)) * 3.8 + 3;
      if (y + alto > H - m - 6) { doc.addPage(); y = m; encabezado(p); cabTabla(); }
      let x = m;
      lineas.forEach((l, i) => {
        doc.setFont('helvetica', i === (unico ? 0 : 1) ? 'bold' : 'normal'); doc.setFontSize(9); doc.setTextColor(...NEGRO);
        doc.text(l, cols[i].der ? x + cols[i].w - 1.5 : x + 1.5, y + 4.2, { align: cols[i].der ? 'right' : 'left' });
        x += cols[i].w;
      });
      y += alto;
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(m, y, m + ancho, y);
    };
    const renglonCeldas = (p, it) => {
      const rec = recibidoDe(p, it), falta = Math.max(0, num(it.cantidad) - rec);
      const cierre = it.cierre ? (it.cierre.tipo === 'pasa' ? (it.cierre.codigo ? `pasa al ${it.cierre.codigo}` : 'pasa al próximo pedido') : 'cancelado') : '';
      const coms = [it.oc, it.comentario, it.viene ? `viene del ${it.viene.codigo}` : '', cierre, it.prioridad && it.prioridad !== p.prioridad ? `prioridad ${it.prioridad}` : ''].filter(Boolean).join(' · ');
      return [...(unico ? [] : [`${codigoPedido(p).replace('BEGAR-', '')}\n${fechaCorta(p.fecha + 'T12:00')}`]), it.material, (rubro(it.rubro) || {}).nombre || it.rubro, it.unidad,
        cant(num(it.cantidad)), cant(rec), it.cierre ? '-' : cant(falta), proveedoresDe(p, it).join(', '), coms];
    };
    const p0 = lista[0] || { fecha: fechaLocal(), items: [] };
    encabezado(p0);
    cabTabla();
    let total = 0;
    for (const p of lista) for (const it of p.items) {
      if (soloRubro && it.rubro !== soloRubro) continue;
      if (soloFalta && renglonResuelto(p, it)) continue;
      fila(renglonCeldas(p, it), p); total++;
    }
    if (!total) { y += 4; txt('Sin materiales para mostrar.', m, y, 10, 'normal', GRIS); y += 4; }
    const bloque = (k, v) => {
      if (!v) return;
      const l = doc.splitTextToSize(latin1(v), ancho - 42);
      if (y + l.length * 4.2 + 6 > H - m) { doc.addPage(); y = m; }
      y += 6; txt(k, m, y, 8.5, 'bold', GRIS); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...NEGRO); doc.text(l, m + 42, y); y += (l.length - 1) * 4.2;
    };
    if (unico) {
      bloque('OBSERVACIONES:', p0.observaciones);
      bloque('JUSTIFICACIÓN DE COMPRA:', p0.justificacion);
      bloque('REMISIONES:', (p0.remisiones || []).map((r) => `${fechaCorta(r.fecha + 'T12:00')} · N.º ${r.numero || 's/n'} · ${r.proveedor || 'proveedor sin indicar'}`).join('\n'));
      if (y + 24 > H - m) { doc.addPage(); y = m; }
      y = Math.max(y + 18, H - m - 10);
      doc.setDrawColor(...NEGRO); doc.setLineWidth(0.3);
      doc.line(m + 20, y, m + 100, y); doc.line(W - m - 100, y, W - m - 20, y);
      txt('Firma del solicitante', m + 60, y + 4.5, 9, 'normal', GRIS, { align: 'center' });
      txt('Firma autorizada', W - m - 60, y + 4.5, 9, 'normal', GRIS, { align: 'center' });
    }
    const nombre = `${(unico ? codigoPedido(p0) : titulo).replace(/[\\/:*?"<>|·]+/g, ' ').replace(/\s+/g, ' ').trim()} ${fechaLocal()}.pdf`;
    await entregar(doc.output('blob'), nombre, compartir);
  } catch (e) { console.error(e); aviso('No se pudo armar el PDF'); }
}
