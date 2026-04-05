# Agents — WaPro

## Cómo usar esta carpeta

### 1. Elegí el dueño principal del problema
No arranques por tres agentes. Elegí uno.

### 2. Sumá guardrails solo si agregan valor
- `catalog-truth-guardian` si el tema toca stock, precio, moneda, versión o disponibilidad
- `conversation-judge` si querés auditoría final o el cambio es sensible

### 3. Escalá a orquestación solo cuando haga falta
`chief-of-staff-orchestrator` es útil cuando el caso toca varias capas o hay contradicción entre especialistas.

## Core agents

| Agente | Dueño de | Cuándo usar |
|---|---|---|
| `chief-of-staff-orchestrator` | estrategia, ruteo y síntesis | tareas mixtas, ambiguas o de alto impacto |
| `bot-sales-brain` | inteligencia comercial del bot | intención, respuestas, seguimiento, escalado comercial |
| `catalog-truth-guardian` | verdad comercial | stock, precio, moneda, catálogo, riesgo de invención |
| `conversation-judge` | auditoría final | validar calidad antes de aprobar |

## Support agents

| Agente | Dueño de | Cuándo usar |
|---|---|---|
| `backend-fixer` | backend/API/contratos/persistencia | bugs de backend, 200 OK sin persistencia, validaciones |
| `debug-deploy-ops` | Railway/build/runtime/env | fallos de deploy, logs, CORS, assets, drift local/prod |
| `data-sync-catalog` | syncs y calidad del catálogo | Supabase/Railway/ML, mapeos, currency, modelo/version |
| `frontend-ui-ux` | panel React y ergonomía | tickets, pipeline, cotizaciones, estados visuales |
| `crm-product-owner` | prioridad funcional y ROI | decidir qué conviene hacer primero |
| `prompt-training-manager` | entrenamiento del bot | prompts, playbooks, FAQs, ejemplos, tests |
| `test-qa-guard` | riesgo y regresión | checklist de release, edge cases, cobertura mínima |

## Regla de ownership

Cada tarea debe tener **un solo dueño principal**.
Los demás agentes acompañan, validan o bloquean.
