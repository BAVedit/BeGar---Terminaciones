# Qué cambiaría, qué mejoraría y más ideas

Lo que sigue sale de construir el piloto. Ordené por impacto: lo de arriba es lo que más cambia el resultado.

## 1. Lo que cambiaría del planteo

### Hacer la app como web instalable (PWA) y no arrancar con Expo
El piloto ya es una web que se abre en el celular, funciona sin señal y guarda fotos. Para el equipo de obra la diferencia con una app nativa es mínima, y te ahorrás tiendas de apps, builds y actualizaciones: cambiás el código y todos lo tienen al instante.
Si más adelante necesitás algo nativo (notificaciones push en iPhone, subir fotos en segundo plano), se envuelve **el mismo código** con Capacitor y se publica en las tiendas. Reescribir en React Native sería hacer la app dos veces.

### Entrar también por nivel y por departamento, no solo por rubro
En obra el residente recorre piso por piso y dpto por dpto. Con "Rubro → Nivel" tiene que entrar 15 veces al mismo piso para ver todo. Propongo dos entradas al mismo dato:
- **Por rubro** (como pediste): para el contratista y para certificar.
- **Por nivel / dpto**: "N3 → 3C" muestra todas las observaciones de todos los rubros de esa unidad. Es la vista de la recorrida y la del acta de entrega.

### Que un pin sea un punto del edificio y no del PDF
Hoy el pin se guarda relativo al recorte del plano (lo que pediste, y funciona). Mejor todavía: calibrar cada plano con 2 puntos conocidos (por ejemplo dos ejes de columnas) y guardar el pin en **metros del edificio**. Ganás:
- El pin sobrevive aunque cambie el formato o la diagramación de la lámina.
- El mismo punto se ve en todos los planos: dejás un pin en el Arquitectónico de N3 y aparece en Eléctrica, Sanitarias y Cielorraso del mismo nivel.
- La calibración de la fase 2 ya tiene que tocar cada plano, así que el costo extra es chico.

### Avance por ítem, no solo por pines
"% de pines cerrados" mide problemas, no avance. Las planillas ya dicen cuántos `PV-04` hay por nivel. Con eso se arma una **matriz código × unidad** con etapas (colocado / sellado / vidriado / aprobado). Eso sirve para:
- Ver el avance real de cada contratista.
- **Certificar** contra la OT: "MENA tiene 38 de 52 ventanas aprobadas en N1–N3".

### Reglas de estado más estrictas
- Solo el fiscal pasa a **Aprobado**. El contratista solo puede marcar **Corregido**, y con **foto obligatoria** (antes/después).
- Agregar **Rechazado / Reabierto** para cuando lo "corregido" no está bien. Si no, se pierde la historia.

## 2. Mejoras técnicas que encontré al construirlo

| Tema | Qué hacer |
|---|---|
| **DWG sin PDF** (la mayoría) | Es el cuello de botella. Exportar en lote con *Publicar* de AutoCAD o con un script de `accoreconsole`. El inventario ya lista qué falta. |
| **Texto SHX** | Si AutoCAD exporta los textos con fuentes SHX como dibujo, los códigos **no se pueden leer**. Exportar con fuentes TrueType o con `EPDFSHX = 1`. Revisarlo con un plano antes de exportar todo. |
| **Una planta por hoja** | Si la oficina técnica exporta cada nivel en su propia hoja, la detección de recortes es exacta y la calibración casi desaparece. |
| **Capas del PDF** | Exportar con capas (OCG). Así el visor puede prender y apagar cotas, mobiliario o instalaciones. |
| **Cambios de versión** | Ya se detectan (los pines quedan marcados "verificar"). Siguiente paso: comparar qué códigos aparecieron o desaparecieron entre versiones y avisar. |
| **Sincronización** | Supabase está bien. Para que el offline no pierda datos, guardar cada cambio como un evento (creó, cambió estado, agregó foto) y sincronizar eventos, no el pin entero. Dos personas editando sin señal no se pisan. |
| **Fotos** | Comprimir en el celular (ya lo hace el piloto: 1280 px), subir en cola y guardar fecha, autor y ubicación del pin en cada foto. |
| **Permisos** | El contratista no debe ver contratos ni observaciones de otros contratistas. Definirlo en la base (RLS de Supabase), no solo en la pantalla. |

## 3. Más ideas

1. **QR en cada puerta de dpto.** Lo escanean y abre ese dpto en ese nivel. Cero navegación en obra.
2. **Recorridas con checklist.** Plantilla por rubro y tipo de unidad ("Carpintería: burletes, sellado, herrajes, vidrio, limpieza"). Se recorre el dpto, se tilda, y lo que falla se convierte en pin.
3. **Acta de entrega y posventa.** La misma base sirve para la entrega al comprador (firma en pantalla, PDF) y para los reclamos de posventa, que ya caen en el dpto, el ítem y el contratista correctos.
4. **Notas de voz.** Dictar la observación en vez de escribirla con guantes. El texto se completa solo.
5. **Asistente sobre los contratos.** "¿Qué dice la OT de MENA sobre sellado perimetral?" o "¿Quién se hace cargo del burlete?". Responde citando el PDF del contrato o adenda.
6. **Fotos que se ordenan solas.** Un modelo de visión sugiere el rubro y el tipo de defecto a partir de la foto.
7. **Reporte semanal automático** por contratista (PDF + resumen para WhatsApp), con lo vencido arriba.
8. **Tablero para dirección.** Avance por rubro y nivel, observaciones vencidas y contratistas con más reabiertos.
9. **Plano "de obra" vivo.** Los pines de replanteo (tomas, llaves, pases) también sirven para generar el conforme a obra.

## 4. Comprar o construir

Antes de invertir en las fases 4 y 5, conviene mirar 2 o 3 productos que ya hacen "pines sobre planos" (PlanRadar, Fieldwire, Dalux, Procore). Resuelven bien la sincronización, los roles y los reportes.
Lo que **no** traen, y justifica lo propio, es lo específico de tu flujo:
- Códigos tocables con la ficha y la planilla del detalle.
- La lógica de plantas tipo y niveles.
- Los contratos y OT por rubro.
- La certificación por ítem.

Un camino intermedio: usar uno de esos productos para la parte de pines y quedarte con la ingesta y las fichas como herramienta propia.

## 5. Próximos pasos sugeridos

1. Correr `ingesta.py` sobre la carpeta real de Garay y revisar `revisar.md` (versiones, DWG faltantes, prefijos B, C, D, E, ES, PT, DU).
2. Exportar a PDF los planos del piloto (Nomenclados y Carpintería de Aluminio y Vidrio) chequeando el tema SHX.
3. Probar el visor 1–2 semanas con un residente en N1 de Carpintería de aluminio.
4. Con eso decidimos: PWA + Supabase propio o producto comprado + herramienta de fichas.
