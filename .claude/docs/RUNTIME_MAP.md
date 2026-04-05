# Runtime Map — dónde vive hoy la lógica real

## Bot (`apps/bot/src/`)

### Servicios clave
- `services/extract.ts` → extracción de campos, intent y faltantes
- `services/guardrails.ts` → validaciones de calidad / señales de alucinación
- `services/intelligence.ts` → settings, episodios, policies, FAQs, playbooks y auditoría
- `services/salesIntelligence.ts` → lógica comercial del bot
- `services/salesCoach.ts` → coaching/reglas de mejora
- `services/learning.ts` → aprendizaje y memoria operativa
- `services/conversationAnalyzer.ts` → análisis conversacional
- `services/commercialAudit.ts` → auditoría comercial
- `services/leadMemory.ts` / `leadProfile.ts` / `lead.ts` → contexto y perfil del lead
- `services/catalog.ts` / `vehicleRanker.ts` / `demands.ts` → catálogo, ranking y matching

### Rutas clave
- `routes/webhooks.ts` → flujo principal del bot
- `routes/admin.ts` → panel de inteligencia, policies, FAQs, playbooks, examples, learning

## Panel
- `apps/panel-whaticket/frontend/src/` → tickets, pipeline, cotizaciones y UI
- `apps/panel-whaticket/backend/src/` → API del panel, persistencia y contratos

## Infra / Operación
- Railway
- GitHub Actions
- Supabase + Railway Postgres

## Regla para agentes

Antes de proponer “una nueva capa”, revisar si el punto correcto ya existe en este mapa.
