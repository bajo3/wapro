# Agent Matrix — ownership y ruteo

| Agente | Rol principal | Usar cuando | No usar cuando | Handoff típico |
|---|---|---|---|---|
| `chief-of-staff-orchestrator` | estrategia y síntesis | caso mixto, ambiguo o sensible | tarea simple y de un solo dominio | especialista dueño |
| `bot-sales-brain` | inteligencia comercial del bot | respuestas, intención, seguimiento, objeciones, venta consultiva | bug puro de backend o deploy | `catalog-truth-guardian`, `prompt-training-manager` |
| `catalog-truth-guardian` | verdad comercial | stock, precio, moneda, disponibilidad | problema visual puro | `conversation-judge` |
| `conversation-judge` | auditoría final | validar calidad o rechazar — usar EVAL_SCORECARD.md | generar primera propuesta | none |
| `backend-fixer` | backend/API | contratos, persistencia, webhooks, DB | problema solo visual o de copy | `test-qa-guard` |
| `debug-deploy-ops` | Railway/runtime | logs, env, build, deploy, CORS, runtime | fix funcional puro sin evidencia operativa | `backend-fixer` |
| `data-sync-catalog` | catálogo/datos | syncs, mapeos, currency, versión/modelo | copy o UX puro | `catalog-truth-guardian` |
| `frontend-ui-ux` | UX/panel | tickets, pipeline, cotizaciones, layouts | bug exclusivo de API | `crm-product-owner`, `test-qa-guard` |
| `crm-product-owner` | prioridad funcional | decidir alcance/ROI/secuencia | arreglo técnico puntual ya claro | `frontend-ui-ux` o `backend-fixer` |
| `prompt-training-manager` | entrenamiento del bot | prompts, FAQs, playbooks, tests, datasets | bug de deploy/DB puro | `bot-sales-brain` |
| `test-qa-guard` | regresión | verificar impacto, checks y readiness — usar AGENT_CHECKLIST.md | análisis exploratorio inicial | `conversation-judge` |

## Skills disponibles y quién las usa

| Skill | Agentes que la usan |
|---|---|
| `consultar-catalogo-sin-inventar` | `bot-sales-brain`, `catalog-truth-guardian` |
| `detectar-intencion-comercial` | `bot-sales-brain`, `prompt-training-manager` |
| `extraer-filtros-del-cliente` | `bot-sales-brain`, `data-sync-catalog` |
| `generar-lead-completo` | `bot-sales-brain`, `crm-product-owner` |
| `vendedor-consultivo` | `bot-sales-brain` |
| `manejar-objeciones` | `bot-sales-brain` |
| `moneda-dual-ars-usd` | `bot-sales-brain`, `catalog-truth-guardian`, `data-sync-catalog` |
| `seguimiento-lead-frio` | `bot-sales-brain`, `prompt-training-manager` |
| `escalar-a-humano` | `bot-sales-brain`, `conversation-judge` |
