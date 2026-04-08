---
name: dev-systematic-debugging
description: Usar cuando hay bugs, errores, test failures, o comportamiento inesperado — ANTES de proponer cualquier fix. Solo para tareas técnicas (código, backend, bot engine, Railway). NO usar en flujos comerciales o del bot.
---

# Systematic Debugging — WaPro

## Iron Law

```
NO HAY FIX SIN ROOT CAUSE IDENTIFICADO PRIMERO
```

Si no completaste la Fase 1, no podés proponer fixes.

## Cuándo usarlo

- Test failures
- Bugs en producción / Railway
- Comportamiento inesperado del bot o API
- Build failures / errores TypeScript
- Problemas de integración entre servicios

**Especialmente cuando:**
- Parece un "quick fix" obvio → no lo es
- Ya intentaste varios fixes y no funcionó
- No entendés del todo el error

## Las Cuatro Fases

**Completá cada fase antes de pasar a la siguiente.**

### Fase 1: Root Cause

1. **Leé el error completo** — stack trace, line numbers, file paths. No lo saltes.
2. **Reproducí de forma consistente** — si no podés reproducirlo, recolectá más datos, no adivines.
3. **Revisá cambios recientes** — git diff, últimos commits, cambios de config, vars de entorno en Railway.
4. **En sistemas multi-componente** (bot → Evolution API → DB → webhook):
   - Agregá logging en cada boundary antes de proponer fix
   - Correlo una vez para ver DÓNDE rompe
   - Analizá evidencia → identificá componente fallando → investigá ese componente
5. **Trazá el data flow** — ¿dónde origina el valor malo? Trazá hacia arriba hasta la fuente. Fix en la fuente, no en el síntoma.

### Fase 2: Análisis de patrón

- Encontrá código similar que SÍ funciona en el mismo repo
- Comparalo con el código roto → listá todas las diferencias
- Entendé las dependencias: env vars, contratos de API, estado compartido

### Fase 3: Hipótesis y prueba

1. Formulá UNA hipótesis: "creo que X es la causa porque Y"
2. Hacé el cambio MÁS PEQUEÑO posible para testear esa hipótesis
3. Si funcionó → Fase 4. Si no → nueva hipótesis, no apilés fixes.

### Fase 4: Implementación

1. Creá un test que falle reproduciendo el bug (ver `dev-tdd.md`)
2. Implementá fix único apuntando a la root cause
3. Verificá: test pasa, no hay regresiones

**Si 3+ fixes fallaron → STOP.** Preguntá si el problema es arquitectural antes de intentar otro fix.

## Red Flags — STOP, volvé a Fase 1

| Pensamiento | Realidad |
|---|---|
| "Quick fix por ahora" | No existe. Tiene root cause. |
| "Pruebo X a ver qué pasa" | Eso es adivinar, no debuggear. |
| "Cambio varias cosas a la vez" | No podés saber qué funcionó. |
| "Ya probé 3 fixes, uno más" | 3+ failures = problema arquitectural. |
| "No entiendo bien pero puede ser esto" | Si no entendés, no fijés. Investigá más. |

## Señales del humano de que estás haciéndolo mal

- "¿Eso está pasando realmente?" → asumiste sin verificar
- "Pará de adivinar" → estás proponiendo fixes sin entender
- "Pensalo bien" → cuestioná fundamentos, no síntomas

## Quick Reference

| Fase | Actividad clave | Criterio de éxito |
|---|---|---|
| **1. Root Cause** | Leer errores, reproducir, trazar data flow | Entendés QUÉ y POR QUÉ |
| **2. Patrón** | Encontrar ejemplos que funcionan, comparar | Identificaste diferencias |
| **3. Hipótesis** | Teoría específica, test mínimo | Confirmada o nueva hipótesis |
| **4. Fix** | Test que falla → fix → verificación | Bug resuelto, sin regresiones |
