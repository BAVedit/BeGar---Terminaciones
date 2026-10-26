/* Pruebas de dptos: checklist de puesta en marcha por nivel (tablero, luces, AA, cocina, termocalefón, baños…).
   - La lista sale de pruebas.json: la misma para todos los dptos; las áreas comunes (quincho, baños, generador) tienen la suya.
   - Cada ítem se marca ✓ (aprueba), ✕ (no aprueba) o N/A (no aplica). Un No aprueba abre un hilo (dónde, qué pasa, fotos, rubro y responsable)
     que se actualiza con fecha en cada revisión sin borrar lo anterior. Si se quiere, el problema se marca en el plano.
   - Cada toque es una entrada nueva: en la versión compartida, tabla "pruebas" (supabase/5-pruebas.sql), donde las filas
     solo se agregan; sin nube, en el teléfono. El estado de cada ítem es su última entrada.
   Cualquier miembro carga pruebas. No toca terminaciones: solo comparte el plano cuando se marca un problema. */
'use strict';

const NIVEL_COMUNES = 'COM';
const ESTADOS_ITEM_PR = {
  pendiente: { nombre: 'Pendiente', c: 'var(--linea)' },
  aprueba: { nombre: 'Aprueba', c: 'var(--aprobado)' },
  no_aprueba: { nombre: 'No aprueba', c: 'var(--abierto)' },
  no_aplica: { nombre: 'No aplica', c: 'var(--tenue)' },
};
const ESTADOS_UNIDAD_PR = {
  sin: { nombre: 'Sin revisar', c: 'var(--linea)' },
  revision: { nombre: 'En revisión', c: 'var(--proceso)' },
  obs: { nombre: 'Con observaciones', c: 'var(--abierto)' },
  aprobado: { nombre: 'Aprobado', c: 'var(--aprobado)' },
};

let PR = null;            // pruebas.json
let entradasPr = [];      // todas las entradas, del teléfono y de la nube
let pruebasCargadas = false;
let indicePr = new Map(); // "unidad|item" → entradas en orden

/* ---------- checklist ---------- */
const nivelesPr = () => [
  ...M.niveles.filter((n) => (n.unidades || []).length).map((n) => ({ id: n.id, nombre: n.nombre, unidades: n.unidades })),
  { id: NIVEL_COMUNES, nombre: 'Áreas comunes', unidades: PR.comunes.map((c) => c.id) },
];
const nivelPr = (id) => nivelesPr().find((n) => n.id === id);
const comunPr = (u) => PR.comunes.find((c) => c.id === u);
const nombreUnidadPr = (u) => (comunPr(u) ? comunPr(u).nombre : u);
// Tipología del dpto según su planta tipo y su letra (pruebas.json → tipologias). Con 2 baños el sistema "banos"
// se duplica (Baño 1 conserva los ids, Baño 2 les suma -2); los ítems con "tipos" salen solo en esas tipologías
// y "por_tipo" les cambia nombre o texto. Los números de ítem se corren.
function tipologiaDe(u) {
  const nv = M.niveles.find((n) => (n.unidades || []).includes(u));
  const tl = PR.tipologias || {};
  const t = ((tl.por_dpto || {})[nv && nv.tipo] || {})[u.replace(/^\d+/, '')];
  return { id: t, ...((tl.tipos || {})[t] || {}) };
}
const cacheSistemasPr = new Map();
function sistemasDe(u) {
  if (comunPr(u)) return PR.checklists[comunPr(u).checklist] || [];
  if (cacheSistemasPr.has(u)) return cacheSistemasPr.get(u);
  const tp = tipologiaDe(u);
  const nb = tp.banos || 1;
  let n = 0;
  const lista = (PR.checklists.dpto || []).flatMap((s) => {
    const items = s.items.filter((it) => !it.tipos || it.tipos.includes(tp.id))
      .map((it) => ({ ...it, ...((it.por_tipo || {})[tp.id] || {}) }));
    if (s.id !== 'banos' || nb < 2) return [{ ...s, items }];
    return Array.from({ length: nb }, (_, i) => ({ ...s, id: i ? `${s.id}-${i + 1}` : s.id, nombre: `${s.nombre} ${i + 1}`,
      items: items.map((it) => ({ ...it, id: i ? `${it.id}-${i + 1}` : it.id, lugar: `${s.nombre} ${i + 1}` })) }));
  }).filter((s) => s.items.length).map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, n: ++n })) }));
  cacheSistemasPr.set(u, lista);
  return lista;
}
// nombre del ítem fuera de la lista (hilos, marcadores): dice de qué baño es
const nombrePr = (it) => (it.lugar ? `${it.lugar} · ${it.nombre}` : it.nombre);
const itemsDe = (u) => sistemasDe(u).flatMap((s) => s.items.map((it) => ({ ...it, sistema: s, rubro: it.rubro || s.rubro })));
const itemPr = (u, id) => itemsDe(u).find((it) => it.id === id);
const nombreLocal = (id) => ((PR.locales || []).find((l) => l[0] === id) || [id, id])[1];

/* ---------- estado ---------- */
const porFecha = (a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.id || '').localeCompare(b.id || '');
function indexarPr() {
  indicePr = new Map();
  for (const e of [...entradasPr].sort(porFecha)) {
    const k = `${e.unidad}|${e.item}`;
    if (!indicePr.has(k)) indicePr.set(k, []);
    indicePr.get(k).push(e);
  }
}
const entradasItem = (u, it) => indicePr.get(`${u}|${it}`) || [];
const ultimaPr = (u, it) => entradasItem(u, it).at(-1) || null;
/** Primera entrada de la racha actual con el mismo estado: la fecha en que aprobó (o marcó N/A), aunque después se sumen observaciones. */
function desdePr(u, it) {
  const l = entradasItem(u, it);
  let i = l.length - 1;
  while (i > 0 && l[i - 1].estado === l[i].estado && !l[i - 1].hilo === !l[i].hilo) i--;
  return l[i] || null;
}
const estadoItemPr = (u, it) => (ultimaPr(u, it) || { estado: 'pendiente' }).estado;
/** El hilo sigue abierto mientras la última entrada del ítem sea un No aprueba. */
const hiloAbierto = (u, it) => { const e = ultimaPr(u, it); return e && e.estado === 'no_aprueba' ? e.hilo : null; };
const entradasHilo = (hilo) => entradasPr.filter((e) => e.hilo === hilo).sort(porFecha);
const hilosItem = (u, it) => [...new Set(entradasItem(u, it).map((e) => e.hilo).filter(Boolean))];
/** Revisiones de un hilo: cada prueba (✓, ✕ o N/A) cuenta; las observaciones y los "volver a pendiente" no. */
const esRevisionPr = (e) => ['aprueba', 'no_aprueba', 'no_aplica'].includes(e.estado) && !e.obs;
const revisionesHilo = (hilo) => entradasHilo(hilo).filter(esRevisionPr);
const rechazosHilo = (hilo) => revisionesHilo(hilo).filter((e) => e.estado === 'no_aprueba').length;
const vecesTxt = (n) => `${n} ${n === 1 ? 'vez' : 'veces'}`;

function resumenUnidadPr(u) {
  const its = itemsDe(u);
  const r = { total: its.length, ap: 0, no: 0, na: 0, pend: 0 };
  for (const it of its) {
    const e = estadoItemPr(u, it.id);
    if (e === 'aprueba') r.ap++; else if (e === 'no_aprueba') r.no++; else if (e === 'no_aplica') r.na++; else r.pend++;
  }
  r.listos = r.ap + r.na; // N/A cuenta como resuelto
  r.estado = r.total && r.listos === r.total ? 'aprobado' : r.no ? 'obs' : r.listos ? 'revision' : 'sin';
  return r;
}

/* ---------- almacenamiento ---------- */
const almacenPr = {
  local() { try { return JSON.parse(pref('pruebas') || '[]'); } catch (e) { return []; } },
  guardarLocal() {
    // en la versión compartida, las fotos ya subidas no se guardan en el teléfono (se firman al abrir el hilo)
    const liviano = entradasPr.map((e) => (nube && !e._pendiente ? { ...e, fotos: (e.fotos || []).map((f) => (f.path ? { ...f, src: undefined, vence: undefined } : f)) } : e));
    try { pref('pruebas', JSON.stringify(liviano)); } catch (e) { console.warn('pruebas sin guardar en el teléfono', e); }
  },
  async cargar() {
    if (!PR) PR = await fetch('pruebas.json', { cache: 'no-store' }).then((r) => r.json());
    entradasPr = this.local();
    if (nube) {
      try {
        const filas = [];
        for (let desde = 0; ; desde += 1000) { // la base entrega de a 1000 filas
          const { data, error } = await nube.sb.from('pruebas').select('*').eq('proyecto', M.proyecto.id).order('creado').range(desde, desde + 999);
          if (error) throw error;
          filas.push(...data);
          if (data.length < 1000) break;
        }
        const locales = new Map(entradasPr.map((e) => [e.id, e]));
        entradasPr = filas.map((r) => deFilaPr(r, locales.get(r.id)));
        for (const r of filas) locales.delete(r.id);
        for (const l of locales.values()) if (l._pendiente) entradasPr.push(l); // cargadas sin señal
        this.guardarLocal();
        this.subirPendientes();
      } catch (e) {
        console.warn('pruebas: sin conexión, se muestran las del teléfono', e);
        if (/relation|does not exist|schema cache/i.test((e && e.message) || '')) aviso('Falta crear la tabla de pruebas en Supabase (supabase/5-pruebas.sql)');
      }
    }
    indexarPr();
    pruebasCargadas = true;
  },
  agregar(e) {
    if (nube) e._pendiente = true;
    entradasPr.push(e);
    indexarPr();
    this.guardarLocal();
    if (nube) this.subirPendientes().then(() => { if (pila[pila.length - 1].vista === 'pruebas') refrescarSiSePuede(); });
  },
  subiendo: null,
  subirPendientes() {
    if (!nube) return Promise.resolve(true);
    return (this.subiendo ||= (async () => {
      let ok = true;
      for (const e of entradasPr.filter((x) => x._pendiente)) {
        try {
          await subirFotosPr(e);
          const fila = { id: e.id, proyecto: e.proyecto, nivel: e.nivel, unidad: e.unidad, item: e.item, hilo: e.hilo || null, estado: e.estado,
            datos: { ...e, _pendiente: undefined, fotos: (e.fotos || []).map(({ src, vence, ...f }) => f) } };
          // si ya había llegado (se cortó la señal antes de la respuesta), no se repite
          const { error } = await nube.sb.from('pruebas').upsert(fila, { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;
          delete e._pendiente;
        } catch (er) {
          ok = false;
          console.warn('prueba sin subir', er);
          if (er && /relation|does not exist|schema cache/i.test(er.message || '')) { aviso('Falta crear la tabla de pruebas en Supabase (supabase/5-pruebas.sql)'); break; }
        }
      }
      this.guardarLocal();
      this.subiendo = null;
      return ok;
    })());
  },
};

async function subirFotosPr(e) {
  for (const f of e.fotos || []) {
    if (f.path || !f.src || !f.src.startsWith('data:')) continue;
    const blob = await (await fetch(f.src)).blob();
    const path = `${e.proyecto}/pruebas/${e.unidad}/${f.id || (f.id = uid())}.jpg`;
    const { error } = await nube.sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error && !/exists/i.test(error.message)) throw error;
    f.path = path;
  }
}
async function firmarFotosPr(lista) {
  if (!nube) return;
  const faltan = lista.flatMap((e) => (e.fotos || []).filter((f) => f.path && (!f.src || (f.vence && f.vence < Date.now()))));
  if (!faltan.length) return;
  const { data } = await nube.sb.storage.from('fotos').createSignedUrls(faltan.map((f) => f.path), 7 * 864e2);
  (data || []).forEach((d, j) => { if (d.signedUrl) { faltan[j].src = d.signedUrl; faltan[j].vence = Date.now() + 6 * 864e5; } });
}
function deFilaPr(r, local) {
  const e = { ...r.datos, id: r.id, creadoPor: r.creado_por, subida: r.creado };
  const ya = new Map(((local && local.fotos) || []).filter((f) => f.src).map((f) => [f.path || f.id, f]));
  e.fotos = (e.fotos || []).map((f) => { const l = ya.get(f.path) || ya.get(f.id); return l ? { ...f, src: l.src, vence: l.vence } : f; });
  return e;
}

/** En vivo: lo que se prueba en otro teléfono aparece sin recargar. */
function escucharPruebas() {
  if (!nube || escucharPruebas.hecho) return;
  escucharPruebas.hecho = true;
  nube.sb.channel('pruebas-' + M.proyecto.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pruebas', filter: `proyecto=eq.${M.proyecto.id}` }, (ev) => {
      const r = ev.new; if (!r || !r.id || !r.datos) return;
      const i = entradasPr.findIndex((x) => x.id === r.id);
      if (i >= 0) { if (!entradasPr[i]._pendiente) entradasPr[i] = deFilaPr(r, entradasPr[i]); }
      else entradasPr.push(deFilaPr(r));
      indexarPr();
      almacenPr.guardarLocal();
      if (pila[pila.length - 1].vista === 'pruebas') refrescarSiSePuede();
    })
    .subscribe();
  addEventListener('online', () => almacenPr.subirPendientes());
}

function nuevaEntradaPr(nv, u, item, datos) {
  return { id: uid(), proyecto: M.proyecto.id, nivel: nv, unidad: u, item, hilo: null, estado: 'aprueba', locales: [], lugar: '', texto: '',
    fotos: [], rubro: '', responsable: '', autor: autor(), fecha: hoyISO(), ...datos };
}

/* ---------- vista: checklist del nivel ---------- */
async function vPruebas(main, params) {
  cabecera('Pruebas de dptos', 'Pruebas');
  if (!pruebasCargadas) {
    main.innerHTML = '<p class="vacio-txt">Cargando pruebas…</p>';
    try { await almacenPr.cargar(); } catch (e) { main.innerHTML = '<div class="pagina"><p class="vacio-txt">No se pudo abrir la checklist (pruebas.json).</p></div>'; return; }
    escucharPruebas();
    if (pila[pila.length - 1].vista !== 'pruebas') return; // se fue a otra pantalla mientras cargaba
  }
  const niveles = nivelesPr();
  const nv = nivelPr(params.nivel || pref('pruebas-nivel')) || niveles[0];
  const u = nv.unidades.includes(params.unidad) ? params.unidad : nv.unidades.includes(pref('pruebas-unidad')) ? pref('pruebas-unidad') : nv.unidades[0];
  pref('pruebas-nivel', nv.id); pref('pruebas-unidad', u);
  Object.assign(params, { nivel: nv.id, unidad: u });
  const filtro = params.filtro || 'todos';
  cabecera(`Pruebas · ${nv.id === NIVEL_COMUNES ? 'Áreas comunes' : nv.id + ' · ' + nv.nombre}`, nombreUnidadPr(u));
  const r = resumenUnidadPr(u);
  const aprobadas = nv.unidades.filter((x) => resumenUnidadPr(x).estado === 'aprobado').length;
  const pasa = (it) => { const e = estadoItemPr(u, it.id); return filtro === 'todos' || (filtro === 'pend' ? e === 'pendiente' : e === 'no_aprueba'); };
  const grupos = sistemasDe(u).map((s) => ({ s, its: s.items.map((it) => ({ ...it, rubro: it.rubro || s.rubro })) }))
    .map((g) => ({ ...g, ap: g.its.filter((it) => ['aprueba', 'no_aplica'].includes(estadoItemPr(u, it.id))).length, ver: g.its.filter(pasa) })).filter((g) => g.ver.length);
  main.innerHTML = `
  <div class="pagina pr">
    <div class="selector-nivel"><div class="niveles-scroll">${niveles.map((n) => `<button class="nivel-btn" data-nv="${n.id}" aria-current="${n.id === nv.id}">${n.id === NIVEL_COMUNES ? 'Comunes' : n.id}</button>`).join('')}</div></div>
    <p class="nota">${nv.id === NIVEL_COMUNES ? 'Áreas comunes' : esc(nv.nombre)}: <b>${aprobadas} de ${nv.unidades.length}</b> ${nv.id === NIVEL_COMUNES ? 'espacios' : 'dptos'} aprobados</p>
    <div class="pr-unidades" role="tablist">${nv.unidades.map((x) => {
      const ru = resumenUnidadPr(x);
      return `<button role="tab" data-u="${esc(x)}" aria-selected="${x === u}" style="--c:${ESTADOS_UNIDAD_PR[ru.estado].c}" title="${ESTADOS_UNIDAD_PR[ru.estado].nombre}">
        <b>${esc(nombreUnidadPr(x))}</b><small class="num">${ru.listos}/${ru.total}${ru.no ? ` · <span class="pr-no-txt">${ru.no} ✕</span>` : ''}</small></button>`;
    }).join('')}</div>
    <div class="pr-estado-u" style="--c:${ESTADOS_UNIDAD_PR[r.estado].c}">${esc(nombreUnidadPr(u))}: <b>${ESTADOS_UNIDAD_PR[r.estado].nombre}</b>${tipologiaDe(u).nombre ? ` · ${esc(tipologiaDe(u).nombre)}` : ''}</div>
    <p class="nota">Lista ${esc(PR.version || 'sin versión')}</p>
    <div class="kpis">
      <div class="kpi ok"><b>${r.ap}</b><span>aprueban${r.na ? ` · ${r.na} N/A` : ''}</span></div>
      <div class="kpi alerta"><b>${r.no}</b><span>no aprueban</span></div>
      <div class="kpi"><b>${r.pend}</b><span>pendientes</span></div>
    </div>
    <nav class="pestanas" role="tablist">
      ${[['todos', `Todos (${r.total})`], ['pend', `Pendientes (${r.pend})`], ['no', `No aprueban (${r.no})`]].map(([id, n]) => `<button role="tab" data-f="${id}" aria-selected="${filtro === id}">${n}</button>`).join('')}
    </nav>
    ${grupos.map((g) => `<div class="grupo-rubro">
      <div class="grupo-cab"><b>${esc(g.s.nombre)}</b><span class="nota num">${g.ap}/${g.its.length}</span></div>
      <div class="lista">${g.ver.map((it) => filaItemPr(nv.id, u, it)).join('')}</div>
    </div>`).join('') || `<p class="vacio-txt">${filtro === 'no' ? 'Nada observado en ' : 'No quedan pendientes en '}${esc(nombreUnidadPr(u))}.</p>`}
    <p class="nota">✓ y N/A son un toque. ✕ abre un hilo con dónde, qué pasa, fotos y responsable; cada revisión nueva se suma al hilo con su fecha.</p>
  </div>`;
  const scroll = main.querySelector('.niveles-scroll'), act = scroll.querySelector('[aria-current="true"]');
  if (act) scroll.scrollLeft = act.offsetLeft - scroll.offsetLeft - (scroll.clientWidth - act.offsetWidth) / 2;
  const tabs = main.querySelector('.pr-unidades'), tabAct = tabs.querySelector('[aria-selected="true"]');
  if (tabAct) tabs.scrollLeft = tabAct.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - tabAct.offsetWidth) / 2;
  main.querySelectorAll('[data-nv]').forEach((b) => (b.onclick = () => ir('pruebas', { nivel: b.dataset.nv, filtro }, true)));
  main.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => ir('pruebas', { nivel: nv.id, unidad: b.dataset.u, filtro }, true)));
  main.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => ir('pruebas', { ...params, filtro: b.dataset.f }, true)));
  main.querySelectorAll('[data-si]').forEach((b) => (b.onclick = () => tocarResuelto(nv.id, u, b.dataset.si, 'aprueba')));
  main.querySelectorAll('[data-na]').forEach((b) => (b.onclick = () => tocarResuelto(nv.id, u, b.dataset.na, 'no_aplica')));
  main.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => tocarNoAprueba(nv.id, u, b.dataset.no)));
  main.querySelectorAll('[data-hist]').forEach((b) => (b.onclick = () => verHistorialPr(nv.id, u, b.dataset.hist)));
  main.querySelectorAll('[data-obs]').forEach((b) => (b.onclick = () => hojaResueltoPr(nv.id, u, b.dataset.obs)));
}

function filaItemPr(nv, u, it) {
  const e = estadoItemPr(u, it.id);
  const ult = ultimaPr(u, it.id);
  const hilo = hiloAbierto(u, it.id);
  const nHilos = hilosItem(u, it.id).length;
  const enHilo = hilo ? entradasHilo(hilo) : [];
  const primera = enHilo[0];
  const lugar = primera ? [...(primera.locales || []), primera.lugar].filter(Boolean).join(', ') : '';
  return `<div class="fila pr-item pr-${e}">
    <span class="fila-t"><span class="pr-n num">${it.n}</span>${esc(it.nombre)}</span>
    <span class="fila-s"><span>${esc(it.como || '')}</span></span>
    <span class="pr-botones">
      <button type="button" class="pr-si" data-si="${it.id}" aria-pressed="${e === 'aprueba'}" aria-label="Aprueba" title="Aprueba">✓</button>
      <button type="button" class="pr-no" data-no="${it.id}" aria-pressed="${e === 'no_aprueba'}" aria-label="No aprueba" title="No aprueba">✕</button>
      <button type="button" class="pr-na" data-na="${it.id}" aria-pressed="${e === 'no_aplica'}" aria-label="No aplica" title="No aplica">N/A</button>
    </span>
    ${hilo ? `<button type="button" class="pr-hilo" data-no="${it.id}">
        <b>Hilo abierto${lugar ? ' · ' + esc(lugar) : ''} · rechazado ${vecesTxt(rechazosHilo(hilo))}</b>
        <span>${esc((ult.texto || primera.texto || 'Sin descripción').slice(0, 110))}</span>
        <small>${enHilo.length} ${enHilo.length === 1 ? 'entrada' : 'entradas'} · última ${fechaHora(ult.fecha)} · ${esc(ult.autor)}${(primera.responsable || ult.responsable) ? ' · ' + esc(ult.responsable || primera.responsable) : ''}${enHilo.some((x) => x._pendiente) ? ' · sin subir' : ''}</small>
      </button>` : ult && e !== 'pendiente' ? `<span class="fila-s pr-meta"><span>${e === 'aprueba' ? (ult.hilo ? 'Cerró' : 'Aprobó') : e === 'no_aplica' ? 'Marcó N/A' : 'Marcó'} ${esc(desdePr(u, it.id).autor)} el ${fechaHora(desdePr(u, it.id).fecha)}${ult.hilo ? ` · ${e === 'aprueba' ? 'aprobó' : 'cerró'} en la ${revisionesHilo(ult.hilo).length}ª revisión (rechazado ${vecesTxt(rechazosHilo(ult.hilo))})` : ''}${ult._pendiente ? ' · sin subir' : ''}</span>
        <button type="button" class="btn-txt" data-obs="${it.id}">${ult.texto ? 'Editar observación' : '＋ Observación'}</button>
        ${nHilos ? `<button type="button" class="btn-txt" data-hist="${it.id}">Historial (${nHilos} ${nHilos === 1 ? 'hilo' : 'hilos'})</button>` : ''}</span>
        ${ult.texto ? `<span class="fila-s pr-obs"><span>${esc(ult.texto)}${ult.texto && ult !== desdePr(u, it.id) ? ` <small>· ${esc(ult.autor)}, ${fechaHora(ult.fecha)}</small>` : ''}</span></span>` : ''}` : ''}
  </div>`;
}

/* ---------- acciones ---------- */
/** ✓ o N/A: un toque. Con un hilo abierto, se cierra desde el hilo; tocar de nuevo ofrece volver a pendiente. */
function tocarResuelto(nv, u, itemId, estado) {
  const it = itemPr(u, itemId);
  const hilo = hiloAbierto(u, itemId);
  if (hilo) return abrirHiloPr(nv, u, itemId, hilo, estado);
  const ult = ultimaPr(u, itemId);
  if (ult && ult.estado === estado) return hojaResueltoPr(nv, u, itemId);
  almacenPr.agregar(nuevaEntradaPr(nv, u, itemId, { estado }));
  render();
}

/** Ítem aprobado o N/A: observación (queda como entrada nueva, con su fecha) o volver a pendiente. */
function hojaResueltoPr(nv, u, itemId) {
  const it = itemPr(u, itemId);
  const ult = ultimaPr(u, itemId), desde = desdePr(u, itemId);
  const quien = ult.estado === 'aprueba' ? (ult.hilo ? 'cerró' : 'aprobó') : 'marcó N/A';
  abrirHoja(`<div class="pr-hoja"><div class="ficha-cab"><div><h2 class="h-hoja">${esc(nombrePr(it))}</h2><p>${esc(nombreUnidadPr(u))} · ${quien} ${esc(desde.autor)} el ${fechaHora(desde.fecha)}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="campo todo"><label for="pr-obs">Comentario / observación</label><textarea id="pr-obs" placeholder="Ej.: aprueba, pero el tomacorriente del dorm. 2 quedó flojo">${esc(ult.texto || '')}</textarea></div>
    <div class="acciones"><button class="btn primario ancho" id="pr-obs-ok">Guardar observación</button></div>
    <p class="nota">Si lo marcaste por error, volvé a dejarlo pendiente. Queda anotado en el historial.</p>
    <div class="acciones"><button class="btn ancho" id="pr-desmarcar">Volver a pendiente</button></div></div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    $('#pr-obs-ok', h).onclick = () => {
      const texto = $('#pr-obs', h).value.trim();
      if (texto === (ult.texto || '')) { cerrarHoja(); return; }
      almacenPr.agregar(nuevaEntradaPr(nv, u, itemId, { estado: ult.estado, hilo: ult.hilo || null, texto, obs: true }));
      cerrarHoja(); render();
    };
    $('#pr-desmarcar', h).onclick = () => { almacenPr.agregar(nuevaEntradaPr(nv, u, itemId, { estado: 'pendiente' })); cerrarHoja(); render(); };
  });
}

function tocarNoAprueba(nv, u, itemId) {
  const hilo = hiloAbierto(u, itemId);
  if (hilo) return abrirHiloPr(nv, u, itemId, hilo, 'no_aprueba');
  formNoAprueba(nv, u, itemId);
}

const opcionesRubroPr = (act) => M.rubros.map((r) => `<option value="${r.id}" ${act === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('');
const responsablesPr = (rbId, actual) => [...new Set([...responsablesRubro(rubro(rbId)), ...M.rubros.flatMap(responsablesRubro), actual].filter(Boolean))];
const nivelesConPlano = () => M.niveles.filter((n) => recortesNivel(n.id).length);

/** Primer No aprueba de un ítem: abre el hilo. */
function formNoAprueba(nv, u, itemId) {
  const it = itemPr(u, itemId);
  const e = nuevaEntradaPr(nv, u, itemId, { estado: 'no_aprueba', rubro: it.rubro, responsable: responsablesRubro(rubro(it.rubro))[0] || '' });
  e.hilo = e.id;
  const esComun = nv === NIVEL_COMUNES;
  abrirHoja(`<div class="pr-hoja">
    <div class="ficha-cab"><div><h2 class="h-hoja">No aprueba</h2><p><span class="cod">${esc(nombreUnidadPr(u))}</span> · ${it.n}. ${esc(nombrePr(it))}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    ${esComun ? '' : `<div class="campo todo"><span class="lbl">Dónde</span><div class="incluir" id="pr-locales">${PR.locales.map(([id, n]) => `<button type="button" data-loc="${id}" aria-pressed="false" title="${esc(n)}">${id}</button>`).join('')}</div>
      <p class="nota" id="pr-locales-nom"></p></div>`}
    <div class="campo todo"><label for="pr-lugar">${esComun ? 'Dónde' : 'Detalle del lugar (opcional)'}</label><input id="pr-lugar" placeholder="${esComun ? 'Ej.: mesada de la parrilla, equipo 2' : 'Ej.: canilla de la ducha, ventana del balcón'}"></div>
    <div class="campo todo"><label for="pr-txt">Qué pasa</label><textarea id="pr-txt" placeholder="Ej.: el inodoro queda corriendo después de descargar"></textarea></div>
    <div class="campo todo"><span class="lbl">Fotos</span><div class="fotos" id="pr-fotos"></div></div>
    <div class="campos">
      <div class="campo"><label for="pr-rubro">Con quién verlo: rubro</label><select id="pr-rubro">${opcionesRubroPr(e.rubro)}</select></div>
      <div class="campo"><label for="pr-resp">Responsable</label><input id="pr-resp" list="pr-resp-l" value="${esc(e.responsable)}" placeholder="Contratista o persona"><datalist id="pr-resp-l"></datalist></div>
    </div>
    <div class="acciones"><button class="btn primario ancho" id="pr-ok">Guardar</button>
      ${puedeEditar() && nivelesConPlano().length ? '<button class="btn" id="pr-ok-plano">Guardar y marcar en el plano</button>' : ''}</div>
  </div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-loc]').forEach((b) => (b.onclick = () => {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
      $('#pr-locales-nom', h).textContent = [...h.querySelectorAll('[data-loc][aria-pressed="true"]')].map((x) => nombreLocal(x.dataset.loc)).join(', ');
    }));
    const llenarResp = () => { $('#pr-resp-l', h).innerHTML = responsablesPr($('#pr-rubro', h).value).map((x) => `<option value="${esc(x)}">`).join(''); };
    llenarResp();
    $('#pr-rubro', h).onchange = () => { llenarResp(); const r = responsablesRubro(rubro($('#pr-rubro', h).value))[0]; $('#pr-resp', h).value = r || ''; };
    fotosEditables($('#pr-fotos', h), e.fotos, () => `${nombreUnidadPr(u)} · ${nombrePr(it)}`);
    const guardar = (plano) => () => {
      Object.assign(e, {
        locales: [...h.querySelectorAll('[data-loc][aria-pressed="true"]')].map((x) => x.dataset.loc),
        lugar: $('#pr-lugar', h).value.trim(), texto: $('#pr-txt', h).value.trim(),
        rubro: $('#pr-rubro', h).value, responsable: $('#pr-resp', h).value.trim(), fecha: hoyISO(),
      });
      if (!e.texto && !e.fotos.length) { aviso('Contá qué pasa o sacale una foto'); return; }
      almacenPr.agregar(e);
      cerrarHoja();
      aviso(e._pendiente && !navigator.onLine ? 'Guardado en el teléfono: se sube cuando haya señal' : 'Hilo abierto');
      if (plano) marcarEnPlanoPr(nv, u, it, e); else render();
    };
    $('#pr-ok', h).onclick = guardar(false);
    const bp = $('#pr-ok-plano', h); if (bp) bp.onclick = guardar(true);
  });
}

/** Hilo de un No aprueba: historia con fecha y una actualización nueva (sigue sin aprobar o aprueba). */
async function abrirHiloPr(nv, u, itemId, hilo, preset = 'no_aprueba') {
  const it = itemPr(u, itemId) || { id: itemId, nombre: itemId, n: '' };
  const lista = entradasHilo(hilo);
  const abierto = hiloAbierto(u, itemId) === hilo;
  const primera = lista[0] || {};
  const ult = lista.at(-1) || primera;
  const pinesHilo = pines.filter((p) => p.prueba === hilo && !p.borrado);
  const fotos = [];
  const pintar = () => abrirHoja(`<div class="pr-hoja">
    <div class="ficha-cab"><div><h2 class="h-hoja">${esc(nombrePr(it))}</h2>
      <p><span class="cod">${esc(nombreUnidadPr(u))}</span> · ítem ${it.n} · ${abierto ? 'hilo abierto' : `cerrado el ${fechaHora((revisionesHilo(hilo).at(-1) || ult).fecha)}, en la ${revisionesHilo(hilo).length}ª revisión`}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="pr-datos">
      ${[...(primera.locales || []).map(nombreLocal), primera.lugar].filter(Boolean).length ? `<span>Dónde: <b>${esc([...(primera.locales || []).map(nombreLocal), primera.lugar].filter(Boolean).join(', '))}</b></span>` : ''}
      <span>Con quién verlo: <b>${esc((rubro(ult.rubro || primera.rubro) || {}).nombre || 'sin rubro')}${(ult.responsable || primera.responsable) ? ' · ' + esc(ult.responsable || primera.responsable) : ''}</b></span>
    </div>
    ${pinesHilo.length ? `<div class="acciones">${pinesHilo.map((p) => `<button class="btn" data-pin="${p.id}">Ver en el plano · ${esc(codigoPin(p))}</button>`).join('')}</div>` : ''}
    <div class="seccion-t">Historial (${lista.length})</div>
    <ol class="pr-linea">${lista.map((x, i) => `<li class="pr-${x.estado}">
      <div class="pr-linea-cab"><span class="estado-pill" style="--c:${ESTADOS_ITEM_PR[x.estado].c}">${x.obs ? 'Observación' : x.estado === 'pendiente' ? 'Pendiente' : `${lista.slice(0, i + 1).filter(esRevisionPr).length}ª revisión · ${x.estado === 'aprueba' ? 'Aprueba' : x.estado === 'no_aplica' ? 'No aplica' : 'No aprueba'}`}</span>
        <small>${fechaHora(x.fecha)} · ${esc(x.autor)}${x._pendiente ? ' · sin subir' : ''}</small></div>
      ${x.texto ? `<p>${esc(x.texto)}</p>` : ''}
      ${i > 0 && x.responsable && x.responsable !== lista[i - 1].responsable ? `<p class="nota">Responsable: ${esc(x.responsable)}</p>` : ''}
      ${(x.fotos || []).length ? `<div class="fotos">${x.fotos.map((f) => fotoMini(f, nombrePr(it))).join('')}</div>` : ''}
    </li>`).join('')}</ol>
    ${abierto ? `<div class="seccion-t">Nueva revisión (${revisionesHilo(hilo).length + 1}ª) · rechazado ${vecesTxt(rechazosHilo(hilo))} hasta ahora</div>
      <div class="estados alcance pr-elige" id="pr-est">
        <button type="button" data-est="no_aprueba" aria-pressed="${preset === 'no_aprueba'}">✕ Sigue sin aprobar</button>
        <button type="button" data-est="aprueba" aria-pressed="${preset === 'aprueba'}">✓ Aprueba</button>
        <button type="button" data-est="no_aplica" aria-pressed="${preset === 'no_aplica'}">N/A</button></div>
      <div class="campo todo"><label for="pr-txt">Qué se vio</label><textarea id="pr-txt" placeholder="Ej.: cambiaron el flotante, sigue corriendo de a ratos"></textarea></div>
      <div class="campo todo"><span class="lbl">Fotos</span><div class="fotos" id="pr-fotos"></div></div>
      <div class="campo todo"><label for="pr-resp">Responsable</label><input id="pr-resp" list="pr-resp-l" value="${esc(ult.responsable || primera.responsable || '')}"><datalist id="pr-resp-l">${responsablesPr(ult.rubro || primera.rubro).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
      <div class="acciones"><button class="btn primario ancho" id="pr-ok">Guardar revisión</button>
        ${puedeEditar() && nivelesConPlano().length ? '<button class="btn" id="pr-plano">Marcar en el plano</button>' : ''}</div>` : ''}
  </div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-foto]').forEach((b) => (b.onclick = () => verFoto(b.dataset.foto)));
    h.querySelectorAll('[data-pin]').forEach((b) => (b.onclick = () => {
      const p = pines.find((x) => x.id === b.dataset.pin);
      cerrarHoja(); ir('visor', { nivel: p.nivel, unidad: p.unidad, capa: p.recorte, abrirPin: p.id });
    }));
    if (!abierto) return;
    let est = preset;
    h.querySelectorAll('[data-est]').forEach((b) => (b.onclick = () => { est = b.dataset.est; h.querySelectorAll('[data-est]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
    fotosEditables($('#pr-fotos', h), fotos, () => `${nombreUnidadPr(u)} · ${nombrePr(it)}`);
    $('#pr-ok', h).onclick = () => {
      const texto = $('#pr-txt', h).value.trim();
      if (est === 'no_aprueba' && !texto && !fotos.length) { aviso('Contá qué se vio o sacale una foto'); return; }
      const e = nuevaEntradaPr(nv, u, itemId, { estado: est, hilo, texto, fotos, locales: primera.locales || [], lugar: primera.lugar || '',
        rubro: ult.rubro || primera.rubro || '', responsable: $('#pr-resp', h).value.trim() });
      almacenPr.agregar(e);
      cerrarHoja();
      aviso(est === 'aprueba' ? 'Aprobado: el hilo queda cerrado' : est === 'no_aplica' ? 'No aplica: el hilo queda cerrado' : 'Revisión guardada en el hilo');
      render();
    };
    const bp = $('#pr-plano', h); if (bp) bp.onclick = () => { cerrarHoja(); marcarEnPlanoPr(nv, u, it, ult.texto ? ult : primera); };
  });
  pintar();
  // las fotos de la nube se firman después de mostrar el hilo
  if (nube && lista.some((x) => (x.fotos || []).some((f) => f.path && !f.src))) {
    try { await firmarFotosPr(lista); almacenPr.guardarLocal(); if (!$('#hoja').hidden && $('.pr-hoja') && !$('#pr-txt')?.value && !fotos.length) pintar(); } catch (er) { /* sin señal: quedan sin imagen */ }
  }
}

/** Todos los hilos del ítem (abiertos y cerrados), para ver por qué falló antes. */
function verHistorialPr(nv, u, itemId) {
  const it = itemPr(u, itemId);
  const hilos = hilosItem(u, itemId).map((h) => ({ h, es: entradasHilo(h) })).reverse();
  abrirHoja(`<div class="pr-hoja"><div class="ficha-cab"><div><h2 class="h-hoja">${esc(nombrePr(it))}</h2><p>${esc(nombreUnidadPr(u))} · ${hilos.length} ${hilos.length === 1 ? 'hilo' : 'hilos'}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="lista">${hilos.map(({ h, es }) => `<button class="fila" data-h="${h}"><span class="fila-t">${fechaCorta(es[0].fecha)}: ${esc((es[0].texto || 'Sin descripción').slice(0, 80))}</span>
      <span class="fila-der"><span class="estado-pill" style="--c:${ESTADOS_ITEM_PR[es.at(-1).estado].c}">${es.at(-1).estado === 'no_aprueba' ? 'Abierto' : 'Cerrado'}</span></span>
      <span class="fila-s"><span>${revisionesHilo(h).length} revisiones · rechazado ${vecesTxt(rechazosHilo(h))}${es.at(-1).estado === 'no_aprueba' ? '' : ` · cerrado ${fechaCorta((revisionesHilo(h).at(-1) || es.at(-1)).fecha)}`}</span><span>${esc(es[0].responsable || '')}</span></span></button>`).join('')}</div></div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => abrirHiloPr(nv, u, itemId, b.dataset.h)));
  });
}

/** Lleva al plano para dejar un marcador del problema, con el texto, el rubro y el responsable ya puestos. */
function marcarEnPlanoPr(nv, u, it, e) {
  const conPlano = nivelesConPlano();
  const seguir = (nivelId) => ir('visor', { nivel: nivelId, unidad: nv === NIVEL_COMUNES ? COMUN : u,
    prueba: { hilo: e.hilo, rubro: e.rubro, responsable: e.responsable, texto: `Prueba ${it.n}. ${nombrePr(it)}: ${e.texto || 'no aprueba'}` } });
  if (nv !== NIVEL_COMUNES && conPlano.some((n) => n.id === nv)) return seguir(nv);
  abrirHoja(`<div class="pr-hoja"><div class="ficha-cab"><div><h2 class="h-hoja">¿En qué plano?</h2><p>${esc(nombreUnidadPr(u))}</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="lista">${conPlano.map((n) => `<button class="fila" data-nvp="${n.id}"><span class="fila-t">${n.id} · ${esc(n.nombre)}</span></button>`).join('')}</div></div>`, (h) => {
    $('[data-cerrar]', h).onclick = () => { cerrarHoja(); render(); };
    h.querySelectorAll('[data-nvp]').forEach((b) => (b.onclick = () => { cerrarHoja(); seguir(b.dataset.nvp); }));
  });
}
