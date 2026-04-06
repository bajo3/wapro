# Memoria — chief-of-staff-orchestrator
Última actualización: 2026-04-05

## Decisiones confirmadas
- Regla principal: no orquestar por estética — si hay un dueño claro, usar solo ese agente
- Máximo 2 especialistas + judge salvo casos realmente complejos
- Las skills son transversales: no son agentes, son instrucciones que carga el agente dueño

## Estructura de capas actual
- Capa 1: chief-of-staff-orchestrator (orquestación)
- Capa 2: bot-sales-brain, catalog-truth-guardian, conversation-judge, prompt-training-manager (núcleo)
- Capa 3: backend-fixer, debug-deploy-ops, data-sync-catalog, frontend-ui-ux, crm-product-owner, test-qa-guard (especialistas)
- Skills (transversal): 9 skills activas — ver AGENT_MATRIX.md

## Rutas frecuentes
- objeciones / leads fríos → bot-sales-brain (con skills manejar-objeciones + seguimiento-lead-frio)
- doble moneda → catalog-truth-guardian (con skill moneda-dual-ars-usd)
- calidad de respuesta → conversation-judge (con EVAL_SCORECARD.md)
- release / cambio crítico → test-qa-guard (con AGENT_CHECKLIST.md)
