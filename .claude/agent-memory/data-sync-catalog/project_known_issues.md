---
name: Problemas conocidos del catálogo vehicular
description: Bugs e inconsistencias detectadas en el catálogo de vehículos de WaPro — campo faltante, moneda, 0km, bodywork
type: project
---

Problemas detectados al auditar el catálogo en 2026-03-26:

1. **`version` faltaba en `CatalogItem`**: el tipo no tenía el campo, el SELECT no lo traía, y `formatItemLine` tampoco lo mostraba. Corregido en `catalog.ts`.

2. **`isNew` no existía**: no había forma de distinguir 0km vs usado en el bot. Corregido: se infiere de `km === 0` o `status` que contenga "0km"/"nuevo". Campo `isNew: boolean` agregado al tipo.

3. **`bodywork` faltaba en `CatalogItem`**: el tipo no lo tenía, aunque `demands.ts` ya lo infería desde texto. Corregido: se agregó campo y función `inferBodyworkFromRow()` que parsea desde `title`/`model`/`version`.

4. **Heurística de moneda demasiado agresiva**: el código original marcaba como USD todo precio ARS < 1.000.000 (incluyendo 0km baratos). Corregida: ahora diferencia entre 0km (puede ser ARS bajo) y usado (si < 1M en ARS → sospecha USD). Precio < 50.000 siempre → USD.

5. **`loadVehiclesFromSimpleDb` muy básico**: no traía km, transmission, fuel, color. Es el fallback, no es crítico, pero empobrece el catálogo si la query principal falla.

6. **`parseMoney` no manejaba**: "800k", "medio millón", "0.8 millones", "800" con contexto vehicular. Corregido en v4.

7. **bodywork en `extract.ts` faltaba `coupe` y `2 puertas`**: agregado.

**Why:** los campos faltantes causaban que el bot mostrara listados pobres (sin version, sin 0km destacado, sin bodywork para filtrar). La moneda mal inferida generaba precios inconsistentes en cotizaciones.

**How to apply:** ante nuevos reportes de campo faltante en el bot, verificar que: (a) esté en el SELECT de `loadVehiclesFromDb`, (b) esté en el tipo `CatalogItem`, (c) esté en el haystack de `searchCatalog`, (d) esté en `formatItemLine`.
