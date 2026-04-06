---
name: phase3_autolearning
description: Estado de la Fase 3 de autoaprendizaje del bot — tabla bot_memory, wiring en webhooks, evaluación post-turno real
type: project
---

Fase 3 de autoaprendizaje implementada y compilando sin errores (2026-04-05).

**Qué existe:**
- `apps/bot/sql/017_bot_memory_phase3.sql` — migración SQL con tabla `bot_memory` e índices
- `apps/bot/src/services/botMemory.ts` — módulo unificado Fase 1+2+3
- `apps/bot/src/routes/webhooks.ts` — wiring del pipeline de aprendizaje

**Flujo implementado:**
1. Turno N: `selfEvaluateResponse()` → log `[SELF_EVAL]`
2. Turno N+1: `evaluateResponseOutcome()` → `calculateOutcomeScore()` → `classifyMemoryEntry()` → `saveMemoryToDB()` (async, no bloquea)
3. `selectFewShotExamples(context, 3)` → `formatFewShotBlock()` → inyectado en prompt del agente

**Guardrails:**
- `FORBIDDEN_IN_MEMORY` (palabras) + `FORBIDDEN_PATTERNS` (regex) en `isSafeToLearn()`
- Cualquier violación → log `[MEMORY_GUARDRAIL_VIOLATION]` → NOT saved
- `anti_pattern` y `bad_generic_reply` excluidos de `selectFewShotExamples()`

**Fallback:** Si DB no disponible, el sistema sigue funcionando con capa RAM/JSON (Fase 2).

**Why:** El autoaprendizaje real requiere evaluar respuestas con comportamiento real del usuario (turno N+1), no solo heurísticas en el momento de generar la respuesta.

**How to apply:** Si hay bugs de memoria o few-shot, revisar `botMemory.ts` funciones `evaluateResponseOutcome`, `classifyMemoryEntry`, `selectFewShotExamples`. El wiring está en `webhooks.ts` alrededor de líneas 930-970 (evaluación) y 1919 (few-shot).
