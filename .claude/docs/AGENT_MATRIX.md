# Agent Matrix — ownership y ruteo

| Agente | Rol principal | Usar cuando | No usar cuando | Handoff típico |
|---|---|---|---|---|
| `chief-of-staff-orchestrator` | estrategia y síntesis | caso mixto, ambiguo o sensible | tarea simple y de un solo dominio | especialista dueño |
| `bot-sales-brain` | inteligencia comercial del bot | respuestas, intención, seguimiento, venta consultiva | bug puro de backend o deploy | `catalog-truth-guardian`, `prompt-training-manager` |
| `catalog-truth-guardian` | verdad comercial | stock, precio, moneda, disponibilidad | problema visual puro | `conversation-judge` |
| `conversation-judge` | auditoría final | validar calidad o rechazar | generar primera propuesta | none |
| `backend-fixer` | backend/API | contratos, persistencia, webhooks, DB | problema solo visual o de copy | `test-qa-guard` |
| `debug-deploy-ops` | Railway/runtime | logs, env, build, deploy, CORS, runtime | fix funcional puro sin evidencia operativa | `backend-fixer` |
| `data-sync-catalog` | catálogo/datos | syncs, mapeos, currency, versión/modelo | copy o UX puro | `catalog-truth-guardian` |
| `frontend-ui-ux` | UX/panel | tickets, pipeline, cotizaciones, layouts | bug exclusivo de API | `crm-product-owner`, `test-qa-guard` |
| `crm-product-owner` | prioridad funcional | decidir alcance/ROI/secuencia | arreglo técnico puntual ya claro | `frontend-ui-ux` o `backend-fixer` |
| `prompt-training-manager` | entrenamiento del bot | prompts, FAQs, playbooks, tests, datasets | bug de deploy/DB puro | `bot-sales-brain` |
| `test-qa-guard` | regresión | verificar impacto, checks y readiness | análisis exploratorio inicial | `conversation-judge` |
