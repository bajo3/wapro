---
name: Arquitectura del catálogo vehicular WaPro
description: Cómo fluyen los datos del catálogo desde la DB hasta el bot, panel y demandas — capas, campos clave y puntos de falla conocidos
type: project
---

El catálogo vehicular de WaPro tiene las siguientes capas:

1. **DB fuente**: `public.vehicles` en Railway Postgres. Columnas confirmadas: `id`, `title`, `brand`, `model`, `version`, `year`, `price`, `currency`, `slug`, `pictures`, `permalink`, `status`, `km`, `Km` (legacy), `Motor` (legacy), `Caja` (legacy), `Combustible` (legacy), `engine`, `transmission`, `color`, `bodywork`, `dealership_id`, `updated_at`.

2. **Bot (`apps/bot/src/services/catalog.ts`)**: carga vehículos via `loadVehiclesFromDb()` con un SELECT directo a `public.vehicles`. El tipo `CatalogItem` representa un ítem genérico (no sólo vehículos). La función `searchCatalog()` hace scoring por tokens.

3. **Backend panel (`apps/panel-whaticket/backend/src/controllers/VehiclesController.ts`)**: detecta la tabla de catálogo dinámicamente via `information_schema`, mapea columnas por sinónimos y expone `GET /vehicles`. Devuelve `{ vehicles: [...] }` con campos `marca`, `modelo`, `version`, `precio`, `currency`, `year`, `km`, `label`.

4. **Demandas (`apps/bot/src/services/demands.ts`)**: hace matching entre demandas abiertas y vehículos nuevos. Tiene su propia lógica de `getVehicleSource()` (igual al panel). Infiere `bodywork` y `fuel` desde texto si no están explícitos en la DB.

5. **Extracción (`apps/bot/src/services/extract.ts`)**: parsea texto libre del usuario para extraer campos estructurados (marca, modelo, precio, año, km, bodywork, combustible, caja). Alimenta demandas y matching.

**Why:** el bot, el panel y las demandas son clientes distintos del mismo catálogo pero con lógica de mapeo propia en cada capa.

**How to apply:** ante bugs de campo faltante, revisar las 4 capas en orden: DB schema → catalog.ts → VehiclesController.ts → demands.ts. La fuente de verdad es `public.vehicles`.
