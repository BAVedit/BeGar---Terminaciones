/* Relevamiento de pendientes por dpto — Belive Garay.
   Lee datos/manifest.json (ingesta/ingesta.py) y guarda los marcadores en IndexedDB del dispositivo.
   Flujo: Edificio (22 dptos + SS, PB, Azotea) → Dpto → plano con marcadores → informe por rubro/contratista. */
'use strict';

const DATOS = 'datos/';
const ESTADOS = [
  { id: 'abierto', nombre: 'Pendiente' },
  { id: 'corregido', nombre: 'En proceso' },
  { id: 'aprobado', nombre: 'Verificado' },
];
const GRAVEDAD = { abierto: 2, corregido: 1, aprobado: 0 };
/* Cada etapa del marcador tiene sus fotos y su texto, así queda el antes y el después.
   Las fotos guardan su etapa (las viejas, sin etapa, son de Pendiente). */
const ETAPAS = [
  { id: 'abierto', nombre: 'Pendiente', campo: 'texto', lbl: 'Descripción', ph: 'Ej.: falta segunda mano en muro del living, mancha de humedad en cielorraso' },
  { id: 'corregido', nombre: 'En proceso', campo: 'textoProceso', lbl: 'Comentario en proceso', ph: 'Ej.: 2 de 3 detalles solucionados' },
  { id: 'aprobado', nombre: 'Verificado', campo: 'textoCierre', lbl: 'Comentario de cierre', ph: 'Ej.: terminado, se cambió la placa' },
];
const etapaFoto = (f) => f.etapa || 'abierto';
const fotosEtapa = (p, e) => p.fotos.filter((f) => etapaFoto(f) === e);
/** Etapas posteriores a Pendiente que tienen algo para mostrar en el informe. */
const etapasPosteriores = (p) => ETAPAS.slice(1).filter((e) => p[e.campo] || fotosEtapa(p, e.id).length);
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
