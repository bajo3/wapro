# Estado del proyecto

## Resumen
WaPro es un monorepo con:
- `apps/bot`: bot comercial WhatsApp
- `apps/panel-whaticket`: panel frontend/backend
- `apps/gateway-meta`: gateway meta
- `apps/evolution-*`: integración de WhatsApp

## Estado actual al 2026-04-01
- Bot ya lee stock desde Supabase de forma estable.
- Panel ya puede leer `/vehicles` desde Supabase.
- Se agregó `GET /admin/catalog-debug`.
- Se agregó acceso visual a ese debug en la pestaña **Stock del bot**.
- El siguiente foco es observabilidad del bot y uso real del catálogo en respuestas.

## Focos activos
1. Bot no siempre responde con autos aunque el catálogo exista.
2. Necesitamos test lab / observabilidad del razonamiento.
3. Hay que evitar regresiones de panel frontend.
