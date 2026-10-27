/* Hoja inferior, novedades, aviso de APK nuevo y ficha de código del plano. */
'use strict';
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
