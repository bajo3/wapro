---
name: dev-subagent-execution
description: Usar cuando tenés un plan de implementación con tasks independientes y querés ejecutarlo en la sesión actual. Fresh subagent por task + review de dos etapas. Solo para tareas técnicas. NO usar en flujos comerciales o del bot.
---

# Subagent-Driven Execution — WaPro

## Core Principle

Fresh subagent por task + review de dos etapas (spec compliance → code quality) = alta calidad, iteración rápida.

Los subagentes no heredan el contexto de la sesión. Vos construís exactamente lo que necesitan.

## Cuándo usar

- Tenés un plan de implementación (de `dev-writing-plans`)
- Las tasks son mayormente independientes
- Querés ejecutar en esta sesión (no paralela)

Si las tasks están fuertemente acopladas → ejecutá manualmente en orden.

## El proceso por task

```
1. Extraé el texto completo de la task del plan
2. Dispatch implementer subagent con:
   - texto completo de la task
   - contexto de la sesión (cuál es el goal, qué ya se hizo)
   - archivos relevantes como contexto
3. Si el subagente pregunta → respondé antes de que implemente
4. Subagente implementa, testea, hace self-review, commitea
5. Dispatch spec reviewer → ¿el código cumple el spec?
   - Si NO → implementer fix → spec reviewer de nuevo
6. Dispatch code quality reviewer → ¿el código es de buena calidad?
   - Si NO → implementer fix → code reviewer de nuevo
7. Marcá la task como completa
8. Siguiente task
```

## Estados del subagente implementer

- **DONE**: procedé a spec review
- **DONE_WITH_CONCERNS**: leé las concerns antes de hacer review. Si son sobre correctness → resolvelas primero. Si son observaciones → notá y procedé.
- **NEEDS_CONTEXT**: el subagente necesita info que no tenía → proveéla y re-dispatch
- **BLOCKED**: evaluá el blocker → más contexto, modelo más capaz, o dividir la task. Nunca forzar retry sin cambios.

## Selección de modelo

- Tasks mecánicas (1-2 archivos, spec clara) → modelo fast/cheap
- Integración multi-archivo → modelo estándar
- Arquitectura, design, review → modelo más capaz disponible

## Red Flags

- Empezar en main/master sin consentimiento explícito
- Saltear cualquiera de los dos reviews
- Proceder con issues abiertos sin fix
- Confiar en el reporte del subagente sin verificar (ver `dev-verification.md`)
- Hacer que el subagente lea el plan → proveer texto completo directamente
- Dejar que el self-review del implementer reemplace el review real

## Integración WaPro

Después de todas las tasks, corrés `test-qa-guard` si el cambio toca backend, bot o catálogo (ver `shared/AGENT_CHECKLIST.md`).

Plans se guardan en `docs/plans/` (no en `docs/superpowers/plans/`).
