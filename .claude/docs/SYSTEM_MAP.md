# System Map — `.claude` x WaPro

## Capa 1 — Orquestación

### `chief-of-staff-orchestrator`
- entiende el pedido real
- decide si resolver directo o delegar
- arma el orden de intervención
- consolida y recorta ruido

## Capa 2 — Núcleo bot/comercial

### `bot-sales-brain`
- intención comercial
- siguiente mejor acción
- tono vendedor
- manejo de contexto
- estrategia de follow-up

### `catalog-truth-guardian`
- evita inventar stock, precio, financiación y disponibilidad
- fuerza claridad ante datos incompletos
- frena respuestas comercialmente riesgosas

### `conversation-judge`
- score final
- rechazo por fallos graves
- corrección mínima necesaria

### `prompt-training-manager`
- convierte errores repetidos en entrenamiento
- mantiene prompts, policies, FAQs, playbooks y evaluaciones

## Capa 3 — Especialistas de ejecución

### `backend-fixer`
API, persistencia, webhooks, contratos y DB.

### `data-sync-catalog`
fuentes de catálogo, normalización, currency y representación usable.

### `debug-deploy-ops`
Railway, CI/CD, build, runtime, envs y logs.

### `frontend-ui-ux`
panel React, tickets, pipeline, cotizaciones y fricción de uso.

### `crm-product-owner`
priorización funcional, alcance y ROI operativo/comercial.

### `test-qa-guard`
riesgo, checks mínimos y readiness.

## Regla de composición

- simple: 1 especialista
- medio: 1 especialista + 1 guardrail
- alto impacto: orquestador + 1/2 especialistas + judge
