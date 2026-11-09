/* Checklist de Jose: planillas de inspección por dpto, aparte de los marcadores sobre el plano.
   Se entra con el ícono de la barra (o desde el inicio): rubros → caja de dptos → planilla del dpto.
   Cada ítem se marca ✓ (check), ✗ (no check) o N/A; el ✗ lleva observación, ambientes y fotos para solucionarlo.
   Los ítems no se mueven al marcarlos: la planilla queda entera para el control final.
   Solo verifican el administrador y quienes él habilite por rubro ("Quién verifica"); el resto mira.
   Para sumar otra planilla de Jose (otro rubro), agregarla a PLANILLAS_JOSE con sus ítems.
   En la versión compartida se guarda en la tabla "checklists" (supabase/8-checklist-jose.sql); sin nube, en el teléfono. */
'use strict';

const AMBIENTES_JOSE = [
  { id: 'd1', nombre: 'Dormitorio 1', corto: 'Dorm. 1', pdf: 'Dorm. 1' },
  { id: 'bs', nombre: 'Baño en suite', corto: 'Baño suite', pdf: 'Baño en suite' },
  { id: 'd2', nombre: 'Dormitorio 2', corto: 'Dorm. 2', pdf: 'Dorm. 2' },
  { id: 'b1', nombre: 'Baño 1', corto: 'Baño 1', pdf: 'Baño 1' },
  { id: 'l', nombre: 'L - Lavadero', corto: 'Lavadero', pdf: 'L - Lavad.' },
  { id: 'h', nombre: 'H - Acceso', corto: 'Acceso', pdf: 'H - Acceso' },
  { id: 'sc', nombre: 'SC - Estar-Comedor', corto: 'Estar-Com.', pdf: 'SC - Estar Comedor' },
  { id: 'c', nombre: 'C - Cocina', corto: 'Cocina', pdf: 'C - Cocina' },
  { id: 'b', nombre: 'B - Balcón-Terraza', corto: 'Balcón', pdf: 'B - Balcón Terraza' },
];
const PLANILLAS_JOSE = [
  {
    id: 'aluminio',
    nombre: 'Carpintería de aluminio',
    detalle: 'Aberturas de aluminio',
    sinAmbientes: ['h'], // en la planilla, Acceso va con "–" en todos los ítems
    items: [
      'Llavea',
      'Cierra sin llavear (para hojas batientes)',
      'Marco: sin daños ni defectos visibles',
      'Contramarco: sin daños ni defectos visibles',
      'Hoja: sin daños ni defectos visibles',
      'Encuadre marco y contramarco',
      'Encuadre hoja y marco',
      'Vidrios: sin rayones ni defectos visibles',
      'Siliconado contramarco/muro: continuo y sin defectos visibles',
      'Siliconado contramarco: continuo y sin defectos visibles',
      'Siliconado marco: continuo y sin defectos visibles',
      'Herrajes: sin daños ni defectos visibles',
      'Limpieza',
      'Hojas no vibran',
      'Felpas o gomas',
      'Marcos cuentan con guías de desagüe',
      'Tornillos cuentan con tapa tornillos',
      'Desagües de marcos ok',
      'Hojas sin ruidos',
      'Siliconado exterior prolijo, continuo y sin defectos',
      'Prueba de filtración de agua (manguera): sin ingreso de agua',
      'Trabas / cierres de seguridad funcionando',
    ],
  },
];
/* Lo que se marca en cada ítem */
const MARCAS_JOSE = [
  { id: 'si', simbolo: '✓', nombre: 'Check', c: 'var(--aprobado)' },
  { id: 'no', simbolo: '✗', nombre: 'No check', c: 'var(--abierto)' },
  { id: 'na', simbolo: 'N/A', nombre: 'No aplica', c: 'var(--tenue)' },
];
const marcaJose = (id) => MARCAS_JOSE.find((m) => m.id === id);

let checklists = [];
let checklistsCargadas = false;
let permisosJose = null; // planillas que este usuario puede verificar (columna miembros.checklists)
const planillaJose = (id) => PLANILLAS_JOSE.find((p) => p.id === id);
const ambientesDe = (pl) => AMBIENTES_JOSE.filter((a) => !(pl.sinAmbientes || []).includes(a.id));
const idChecklist = (nv, u, pl) => `${M.proyecto.id}-${nv}-${slug(u)}-${pl}`;
const checklistDe = (nv, u, pl) => checklists.find((c) => c.id === idChecklist(nv, u, pl));
const nivelesConDptos = () => nivelesEdificio().filter((n) => (n.unidades || []).length);
const dptosEdificio = () => nivelesConDptos().flatMap((n) => n.unidades.map((u) => ({ nv: n.id, u })));
/** Sin nube (todo en el teléfono) se puede todo; con nube, el admin y los habilitados para esa planilla. */
const puedeVerificar = (pl) => !nube || esAdmin() || (permisosJose || []).includes(pl);

/* ---------- cálculos ---------- */
const marcaDe = (c, i) => ((c && c.items[i]) || {}).marca || '';
function resumenChecklist(c, pl) {
  const r = { total: pl.items.length, si: 0, no: 0, na: 0, sin: 0 };
  pl.items.forEach((_, i) => { const m = marcaDe(c, i); if (m) r[m]++; else r.sin++; });
  r.hechos = r.total - r.sin;
  r.pct = Math.round((100 * r.hechos) / r.total);
  return r;
}
const textoResumen = (r) => (r.hechos ? `${r.hechos} de ${r.total} controlados · ✓ ${r.si} · ✗ ${r.no} · N/A ${r.na}` : 'Sin empezar');
const fotosChecklist = (c) => Object.values((c && c.items) || {}).flatMap((it) => it.fotos || []);

/** Dos copias de la misma checklist (este teléfono y la nube): cada ítem queda con su cambio más nuevo. */
function unirChecklists(a, b) {
  const items = {};
  for (const k of new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})])) {
    const x = (a.items || {})[k], y = (b.items || {})[k];
    items[k] = !x ? y : !y ? x : (x.t || '') >= (y.t || '') ? x : y;
  }
  const cab = (a.tCab || '') >= (b.tCab || '') ? a : b;
  const nuevo = (a.actualizado || '') >= (b.actualizado || '') ? a : b;
  return { ...nuevo, fecha: cab.fecha, inspector: cab.inspector, dictamen: cab.dictamen, tCab: cab.tCab, items };
}
/** Conserva las imágenes que este teléfono ya tiene (las fotos subidas se guardan solo con su ruta). */
function conImagenes(c, local) {
  const ya = new Map(fotosChecklist(local).filter((f) => f.src).map((f) => [f.path || f.id, f]));
  for (const f of fotosChecklist(c)) { const l = ya.get(f.path) || ya.get(f.id); if (l && !f.src) Object.assign(f, { src: l.src, vence: l.vence }); }
  return c;
}

/* ---------- almacenamiento ---------- */
const almacenChecklists = {
  local() { try { return JSON.parse(pref('checklists') || '[]'); } catch (e) { return []; } },
  guardarLocal() {
    // en la versión compartida, las fotos ya subidas no se guardan en el teléfono (se firman al abrirlas)
    const liviano = nube ? checklists.map((c) => ({ ...c, items: Object.fromEntries(Object.entries(c.items || {}).map(([k, it]) =>
      [k, { ...it, fotos: (it.fotos || []).map((f) => (f.path ? { ...f, src: undefined, vence: undefined } : f)) }])) })) : checklists;
    try { pref('checklists', JSON.stringify(liviano)); } catch (e) { console.warn('checklist sin guardar en el teléfono', e); }
  },
  async cargar() {
    checklists = this.local();
    try { permisosJose = JSON.parse(pref('permisosJose') || 'null'); } catch (e) { permisosJose = null; }
    if (nube) {
      try {
        const { data: yo, error: e1 } = await nube.sb.from('miembros').select('checklists').ilike('email', nube.email).maybeSingle();
        if (!e1) { permisosJose = (yo && yo.checklists) || []; pref('permisosJose', JSON.stringify(permisosJose)); }
        const { data, error } = await nube.sb.from('checklists').select('*').eq('proyecto', M.proyecto.id);
        if (error) throw error;
        const locales = new Map(checklists.map((c) => [c.id, c]));
        checklists = data.filter((r) => !r.borrado).map((r) => {
          const l = locales.get(r.id);
          locales.delete(r.id);
          return conImagenes(l && l._pendiente ? { ...unirChecklists(l, r.datos), _pendiente: true } : r.datos, l);
        });
        for (const l of locales.values()) if (l._pendiente) checklists.push(l); // cargadas sin señal
        this.guardarLocal();
        this.subirPendientes();
      } catch (e) {
        console.warn('checklist: sin conexión, se muestran las del teléfono', e);
        if (e && /relation|does not exist|schema cache/i.test(e.message || '')) aviso('Falta crear la tabla de la Checklist de Jose en Supabase (supabase/8-checklist-jose.sql)');
      }
    }
    checklistsCargadas = true;
  },
  guardar(c) {
    c.actualizado = hoyISO();
    c.actualizadoPor = autor();
    if (!checklists.includes(c)) checklists.push(c);
    if (nube) c._pendiente = true;
    this.guardarLocal();
    if (nube) { clearTimeout(this.t); this.t = setTimeout(() => this.subirPendientes(), 1200); }
  },
  async subirPendientes() {
    if (!nube || this.subiendo) return true;
    this.subiendo = true;
    let ok = true;
    for (const c of checklists.filter((x) => x._pendiente)) {
      try {
        for (const f of fotosChecklist(c)) {
          if (f.path || !f.src || !f.src.startsWith('data:')) continue;
          const blob = await (await fetch(f.src)).blob();
          const path = `${c.proyecto}/checklists/${c.plantilla}/${c.id}/${f.id || (f.id = uid())}.jpg`;
          const { error } = await nube.sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
          if (error && !/exists/i.test(error.message)) throw error;
          f.path = path;
        }
        const r = resumenChecklist(c, planillaJose(c.plantilla));
        const enviado = c.actualizado;
        const datos = { ...c, _pendiente: undefined, items: Object.fromEntries(Object.entries(c.items).map(([k, it]) =>
          [k, { ...it, fotos: (it.fotos || []).map(({ src, vence, ...f }) => f) }])) };
        const fila = { id: c.id, proyecto: c.proyecto, nivel: c.nivel, unidad: c.unidad, plantilla: c.plantilla,
          controlados: r.hechos, observados: r.no, datos };
        const { error } = await nube.sb.from('checklists').upsert(fila);
        if (error) throw error;
        if (c.actualizado === enviado) delete c._pendiente; // si se tocó mientras subía, queda para la próxima
      } catch (e) {
        ok = false;
        console.warn('checklist sin subir', e);
        if (e && (e.code === '42501' || /row-level|permiso|security/i.test(e.message || ''))) { delete c._pendiente; aviso('Tu usuario no está habilitado para verificar esta checklist'); }
        else if (e && /relation|does not exist|schema cache/i.test(e.message || '')) aviso('Falta crear la tabla de la Checklist de Jose en Supabase (supabase/8-checklist-jose.sql)');
      }
    }
    this.subiendo = false;
    this.guardarLocal();
    return ok;
  },
};
async function firmarFotosChecklist(c) {
  if (!nube || !c) return false;
  const faltan = fotosChecklist(c).filter((f) => f.path && (!f.src || (f.vence && f.vence < Date.now())));
  if (!faltan.length) return false;
  const { data } = await nube.sb.storage.from('fotos').createSignedUrls(faltan.map((f) => f.path), 7 * 864e2);
  (data || []).forEach((d, j) => { if (d.signedUrl) { faltan[j].src = d.signedUrl; faltan[j].vence = Date.now() + 6 * 864e5; } });
  return true;
}

/** Cambios en vivo: lo que marca otro teléfono aparece sin recargar. */
function escucharChecklists() {
  if (!nube || escucharChecklists.hecho) return;
  escucharChecklists.hecho = true;
  nube.sb.channel('checklists-' + M.proyecto.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checklists', filter: `proyecto=eq.${M.proyecto.id}` }, (ev) => {
      const r = ev.new; if (!r || !r.id || !r.datos) return;
      const i = checklists.findIndex((x) => x.id === r.id);
      if (r.borrado) { if (i >= 0) checklists.splice(i, 1); }
      else if (i >= 0) checklists[i] = conImagenes(checklists[i]._pendiente ? { ...unirChecklists(checklists[i], r.datos), _pendiente: true } : r.datos, checklists[i]);
      else checklists.push(r.datos);
      almacenChecklists.guardarLocal();
      const v = pila[pila.length - 1];
      if (!v || !['checklist', 'checklists', 'espacio', 'edificio'].includes(v.vista)) return;
      // no redibujar mientras se escribe una observación
      if (v.vista === 'checklist' && document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      refrescarSiSePuede();
    })
    .subscribe();
  addEventListener('online', () => almacenChecklists.subirPendientes());
}

/** Al arrancar la app: trae las checklists para mostrar el avance en el edificio y en cada dpto. */
async function iniciarChecklistJose() {
  const b = $('#btn-checklist');
  if (b) { b.hidden = false; b.onclick = () => elegirPlanillaJose(); }
  await almacenChecklists.cargar();
  escucharChecklists();
  const v = pila[pila.length - 1];
  if (v && ['edificio', 'espacio'].includes(v.vista)) refrescarSiSePuede();
}

/* ---------- entrada: ícono → rubros ---------- */
function elegirPlanillaJose() {
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Checklist de Jose</h2><p>Elegí el rubro y después el dpto a relevar.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="lista">${PLANILLAS_JOSE.map((pl) => {
      const rs = dptosEdificio().map(({ nv, u }) => resumenChecklist(checklistDe(nv, u, pl.id), pl));
      return `<button class="fila" data-pl="${pl.id}"><span class="fila-t">${esc(pl.nombre)}</span>
        <span class="fila-der">${puedeVerificar(pl.id) ? '<span class="chip piloto">verificás</span>' : '<span class="chip">solo ver</span>'}</span>
        <span class="fila-s"><span>${pl.items.length} ítems por dpto</span><span>${rs.filter((r) => !r.sin).length} de ${rs.length} dptos completos</span>${rs.some((r) => r.no) ? `<span><span class="punto e-abierto"></span> ${rs.filter((r) => r.no).length} con ✗</span>` : ''}</span></button>`;
    }).join('')}</div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-pl]').forEach((b) => (b.onclick = () => { cerrarHoja(); ir('checklists', { plantilla: b.dataset.pl }); }));
  });
}
function bloqueChecklistEdificio() {
  return `<div class="seccion-t">Checklist de Jose</div>
    <div class="lista"><button class="fila" id="ir-checklist"><span class="fila-t">${ICONO_CHECKLIST} Planillas de inspección por dpto</span>
      <span class="fila-der"><span class="chip piloto">nuevo</span></span>
      <span class="fila-s"><span>${esc(PLANILLAS_JOSE.map((p) => p.nombre).join(' · '))}</span></span></button></div>`;
}
function bloqueChecklistDpto(nv, u) {
  if (u === COMUN) return '';
  return `<div class="seccion-t">Checklist de Jose</div>
    <div class="lista">${PLANILLAS_JOSE.map((pl) => {
      const c = checklistDe(nv, u, pl.id);
      const r = resumenChecklist(c, pl);
      return `<button class="fila" data-cj="${pl.id}"><span class="fila-t">${esc(pl.nombre)}</span>
        <span class="fila-der">${r.hechos ? `<div class="avance"><b>${r.pct}%</b><div class="barrita"><i style="width:${r.pct}%"></i></div></div>` : '<span class="nota">Sin empezar</span>'}</span>
        <span class="fila-s"><span>${r.hechos ? esc(textoResumen(r)) : `${pl.items.length} ítems · tocá para relevar`}</span>${c && c.inspector ? `<span>Inspeccionó: ${esc(c.inspector)}</span>` : ''}${c && c._pendiente ? '<span class="chip">sin subir</span>' : ''}</span></button>`;
    }).join('')}</div>`;
}
function enlazarChecklist(root, nv, u) {
  root.querySelectorAll('[data-cj]').forEach((b) => (b.onclick = () => ir('checklist', { nivel: nv, unidad: u, plantilla: b.dataset.cj })));
  const b = $('#ir-checklist', root); if (b) b.onclick = () => elegirPlanillaJose();
}
const ICONO_CHECKLIST = '<svg class="ico-cj" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 4V3h6v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.5 12.5l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- vista: caja de dptos de una planilla ---------- */
async function vChecklists(main, params) {
  const pl = planillaJose(params.plantilla) || PLANILLAS_JOSE[0];
  cabecera('Checklist de Jose', pl.nombre);
  if (!checklistsCargadas) {
    main.innerHTML = '<p class="vacio-txt">Cargando checklist…</p>';
    await almacenChecklists.cargar(); escucharChecklists();
    if (pila[pila.length - 1].vista !== 'checklists') return;
  }
  const rs = dptosEdificio().map((x) => resumenChecklist(checklistDe(x.nv, x.u, pl.id), pl));
  const celda = (nv, u) => {
    const r = resumenChecklist(checklistDe(nv, u, pl.id), pl);
    const cls = r.no ? 'con-pend' : r.hechos && !r.sin ? 'al-dia' : r.hechos ? 'en-curso' : '';
    const txt = r.no ? `✗ ${r.no}` : r.hechos && !r.sin ? '✓' : r.hechos ? `${r.hechos}/${r.total}` : '';
    return `<button class="unidad ${cls}" data-nv="${nv}" data-u="${esc(u)}" aria-label="${esc(u)}: ${esc(textoResumen(r))}">
      <span class="u-nom">${esc(u)}</span><span class="u-cant num">${txt}</span></button>`;
  };
  main.innerHTML = `
  <div class="pagina">
    <div class="kpis">
      <div class="kpi"><b>${rs.filter((r) => r.hechos && r.sin).length}</b><span>en curso</span></div>
      <div class="kpi alerta"><b>${rs.filter((r) => r.no).length}</b><span>con ✗</span></div>
      <div class="kpi ok"><b>${rs.filter((r) => !r.sin).length}</b><span>completos</span></div>
    </div>
    <div class="seccion-t">${esc(pl.nombre)} · tocá un dpto para relevarlo</div>
    <div class="edificio">${nivelesConDptos().map((n) => `<div class="piso">
      <div class="piso-id"><b class="cod">${n.id}</b><span>${esc(n.tipo || n.nombre)}</span></div>
      <div class="piso-unidades">${n.unidades.map((u) => celda(n.id, u)).join('')}</div></div>`).join('')}</div>
    <div class="ley-cj"><span><i class="con-pend"></i>Con ✗</span><span><i class="en-curso"></i>En curso</span><span><i class="al-dia"></i>Completo sin ✗</span></div>
    <p class="nota">${puedeVerificar(pl.id) ? 'Podés verificar esta planilla.' : 'Esta planilla la verifican solo las personas habilitadas; vos la podés ver.'}</p>
    ${nube && esAdmin() ? '<div class="acciones"><button class="btn" id="cj-quien">Quién verifica</button></div>' : ''}
  </div>`;
  main.querySelectorAll('.unidad').forEach((b) => (b.onclick = () => ir('checklist', { nivel: b.dataset.nv, unidad: b.dataset.u, plantilla: pl.id })));
  const q = $('#cj-quien', main); if (q) q.onclick = () => quienVerifica(pl);
}

/** Solo admin: elegir qué miembros pueden verificar esta planilla (además del administrador). */
async function quienVerifica(pl) {
  const { data, error } = await nube.sb.from('miembros').select('email, nombre, rol, checklists').order('nombre');
  if (error) { aviso(/checklists/.test(error.message || '') ? 'Falta correr supabase/8-checklist-jose.sql en Supabase' : 'No se pudo leer la lista de miembros'); return; }
  abrirHoja(`<div class="ficha-cab"><div><h2 class="h-hoja">Quién verifica</h2><p>${esc(pl.nombre)}: los administradores siempre pueden. Tildá a quién más habilitás; el resto solo mira.</p></div><button class="cerrar" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="lista">${data.map((m) => `<label class="fila fila-check"><input type="checkbox" data-mail="${esc(m.email)}" ${m.rol === 'admin' || (m.checklists || []).includes(pl.id) ? 'checked' : ''} ${m.rol === 'admin' ? 'disabled' : ''}>
      <span class="fila-t">${esc(m.nombre)}</span><span class="fila-s"><span>${esc(m.email)}</span><span>${m.rol === 'admin' ? 'administrador' : esc(m.rol)}</span></span></label>`).join('')}</div>`, (h) => {
    $('[data-cerrar]', h).onclick = cerrarHoja;
    h.querySelectorAll('[data-mail]').forEach((cb) => (cb.onchange = async () => {
      const { error: e } = await nube.sb.rpc('permitir_checklist', { correo: cb.dataset.mail, plantilla: pl.id, permitir: cb.checked });
      if (e) { cb.checked = !cb.checked; aviso('No se pudo cambiar el permiso'); return; }
      aviso(cb.checked ? 'Habilitado para verificar' : 'Ya no verifica esta planilla');
    }));
  });
}

/* ---------- vista: la planilla de un dpto ---------- */
async function vChecklist(main, params) {
  const nv = nivel(params.nivel), u = params.unidad;
  const pl = planillaJose(params.plantilla) || PLANILLAS_JOSE[0];
  cabecera(`Checklist de Jose · ${pl.nombre}`, `Dpto ${u}`);
  if (!checklistsCargadas) {
    main.innerHTML = '<p class="vacio-txt">Cargando checklist…</p>';
    await almacenChecklists.cargar(); escucharChecklists();
    if (pila[pila.length - 1].vista !== 'checklist') return;
  }
  const editable = puedeVerificar(pl.id);
  const ambs = ambientesDe(pl);
  const ver = params.ver || 'todos';
  // la checklist se crea recién cuando se marca algo, así no quedan vacías en la base
  let c = checklistDe(nv.id, u, pl.id);
  const nueva = () => ({ id: idChecklist(nv.id, u, pl.id), proyecto: M.proyecto.id, nivel: nv.id, unidad: u, plantilla: pl.id,
    fecha: fechaLocal(), inspector: autor(), dictamen: '', tCab: hoyISO(), items: {}, creado: hoyISO(), creadoPor: autor() });
  const asegurar = () => (c ||= nueva());
  const guardar = () => almacenChecklists.guardar(c);
  const tocar = (i) => { const it = (asegurar().items[i] ||= { marca: '', amb: [], nota: '', fotos: [] }); it.t = hoyISO(); it.por = autor(); return it; };
  const unidades = nv.unidades || [];
  const visible = (i) => ver === 'todos' || (ver === 'sin' ? !marcaDe(c, i) : marcaDe(c, i) === ver);

  const htmlItem = (txt, i) => {
    const it = (c && c.items[i]) || { marca: '', amb: [], nota: '', fotos: [] };
    const dis = editable ? '' : 'disabled';
    const no = it.marca === 'no';
    return `<div class="cj-item ${it.marca ? 'cj-' + it.marca : ''}" data-i="${i}" ${visible(i) ? '' : 'hidden'}>
      <div class="cj-cab"><span class="cj-n num">${i + 1}</span><span class="cj-t">${esc(txt)}</span></div>
      <div class="cj-marcas" role="group" aria-label="Control del ítem ${i + 1}">${MARCAS_JOSE.map((m) => `<button type="button" data-marca="${m.id}" style="--c:${m.c}" aria-pressed="${it.marca === m.id}" ${dis}>
        <b>${m.simbolo}</b><span>${m.nombre}</span></button>`).join('')}</div>
      ${no ? `<div class="cj-detalle">
        <div class="cj-lbl">Dónde (opcional)</div>
        <div class="cj-amb">${ambs.map((a) => `<button type="button" data-amb="${a.id}" aria-pressed="${(it.amb || []).includes(a.id)}" title="${esc(a.nombre)}" ${dis}>${esc(a.corto)}</button>`).join('')}</div>
        <textarea data-nota rows="2" placeholder="Observación: qué hay que solucionar" ${dis} aria-label="Observación del ítem ${i + 1}">${esc(it.nota || '')}</textarea>
        <div class="fotos">${(it.fotos || []).map((f, k) => `<figure><img src="${esc(f.src || '')}" alt="Foto ${k + 1} del ítem ${i + 1}"><figcaption>${esc(fechaCorta(f.fecha))}</figcaption>
          ${editable ? `<button type="button" class="cj-foto-quitar" data-quitar="${k}" aria-label="Quitar foto ${k + 1}">✕</button>` : ''}</figure>`).join('')}
          ${editable ? `<label class="cj-foto-add camara">📷<br>Sacar foto<input type="file" accept="image/*" capture="environment" data-foto></label>
          <label class="cj-foto-add">＋<br>De galería<input type="file" accept="image/*" multiple data-foto></label>` : ''}</div>
      </div>` : ''}
      ${it.por ? `<span class="cj-firma">${esc(it.por)} · ${esc(fechaHora(it.t))}</span>` : ''}
    </div>`;
  };
  const htmlResumen = () => {
    const r = resumenChecklist(c, pl);
    return `<div class="kpi"><b>${r.hechos}/${r.total}</b><span>controlados</span></div>
      <div class="kpi alerta"><b>${r.no}</b><span>✗ no check</span></div>
      <div class="kpi ok"><b>${r.si}</b><span>✓ check${r.na ? ` · ${r.na} N/A` : ''}</span></div>`;
  };
  const htmlFiltro = () => {
    const r = resumenChecklist(c, pl);
    return [['todos', `Todos (${r.total})`], ['si', `✓ ${r.si}`], ['no', `✗ ${r.no}`], ['na', `N/A ${r.na}`], ['sin', `Sin marcar ${r.sin}`]]
      .map(([id, n]) => `<button type="button" data-ver="${id}" aria-pressed="${ver === id}">${n}</button>`).join('');
  };

  main.innerHTML = `
  <div class="pagina">
    ${unidades.length > 1 ? `<div class="selector-nivel"><div class="niveles-scroll">${unidades.map((x) => `<button class="nivel-btn" data-u="${esc(x)}" aria-current="${x === u}">${esc(x)}</button>`).join('')}</div></div>` : ''}
    <div class="kpis" id="cj-kpis">${htmlResumen()}</div>
    <div class="campos">
      <div class="campo"><span class="lbl">Edificio</span><div class="cj-dato">${esc(M.proyecto.nombre)}</div></div>
      <div class="campo"><span class="lbl">N° dpto</span><div class="cj-dato">${esc(u)} <span class="nota">(${esc(nv.id)})</span></div></div>
      <div class="campo"><label for="cj-fecha">Fecha</label><input type="date" id="cj-fecha" value="${esc((c && c.fecha) || fechaLocal())}" ${editable ? '' : 'disabled'}></div>
      <div class="campo"><label for="cj-insp">Inspeccionó</label><input id="cj-insp" value="${esc((c && c.inspector) || autor())}" ${editable ? '' : 'disabled'}></div>
    </div>
    ${editable ? '<p class="nota">Marcá cada ítem con <b>✓ Check</b>, <b>✗ No check</b> o <b>N/A</b>. En los ✗ dejá la observación y una foto para que se solucione. Los ítems quedan en su lugar para el control final.</p>'
      : '<p class="nota">Esta planilla la verifican solo las personas habilitadas. Vos la podés ver y descargar.</p>'}
    <div class="cj-ver" id="cj-ver">${htmlFiltro()}</div>
    <div class="cj-lista">${pl.items.map(htmlItem).join('')}</div>
    <div class="campo"><label for="cj-dict">Resumen de observaciones y dictamen</label><textarea id="cj-dict" ${editable ? '' : 'disabled'} placeholder="Dictamen de la inspección del dpto">${esc((c && c.dictamen) || '')}</textarea></div>
    <div class="acciones">
      ${editable ? '<button class="btn" id="cj-resto">Marcar el resto con ✓</button>' : ''}
      <button class="btn primario" id="cj-pdf">PDF de la planilla</button>
      <button class="btn" id="cj-compartir">Compartir</button>
    </div>
    ${c && c.actualizadoPor ? `<p class="nota">Último cambio: ${esc(c.actualizadoPor)} · ${esc(fechaHora(c.actualizado))}</p>` : ''}
  </div>`;

  main.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => ir('checklist', { ...params, unidad: b.dataset.u }, true)));
  const act = main.querySelector('.nivel-btn[aria-current="true"]');
  if (act) { const sc = act.parentElement; sc.scrollLeft = act.offsetLeft - sc.offsetLeft - (sc.clientWidth - act.offsetWidth) / 2; }
  const redibujar = (i) => {
    const viejo = main.querySelector(`.cj-item[data-i="${i}"]`);
    const tmp = document.createElement('div'); tmp.innerHTML = htmlItem(pl.items[i], i);
    const nuevo = tmp.firstElementChild;
    nuevo.hidden = false; // recién tocado: queda a la vista aunque haya un filtro, hasta que se cambie el filtro
    viejo.replaceWith(nuevo);
    $('#cj-kpis', main).innerHTML = htmlResumen();
    $('#cj-ver', main).innerHTML = htmlFiltro();
    return nuevo;
  };
  $('#cj-ver', main).onclick = (ev) => {
    const b = ev.target.closest('[data-ver]'); if (!b) return;
    pila[pila.length - 1].params.ver = b.dataset.ver; render();
  };
  const lista = $('.cj-lista', main);
  lista.addEventListener('click', (ev) => {
    if (!editable) return;
    const b = ev.target.closest('button'); if (!b) return;
    const i = +b.closest('.cj-item').dataset.i;
    const it = tocar(i);
    if (b.dataset.marca) it.marca = it.marca === b.dataset.marca ? '' : b.dataset.marca;
    else if (b.dataset.amb) { const a = b.dataset.amb; it.amb = (it.amb || []).includes(a) ? it.amb.filter((x) => x !== a) : [...(it.amb || []), a]; }
    else if (b.dataset.quitar !== undefined) it.fotos.splice(+b.dataset.quitar, 1);
    else return;
    guardar();
    const el = redibujar(i);
    if (b.dataset.marca === 'no' && it.marca === 'no') { const t = $('[data-nota]', el); if (t && !t.value) t.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  });
  lista.addEventListener('change', async (ev) => {
    if (!editable) return;
    const el = ev.target.closest('.cj-item'); if (!el) return;
    const i = +el.dataset.i;
    if (ev.target.matches('[data-nota]')) {
      const v = ev.target.value.trim();
      if (v === ((c && c.items[i] && c.items[i].nota) || '')) return;
      tocar(i).nota = v; guardar();
      el.querySelector('.cj-firma')?.remove();
      return;
    }
    if (ev.target.matches('[data-foto]')) {
      const it = tocar(i);
      it.fotos = it.fotos || [];
      for (const file of ev.target.files) {
        try { it.fotos.push({ id: uid(), src: await comprimir(file, `${u} · ítem ${i + 1} · ${autor()}`), fecha: hoyISO(), autor: autor() }); }
        catch (er) { aviso('No se pudo leer la imagen'); }
      }
      guardar(); redibujar(i);
    }
  });
  if (editable) {
    const cab = () => { asegurar().tCab = hoyISO(); guardar(); };
    $('#cj-fecha', main).onchange = (ev) => { asegurar().fecha = ev.target.value || fechaLocal(); cab(); };
    $('#cj-insp', main).onchange = (ev) => { asegurar().inspector = limpiarNombre(ev.target.value); cab(); };
    $('#cj-dict', main).onchange = (ev) => { asegurar().dictamen = ev.target.value.trim(); cab(); };
    $('#cj-resto', main).onclick = () => {
      const faltan = pl.items.map((_, i) => i).filter((i) => !marcaDe(c, i));
      if (!faltan.length) { aviso('Ya están todos marcados'); return; }
      faltan.forEach((i) => { tocar(i).marca = 'si'; });
      guardar(); faltan.forEach(redibujar);
      aviso(`${faltan.length} ${faltan.length === 1 ? 'ítem marcado' : 'ítems marcados'} con ✓`);
    };
  }
  const exportar = (compartir) => async () => {
    const b = $(compartir ? '#cj-compartir' : '#cj-pdf', main);
    b.disabled = true;
    try {
      if (c) await firmarFotosChecklist(c).catch(() => {});
      const blob = await checklistPDF(c || nueva(), pl);
      await entregar(blob, `Checklist ${pl.nombre} ${u} ${(c && c.fecha) || fechaLocal()}.pdf`.replace(/[\\/:*?"<>|]+/g, ' '), compartir);
    } catch (e) { console.error(e); aviso('No se pudo armar el PDF'); }
    b.disabled = false;
  };
  $('#cj-pdf', main).onclick = exportar(false);
  $('#cj-compartir', main).onclick = exportar(true);
  // fotos subidas desde otro teléfono: se firman y se muestran
  if (c && (await firmarFotosChecklist(c).catch(() => false)) && pila[pila.length - 1].vista === 'checklist') {
    pl.items.forEach((_, i) => { if (marcaDe(c, i) === 'no' && (c.items[i].fotos || []).length) redibujar(i).hidden = !visible(i); });
  }
}

/* ---------- PDF: la planilla de Jose en A4 apaisado, y después los ✗ con sus fotos ---------- */
async function checklistPDF(c, pl) {
  await cargarScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const W = 297, H = 210, m = 10, ancho = W - 2 * m;
  const ORO = [254, 190, 16], NEGRO = [26, 26, 26], GRIS = [95, 95, 95], LINEA = [200, 200, 200];
  const COL = { si: [46, 155, 87], no: [214, 69, 61], na: [95, 95, 95] };
  const TXT = { si: 'OK', no: 'NO', na: 'N/A' };
  const ambs = AMBIENTES_JOSE; // el PDF lleva todas las columnas de la planilla; las que no aplican van con "–"
  const sin = new Set(pl.sinAmbientes || []);
  const wN = 7, wItem = 72, wCtl = 13, wAmb = 12.5;
  const wObs = ancho - wN - wItem - wCtl - wAmb * ambs.length;
  const cols = [wN, wItem, wCtl, ...ambs.map(() => wAmb), wObs];
  const xs = cols.reduce((a, w) => [...a, a[a.length - 1] + w], [m]);
  const xAmb = (j) => xs[3 + j], xObs = xs[3 + ambs.length];
  let y = m;
  const logo = await logoJPEG();
  const encabezado = () => {
    if (logo) { const h = 9; doc.addImage(logo.url, 'JPEG', m, y, h * logo.w / logo.h, h); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
    doc.text('CHECKLIST DE JOSE', W - m, y + 3, { align: 'right' });
    doc.setFontSize(15); doc.setTextColor(...NEGRO);
    doc.text(latin1(`Planilla de inspección · ${pl.nombre} · Dpto ${c.unidad}`), W - m, y + 9, { align: 'right' });
    y += 12;
    doc.setFillColor(...ORO); doc.rect(m, y, ancho, 1, 'F'); y += 5;
  };
  encabezado();
  doc.setFontSize(10);
  const dato = (lbl, val, x) => {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...GRIS); doc.text(latin1(lbl), x, y + 4);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...NEGRO); doc.text(latin1(val), x + doc.getTextWidth(latin1(lbl)) + 2, y + 4);
  };
  dato('RUBRO:', pl.nombre, m);
  dato('EDIFICIO:', M.proyecto.nombre, m + 80);
  dato('N° DPTO:', `${c.unidad} (${c.nivel})`, m + 150);
  dato('FECHA:', c.fecha ? fechaCorta(c.fecha + 'T12:00') : '', m + 205);
  y += 5.5;
  dato('INSPECCIONÓ:', c.inspector || '', m);
  y += 7;

  const cabTabla = () => {
    const hCab = 11;
    doc.setFillColor(242, 242, 242); doc.rect(m, y, ancho, hCab, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...NEGRO);
    const cabs = ['N°', (pl.detalle || pl.nombre).toUpperCase(), 'Control', ...ambs.map((a) => a.pdf), 'Observación'];
    cabs.forEach((t, j) => {
      const izq = j === 1 || j === cabs.length - 1;
      const lineas = doc.splitTextToSize(latin1(t), cols[j] - 1.5).slice(0, 3);
      const y0 = y + hCab / 2 - (lineas.length - 1) * 1.35 + 1;
      lineas.forEach((l, k) => doc.text(l, izq ? xs[j] + 1.5 : xs[j] + cols[j] / 2, y0 + k * 2.7, { align: izq ? 'left' : 'center' }));
    });
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.rect(m, y, ancho, hCab);
    xs.slice(1, -1).forEach((x) => doc.line(x, y, x, y + hCab));
    y += hCab;
  };
  cabTabla();
  doc.setFontSize(7.5);
  pl.items.forEach((txt, i) => {
    const it = (c.items || {})[i] || {};
    doc.setFont('helvetica', 'normal');
    const lItem = doc.splitTextToSize(latin1(txt), wItem - 3);
    const nota = it.marca === 'no' ? `${it.nota || ''}${(it.fotos || []).length ? ` (${it.fotos.length} foto${it.fotos.length > 1 ? 's' : ''})` : ''}` : '';
    const lObs = doc.splitTextToSize(latin1(nota), wObs - 3);
    const h = Math.max(5.2, 2 + 2.9 * Math.max(lItem.length, lObs.length));
    if (y + h > H - m - 6) { doc.addPage(); y = m; cabTabla(); doc.setFontSize(7.5); }
    if (i % 2) { doc.setFillColor(250, 250, 250); doc.rect(m, y, ancho, h, 'F'); }
    const yc = y + h / 2 + 1;
    doc.setTextColor(...NEGRO);
    doc.text(String(i + 1), xs[0] + wN / 2, yc, { align: 'center' });
    lItem.forEach((l, k) => doc.text(l, xs[1] + 1.5, y + 3.6 + k * 2.9));
    if (it.marca) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...COL[it.marca]); doc.text(TXT[it.marca], xs[2] + wCtl / 2, yc, { align: 'center' }); doc.setFont('helvetica', 'normal'); }
    ambs.forEach((a, j) => {
      const x = xAmb(j) + wAmb / 2;
      if (sin.has(a.id)) { doc.setTextColor(...GRIS); doc.text('-', x, yc, { align: 'center' }); return; }
      if (it.marca === 'no' && (it.amb || []).includes(a.id)) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...COL.no); doc.text('X', x, yc, { align: 'center' }); doc.setFont('helvetica', 'normal'); }
    });
    doc.setTextColor(...NEGRO);
    lObs.forEach((l, k) => doc.text(l, xObs + 1.5, y + 3.6 + k * 2.9));
    doc.setDrawColor(...LINEA);
    doc.rect(m, y, ancho, h);
    xs.slice(1, -1).forEach((x) => doc.line(x, y, x, y + h));
    y += h;
  });

  const r = resumenChecklist(c, pl);
  y += 4;
  if (y + 25 > H - 8) { doc.addPage(); y = m; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NEGRO);
  doc.text(latin1(`Controlados ${r.hechos} de ${r.total} · Check ${r.si} · No check ${r.no} · N/A ${r.na}${r.sin ? ` · Sin marcar ${r.sin}` : ''}`), m, y + 3);
  y += 6;
  doc.text('RESUMEN DE OBSERVACIONES Y DICTAMEN', m, y + 3); y += 5;
  doc.setFont('helvetica', 'normal');
  const lDict = doc.splitTextToSize(latin1(c.dictamen || ''), ancho - 4);
  const hDict = Math.max(10, 4 + lDict.length * 4);
  doc.setDrawColor(...LINEA); doc.rect(m, y, ancho, hDict);
  lDict.forEach((l, k) => doc.text(l, m + 2, y + 5 + k * 4));

  // los ✗, uno debajo del otro, con su observación y sus fotos
  const nos = pl.items.map((txt, i) => ({ txt, i, it: (c.items || {})[i] || {} })).filter((x) => x.it.marca === 'no');
  if (nos.length) {
    doc.addPage(); y = m; encabezado();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...COL.no);
    doc.text(latin1(`Ítems con no check (${nos.length}): a solucionar`), m, y + 4); y += 9;
    for (const { txt, i, it } of nos) {
      const fotos = (await Promise.all((it.fotos || []).map((f) => (f.src ? aJPEG(f.src, 900).catch(() => null) : null)))).filter(Boolean);
      const hf = 42;
      const wf = 56;
      const lNota = doc.splitTextToSize(latin1(it.nota || 'Sin observación escrita.'), ancho);
      const alto = 7 + lNota.length * 4.2 + (fotos.length ? Math.ceil(fotos.length / 4) * (hf + 3) : 0) + 4;
      if (y + Math.min(alto, 60) > H - m - 6) { doc.addPage(); y = m; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...NEGRO);
      const donde = (it.amb || []).map((a) => (AMBIENTES_JOSE.find((x) => x.id === a) || {}).nombre).filter(Boolean).join(', ');
      doc.text(latin1(`${i + 1}. ${txt}${donde ? ` · ${donde}` : ''}`), m, y + 4); y += 6.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
      lNota.forEach((l) => { doc.text(l, m, y + 3.5); y += 4.2; });
      y += 1;
      for (let k = 0; k < fotos.length; k += 4) {
        if (y + hf > H - m - 6) { doc.addPage(); y = m; }
        fotos.slice(k, k + 4).forEach((f, j) => {
          const w = Math.min(wf, hf * f.w / f.h), hh = w * f.h / f.w;
          doc.addImage(f.url, 'JPEG', m + j * (wf + 4), y, w, hh);
        });
        y += hf + 3;
      }
      y += 2; doc.setDrawColor(226, 226, 226); doc.line(m, y, W - m, y); y += 4;
    }
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(latin1(`${M.proyecto.nombre} · Codesarrollos · emitido ${fechaCorta(hoyISO())} por ${autor()}`), m, H - 5);
    doc.text(`Página ${i} de ${n}`, W - m, H - 5, { align: 'right' });
  }
  return doc.output('blob');
}
