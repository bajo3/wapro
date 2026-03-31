# Fix definitivo — catálogo y demands leyendo Supabase directo

## Problema confirmado
El stock del bot oscilaba entre `29` y `0` vehículos.

Los logs mostraban que el servicio levantaba `supabasePool`, pero en algunos escaneos de demands devolvía 29 vehículos y luego volvía a 0. Eso indica un problema de lectura y fallback, no un problema real de stock.

## Causas raíz
1. **Fallback silencioso a Railway**: cuando la lectura directa a Supabase fallaba, algunas consultas podían terminar leyendo `public.vehicles` desde Railway, donde el stock no era la fuente real o podía estar vacío.
2. **Filtro incremental por `since` en demands**: el escaneo de demandas dependía de una ventana temporal. Si `updated_at` no existía, era nulo o no coincidía con esa ventana, el resultado podía quedar en 0 aunque el inventario siguiera cargado.
3. **Schema rígido en catálogo**: el bot asumía columnas fijas (`status`, `dealership_id`, `pictures`, etc.). Si el schema cambiaba o venía distinto desde Supabase, podía ocultar stock válido.

## Cambios aplicados
### apps/bot/src/services/catalog.ts
- Se fuerza la lectura del catálogo desde `supabasePool` cuando `SUPABASE_DATABASE_URL` está configurada.
- Se elimina el fallback automático a Railway para la fuente directa de catálogo.
- Se agrega autodetección de tabla/columnas desde `information_schema`.
- `status` deja de ser obligatorio y sólo excluye estados explícitamente inactivos.
- `CATALOG_DEALERSHIP_ID` sólo filtra si existe la columna `dealership_id`.
- `pictures` acepta array real o JSON string.
- Si una lectura fresca devuelve 0 pero había cache válida, reutiliza la última cache buena.
- Se agregan logs de fuente y cantidad real cargada.

### apps/bot/src/services/demands.ts
- Las lecturas de vehículos para matching quedan ancladas a Supabase cuando está configurado.
- Se elimina la dependencia efectiva del filtro incremental por `since` para listar inventario.
- El matching ahora recorre el inventario completo (`strategy=full-inventory`).
- Si una lectura devuelve 0 pero existe un último escaneo bueno reciente, reutiliza ese snapshot.

### apps/bot/src/routes/admin.ts
- Nuevo endpoint `GET /admin/catalog-debug`
- Devuelve:
  - estado del cache del catálogo
  - fuente detectada
  - si está usando Supabase directo
  - estado del último snapshot bueno de demands

## Qué verificar en Railway
Buscar logs como estos:

```txt
[catalog] loaded 29 vehicles from public.vehicles
[demands] scan source=public.vehicles vehicles=29 strategy=full-inventory
```

## Variables importantes
- `SUPABASE_DATABASE_URL`
- `CATALOG_DEALERSHIP_ID` (solo si corresponde)
- `CATALOG_CACHE_TTL_MS`
- `DEMAND_SCAN_MS`

## Endpoint de debug
Con header `x-admin-token`:

```txt
GET /admin/catalog-debug
```

Sirve para confirmar si el bot tiene cache, qué fuente detectó y si demands está usando el último snapshot bueno.
