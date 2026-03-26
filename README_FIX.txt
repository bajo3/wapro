PATCH SEGURO

Incluye solo archivos aditivos que no deberían romper build/deploy:
- apps/bot/sql/011_faq_mejorado.sql
- apps/panel-whaticket/frontend/src/styles/wapro-design-tokens.css

NO incluye los reemplazos de:
- apps/bot/src/services/agent.ts
- apps/bot/src/routes/webhooks.ts
- apps/panel-whaticket/frontend/src/pages/Pipeline/index.js

Motivo:
los logs mostraron que esos archivos del ZIP anterior eran plantillas/incompletos y rompían el build.

Para aplicar las mejoras grandes (pipeline focus + anti-loop del bot) hace falta editar el repo real, no sobrescribir esos archivos con stubs.
