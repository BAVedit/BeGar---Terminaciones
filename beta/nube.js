/* Versión compartida: cuentas, permisos y sincronización con Supabase.
   Se activa solo si config.js trae supabaseUrl y supabaseKey; si no, la app sigue 100 % local.
   - Cada persona se registra una vez con mail y contraseña; la sesión queda guardada en el teléfono.
   - Permisos por la tabla "miembros" (editor / lector), validados en la base (supabase/esquema.sql).
   - Los marcadores se guardan primero en el teléfono y se suben cuando hay señal (cola de pendientes).
   - Las fotos van a la carpeta privada "fotos" y se ven con enlaces firmados. */
'use strict';

async function iniciarNube(cfg) {
  await cargarScript('vendor/supabase.js');
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'obra.sesion' },
  });
  const nube = { sb, perfil: null, email: null, enLinea: navigator.onLine };

  /* ---------- acceso ---------- */
  let { data: { session } } = await sb.auth.getSession();
  if (!session) session = await pantallaAcceso(sb);
  nube.email = session.user.email;
  let { data: miembro, error } = await sb.from('miembros').select('nombre, rol').ilike('email', nube.email).maybeSingle();
  // sin señal: usar el último perfil conocido en este teléfono
  if (error) { try { miembro = JSON.parse(pref('perfil') || 'null'); } catch (e) { miembro = null; } }
  else pref('perfil', JSON.stringify(miembro));
  if (!miembro) {
    await pantallaSinPermiso(sb, nube.email);
    return null; // no vuelve: la pantalla ofrece cerrar sesión y recargar
  }
  nube.perfil = miembro;
  document.body.classList.toggle('solo-lectura', !['admin', 'editor'].includes(miembro.rol));

  /* ---------- fotos ---------- */
  const rutaFoto = (p, f) => `${p.proyecto}/${p.id}/${f.id || (f.id = uid())}.jpg`;
  async function subirFotos(p) {
    for (const f of p.fotos) {
      if (f.path || !f.src || !f.src.startsWith('data:')) continue;
      const blob = await (await fetch(f.src)).blob();
      const path = rutaFoto(p, f);
      const { error } = await sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error && !/exists/i.test(error.message)) throw error;
      f.path = path;
    }
  }
  async function firmarFotos(lista) {
    const faltan = lista.flatMap((p) => p.fotos.filter((f) => f.path && (!f.src || (f.vence && f.vence < Date.now()))));
    for (let i = 0; i < faltan.length; i += 100) {
      const tanda = faltan.slice(i, i + 100);
      const { data } = await sb.storage.from('fotos').createSignedUrls(tanda.map((f) => f.path), 7 * 864e2);
      (data || []).forEach((d, j) => { if (d.signedUrl) { tanda[j].src = d.signedUrl; tanda[j].vence = Date.now() + 6 * 864e5; } });
    }
  }

  /* ---------- marcadores ---------- */
  const aFila = (p) => ({
    id: p.id, proyecto: p.proyecto, nivel: p.nivel, unidad: p.unidad, rubro: p.rubro, estado: p.estado,
    responsable: p.responsable, borrado: !!p.borrado,
    // en la nube las fotos viajan sin la imagen (está en la carpeta "fotos")
    datos: { ...p, _pendiente: undefined, fotos: p.fotos.map(({ src, vence, ...f }) => f) },
  });
  const deFila = (r, local) => {
    const p = { ...r.datos, n: r.n, borrado: r.borrado, creadoPor: r.creado_por, actualizadoPor: r.actualizado_por };
    // conservar las imágenes que este teléfono ya tiene
    const srcLocal = new Map((local?.fotos || []).filter((f) => f.path || f.id).map((f) => [f.path || f.id, f]));
    p.fotos = (p.fotos || []).map((f) => { const l = srcLocal.get(f.path) || srcLocal.get(f.id); return l ? { ...f, src: l.src, vence: l.vence } : f; });
    return p;
  };

  let subiendo = null;
  nube.vaciarCola = () => (subiendo ||= (async () => {
    await null; // que "subiendo" quede asignado antes de que termine, aunque la cola esté vacía
    try {
      for (const p of pines.filter((x) => x._pendiente).concat(borradosPendientes())) {
        await subirFotos(p);
        const { data, error } = await sb.from('marcadores').upsert(aFila(p)).select('n').single();
        if (error && (error.code === '42501' || /row-level|permiso/i.test(error.message || ''))) {
          // la base no lo permite (p. ej. eliminar sin ser administrador): se descarta el cambio
          if (p.borrado) quitarBorrado(p.id); else { delete p._pendiente; await almacen.guardarLocal(p); }
          aviso(/administrador/i.test(error.message || '') ? 'Solo el administrador puede eliminar marcadores' : 'Tu usuario no tiene permiso para ese cambio');
          continue;
        }
        if (error) throw error;
        delete p._pendiente;
        if (data && data.n && p.n !== data.n) { p.n = data.n; }
        if (p.borrado) quitarBorrado(p.id); else await almacen.guardarLocal(p);
      }
      marcarConexion(true);
      return true;
    } catch (e) {
      console.warn('sin subir todavía', e);
      marcarConexion(false);
      return false;
    } finally { subiendo = null; }
  })().then((ok) => {
    // lo que se guardó mientras subía, va en la siguiente vuelta
    if (ok && (pines.some((x) => x._pendiente) || borradosPendientes().length)) setTimeout(nube.vaciarCola, 300);
  }));

  // borrados que todavía no llegaron a la nube
  const borradosPendientes = () => { try { return JSON.parse(pref('borrados') || '[]'); } catch (e) { return []; } };
  const quitarBorrado = (id) => pref('borrados', JSON.stringify(borradosPendientes().filter((x) => x.id !== id)));
  nube.borrar = (p) => {
    const min = { id: p.id, proyecto: p.proyecto, nivel: p.nivel, unidad: p.unidad, rubro: p.rubro, estado: p.estado, responsable: p.responsable, actualizado: hoyISO(), fotos: [], borrado: true };
    pref('borrados', JSON.stringify([...borradosPendientes().filter((x) => x.id !== p.id), min]));
    return nube.vaciarCola();
  };

  function marcarConexion(ok) {
    nube.enLinea = ok;
    document.body.classList.toggle('sin-sync', !ok || pines.some((x) => x._pendiente));
  }

  /** Trae todo de la nube y lo mezcla con lo local (gana la versión más nueva). */
  nube.traer = async () => {
    const { data, error } = await sb.from('marcadores').select('*').eq('proyecto', M.proyecto.id);
    if (error) throw error;
    const locales = new Map(pines.map((p) => [p.id, p]));
    const resultado = [];
    for (const r of data) {
      const l = locales.get(r.id);
      locales.delete(r.id);
      if (r.borrado) { if (l) await almacen.borrarLocal(r.id); continue; }
      if (l && l._pendiente && l.actualizado > r.datos.actualizado) { resultado.push(l); continue; }
      const p = deFila(r, l); resultado.push(p);
    }
    for (const l of locales.values()) if (!l.ejemplo) { l._pendiente = true; resultado.push(l); } // creados sin señal
    await firmarFotos(resultado);
    for (const p of resultado) await almacen.guardarLocal(p);
    return resultado;
  };

  /* ---------- consultas (cualquier miembro, también lectores) ---------- */
  nube.comentar = async (id, texto) => {
    const { data, error } = await sb.rpc('comentar', { marcador: id, texto });
    if (error) throw error;
    return data;
  };

  /* ---------- rubros agregados por el equipo ---------- */
  // eliminado y actualizado llegaron con "editar rubros"; si la base todavía no tiene esas columnas
  // (falta correr supabase/2-editar-rubros.sql) se sube lo básico y se avisa una vez.
  let rubrosViejos = false;
  nube.guardarRubro = async (r) => {
    const fila = { id: r.id, proyecto: M.proyecto.id, nombre: r.nombre, responsables: r.responsables || [] };
    let { error } = await sb.from('rubros').upsert(rubrosViejos ? fila : { ...fila, eliminado: !!r.eliminado, actualizado: r.actualizado || hoyISO() });
    if (error && !rubrosViejos && /eliminado|actualizado|column/i.test(error.message || '')) {
      rubrosViejos = true;
      ({ error } = await sb.from('rubros').upsert(fila));
      if (r.eliminado) aviso('El rubro se eliminó en este teléfono; para el resto del equipo falta un paso en Supabase');
    }
    if (error) console.warn('rubro sin subir', error);
  };
  const deFilaRubro = (r) => ({ id: r.id, nombre: r.nombre, responsables: r.responsables || [], eliminado: !!r.eliminado, actualizado: r.actualizado || r.creado || '' });
  nube.traerRubros = async () => {
    const { data, error } = await sb.from('rubros').select('*').eq('proyecto', M.proyecto.id);
    if (error) return;
    if (data.length && !('eliminado' in data[0])) rubrosViejos = true;
    const remotos = new Map(data.map((r) => [r.id, deFilaRubro(r)]));
    const final = new Map(remotos);
    // cambios hechos sin señal en este teléfono: si son más nuevos que los de la nube, se suben
    for (const l of rubrosPropios()) {
      const r = remotos.get(l.id);
      if (!r || (l.actualizado || '') > (r.actualizado || '')) { final.set(l.id, l); nube.guardarRubro(l); }
    }
    const lista = [...final.values()];
    sumarRubros(lista);
    pref('rubros-propios', JSON.stringify(lista));
  };

  /* ---------- en vivo ---------- */
  sb.channel('rubros-' + M.proyecto.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rubros', filter: `proyecto=eq.${M.proyecto.id}` }, (ev) => {
      if (!ev.new || !ev.new.id || !('nombre' in ev.new)) return;
      const r = deFilaRubro(ev.new);
      const l = rubrosPropios().find((x) => x.id === r.id);
      if (l && (l.actualizado || '') > (r.actualizado || '')) return;
      pref('rubros-propios', JSON.stringify([...rubrosPropios().filter((x) => x.id !== r.id), r]));
      sumarRubros([r]);
      refrescarSiSePuede();
    })
    .subscribe();
  sb.channel('marcadores-' + M.proyecto.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'marcadores', filter: `proyecto=eq.${M.proyecto.id}` }, async (ev) => {
      const r = ev.new; if (!r || !r.id) return;
      const i = pines.findIndex((x) => x.id === r.id);
      if (r.borrado) { if (i >= 0) { pines.splice(i, 1); await almacen.borrarLocal(r.id); refrescarSiSePuede(); } return; }
      const l = i >= 0 ? pines[i] : null;
      if (l && l._pendiente) return;
      const p = deFila(r, l);
      await firmarFotos([p]);
      if (i >= 0) pines[i] = p; else pines.push(p);
      await almacen.guardarLocal(p);
      refrescarSiSePuede();
    })
    .subscribe();

  addEventListener('online', () => nube.vaciarCola());
  setInterval(() => { if (pines.some((x) => x._pendiente) || borradosPendientes().length) nube.vaciarCola(); }, 30000);

  nube.salir = async () => { await sb.auth.signOut(); location.reload(); };
  return nube;
}

/** Si hay una hoja abierta (formulario) no se redibuja, para no perder lo que se está escribiendo. */
function refrescarSiSePuede() {
  if (!$('#hoja').hidden) return;
  const v = pila[pila.length - 1];
  if (v && v.vista === 'visor' && mapa) { const c = mapa.getCenter(), z = mapa.getZoom(); render(); if (mapa) mapa.setView(c, z, { animate: false }); }
  else render();
}

/* ---------- pantallas de acceso ---------- */
function pantallaAcceso(sb) {
  cabecera('Codesarrollos', 'Ingresar');
  const main = $('#vista');
  return new Promise((resolver) => {
    let modo = 'entrar';
    const pintar = (msj = '') => {
      main.innerHTML = `<div class="pagina acceso">
        <img class="acceso-logo" src="iconos/codesarrollos-logo.svg" alt="Codesarrollos">
        <h2>${modo === 'entrar' ? 'Ingresá a Belive Garay' : 'Creá tu cuenta'}</h2>
        <p class="nota">${modo === 'entrar' ? 'Lo hacés una sola vez: después la app te recuerda en este teléfono.' : 'Usá el mail que te habilitaron. Vas a recibir un correo para confirmarlo.'}</p>
        <form class="campos" id="acc-form" style="grid-template-columns:1fr">
          ${modo === 'crear' ? '<div class="campo"><label for="acc-nom">Nombre</label><input id="acc-nom" autocomplete="name" required></div>' : ''}
          <div class="campo"><label for="acc-mail">Mail</label><input id="acc-mail" type="email" autocomplete="email" required></div>
          <div class="campo"><label for="acc-pass">Contraseña</label><input id="acc-pass" type="password" minlength="6" autocomplete="${modo === 'entrar' ? 'current-password' : 'new-password'}" required></div>
          ${msj ? `<p class="nota acceso-msj">${msj}</p>` : ''}
          <button class="btn primario" type="submit">${modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}</button>
        </form>
        <div class="acciones">
          <button class="btn" id="acc-modo">${modo === 'entrar' ? 'Es mi primera vez: crear cuenta' : 'Ya tengo cuenta'}</button>
          ${modo === 'entrar' ? '<button class="btn" id="acc-olvido">Olvidé mi contraseña</button>' : ''}
        </div>
      </div>`;
      $('#acc-modo').onclick = () => { modo = modo === 'entrar' ? 'crear' : 'entrar'; pintar(); };
      const olv = $('#acc-olvido');
      if (olv) olv.onclick = async () => {
        const email = $('#acc-mail').value.trim();
        if (!email) return pintar('Escribí tu mail y tocá de nuevo "Olvidé mi contraseña".');
        await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
        pintar('Te mandamos un mail para elegir una contraseña nueva.');
      };
      $('#acc-form').onsubmit = async (e) => {
        e.preventDefault();
        const email = $('#acc-mail').value.trim(), password = $('#acc-pass').value;
        const btn = e.submitter; btn.disabled = true; btn.textContent = 'Un momento…';
        if (modo === 'entrar') {
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) return pintar(/confirm/i.test(error.message) ? 'Todavía no confirmaste el mail: buscá el correo de confirmación.'
            : (!error.status || /fetch/i.test(error.name || '')) ? 'No hay conexión con el servidor. Probá de nuevo cuando tengas señal.' : 'Mail o contraseña incorrectos.');
          resolver(data.session);
        } else {
          const nombre = $('#acc-nom').value.trim();
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nombre }, emailRedirectTo: location.href.split('#')[0] } });
          if (error) return pintar(errorAlta(error));
          if (data.session) return resolver(data.session);
          modo = 'entrar'; pintar('Listo. Confirmá tu mail desde el correo que te llegó y después entrá acá.');
        }
      };
    };
    pintar();
  });
}

/** Errores de Supabase al crear la cuenta, en castellano. */
function errorAlta(error) {
  const m = error.message || '';
  if (/rate limit/i.test(m)) return 'Se mandaron demasiados correos de confirmación en poco tiempo. Probá de nuevo en una hora, o pedile a quien administra la obra que te cree la cuenta.';
  if (/already registered|already exists/i.test(m)) return 'Ese mail ya tiene cuenta: tocá "Ya tengo cuenta" y entrá con tu contraseña.';
  if (/password/i.test(m)) return 'La contraseña tiene que tener al menos 6 caracteres.';
  if (/invalid/i.test(m) && /email/i.test(m)) return 'Revisá el mail: parece que está mal escrito.';
  if (!error.status || /fetch/i.test(error.name || '')) return 'No hay conexión con el servidor. Probá de nuevo cuando tengas señal.';
  return esc(m);
}

function pantallaSinPermiso(sb, email) {
  cabecera('Codesarrollos', 'Sin acceso');
  $('#vista').innerHTML = `<div class="pagina acceso">
    <img class="acceso-logo" src="iconos/codesarrollos-logo.svg" alt="Codesarrollos">
    <h2>Tu mail todavía no está habilitado</h2>
    <p class="nota">Entraste como <b>${esc(email)}</b>. Pedile a quien administra la obra que te agregue como editor o lector, y volvé a abrir la app.</p>
    <div class="acciones"><button class="btn" id="acc-salir">Usar otro mail</button><button class="btn primario" id="acc-reint">Ya me habilitaron</button></div>
  </div>`;
  $('#acc-salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('#acc-reint').onclick = () => location.reload();
  return new Promise(() => {});
}
