# Optimización aplicada a `.claude`

## Ronda 1 (previa a 2026-04-05)
- eliminado `revenue-commander` por solapamiento con `bot-sales-brain`
- removido `settings.local.json` por ser local y no portable
- estandarizados los agentes con scope explícito
- agregado mapa de runtime real de WaPro
- completadas skills faltantes
- completadas evaluations mínimas

## Ronda 2 (2026-04-05)

### Skills agregadas
- `manejar-objeciones` v1 — 5 patrones comerciales frecuentes en AR
- `moneda-dual-ars-usd` v1 — manejo de doble moneda sin conversión propia
- `seguimiento-lead-frio` v1 — 3 ventanas de re-engagement, máximo 3 mensajes

### Skills mejoradas
- `escalar-a-humano` v1 → v2: contexto estructurado al ticket, reglas post-escalado, cuándo no escalar
- `vendedor-consultivo` v1 → v2: cierre cálido, ranking de opciones, manejo de indecisión, anti-patrones

### Evaluations agregadas
- `test-comparacion` — comparación entre opciones sin sobrecargar
- `test-objeciones` — 5 objeciones comerciales frecuentes
- `test-cierre-frio` — seguimiento, re-engagement y cierre limpio
- `test-moneda-dual` — doble moneda ARS/USD
- `test-seguimiento` — re-engagement con contexto
- `test-indecision` — leads indecisos

### Agentes mejorados
- `conversation-judge`: ahora referencia explícitamente EVAL_SCORECARD.md con umbrales claros
- `bot-sales-brain`: referencia las 6 skills comerciales que debe aplicar por contexto

### Archivos compartidos actualizados
- `AGENT_CHECKLIST.md`: expandido con checks conversacionales y de QA
- `BOT_RESPONSE_POLICY.md`: tabla de routing skill por situación
- `AGENT_MATRIX.md`: tabla de skills y qué agentes las usan
- `SYSTEM_MAP.md`: capa de skills documentada
- `START_HERE.md`: rutas actualizadas incluyendo objeciones y seguimiento

### Memorias sincronizadas
- `bot-sales-brain/MEMORY.md` — al día con skills v2 y estado actual del agente
- `catalog-truth-guardian/MEMORY.md` — incluye contexto de doble moneda
- `prompt-training-manager/MEMORY.md` — inventario completo de skills y evaluations
- `chief-of-staff-orchestrator/MEMORY.md` — rutas frecuentes actualizadas

## Estado post-ronda 2

| Dimensión | Antes | Después |
|---|---|---|
| Skills | 6 | 9 |
| Evaluations | 5 | 11 |
| Cobertura objeciones | 0% | 100% (5 patrones) |
| Cobertura seguimiento | 0% | 100% |
| Cobertura moneda dual | 0% | 100% |
| Memorias sincronizadas | parcial | completo |
| Scorecard en judge | implícito | explícito |
| Checklist QA | básico | completo |
