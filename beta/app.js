/* Relevamiento de pendientes por dpto — Belive Garay.
   Lee datos/manifest.json (ingesta/ingesta.py) y guarda los marcadores en IndexedDB del dispositivo.
   Flujo: Edificio (22 dptos + SS, PB, Azotea) → Dpto → plano con marcadores → informe por rubro/contratista. */
'use strict';

const DATOS = 'datos/';
const ESTADOS = [
  { id: 'abierto', nombre: 'Pendiente' },
  { id: 'corregido', nombre: 'Realizado' },
  { id: 'aprobado', nombre: 'Verificado' },
];
const GRAVEDAD = { abierto: 2, corregido: 1, aprobado: 0 };
const PRIORIDADES = ['Alta', 'Media', 'Baja'];
const COMUN = 'Áreas comunes';
const VERSION_EJEMPLOS = '4';
const EN_IFRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
/* App Android (carpeta android-app): la misma página abierta dentro de la app, con acceso a compartir, botón atrás y giro de pantalla. */
const NATIVO = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const nativo = (nombre) => (NATIVO ? (window.Capacitor.Plugins && window.Capacitor.Plugins[nombre]) || window.Capacitor.registerPlugin(nombre) : null);

let M = null;          // manifest
let pines = [];        // marcadores
let mapa = null;
const vistasMapa = {};
const pila = [];

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoyISO = () => new Date().toISOString();
const fechaCorta = (iso) => { try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch (e) { return iso; } };
const fechaHora = (iso) => { try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } };
const estadoNombre = (id) => (ESTADOS.find((e) => e.id === id) || {}).nombre || id;
const pref = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem('obra.' + k);
    localStorage.setItem('obra.' + k, v);
  } catch (e) { return null; }
};
const CFG = window.OBRA_CONFIG || {};
let nube = null;       // versión compartida (nube.js); null = todo local en el dispositivo
const autor = () => (nube && nube.perfil ? nube.perfil.nombre : pref('autor') || 'Fiscal de obra');
/* Roles: admin (todo), editor (carga, edita y cierra; no elimina), lector (mira y comenta). Sin nube, el teléfono es admin. */
const miRol = () => (nube ? nube.perfil.rol : 'admin');
const puedeEditar = () => ['admin', 'editor'].includes(miRol());
const esAdmin = () => miRol() === 'admin';
const puedeBorrar = () => esAdmin(); // los editores cambian y cierran, pero no eliminan

function aviso(txt) {
  const a = $('#aviso');
  a.textContent = txt; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), 2600);
}

/* ---------- almacenamiento local ---------- */
const almacen = (() => {
  let idb = null;
  const mem = new Map();
  const op = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const st = (modo) => idb.transaction('pines', modo).objectStore('pines');
  return {
    async abrir() {
      try {
        idb = await new Promise((res, rej) => {
          const r = indexedDB.open('obra-terminaciones', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('pines', { keyPath: 'id' });
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      } catch (e) { idb = null; }
    },
    get persistente() { return !!idb; },
    async todos() {
      if (!idb) return [...mem.values()];
      try { return await op(st('readonly').getAll()); } catch (e) { return [...mem.values()]; }
    },
    async guardarLocal(p) {
      mem.set(p.id, p);
      if (!idb) return;
      try { await op(st('readwrite').put(p)); } catch (e) { aviso('No se pudo guardar en este dispositivo'); }
    },
    async borrarLocal(id) {
      mem.delete(id);
      if (!idb) return;
      try { await op(st('readwrite').delete(id)); } catch (e) { /* sin acción */ }
    },
    /** Guarda en el teléfono y, en la versión compartida, deja el marcador en cola para subirlo. */
    async guardar(p) {
      if (nube && !p.ejemplo) p._pendiente = true;
      await this.guardarLocal(p);
      if (nube && !p.ejemplo) nube.vaciarCola();
    },
    async borrar(id) {
      const p = pines.find((x) => x.id === id);
      await this.borrarLocal(id);
      if (nube && p && !p.ejemplo) nube.borrar(p);
    },
  };
})();

/* ---------- consultas ---------- */
const rubrosBorrados = []; // rubros eliminados: sólo para mostrar el nombre en marcadores viejos
const rubro = (id) => M.rubros.find((r) => r.id === id) || rubrosBorrados.find((r) => r.id === id);
/* Color de marcador por contratista (el estado va en el puntito del marcador).
   colores.json fija el color de cada contratista por nombre; los que no figuran toman uno libre de la paleta, siempre el mismo. */
const PALETA_AUTO = ['#c026d3', '#65a30d', '#ea580c', '#155e75', '#a16207', '#be185d', '#6d28d9', '#0d9488', '#854d0e', '#9d174d', '#2f855a', '#b91c1c'];
const SIN_CONTRATISTA = 'Sin contratista';
let coloresFijos = {};
const normNombre = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const contratistaDe = (p) => (p.responsable || '').trim() || responsablesRubro(rubro(p.rubro))[0] || SIN_CONTRATISTA;
const coloresAuto = new Map();
function colorContratista(nombre) {
  const k = normNombre(nombre);
  if (!k || k === normNombre(SIN_CONTRATISTA)) return '#6b7280';
  if (coloresFijos[k]) return coloresFijos[k];
  // "VM" también encuentra "VM Instalaciones" (y al revés)
  const parecido = Object.keys(coloresFijos).find((f) => f.startsWith(k + ' ') || k.startsWith(f + ' '));
  if (parecido) return coloresFijos[parecido];
  if (!coloresAuto.has(k)) {
    const usados = new Set([...Object.values(coloresFijos), ...coloresAuto.values()]);
    let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let i = h % PALETA_AUTO.length, n = 0;
    while (usados.has(PALETA_AUTO[i]) && n++ < PALETA_AUTO.length) i = (i + 1) % PALETA_AUTO.length;
    coloresAuto.set(k, PALETA_AUTO[i]);
  }
  return coloresAuto.get(k);
}
/* Código de cada marcador: prefijo del rubro + número propio del rubro (IH1, IH2, AA1, IE1…).
   Queda guardado en el marcador (p.cod) para que no cambie aunque se borren otros. */
const PREFIJOS = { electricas: 'IE', hidro: 'IH', termo: 'AA', pci: 'PCI', 'carp-aluminio': 'CA', 'carp-madera': 'CM', muebles: 'MU', pisos: 'PR',
  cielorrasos: 'CR', mamposteria: 'MA', pintura: 'PI', herreria: 'HE', aislaciones: 'AI', ascensor: 'AS', amenities: 'AM' };
const prefijosAuto = new Map();
function prefijoRubro(id) {
  if (PREFIJOS[id]) return PREFIJOS[id];
  if (prefijosAuto.has(id)) return prefijosAuto.get(id);
  // rubros agregados: iniciales de las palabras (Mobiliario dptos → MD); si ya existe, se suma una letra
  const nombre = normNombre((rubro(id) || {}).nombre || id).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
  const palabras = nombre.split(' ').filter((w) => w && !['DE', 'Y', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'E'].includes(w));
  let base = palabras.length > 1 ? palabras.map((w) => w[0]).join('').slice(0, 3) : (palabras[0] || 'X').slice(0, 2);
  const usados = new Set([...Object.values(PREFIJOS), ...prefijosAuto.values()]);
  let pre = base, k = 1;
  while (usados.has(pre)) pre = base + ((palabras[palabras.length - 1] || 'X')[k++] || k);
  prefijosAuto.set(id, pre);
  return pre;
}
const numCod = (cod, pre) => (cod && cod.startsWith(pre) && /^\d+$/.test(cod.slice(pre.length)) ? +cod.slice(pre.length) : 0);
const codValido = (p) => numCod(p.cod, prefijoRubro(p.rubro)) > 0;
/** Siguiente código libre del rubro. */
function proximoCod(rubroId, excepto) {
  const pre = prefijoRubro(rubroId);
  const max = Math.max(0, ...pines.filter((q) => q.rubro === rubroId && q.id !== excepto).map((q) => numCod(q.cod, pre)));
  return pre + (max + 1);
}
/** Código para mostrar. Los marcadores viejos sin código guardado se numeran por orden de creación hasta que se les asigna. */
function codigoPin(p) {
  if (codValido(p)) return p.cod;
  const pre = prefijoRubro(p.rubro);
  const conCod = pines.filter((q) => q.rubro === p.rubro && codValido(q));
  const sinCod = pines.filter((q) => q.rubro === p.rubro && !codValido(q)).sort((a, b) => a.n - b.n);
  return pre + (Math.max(0, ...conCod.map((q) => numCod(q.cod, pre))) + sinCod.findIndex((q) => q.id === p.id) + 1);
}
/** Una sola vez: guarda el código en los marcadores que todavía no lo tienen (lo hace quien puede editar). */
async function asignarCodigos() {
  if (!puedeEditar()) return;
  const faltan = pines.filter((p) => !codValido(p)).sort((a, b) => a.n - b.n);
  if (!faltan.length) return;
  const cods = new Map(faltan.map((p) => [p.id, codigoPin(p)]));
  for (const p of faltan) { p.cod = cods.get(p.id); await almacen.guardar(p); }
}

/** Texto blanco u oscuro según lo claro que sea el color (el amarillo lleva número negro). */
const tintaSobre = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160 ? '#1a1a1a' : '#fff'; };
async function cargarColores() {
  try {
    const c = await fetch('colores.json', { cache: 'no-store' }).then((r) => r.json());
    coloresFijos = Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [normNombre(k), v]));
  } catch (e) { /* sin archivo: todos automáticos */ }
}
const nivel = (id) => M.niveles.find((n) => n.id === id);
const recorte = (id) => M.recortes[id];
const nombrePlano = (rec) => { const p = M.planos[rec.plano]; return p ? p.nombre : rec.plano; };
const contratista = (carpeta) => carpeta.replace(/^\d+\.\s*/, '').split(' - ').pop();
const responsablesRubro = (rb) => (!rb ? [] : rb.responsables && rb.responsables.length ? rb.responsables : (rb.contratistas || []).map(contratista));
/* Rubros del equipo: los que se agregan desde la app y los cambios a cualquier rubro (nombre, contratista, eliminado).
   Cada uno es una fila {id, nombre, responsables, eliminado, actualizado}; si hay dos versiones gana la más nueva. */
const rubrosPropios = () => { try { return JSON.parse(pref('rubros-propios') || '[]'); } catch (e) { return []; } };
function sumarRubros(lista) {
  for (const r of lista) {
    if (!r || !r.id) continue;
    const i = M.rubros.findIndex((x) => x.id === r.id);
    const b = rubrosBorrados.findIndex((x) => x.id === r.id);
    if (r.eliminado) {
      if (i >= 0) rubrosBorrados.push(...M.rubros.splice(i, 1));
      continue;
    }
    if (b >= 0) M.rubros.push(...rubrosBorrados.splice(b, 1));
    const actual = M.rubros.find((x) => x.id === r.id);
    if (actual) Object.assign(actual, { nombre: r.nombre, responsables: r.responsables || [], contratistas: [] });
    else M.rubros.push({ contratistas: [], responsables: [], ...r, propio: true });
  }
}
/** Guarda un cambio de rubro en el teléfono y, en la versión compartida, para todo el equipo. */
function registrarRubro(fila) {
  fila = { id: fila.id, nombre: fila.nombre, responsables: fila.responsables || [], eliminado: !!fila.eliminado, actualizado: hoyISO() };
  pref('rubros-propios', JSON.stringify([...rubrosPropios().filter((x) => x.id !== fila.id), fila]));
  sumarRubros([fila]);
  if (nube) nube.guardarRubro(fila);
}
const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const limpiarNombre = (t) => t.trim().replace(/\s+/g, ' ');
const listaResponsables = (t) => t.split(',').map(limpiarNombre).filter(Boolean);
async function agregarRubro(nombre, responsable) {
  nombre = limpiarNombre(nombre);
  const existe = M.rubros.find((r) => slug(r.nombre) === slug(nombre));
  if (existe) return existe;
  const id = 'propio-' + slug(nombre);
  registrarRubro({ id, nombre, responsables: listaResponsables(responsable || '') });
  return rubro(id);
}
/** Mini formulario "nombre del rubro + responsable" que se abre dentro de una hoja. */
function formNuevoRubro(caja, alCrear) {
  caja.hidden = false;
  caja.innerHTML = `<div class="campo"><label for="nr-nom">Nombre del rubro nuevo</label><input id="nr-nom" placeholder="Ej.: Yesería, Vidriería, Limpieza final"></div>
    <div class="campo"><label for="nr-resp">Responsable / contratista (opcional)</label><input id="nr-resp" placeholder="Ej.: Pérez Yesería"></div>
    <div class="acciones"><button type="button" class="btn primario" id="nr-ok">Agregar rubro</button><button type="button" class="btn" id="nr-no">Cancelar</button></div>`;
  $('#nr-nom', caja).focus();
  $('#nr-no', caja).onclick = () => { caja.hidden = true; caja.innerHTML = ''; alCrear(null); };
  $('#nr-ok', caja).onclick = async () => {
    const nom = $('#nr-nom', caja).value.trim();
    if (nom.length < 3) { aviso('Escribí el nombre del rubro'); return; }
    const r = await agregarRubro(nom, $('#nr-resp', caja).value);
    caja.hidden = true; caja.innerHTML = '';
    aviso(`Rubro "${r.nombre}" agregado`);
    alCrear(r);
  };
}
const rubroActivo = () => rubro(pref('rubro')) || M.rubros.find((r) => r.id === 'pintura') || M.rubros[0];
const nivelesEdificio = () => [...M.niveles].reverse(); // Azotea arriba, Subsuelo abajo
const espacioDe = (p) => p.unidad || COMUN;
const etiquetaEspacio = (nv, unidad) => (unidad && unidad !== COMUN ? unidad : `${nv} · ${COMUN}`);

/** Recortes de planta del nivel (de cualquier plano), con el plano base primero. */
function recortesNivel(nv) {
  const base = (M.proyecto.planos_base || []).map((s) => s.toLowerCase());
  const rank = (r) => { const i = base.findIndex((b) => nombrePlano(r).toLowerCase().includes(b.slice(0, 8))); return i < 0 ? 99 : i; };
  return Object.values(M.recortes).filter((r) => r.niveles.includes(nv)).sort((a, b) => rank(a) - rank(b));
}

function resumen(lista) {
  const r = { total: lista.length, pend: 0, real: 0, verif: 0 };
  for (const p of lista) {
    if (p.estado === 'abierto') r.pend++;
    else if (p.estado === 'corregido') r.real++;
    else r.verif++;
  }
  r.pct = r.total ? Math.round((100 * (r.real + r.verif)) / r.total) : null;
  return r;
}
const peorEstado = (lista) => lista.reduce((a, p) => (a === null || GRAVEDAD[p.estado] > GRAVEDAD[a] ? p.estado : a), null);

/** Etiqueta de dpto en el plano: "1A" directo o "DTO A" en planta compartida → número del nivel + letra. */
function nombreUnidad(u, nv) {
  const num = (nv.match(/^N(\d)$/) || [])[1];
  if (u.num) return u.num + u.letra;
  if (num && u.letra) return num + u.letra;
  return null;
}
/** Rótulos de local (A-103, PT-100...) que corresponden a este nivel. */
function localesNivel(rec, nv) {
  const n = nivel(nv);
  const num = (nv.match(/^N(\d)$/) || [])[1];
  return rec.ubicaciones.filter((u) => u.clase === 'local' && (u.unidad
    ? (n.unidades || []).includes(u.unidad)
    : u.zona === (num ? 'PT' : nv)));
}
function posUnidad(rec, nv, unidad) {
  const ls = localesNivel(rec, nv).filter((u) => u.unidad === unidad);
  if (ls.length) return { x: ls.reduce((a, u) => a + u.x, 0) / ls.length, y: ls.reduce((a, u) => a + u.y, 0) / ls.length };
  return rec.ubicaciones.find((u) => u.clase === 'unidad' && nombreUnidad(u, nv) === unidad);
}
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '');

/** Dpto y ambiente más cercanos a un punto del recorte. */
function inferirUbicacion(rec, nv, x, y) {
  const asp = rec.tiles ? rec.tiles.alto_px / rec.tiles.ancho_px : 1;
  const d = (u) => Math.hypot(u.x - x, (u.y - y) * asp);
  const locs = localesNivel(rec, nv).sort((a, b) => d(a) - d(b));
  if (locs.length) {
    const l = locs[0];
    return { unidad: l.unidad || COMUN, ambiente: capital(l.nombre) || l.texto, local: l.texto };
  }
  const unidades = (nivel(nv).unidades || []);
  const uni = rec.ubicaciones.filter((u) => u.clase === 'unidad' && unidades.includes(nombreUnidad(u, nv))).sort((a, b) => d(a) - d(b))[0];
  const amb = rec.ubicaciones.filter((u) => u.clase === 'ambiente').sort((a, b) => d(a) - d(b))[0];
  const unidad = uni && d(uni) < 0.2 ? nombreUnidad(uni, nv) : COMUN;
  const ambiente = amb && d(amb) < 0.12 ? amb.texto.charAt(0) + amb.texto.slice(1).toLowerCase() : '';
  return { unidad, ambiente };
}

function codigosCercanos(rec, x, y, max = 8) {
  const asp = rec.tiles ? rec.tiles.alto_px / rec.tiles.ancho_px : 1;
  return rec.codigos
    .map((c, i) => ({ ...c, i, d: Math.hypot(c.x + c.w / 2 - x, (c.y + c.h / 2 - y) * asp) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max);
}

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
  ({ edificio: vEdificio, espacio: vEspacio, visor: vVisor, informe: vInforme, pedidos: vPedidos, pedido: vPedido }[vista])(main, params);
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
      <div class="kpi"><b>${r.real}</b><span>realizados</span></div>
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
  </div>`;
  enlazarChipRubro(main);
  main.querySelectorAll('.unidad').forEach((b) => (b.onclick = () => ir('espacio', { nivel: b.dataset.nv, unidad: b.dataset.u })));
  main.querySelectorAll('[data-inf]').forEach((b) => (b.onclick = () => ir('informe', { filtro: { rubro: b.dataset.inf } })));
  $('#inf-todos').onclick = () => ir('informe', { filtro: { rubro: '' } });
  $('#inf-dpto').onclick = elegirDptoInforme;
  $('#ver-pend').onclick = abrirPendientes;
  $('#ir-pedidos').onclick = () => ir('pedidos');
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
      <div class="kpi"><b>${r.real}</b><span>realizados</span></div>
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
      if (modoPin) { setModo(false); return nuevoPin(nv, rec, { x: c.x + c.w / 2, y: c.y - c.h * 0.2 }, i); }
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
      + `<div class="ley-est"><span><i class="e-abierto"></i>Pendiente</span><span><i class="e-corregido"></i>Realizado</span><span><i class="e-aprobado">✓</i>Verificado</span></div>`;
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
  mapa.on('click', (e) => { if (!modoPin) return; setModo(false); nuevoPin(nv, rec, aNorm(e.latlng)); });

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
      nuevoPin(nv, rec, aNorm(mapa.containerPointToLatLng([inicio.x - r.left, inicio.y - r.top])));
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

/* ---------- hoja inferior ---------- */
function abrirHoja(html, alAbrir) {
  $('#hoja-cuerpo').innerHTML = html;
  $('#hoja').hidden = false; $('#hoja-fondo').hidden = false;
  document.body.classList.add('con-hoja');
  $('#hoja-cuerpo').scrollTop = 0;
  if (alAbrir) alAbrir($('#hoja-cuerpo'));
}
if (NATIVO) {
  // botón atrás de Android: cierra la hoja, sale de pantalla completa o vuelve una pantalla; en el inicio minimiza la app
  nativo('App').addListener('backButton', () => {
    const mf = $('.marcador-foto'); if (mf) return mf.cerrar();
    const fg = $('.foto-grande'); if (fg) return fg.cerrar();
    if (!$('#hoja').hidden) return cerrarHoja();
    if ($('#app').classList.contains('completa') && $('#t-completa')) return $('#t-completa').click();
    if (!$('#volver').hidden) return $('#volver').click();
    nativo('App').minimizeApp();
  });
}
/* ---------- novedades: qué cambió en cada actualización ---------- */
// novedades.json lleva una entrada por cada publicación con cambios visibles (la más nueva primero).
// Al abrir la app se muestran las que la persona todavía no vio.
async function mostrarNovedades(todas = false) {
  let lista;
  try { lista = await fetch('novedades.json', { cache: 'no-store' }).then((r) => r.json()); } catch (e) { if (todas) aviso('No se pudieron cargar las novedades'); return; }
  if (!lista.length) return;
  const vista = pref('novedades-vista');
  const nuevas = todas ? lista : vista ? lista.filter((n) => n.id > vista) : lista.slice(0, 1);
  pref('novedades-vista', lista[0].id);
  if (!nuevas.length) return;
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">${todas ? 'Novedades' : 'Qué hay de nuevo'}</h2><p>${todas ? 'Lo que cambió en cada actualización.' : 'La app se actualizó.'}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    ${nuevas.map((n) => `<section class="novedad"><h3>${esc(n.titulo)} <small class="nota">${fechaCorta(n.fecha + 'T12:00')}</small></h3><ul>${n.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('')}
    <button class="btn primario" data-cerrar>Entendido</button>`, (h) => h.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = cerrarHoja)));
}

/* ---------- app Android: aviso de versión nueva del APK ---------- */
// Casi todo llega solo (la app abre la página publicada). Solo los cambios de la parte nativa piden instalar un APK nuevo:
// descargas/version.json dice cuál es el último y, si el teléfono tiene uno anterior, se ofrece actualizar.
const APK_URL = () => new URL('descargas/BAV-BeGar.apk', location.href).href;
async function revisarApk() {
  if (!NATIVO) return;
  try {
    const [info, ult] = await Promise.all([nativo('App').getInfo(), fetch('descargas/version.json', { cache: 'no-store' }).then((r) => r.json())]);
    if (!(+ult.build > +info.build)) return;
    const pos = JSON.parse(pref('apk-despues') || 'null');
    if (pos && pos.build === +ult.build && Date.now() - pos.cuando < 864e5) return; // "Después": no insiste por un día
    if (!$('#hoja').hidden) return setTimeout(revisarApk, 30000);
    abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Hay una versión nueva de la app</h2><p>Tenés la ${esc(info.version)} y está disponible la ${esc(ult.version)}.${ult.novedades ? ' ' + esc(ult.novedades) : ''}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
      <p class="nota">Se descarga el APK y Android te pregunta si querés actualizar. Se instala encima: no perdés la sesión ni los marcadores.</p>
      <div class="acciones"><button class="btn primario" id="apk-si">Actualizar ahora</button><button class="btn" id="apk-no">Después</button></div>`, (h) => {
      const despues = () => { pref('apk-despues', JSON.stringify({ build: +ult.build, cuando: Date.now() })); cerrarHoja(); };
      $('[data-cerrar]', h).onclick = despues;
      $('#apk-no', h).onclick = despues;
      $('#apk-si', h).onclick = async () => {
        cerrarHoja();
        try {
          if (window.Capacitor.isPluginAvailable('Browser')) await nativo('Browser').open({ url: APK_URL() });
          // los APK viejos no traen el navegador: se manda el link al menú de compartir para abrirlo con Chrome
          else {
            await navigator.clipboard.writeText(APK_URL()).catch(() => {});
            await nativo('Share').share({ title: 'Actualizar BAV BeGar', text: 'Abrí este link con Chrome para descargar la versión nueva:', url: APK_URL(), dialogTitle: 'Abrí el link con Chrome (también quedó copiado)' });
          }
        } catch (e) { if (!/cancel/i.test(String(e && e.message))) aviso('No se pudo abrir la descarga'); }
      };
    });
  } catch (e) { console.warn('sin datos de versión', e); }
}
setTimeout(revisarApk, 4500); // después de la animación del logo y de las novedades

function cerrarHoja() { document.body.classList.remove('con-hoja'); $('#hoja').hidden = true; $('#hoja-fondo').hidden = true; $('#hoja-cuerpo').innerHTML = ''; }
$('#hoja-fondo').addEventListener('click', cerrarHoja);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHoja(); });

/* ---------- ficha de código ---------- */
function abrirFicha(cod, ctx) {
  const f = M.codigos[cod];
  if (!f) return;
  const rbF = f.rubro ? rubro(f.rubro) : null;
  const aps = ctx.rec.codigos.map((c, i) => ({ c, i })).filter(({ c }) => c.codigo === cod);
  const tipoTxt = f.tipo === 'muro' ? 'Muro' : f.tipo === 'sin_definir' ? 'Prefijo sin definir' : 'Ítem de detalle';
  abrirHoja(`
    <div class="ficha-cab">
      <div><h2>${esc(cod)}</h2><p>${esc(f.descripcion)}${rbF ? ' · ' + esc(rbF.nombre) : ''}</p></div>
      <button class="cerrar" data-cerrar aria-label="Cerrar">✕</button>
    </div>
    <div class="acciones"><span class="chip">${tipoTxt}</span>${f.tipo === 'sin_definir' ? '<span class="chip aviso-c">a confirmar por oficina técnica</span>' : ''}</div>
    ${f.detalle ? `<img class="detalle-img" src="${DATOS + f.detalle.imagen}" alt="Detalle ${esc(cod)}">` : ''}
    ${f.planilla && f.planilla.length ? `<div class="tabla-caja"><table><thead><tr><th>Ubicación</th><th class="num">Cant.</th><th>Descripción</th></tr></thead>
      <tbody>${f.planilla.map((r) => `<tr><td class="cod">${esc(r.ubicacion)}</td><td class="num">${esc(r.cantidad)}</td><td>${esc(r.descripcion)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="seccion-t">En ${ctx.nv.id} (${aps.length})</div>
    <div class="lista">${aps.map(({ c, i }) => {
      const ub = inferirUbicacion(ctx.rec, ctx.nv.id, c.x + c.w / 2, c.y + c.h / 2);
      return `<button class="fila" data-ap="${i}"><span class="fila-t">${esc(etiquetaEspacio(ctx.nv.id, ub.unidad))}${ub.ambiente ? ' – ' + esc(ub.ambiente) : ''}</span>
        <span class="fila-der"><span class="nota">+ Marcador</span></span></button>`;
    }).join('')}</div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => {
      const c = ctx.rec.codigos[+b.dataset.ap];
      nuevoPin(ctx.nv, ctx.rec, { x: c.x + c.w / 2, y: c.y - c.h * 0.2 }, +b.dataset.ap);
    }));
  });
}

/* ---------- marcadores ---------- */
const opcionesRubro = (actual) => M.rubros.map((r) => `<option value="${r.id}" ${actual === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')
  + (puedeEditar() ? '<option value="__nuevo">+ Agregar rubro…</option>' : '');

function nuevoPin(nv, rec, { x, y }, aparicion) {
  if (!puedeEditar()) { aviso('Tu usuario es de solo lectura'); return; }
  const rb = rubroActivo();
  const ub = inferirUbicacion(rec, nv.id, x, y);
  const c = aparicion !== undefined ? rec.codigos[aparicion] : null;
  const p = {
    id: uid(), n: Math.max(0, ...pines.map((q) => q.n)) + 1, cod: proximoCod(rb.id), proyecto: M.proyecto.id,
    rubro: rb.id, nivel: nv.id, unidad: ub.unidad, ambiente: ub.ambiente, recorte: rec.id, huella: rec.huella, x, y,
    aparicion: c ? `${c.codigo}@${aparicion}` : null, codigo: c ? c.codigo : null,
    estado: 'abierto', prioridad: 'Media', responsable: responsablesRubro(rb)[0] || '', limite: '', texto: '',
    fotos: [], comentarios: [], autor: autor(), creado: hoyISO(), actualizado: hoyISO(),
  };
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
    <div class="campo todo"><span class="lbl">Fotos (evidencia)</span>
      <div class="fotos" id="f-fotos"></div></div>
    <div class="campo todo"><label for="f-txt">Descripción</label><textarea id="f-txt" placeholder="Ej.: falta segunda mano en muro del living, mancha de humedad en cielorraso">${esc(p.texto)}</textarea></div>
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
      ${p.realizadoPor ? `<div class="campo"><span class="lbl">Marcó realizado</span><div class="nota" style="padding-top:10px">${esc(p.realizadoPor)} · ${fechaHora(p.realizadoEn)}</div></div>` : ''}
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
    h.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => {
      estado = b.dataset.e;
      h.querySelectorAll('[data-e]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }));
    const pintarFotos = () => {
      $('#f-fotos', h).innerHTML = p.fotos.map((f, i) => `<figure><img src="${f.src}" alt="Foto ${i + 1}"><figcaption>${fechaHora(f.fecha)}</figcaption>
          <button type="button" class="foto-quitar" data-q="${i}" aria-label="Quitar foto ${i + 1}">✕</button>
          <button type="button" class="foto-marcar" data-m="${i}" aria-label="Marcar foto ${i + 1} con círculos o flechas">✎ Marcar</button></figure>`).join('')
        + `<label class="foto-add camara">📷<br>Sacar foto<input type="file" accept="image/*" capture="environment" id="f-cam"></label>
           <label class="foto-add">＋<br>De galería<input type="file" accept="image/*" multiple id="f-gal"></label>`;
      const agregar = async (e) => {
        for (const file of e.target.files) {
          try { p.fotos.push({ src: await comprimir(file, `${nv.id} ${$('#f-unidad', h).value === COMUN ? COMUN : $('#f-unidad', h).value} · ${autor()}`), fecha: hoyISO(), autor: autor() }); }
          catch (er) { aviso('No se pudo leer la imagen'); }
        }
        pintarFotos();
      };
      $('#f-cam', h).onchange = agregar; $('#f-gal', h).onchange = agregar;
      h.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { p.fotos.splice(+b.dataset.q, 1); pintarFotos(); }));
      h.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => marcarFoto(p.fotos[+b.dataset.m], pintarFotos)));
    };
    pintarFotos();
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
        texto: $('#f-txt', h).value.trim(), actualizado: hoyISO(),
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

/* ---------- informe ---------- */
function vInforme(main, params) {
  const f = params.filtro = { rubro: '', resp: '', nivel: '', espacio: '', alcance: 'pend', ...params.filtro };
  if (!ALCANCES[f.alcance]) f.alcance = 'pend';
  f.estados = ALCANCES[f.alcance].estados;
  const inc = f.incluir = { fotos: true, plano: true, datos: true, historial: false, ...f.incluir };
  const rb = f.rubro ? rubro(f.rubro) : null;
  const [eNv, eU] = f.espacio ? f.espacio.split('|') : [];
  cabecera(M.proyecto.nombre, f.espacio ? `Informe · ${etiquetaEspacio(eNv, eU)}` : rb ? `Informe · ${rb.nombre}` : 'Informe general');
  const base = pines.filter((p) => (!f.rubro || p.rubro === f.rubro) && (!f.espacio || (p.nivel === eNv && espacioDe(p) === eU)));
  const ordenRubro = (p) => M.rubros.findIndex((r) => r.id === p.rubro);
  const resuelto = (p) => p.estado !== 'abierto';
  const lista = base
    .filter((p) => (!f.nivel || f.espacio || p.nivel === f.nivel) && f.estados.includes(p.estado) && (!f.resp || p.responsable === f.resp))
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
    <div class="campos no-imprimir">
      <div class="campo"><label for="r-rb">Rubro</label><select id="r-rb"><option value="">Todos</option>${M.rubros.map((r) => `<option value="${r.id}" ${f.rubro === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-resp">Responsable</label><select id="r-resp"><option value="">Todos</option>${resps.map((x) => `<option ${f.resp === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-nv">Nivel</label><select id="r-nv" ${f.espacio ? 'disabled' : ''}><option value="">Todos</option>${M.niveles.map((n) => `<option ${f.nivel === n.id ? 'selected' : ''}>${n.id}</option>`).join('')}</select></div>
      <div class="campo"><label for="r-esp">Dpto / espacio</label><select id="r-esp"><option value="">Todos</option>${espacios.map((x) => `<option value="${esc(x.k)}" ${f.espacio === x.k ? 'selected' : ''}>${esc(x.t)}</option>`).join('')}</select></div>
      <div class="campo todo"><span class="lbl">Marcadores</span><div class="estados alcance">${Object.entries(ALCANCES).map(([id, a]) => `<button type="button" data-alc="${id}" aria-pressed="${f.alcance === id}">${a.nombre}</button>`).join('')}</div></div>
    </div>
    <div class="campo no-imprimir"><span class="lbl">Qué incluir</span>
      <div class="incluir">${INCLUIR.map((o) => `<button type="button" data-inc="${o.id}" aria-pressed="${!!inc[o.id]}">${o.nombre}</button>`).join('')}</div></div>
    <div class="campos no-imprimir">
      <div class="campo todo"><label for="r-tit">Título</label><input id="r-tit" value="${esc(f.titulo ?? tituloInforme(rb, f))}"></div>
      <div class="campo todo"><label for="r-nota">Nota para el contratista (opcional)</label><textarea id="r-nota" placeholder="Ej.: plazo para resolver, condiciones de acceso, contacto en obra">${esc(f.nota || '')}</textarea></div>
    </div>
    <div class="acciones no-imprimir">
      <button class="btn primario" id="r-pdf" ${lista.length ? '' : 'disabled'}>Guardar PDF</button>
      <button class="btn" id="r-word" ${lista.length ? '' : 'disabled'}>Guardar Word</button>
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
    ${grupos.map((g) => `
      <section class="rep-grupo">
        <h3 class="rep-grupo-t"><span class="cod">${g.nv}</span> · ${esc(g.u || COMUN)}</h3>
        ${f.alcance === 'ambos' ? `<p class="nota num">${resumenGrupo(g)}</p>` : ''}
        ${g.secciones.map((sc) => `${sc.t ? `<h4 class="rep-seccion-t">${sc.t} (${sc.ps.length})</h4>` : ''}
        <div class="rep">${sc.ps.length ? '' : `<p class="nota">${sc.t === 'Pendientes' ? 'No quedan pendientes.' : 'Todavía no hay resueltos.'}</p>`}${sc.ps.map((p, i) => `${cabContratista(p, sc.ps[i - 1], f) ? `<h5 class="rep-contratista">${esc(cabContratista(p, sc.ps[i - 1], f))}</h5>` : ''}
          <article class="rep-item">
            <div class="rep-cab"><h4>${codigoPin(p)} · ${esc(p.texto || 'Sin descripción')}</h4><span class="estado-pill e-${p.estado}">${estadoNombre(p.estado)}</span></div>
            <p class="nota">${esc(lineaUbicacion(p))}${inc.datos ? `<br>${esc(lineaDatos(p))}` : ''}</p>
            ${inc.plano || (inc.fotos && p.fotos.length) ? `<div class="rep-fotos">${inc.plano ? `<canvas data-snip="${p.id}" width="${RECORTE_W}" height="${RECORTE_H}" aria-label="Ubicación en el plano"></canvas>` : ''}${inc.fotos ? p.fotos.map((x) => `<img src="${x.src}" alt="">`).join('') : ''}</div>` : ''}
            ${inc.historial && (p.comentarios || []).length ? `<div class="hilo">${p.comentarios.map((c) => `<div class="msj${c.sistema ? ' sistema' : ''}">${esc(c.texto)}<small>${esc(c.autor)} · ${fechaHora(c.fecha)}</small></div>`).join('')}</div>` : ''}
          </article>`).join('')}</div>`).join('')}
      </section>`).join('') || '<p class="vacio-txt">No hay marcadores con esos filtros.</p>'}
  </div>`;
  const setF = (k, v) => { f[k] = v; render(); };
  $('#r-rb').onchange = (e) => setF('rubro', e.target.value);
  $('#r-resp').onchange = (e) => setF('resp', e.target.value);
  $('#r-nv').onchange = (e) => setF('nivel', e.target.value);
  $('#r-esp').onchange = (e) => setF('espacio', e.target.value);
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
    const cuenta = (id) => base.filter((p) => (!f.nivel || f.espacio || p.nivel === f.nivel) && (!f.resp || p.responsable === f.resp) && ALCANCES[id].estados.includes(p.estado)).length;
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
    $('#r-pdf').disabled = !base.length; $('#r-word').disabled = !base.length;
    $('#r-pdf').onclick = preguntar('r-pdf', informePDF, 'pdf', false);
    $('#r-word').onclick = preguntar('r-word', informeWord, 'docx', false);
    const comp = $('#r-compartir');
    if (comp) { comp.disabled = !base.length; comp.onclick = preguntar('r-compartir', informePDF, 'pdf', true); }
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

/* ---------- informe para compartir: PDF y Word ---------- */
const INCLUIR = [
  { id: 'fotos', nombre: 'Fotos' },
  { id: 'plano', nombre: 'Ubicación en el plano' },
  { id: 'datos', nombre: 'Responsable y fechas' },
  { id: 'historial', nombre: 'Historial' },
];
const ALCANCES = {
  pend: { nombre: 'Solo pendientes', estados: ['abierto'], eyebrow: 'Informe de pendientes', ayuda: 'Lo que falta hacer' },
  res: { nombre: 'Solo resueltos', estados: ['corregido', 'aprobado'], eyebrow: 'Informe de resueltos', ayuda: 'Realizados y verificados' },
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
  + `${p.realizadoPor ? ` · Realizado (marcó ${p.realizadoPor}) el ${fechaCorta(p.realizadoEn)}` : ''}${p.verificadoPor ? ` · Verificó ${p.verificadoPor} el ${fechaCorta(p.verificadoEn)}` : ''}`;
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
          fotos: d.inc.fotos ? await Promise.all(p.fotos.map((x) => aJPEG(x.src, 900).catch(() => null))).then((a) => a.filter(Boolean)) : [],
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
      const celdas = [...(it.plano ? [{ ...it.plano, plano: true }] : []), ...it.fotos];
      if (celdas.length) {
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
      const celdas = [...(it.plano ? [it.plano] : []), ...it.fotos]; // el ambiente en el plano, después las fotos
      if (celdas.length) {
        const w = Math.floor((ancho - 16) / 3);
        for (let i = 0; i < celdas.length; i += 3) {
          hijos.push(new X.Table({ width: { size: 100, type: X.WidthType.PERCENTAGE }, borders: X.TableBorders.NONE, rows: [new X.TableRow({
            children: [0, 1, 2].map((j) => new X.TableCell({ width: { size: 33, type: X.WidthType.PERCENTAGE },
              children: [new X.Paragraph({ children: celdas[i + j] ? [img(celdas[i + j], w)] : [] })] })),
          })] }));
        }
        hijos.push(par('', { after: 60 }));
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
  const tipo = nombre.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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

/* ---------- arranque ---------- */
(async function iniciar() {
  const main = $('#vista');
  main.innerHTML = '<p class="vacio-txt">Cargando planos…</p>';
  try {
    M = await (await fetch(DATOS + 'manifest.json')).json();
  } catch (e) {
    main.innerHTML = '<div class="pagina"><p class="vacio-txt">No se encontró <b>datos/manifest.json</b>. Corré la ingesta con <b>--salida visor/datos</b>.</p></div>';
    return;
  }
  for (const n of M.niveles) n.unidades = n.unidades || [];
  await cargarColores();
  sumarRubros(rubrosPropios());
  await almacen.abrir();
  if (CFG.supabaseUrl && CFG.supabaseKey) {
    try { nube = await iniciarNube(CFG); } catch (e) { console.error(e); aviso('Sin conexión con la nube: trabajás en el teléfono y se sube después'); }
    if (nube === null && document.querySelector('.acceso')) return; // mail no habilitado
  }
  pines = (await almacen.todos()).map(migrar);
  if (nube) {
    for (const p of pines.filter((x) => x.ejemplo)) await almacen.borrarLocal(p.id);
    pines = pines.filter((x) => !x.ejemplo);
    try { await nube.traerRubros(); pines = await nube.traer(); } catch (e) { console.warn(e); }
    nube.vaciarCola();
  } else await sembrarEjemplos();
  ir('edificio');
  asignarCodigos().catch((e) => console.warn('códigos', e));
  setTimeout(() => { if ($('#hoja').hidden) mostrarNovedades(); }, 2600); // cuando termina la animación del logo
})();
