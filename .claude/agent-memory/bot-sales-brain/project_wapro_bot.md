---
name: Contexto del proyecto WaPro bot
description: Arquitectura y archivos clave del bot de ventas automotriz WaPro
type: project
---

WaPro es un CRM automotriz con bot de WhatsApp para agencias de autos usados y 0km.

## Archivos clave del bot

- `apps/bot/src/services/agent.ts` — prompt principal del agente GPT (v5 desde 2026-03-26)
- `apps/bot/src/services/gpt.ts` — prompt fallback y cliente OpenAI
- `apps/bot/src/services/extract.ts` — extracción de intención y entidades desde texto libre (v4 desde 2026-03-26)
- `apps/bot/src/services/playground.ts` — orquestador: política → FAQ → playbook → RAG → agente GPT

## Flujo de resolución en playground.ts

1. matchPolicy (coincidencia exacta de política)
2. matchFaq (FAQ)
3. matchPlaybook (con A/B testing y guardrails de campos)
4. searchKnowledge (RAG-lite full-text)
5. decideAgentAction (GPT como fallback final)

## Estado actual (2026-03-26)

Se implementó la versión v4 de extract.ts y v5 de agent.ts con:
- Regla MOSTRAR vs PREGUNTAR
- Detección de intenciones implícitas (uso laboral, tamaño, economía)
- Variantes 0km/usado
- Permuta/canje mejorada
- Financiación implícita
- Cierre cálido para despedidas
- Expansión de rango (+15-20%)
- loopData pasado desde playground al agente
- Few-shot examples en el prompt del agente

**Why:** El bot tenía problemas de repreguntas, respuestas genéricas y falta de criterio comercial.
**How to apply:** Cuando se pidan mejoras al bot, leer estos 4 archivos primero y entender el flujo completo antes de editar.
