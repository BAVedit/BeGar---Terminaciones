# Revisar — Belive Garay

Generado: 2026-10-15T06:17:43

## 1. Versiones duplicadas (elegir la vigente)

Completar `decisiones.json` → `vigentes` con `"<grupo>": "<ruta del vigente>"`. Hasta entonces se procesan todas y la app las marca con ⚠.

Sin duplicados.

## 2. Planos solo en DWG (0) — exportar a PDF

Ninguno.

## 3. Prefijos de código sin definir

Completar en `config/codigos.json` → `prefijos_sin_definir` con `{"descripcion": ..., "rubro": ...}`.

- **ES**: ES-05 (BeGar - AZ, Plano Azotea); ES-04 (BeGar - AZ, Plano Azotea); ES-06 (BeGar - N1-N2, Planta Tipo 1 - Nivel 1); ES-03 (BeGar - N1-N2, Planta Tipo 1 - Nivel 1)
- **BA**: BA-02 (BeGar - AZ, Plano Azotea); BA-01 (BeGar - AZ, Plano Azotea); BA-02 (BeGar - AZ, Plano Azotea); BA-01 (BeGar - AZ, Plano Azotea)

## 3b. Rótulos de local que no corresponden al nivel

Rótulos como `A-103` llevan el número de nivel. Estos aparecen en un nivel que no es el suyo (posible copia en el dibujo); la app los ignora al ubicar marcadores.

- N1: `AZ-102`
- N1: `C-203`
- N5: `D-110`
- N5: `C-111`
- N5: `A-110`
- N5: `A-111`
- N5: `D-111`
- N5: `B-111`
- N5: `B-210`
- N5: `B-110`

## 4. Niveles por rubro

| Rubro | SS | PB | N1 | N2 | N3 | N4 | N5 | AZ | Planos que faltan |
|---|---|---|---|---|---|---|---|---|---|
| Instalaciones eléctricas | — | — | — | — | — | — | — | — | Instalación Eléctrica, Señales Débiles, Portero Inteligente, Luces para Replanteo, Tomas y Llaves, Cielorraso |
| Instalaciones hidrosanitarias | — | — | — | — | — | — | — | — | Sanitarias, Pluvial, Drenaje, Agua Corriente, Pasantes Tanque Superior, Pasantes, Baño Tipo, Cocina Tipo y Lavadero, Arquitectónico |
| Instalaciones termomecánicas | — | — | — | — | — | — | — | — | Climatización, Termomecánica, TM-Cortes, Cielorraso |
| PCI | — | — | — | — | — | — | — | — | Prevención Contra Incendios |
| Carpintería de aluminio y vidrio | — | — | — | — | — | — | — | — | Nomenclados, Carpintería de Aluminio y Vidrio, Muros Cortina, Modelo de Dinteles, Minuta Modificación Carp. Aluminio |
| Carpintería de madera (puertas) | — | — | — | — | — | — | — | — | Nomenclados, Puertas de Madera |
| Muebles y placares | — | — | — | — | — | — | — | — | Armarios y Muebles |
| Pisos y revestimientos | — | — | — | — | — | — | — | — | Pisos y Revestimientos, Pétreos |
| Cielorrasos | — | — | — | — | — | — | — | — | Cielorraso |
| Mampostería y tabiques | — | — | — | — | — | — | — | — | Acotadas, Arquitectónico, Nomenclados |
| Pintura | — | — | — | — | — | — | — | — | Acabados |
| Herrería / carpintería metálica | — | — | — | — | — | — | — | — | Carpintería Metálica, Herrería |
| Aislaciones e impermeabilización | — | — | — | — | — | — | — | — | Aislaciones |
| Ascensor | — | — | — | — | — | — | — | — | Núcleo Escalera y Ascensor |
| Amenities | — | — | — | — | — | — | — | — | Piscina, Lobby y Palieres, Señalética |

● = planta propia del nivel, ◐ = planta tipo compartida, — = sin plano en PDF

## 5. Recortes propuestos (verificar en la calibración)

- `begar-az__plano-azotea` — hoja 1, «Plano Azotea» → AZ (propuesto, 61 códigos, 14 ubicaciones)
- `begar-n1-n2__planta-tipo-1-nivel-1` — hoja 1, «Planta Tipo 1 - Nivel 1» → N1 (propuesto, 133 códigos, 86 ubicaciones)
- `begar-n1-n2__planta-tipo-1-nivel-2` — hoja 1, «Planta Tipo 1 - Nivel 2» → N2 (propuesto, 90 códigos, 82 ubicaciones)
- `begar-n3-n4__planta-tipo-2-nivel-3` — hoja 1, «Planta Tipo 2 - Nivel 3» → N3 (propuesto, 143 códigos, 72 ubicaciones)
- `begar-n3-n4__planta-tipo-2-nivel-4` — hoja 1, «Planta Tipo 2 - Nivel 4» → N4 (propuesto, 91 códigos, 77 ubicaciones)
- `begar-n5__planta-tipo-2-nivel-5` — hoja 1, «Planta Tipo 2 - Nivel 5» → N5 (propuesto, 91 códigos, 78 ubicaciones)
- `begar-ss-y-pb__plano-de-sub-suelo` — hoja 1, «Plano de Sub Suelo» → SS (propuesto, 39 códigos, 8 ubicaciones)
- `begar-ss-y-pb__plano-de-planta-baja` — hoja 1, «Plano de Planta Baja» → PB (propuesto, 49 códigos, 5 ubicaciones)
