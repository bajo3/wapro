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
- **objeciones y leads fríos** (usa skills dedicadas)

### `catalog-truth-guardian`
- evita inventar stock, precio, financiación y disponibilidad
- fuerza claridad ante datos incompletos
- frena respuestas comercialmente riesgosas
- **manejo de doble moneda ARS/USD**

### `conversation-judge`
- score final usando EVAL_SCORECARD.md
- rechazo por fallos graves
- corrección mínima necesaria

### `prompt-training-manager`
- convierte errores repetidos en entrenamiento
- mantiene prompts, policies, FAQs, playbooks y evaluaciones
- **gestiona skills y evaluations en .claude/**

## Capa 3 — Especialistas de ejecución

### `backend-fixer`
API, persistencia, webhooks, contratos y DB.

### `data-sync-catalog`
Fuentes de catálogo, normalización, currency y representación usable.

### `debug-deploy-ops`
Railway, CI/CD, build, runtime, envs y logs.

### `frontend-ui-ux`
Panel React, tickets, pipeline, cotizaciones y fricción de uso.

### `crm-product-owner`
Priorización funcional, alcance y ROI operativo/comercial.

### `test-qa-guard`
Riesgo, checks mínimos y readiness — usa AGENT_CHECKLIST.md.

## Skills (capa transversal)

Las skills son comportamientos específicos que los agentes aplican según contexto.
No son agentes — son instrucciones que un agente carga para una tarea particular.

| Categoría | Skills |
|---|---|
| Catálogo y verdad | `consultar-catalogo-sin-inventar`, `moneda-dual-ars-usd` |
| Lead y captura | `detectar-intencion-comercial`, `extraer-filtros-del-cliente`, `generar-lead-completo` |
| Ventas y conversación | `vendedor-consultivo`, `manejar-objeciones` |
| Gestión del lead | `seguimiento-lead-frio`, `escalar-a-humano` |

## Regla de composición

- simple: 1 especialista
- medio: 1 especialista + 1 guardrail
- alto impacto: orquestador + 1/2 especialistas + judge
