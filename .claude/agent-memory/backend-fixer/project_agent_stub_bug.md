---
name: Agent stub bug — decideAgentAction siempre devolvía null
description: Bug crítico resuelto en 2026-03-26: el agente GPT era un stub que nunca llamaba a OpenAI
type: project
---

`apps/bot/src/services/agent.ts` contenía `decideAgentAction` como stub con comentario
"...rest of your original decideAgentAction implementation goes here..." y `return null` al final.

Esto causaba que el fallback GPT en `playground.ts` nunca generara respuestas, aunque
`OPENAI_API_KEY` estuviera configurada. El error era completamente silencioso porque el catch
en `playground.ts` no logueaba nada.

**Fix aplicado (2026-03-26):**
- `agent.ts`: implementado `decideAgentAction` real que llama a `askGPTJson` con el system prompt correcto y serializa el catálogo como texto compacto (máx 80 items).
- `agent.ts`: `selectModel` y `buildClosingSystemPrompt` ahora son implementaciones reales (no stubs).
- `playground.ts`: merged `extracted` del mensaje actual con `state.extracted` antes de pasarlo al agente.
- `playground.ts`: catch del agente ahora loguea el error en lugar de tragárselo silenciosamente.

**Why:** El stub era el resultado de un merge incompleto — el archivo fue escrito como "snippet a mergear" pero quedó como el archivo definitivo.
**How to apply:** Si el bot responde con el fallback "Sin respuesta del agente", verificar primero que `decideAgentAction` no sea un stub antes de buscar problemas de configuración.
