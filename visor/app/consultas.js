/* Consultas sobre el manifest: rubros, colores y códigos de marcador, recortes de cada nivel, dpto y ambiente de un punto. */
'use strict';
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
