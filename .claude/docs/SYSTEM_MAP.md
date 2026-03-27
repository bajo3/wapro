# System Map — Quién hace qué

## Capa 1: Orquestación
### chief-of-staff-orchestrator
- entrypoint principal
- decide si resolver directo o delegar
- consolida salida final

## Capa 2: Especialistas de ejecución
### backend-fixer
API, persistencia, contratos, DB, webhooks, encoding.

### frontend-ui-ux
React, tickets, pipeline, cotizaciones, ergonomía y bugs de estado.

### debug-deploy-ops
Railway, builds, envs, CI/CD, runtime y drift local/prod.

### data-sync-catalog
catálogo, mapeos, syncs, calidad de datos, moneda/precio/modelo.

### bot-sales-brain
criterio vendedor, contexto, extracción de intención, objeciones.

### prompt-training-manager
prompts, ejemplos, FAQs, policies, playbooks, eval continua.

### crm-product-owner
priorización, UX funcional, roadmap y ROI del producto.

### test-qa-guard
casos de prueba, regresión y validación final.

## Capa 3: Guardrails
### catalog-truth-guardian
protege verdad comercial y calidad de catálogo.

### revenue-commander
fuerza siguiente mejor acción comercial.

### conversation-judge
audita calidad final y detecta regresiones.

## Regla de composición
- simple: orquestador + 1 especialista
- medio: orquestador + 2 especialistas + 1 guardrail
- alto impacto: orquestador + 2/3 especialistas + judge final
