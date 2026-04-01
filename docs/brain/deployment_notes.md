# Deploy y diagnóstico

## Frontend panel
Servicio Railway con root `apps/panel-whaticket/frontend`.

## Error reciente
Build falló por:
`The symbol "MetricCard" has already been declared`
en `src/pages/Bot/index.js`.

## Validación rápida
- `GET /admin/catalog-debug` debe devolver `ok`, `supabase`, `source`, `count`.
- La pestaña Stock del bot debe mostrar el bloque visual de debug.
- Cotizaciones debe listar más de 15 autos.
