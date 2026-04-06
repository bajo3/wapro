# Agents — WaPro

Auditado y optimizado: 2026-04-06

## Cómo elegir el agente correcto

### 1. Identificá el dominio del problema
No arranques por orquestación. Elegí el especialista dueño.

### 2. Usá guardrails solo cuando agreguen valor
- `catalog-truth-guardian` → si el tema toca stock, precio, moneda, versión o disponibilidad
- `conversation-judge` → para auditoría final de respuesta del bot O checklist de release

### 3. Escalá a orquestación solo si hay cruce real de dominios
`chief-of-staff-orchestrator` — solo para casos mixtos o ambiguos. No es el entry point por default.

---

## Agentes activos (9)

### Orquestación
| Agente | Cuándo usar |
|--------|-------------|
| `chief-of-staff-orchestrator` | Tarea mixta que cruza 2+ dominios, o alto riesgo |

### Núcleo bot/comercial
| Agente | Cuándo usar |
|--------|-------------|
| `bot-sales-brain` | Comportamiento runtime del bot: intención, respuesta, objeciones, seguimiento |
| `catalog-truth-guardian` | Validar stock, precio, moneda, disponibilidad antes de afirmarlos |
| `conversation-judge` | Auditoría de respuesta del bot (Modo A) o QA de release (Modo B) |
| `bot-trainer` | Artefactos de entrenamiento: examples, FAQs, evaluations, prompt, playbooks |

### Especialistas técnicos
| Agente | Cuándo usar |
|--------|-------------|
| `backend-fixer` | Bugs backend, API, contratos, persistencia, webhooks |
| `debug-deploy-ops` | Railway, build, env, runtime, CI/CD, drift local/prod |
| `data-sync-catalog` | Calidad y consistencia del catálogo vehicular |
| `frontend-ui-ux` | Panel React, ergonomía operativa, bugs de UI |

---

## Archivos deprecados (no usar)
- `crm-product-owner.md` — Felipe es el PO directo
- `test-qa-guard.md` — absorbido por `conversation-judge` Modo B
- `prompt-training-manager.md` — renombrado a `bot-trainer.md`

---

## Regla de ownership
Cada tarea debe tener **un solo dueño principal**.
Los demás agentes acompañan, validan o bloquean.

## Regla de orquestación
Antes de llamar a `chief-of-staff-orchestrator`, preguntate:
¿Puede un solo agente especialista resolverlo bien? Si sí → no orquestar.
