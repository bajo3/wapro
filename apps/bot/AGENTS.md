# AGENTS.md — apps/bot

## Foco
Bot comercial de WaPro: intención, extracción, contexto, scoring, guardrails, catálogo y respuesta al lead.

## Archivos clave
- `src/routes/webhooks.ts`
- `src/services/agent.ts`
- `src/services/conversationAnalyzer.ts`
- `src/services/salesCoach.ts`
- `src/services/intelligence.ts`
- `src/services/extract.ts`
- `src/services/leadMemory.ts`
- `src/services/catalog.ts`
- `src/services/vehicleRanker.ts`

## Reglas
- no inventar stock, precio, financiación, moneda ni disponibilidad
- una sola pregunta útil por turno
- no repreguntar datos ya capturados
- separar problema de prompt, lógica, threshold o datos
- si hay dato comercial sensible, validar contra catálogo o responder en forma segura
- preservar logs, trazabilidad y guardrails

## Validación mínima
- revisar flujo afectado
- verificar que no aparezcan repreguntas inútiles
- verificar que no afirme datos sin evidencia
- dejar al menos un caso de prueba o conversación ejemplo
