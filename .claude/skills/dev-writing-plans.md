---
name: dev-writing-plans
description: Usar cuando tenés spec o requerimientos de una tarea multi-paso ANTES de tocar código. Genera planes de implementación ejecutables con tasks granulares, TDD, y file paths exactos. Solo para tareas técnicas. NO usar en flujos comerciales o del bot.
---

# Writing Plans — WaPro

## Overview

Escribí planes de implementación asumiendo que el ingeniero tiene cero contexto del codebase. Documentá todo: qué archivos tocar, código real, cómo testear, comandos exactos. Tasks bite-sized. DRY. YAGNI. TDD. Commits frecuentes.

**Guardá plans en:** `docs/plans/YYYY-MM-DD-<nombre-feature>.md`

## Scope Check

Si el spec cubre múltiples subsistemas independientes, sugerí dividirlo en sub-plans. Cada plan debe producir software funcional y testeable por sí solo.

## File Structure (antes de las tasks)

Antes de definir tasks, mapeá qué archivos se crean o modifican y de qué son responsables. Cada archivo debe tener una responsabilidad clara.

- En WaPro: seguí la estructura del monorepo (apps/bot, apps/panel-whaticket/backend, apps/panel-whaticket/frontend)
- Revisá `docs/RUNTIME_MAP.md` antes de proponer una nueva capa

## Granularidad de tasks

**Cada step es una acción (2-5 minutos):**
- "Escribí el test que falla" — step
- "Corré para confirmar que falla" — step
- "Implementá el código mínimo para que pase" — step
- "Corré tests para confirmar que pasan" — step
- "Commit" — step

## Header obligatorio del plan

```markdown
# [Feature Name] — Plan de implementación

**Goal:** [Una oración describiendo qué construye]

**Architecture:** [2-3 oraciones sobre el approach]

**Stack relevante:** [tecnologías clave — ej: TypeScript, PostgreSQL, Evolution API]

**Files afectados:**
- Crear: `ruta/exacta/archivo.ts`
- Modificar: `ruta/exacta/existente.ts`
- Test: `ruta/exacta/test.ts`

---
```

## Estructura de task

```markdown
### Task N: [Nombre del componente]

**Files:**
- Crear/Modificar: `ruta/exacta`

- [ ] **Step 1: Escribí el test que falla**

\`\`\`typescript
test('comportamiento esperado', async () => {
  // ...
  expect(result).toBe(expected);
});
\`\`\`

- [ ] **Step 2: Corré el test — debe fallar**

\`\`\`bash
npm test -- ruta/al/test
\`\`\`
Expected: FAIL con "X is not defined" o similar

- [ ] **Step 3: Implementá el código mínimo**

\`\`\`typescript
// código real acá, no placeholder
\`\`\`

- [ ] **Step 4: Corré tests — deben pasar**

- [ ] **Step 5: Commit**

\`\`\`bash
git add ruta/archivo.ts
git commit -m "feat: descripción concreta"
\`\`\`
```

## No Placeholders

Nunca escribas en el plan:
- "TBD", "TODO", "implementar después"
- "Agregá manejo de errores apropiado" sin mostrar el código
- "Escribí tests para lo de arriba" sin el código del test
- "Similar a Task N" — repetí el código, el ingeniero puede leer tasks desordenadas

## Self-Review antes de entregar el plan

1. **Cobertura del spec:** ¿Cada requerimiento tiene una task?
2. **Scan de placeholders:** buscá los patrones de "No Placeholders" y corregí
3. **Consistencia de tipos:** ¿Los nombres de funciones/tipos en Task 7 coinciden con los definidos en Task 2?

Si encontrás problemas, corregílos inline.

## Handoff de ejecución

Después de guardar el plan, ofrecé:

> "Plan guardado en `docs/plans/<filename>.md`. Para ejecutarlo:
> 1. **Subagent-Driven** (recomendado) — fresh subagent por task, review entre tasks (ver `dev-subagent-execution.md`)
> 2. **Ejecución inline** — ejecutar tasks en esta sesión con checkpoints
>
> ¿Cuál preferís?"
