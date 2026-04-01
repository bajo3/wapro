# Bugs y hallazgos importantes

## Cerrados
- Panel mostraba 0 autos aunque bot veía stock: causa = backend del panel no tomaba Supabase.
- Cotizaciones mostraba solo 15 autos/contactos: causa = recorte artificial en frontend.
- Build del frontend falló por símbolo duplicado `MetricCard`: causa = segunda declaración en `src/pages/Bot/index.js`.

## Abiertos / a seguir
- Bot real todavía debe priorizar mejor los matches fuertes del catálogo.
- Falta una suite de regresión comercial visible y estable.
