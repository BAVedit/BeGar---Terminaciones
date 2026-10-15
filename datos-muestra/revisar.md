# Revisar — Belive Garay

Generado: 2026-10-15T05:25:10

## 1. Versiones duplicadas (elegir la vigente)

Completar `decisiones.json` → `vigentes` con `"<grupo>": "<ruta del vigente>"`. Hasta entonces se procesan todas y la app las marca con ⚠.

- **ar-nomenclados** — ✓ confirmado
  - `01. Arquitectura/BeGar-AR- Nomenclados_C.pdf` (dwg+pdf, 2026-10-15 05:24) ← vigente
  - `05. Otros/20. Modificación Puertas Madera/RE- Nomeclados_C.pdf` (pdf, 2026-10-15 05:24)
- **ie-instalacion-electrica** — ⚠ PENDIENTE
  - `03. Instalaciones/BeGar-IE- Instalación Eléctrica_C.dwg` (dwg, 2026-10-15 05:24)
  - `05. Otros/19. Modificación Eléctrica/BeGar-IE- Instalación Eléctrica_M.dwg` (dwg, 2026-10-15 05:24)
- **tm-termomecanica** — ⚠ PENDIENTE
  - `03. Instalaciones/BeGar-TM- Termomecánica_C.dwg` (dwg, 2026-10-15 05:24)
  - `05. Otros/14. Modif. Extracción Baños y Cocinas/BeGar-TM- Termomecánica_M.dwg` (dwg, 2026-10-15 05:24)

## 2. Planos solo en DWG (10) — exportar a PDF

- `01. Arquitectura/BeGar-AR- Arquitectónico_C.dwg`
- `01. Arquitectura/BeGar-AR- Cielorraso_C.dwg`
- `01. Arquitectura/BeGar-ARD- Muros Cortina_C.dwg`
- `01. Arquitectura/BeGar-ARD- Puertas de Madera_C.dwg`
- `02. Estructuras/BeGar-EH- Pasantes_C.dwg`
- `03. Instalaciones/BeGar-IE- Instalación Eléctrica_C.dwg`
- `03. Instalaciones/BeGar-TM- Termomecánica_C.dwg`
- `05. Otros/10. Planos Complementarios/Modelo de Dinteles.dwg`
- `05. Otros/14. Modif. Extracción Baños y Cocinas/BeGar-TM- Termomecánica_M.dwg`
- `05. Otros/19. Modificación Eléctrica/BeGar-IE- Instalación Eléctrica_M.dwg`

## 3. Prefijos de código sin definir

Completar en `config/codigos.json` → `prefijos_sin_definir` con `{"descripcion": ..., "rubro": ...}`.

- **B**: B-01 (Nomenclados, Planta Tipo 1 - Nivel 1); B-01 (Nomenclados, Planta Tipo 1 - Nivel 1); B-01 (Nomenclados, Planta Tipo 1 - Nivel 1); B-01 (Nomenclados, Planta Tipo 1 - Nivel 1)
- **ES**: ES-01 (Nomenclados, Planta Tipo 1 - Nivel 1); ES-01 (Nomenclados, Planta Tipo 1 - Nivel 2); ES-01 (Nomenclados, Planta Tipo 2); ES-01 (Nomenclados, Planta Baja)
- **DU**: DU-02 (Nomenclados, Planta Tipo 1 - Nivel 1); DU-02 (Nomenclados, Planta Tipo 1 - Nivel 2); DU-02 (Nomenclados, Planta Tipo 2); DU-02 (Nomenclados, Planta Baja)
- **PT**: PT-01 (Nomenclados, Planta Tipo 1 - Nivel 1); PT-01 (Nomenclados, Planta Tipo 1 - Nivel 2); PT-01 (Nomenclados, Planta Tipo 2); PT-01 (Nomenclados, Planta Baja)

## 4. Niveles por rubro

| Rubro | SS | PB | N1 | N2 | N3 | N4 | N5 | AZ | Planos que faltan |
|---|---|---|---|---|---|---|---|---|---|
| Instalaciones eléctricas | — | — | — | — | — | — | — | — | Instalación Eléctrica, Señales Débiles, Portero Inteligente, Luces para Replanteo, Tomas y Llaves, Cielorraso |
| Instalaciones hidrosanitarias | — | — | — | — | — | — | — | — | Sanitarias, Pluvial, Drenaje, Agua Corriente, Pasantes Tanque Superior, Pasantes, Baño Tipo, Cocina Tipo y Lavadero, Arquitectónico |
| Instalaciones termomecánicas | — | — | — | — | — | — | — | — | Climatización, Termomecánica, TM-Cortes, Cielorraso |
| PCI | — | — | — | — | — | — | — | — | Prevención Contra Incendios |
| Carpintería de aluminio y vidrio | — | ●1 | ●1 | ●1 | ◐1 | ◐1 | ◐1 | — | Muros Cortina, Modelo de Dinteles |
| Carpintería de madera (puertas) | — | ●1 | ●1 | ●1 | ◐1 | ◐1 | ◐1 | — | Puertas de Madera |
| Muebles y placares | — | — | — | — | — | — | — | — | Armarios y Muebles |
| Pisos y revestimientos | — | — | — | — | — | — | — | — | Pisos y Revestimientos, Pétreos |
| Cielorrasos | — | — | — | — | — | — | — | — | Cielorraso |
| Mampostería y tabiques | — | ●1 | ●1 | ●1 | ◐1 | ◐1 | ◐1 | — | Acotadas, Arquitectónico |
| Pintura | — | — | — | — | — | — | — | — | Acabados |
| Herrería / carpintería metálica | — | — | — | — | — | — | — | — | Carpintería Metálica, Herrería |
| Aislaciones e impermeabilización | — | — | — | — | — | — | — | — | Aislaciones |
| Ascensor | — | — | — | — | — | — | — | — | Núcleo Escalera y Ascensor |
| Amenities | — | — | — | — | — | — | — | — | Piscina, Lobby y Palieres, Señalética |

● = planta propia del nivel, ◐ = planta tipo compartida, — = sin plano en PDF

## 5. Recortes propuestos (verificar en la calibración)

- `ar-nomenclados__planta-tipo-1-nivel-1` — hoja 1, «Planta Tipo 1 - Nivel 1» → N1 (propuesto, 44 códigos, 26 ubicaciones)
- `ar-nomenclados__planta-tipo-1-nivel-2` — hoja 1, «Planta Tipo 1 - Nivel 2» → N2 (propuesto, 44 códigos, 26 ubicaciones)
- `ar-nomenclados__planta-tipo-2` — hoja 2, «Planta Tipo 2» → N3, N4, N5 (propuesto, 36 códigos, 21 ubicaciones)
- `ar-nomenclados__planta-baja` — hoja 2, «Planta Baja» → PB (propuesto, 28 códigos, 16 ubicaciones)
- `ard-carpinteria-de-aluminio-y-vidrio__hoja-1` — hoja 1, «Hoja 1» → lámina (hoja, 21 códigos, 0 ubicaciones)
- `minuta-modificacion-carp-aluminio__hoja-1` — hoja 1, «Hoja 1» → lámina (hoja, 1 códigos, 0 ubicaciones)
