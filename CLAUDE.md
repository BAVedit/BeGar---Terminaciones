# CLAUDE.md — App de terminaciones (Codesarrollos)

## Reglas firmes
- Las carpetas de planos y contratos son **solo lectura**. `ingesta.py` se niega a escribir dentro de `--obra`.
- Nunca adivinar cuál plano es el vigente: los grupos de versiones sin decisión se procesan todos, se marcan `vigente: "pendiente"` y se listan en `revisar.md`.
- Nunca inventar el significado de un prefijo: los de `prefijos_sin_definir` quedan como `sin_definir` hasta que el usuario los complete.
- Cada nivel es una entidad propia (SS, PB, N1…N5, AZ). Planta Tipo 1 = N1, N2; Tipo 2 = N3, N4, N5. Una planta tipo dibujada una sola vez se reutiliza (`compartida: true`) pero los pines se guardan por nivel.
- Códigos: primero tabla de muros (código exacto: `C3A`, `LH-10`, `M1`…), después prefijos de detalle (`PV`, `VA`, `MV`, `A`, `G`, `PDR`, `MB`). Variantes `PV07-A` → grupo `PV-07`.

## Cómo correr
- Ingesta: `python ingesta/ingesta.py --obra <carpeta Garay> --salida visor/datos [--decisiones archivo] [--sin-tiles]`
- Muestra sintética: `python ingesta/generar_muestra.py --salida muestra` (+ `muestra/decisiones.json`).
- Visor: `cd visor && python -m http.server 8000`.

## Configuración (editable, en `ingesta/config/`)
- `proyecto.json`: niveles, títulos que los identifican, plantas tipo, patrones de dpto/ambiente, parámetros de render.
- `codigos.json`: tabla oficial de detalles y muros, regex de código, prefijos sin definir.
- `rubros.json`: planos por rubro (se comparan sin acentos y con tolerancia a errores de tipeo; anteponer disciplina `TM-Cortes` para desambiguar) y prefijos de carpeta de contratista.
- `decisiones.json`: vigente por grupo de versiones y bbox calibrados por recorte (lo escribirá la herramienta de calibración, fase 2).

## Cómo funciona la ingesta
1. Inventario de `1. Planos/Vigente` y `02 Contratos y OT` (excluye `04. Municipal`). Agrupa .dwg/.pdf del mismo plano y detecta versiones en otras carpetas (`RE- Nomeclados_C` ≈ `AR- Nomenclados_C`).
2. Por cada PDF vigente (rotación normalizada a 0): palabras con coordenadas (une fragmentos `PV-` + `04`), títulos de planta, manchas de dibujo (raster a baja resolución + componentes conexos) → recorte propuesto = la mancha arriba de cada título. Hojas sin títulos = lámina completa.
3. Planillas `UBICACION / CODIGO / CANTIDAD / DESCRIPCION` por posición de columnas. Detalle de cada código = recuadro que contiene su ocurrencia de letra más grande.
4. Tiles 512 px tipo deep-zoom (`tiles/<recorte>/<z>/<x>_<y>.webp`, z máx. con lado ≈ 4096 px) e imágenes de detalle.
5. `manifest.json` + `revisar.md` + `inventario.csv`.

IDs estables: plano = `<disciplina>-<nombre>` del grupo; recorte = `<plano>__<slug del título>`. No dependen de la hoja ni del estado, así un plano nuevo no rompe los pines. `huella` (hash del PDF + bbox) detecta cambios.

## Visor (piloto, `visor/`)
- HTML + JS sin build, Leaflet 1.9.4 (copiado en `vendor/` para que funcione offline).
- Pines en coordenadas normalizadas 0–1 del recorte, guardados en IndexedDB (`obra-terminaciones/pines`).
- `index.html` es un documento completo; lo que sigue al comentario `INICIO` es lo que se publica como demo.
- Cada publicación con cambios visibles suma una entrada arriba en `visor/novedades.json` (la app se la muestra a cada persona una vez).
- Pedido de materiales: `pedidos.js` (pedidos PM, remisiones, resumen PDF), tabla `pedidos` de `supabase/4-pedidos.sql`; solo el admin carga, el resto ve y comenta.
- Pruebas de dptos: `pruebas.js` + checklist editable `pruebas.json` (misma lista para todos los dptos; áreas comunes con la suya; los `id` de ítem no se cambian). Tabla `pruebas` de `supabase/5-pruebas.sql`: una fila por entrada, solo se agregan; cualquier miembro carga. Un No aprueba abre un hilo; el marcador del plano guarda `prueba` = id del hilo.
- Beta: para probar antes de publicar, copiar `visor/` a la carpeta `beta/` de gh-pages (https://bavedit.github.io/BeGar---Terminaciones/beta/). Al publicar en gh-pages, conservar `beta/`.
- APK nuevo (cambios en `android-app/`): Actions lo compila; copiarlo a `visor/descargas/BAV-BeGar.apk` y poner el número de corrida en `visor/descargas/version.json` → la app avisa a los teléfonos con un APK anterior.

## Fases
1. ✅ Ingesta + inventario (probada con muestra sintética; falta correr con los planos reales).
2. Calibración web: arrastrar bbox, asignar planos, elegir vigentes, definir prefijos → escribe `decisiones.json`/`codigos.json`.
3. ✅ (piloto web) Navegación + visor con códigos tocables.
4. ✅ (piloto web, local) Pines, fotos, estados, offline en el dispositivo.
5. Sync multiusuario, roles, reportes PDF server-side, demás rubros. Ver `MEJORAS_E_IDEAS.md` para la propuesta de stack.
