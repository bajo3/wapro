---
name: Problemas conocidos del catálogo vehicular
description: Bugs e inconsistencias detectadas en el catálogo de vehículos de WaPro — campo faltante, moneda, 0km, bodywork, BAIC duplicado
type: project
---

Problemas detectados al auditar el catálogo en 2026-03-26:

1. **`version` faltaba en `CatalogItem`**: el tipo no tenía el campo, el SELECT no lo traía, y `formatItemLine` tampoco lo mostraba. Corregido en `catalog.ts`.

2. **`isNew` no existía**: no había forma de distinguir 0km vs usado en el bot. Corregido: se infiere de `km === 0` o `status` que contenga "0km"/"nuevo". Campo `isNew: boolean` agregado al tipo.

3. **`bodywork` faltaba en `CatalogItem`**: el tipo no lo tenía, aunque `demands.ts` ya lo infería desde texto. Corregido: se agregó campo y función `inferBodyworkFromRow()` que parsea desde `title`/`model`/`version`.

4. **Heurística de moneda demasiado agresiva**: CORREGIDO 2026-03-27 en `VehiclesController.ts`.
   - Antes: marcaba como USD todo precio < 1.000.000 sin importar si currency="ARS" explícito ni si era 0km.
   - Ahora: si currency="ARS" explícito, solo sospecha USD cuando price < 50.000 (imposible en ARS). Sin currency, aplica heurística por isNew: 0km puede ser ARS bajo, usado < 500k → sospecha USD.
   - `catalog.ts` del bot ya tenía la lógica correcta desde antes.

5. **`loadVehiclesFromSimpleDb` consulta columnas inexistentes**: CORREGIDO 2026-03-27 en `catalog.ts`.
   - Antes: usaba `marca`, `modelo`, `precio` → la query fallaba silenciosamente → bot caía al JSON de sector7gamers (tecnología).
   - Ahora: usa `COALESCE(brand, marca)`, `COALESCE(model, modelo)`, `COALESCE(price::text, precio::text)` para compatibilidad con ambos esquemas.

6. **`parseMoney` no manejaba**: "800k", "medio millón", "0.8 millones", "800" con contexto vehicular. Corregido en v4.

7. **bodywork en `extract.ts` faltaba `coupe` y `2 puertas`**: agregado.

8. **BAIC duplicado en label**: CORREGIDO 2026-03-27 en los tres lugares:
   - `VehiclesController.ts` (backend panel)
   - `vehicleLabel.js` (util frontend)
   - `QuotationsManager.jsx` (copia inline)
   - Root cause: `baseNorm.includes(titleNorm)` siempre fallaba porque titleNorm es más largo que baseNorm (contiene brand+model+version). Se reemplazó por `titleNorm.startsWith(brandModelNorm)`: si el title empieza por brand+model, ya está cubierto en base+extras.
   - Resultado: "BAIC BJ40 Plus 2023" con brand=BAIC, model=BJ40 → label="BAIC BJ40 2023 Plus" (no duplicado).

9. **`buildVehicleTitle` en `demands.ts` pobre**: CORREGIDO 2026-03-27.
   - Antes: retornaba `title || version || brand+model+year`. Si title era solo "BAIC", el matching recibía "BAIC".
   - Ahora: construye structured = brand+model+version+year y lo prefiere si tiene >=2 tokens.

10. **`vehicleLabel.js` no se importa en `QuotationsManager.jsx`**: la lógica está copiada inline y puede divergir. PENDIENTE: reemplazar copia inline con import del util para tener una sola fuente de verdad.

**Why:** los campos faltantes causaban que el bot mostrara listados pobres (sin version, sin 0km destacado, sin bodywork para filtrar). La moneda mal inferida generaba precios inconsistentes en cotizaciones. El label duplicado confundía el panel y las cotizaciones. El fallback de DB con columnas incorrectas hacía que el bot usara un catálogo de tecnología en lugar de autos.

**How to apply:** ante nuevos reportes de campo faltante en el bot, verificar que: (a) esté en el SELECT de `loadVehiclesFromDb`, (b) esté en el tipo `CatalogItem`, (c) esté en el haystack de `searchCatalog`, (d) esté en `formatItemLine`. Para el panel: verificar `VehiclesController.ts` y `vehicleLabel.js`. Para `buildVehicleLabel`: siempre verificar que title empiece por brand+model antes de agregarlo como extra, no solo si está "incluido" en baseNorm.
