/* Arranque: carga el manifest, la nube y los marcadores, y abre la pantalla de inicio. */
'use strict';
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
