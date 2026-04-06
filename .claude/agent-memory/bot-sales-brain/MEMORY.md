# Memoria — bot-sales-brain
Última actualización: 2026-04-05

## Decisiones confirmadas
- Bot usa flujo playground.ts: policy → FAQ → playbook → RAG → agente GPT
- agent.ts v5 activo desde 2026-03-26 con regla MOSTRAR vs PREGUNTAR
- extract.ts v4 activo: detecta intenciones implícitas, permuta, financiación implícita, expansión de rango +15-20%
- Few-shot examples incluidos en el prompt del agente

## Skills activas para este agente
- `vendedor-consultivo` v2: reglas de conversación, ranking de opciones, cierre cálido
- `manejar-objeciones` v1: 5 patrones (precio, tiempo, competencia, financiación, permuta)
- `seguimiento-lead-frio` v1: 3 ventanas (24hs, 48hs, 7 días), máximo 3 mensajes
- `escalar-a-humano` v2: contexto estructurado al ticket, reglas post-escalado
- `detectar-intencion-comercial` v1: intenciones principales y secundarias
- `moneda-dual-ars-usd` v1: sin conversión propia, registro separado ARS/USD

## Reglas operativas fijas
- máximo 1 pregunta por turno
- no repreguntar datos ya capturados
- toda respuesta termina con acción siguiente
- si objeción no resuelta en 2 turnos → escalar
- si lead frío → aplicar skill seguimiento (máx 3 mensajes en 7 días)

## Bugs reincidentes conocidos
- repreguntas después de capturar presupuesto → corregido en v5
- respuestas genéricas ante consultas específicas → corregido en v5
- no detectaba financiación implícita → corregido en extract v4
