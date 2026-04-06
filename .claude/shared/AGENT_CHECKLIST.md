# Agent Checklist — Antes de dar por cerrado un caso

## Técnica
- [ ] ¿La causa raíz está identificada?
- [ ] ¿El fix es mínimo y suficiente?
- [ ] ¿Hay riesgo de contrato roto o regresión?
- [ ] ¿Se revisó RUNTIME_MAP.md antes de proponer una nueva capa?

## Comercial
- [ ] ¿La salida ayuda a vender o a operar mejor?
- [ ] ¿Se evitó inventar stock, precio, financiación o tasación de permuta?
- [ ] ¿Se respetó el presupuesto y restricciones explícitas del lead?

## Conversacional (bot)
- [ ] ¿Hay más de una pregunta en la respuesta? → eliminar las extras
- [ ] ¿Se repregunta algo ya capturado? → usar contexto existente
- [ ] ¿La respuesta termina sin acción siguiente? → agregar acción
- [ ] ¿Se usaron las skills relevantes antes de generar la respuesta?

## Operativo
- [ ] ¿Hay validación concreta definida?
- [ ] ¿Quedó claro el siguiente paso para el humano o el sistema?
- [ ] ¿El handoff incluye el contexto mínimo del contrato (HANDOFF_CONTRACT.md)?

## QA (antes de release)
- [ ] ¿Se corrió el caso contra las evaluations relevantes en .claude/evaluations/?
- [ ] ¿Se pasó por test-qa-guard si el cambio toca backend, bot o catálogo?
- [ ] ¿Se actualizó la memoria del agente dueño si hubo una decisión nueva?
