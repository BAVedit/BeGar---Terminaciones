# App de terminaciones — Belive Garay (piloto)

Planos vigentes en el celular, con códigos tocables (`PV-04`, `VA-01`…) y pines de observación con fotos, estado y reporte.

```
ingesta/   Script Python que lee tus carpetas (solo lectura) y genera inventario, recortes por nivel, fichas de códigos y tiles.
visor/     App web del piloto (abre en el celular, funciona sin señal una vez cargada).
muestra/   Planos SINTÉTICOS para probar sin tus archivos (se regeneran con generar_muestra.py).
```

## Probarlo con tus planos reales (Windows)

1. Instalar Python 3.11+ desde python.org (tildar “Add to PATH”).
2. Abrir una terminal en esta carpeta y correr:

```bat
py -m pip install -r ingesta\requirements.txt
py ingesta\ingesta.py --obra "C:\Users\Codesarrollos\Desktop\Garay" --salida visor\datos
```

3. Abrir `visor\datos\revisar.md`: ahí está lo que hay que decidir (versiones duplicadas, planos solo en DWG, prefijos sin definir, recortes propuestos). Las decisiones se cargan en `ingesta\config\decisiones.json` y en `ingesta\config\codigos.json`, y se vuelve a correr el paso 2.
4. Servir el visor y abrirlo desde el celular (misma red Wi-Fi):

```bat
cd visor
py -m http.server 8000
```

En el celular: `http://<IP de la PC>:8000` (la IP sale con `ipconfig`). En la PC: `http://localhost:8000`.

`inventario.csv` usa `;` como separador, así abre directo en Excel en español.

## Probarlo con la muestra

```bash
cd ingesta
python generar_muestra.py --salida ../muestra
python ingesta.py --obra ../muestra/Garay --salida ../visor/datos --decisiones ../muestra/decisiones.json
cd ../visor && python -m http.server 8000
```

## Qué hace el piloto

- **Edificio**: los 22 dptos (1A–1E, 2A–2E, 3A–3D, 4A–4D, 5A–5D) más áreas comunes de cada piso, SS, PB y Azotea, con los pendientes de cada uno.
- **Dpto**: todos los pendientes de la unidad agrupados por rubro; "Abrir plano y marcar" abre el plano del nivel centrado en el dpto.
- **Marcador** (mantener apretado o "+ Marcador"): varias fotos (cámara o galería, con fecha, ubicación y autor estampados), descripción, rubro, responsable de ejecutarlo, quién relevó, ambiente, prioridad, fecha límite y estado (Pendiente / Realizado / Verificado) con historial.
- **Informe** por rubro, responsable, nivel y estado, agrupado por dpto, con recorte del plano y fotos de cada marcador; copiar resumen para WhatsApp; imprimir a PDF desde el navegador.
- Plantas tipo compartidas: N3, N4 y N5 usan la misma imagen, pero cada nivel guarda sus marcadores.
- Los marcadores se guardan en el dispositivo (IndexedDB). Compartirlos entre varias personas es el paso siguiente.
- Unidades por nivel en `ingesta/config/proyecto.json`; responsables por rubro en `ingesta/config/rubros.json`.

## Versión compartida (Supabase)

Sin configurar, cada teléfono guarda sus marcadores. Para que todos vean lo mismo:

1. Crear una cuenta gratis en supabase.com y un proyecto nuevo (por ejemplo `begar-obra`).
2. En **SQL Editor → New query**, pegar `supabase/esquema.sql`, cambiar los mails del final por los reales y tocar **Run**.
3. En **Project Settings → API**, copiar la *Project URL* y la *anon public key* en `visor/config.js`.
4. Para sumar o quitar gente después: **Table Editor → miembros** (rol `editor` o `lector`).

Cada persona entra una sola vez con su mail y contraseña; la sesión queda guardada. Los editores cargan y cierran marcadores; los lectores ven todo, con fotos e informes. Cada marcador guarda quién lo relevó, quién lo marcó realizado y quién lo verificó, con fecha. Sin señal se sigue trabajando y se sube solo cuando vuelve.
