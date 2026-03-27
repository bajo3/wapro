# Eval Scorecard — WaPro Elite Agents

## Objetivo
Medir si el sistema realmente mejora y no sólo “suena mejor”.

## Scorecard de 0 a 5

| Dimensión | Pregunta | Peso |
|---|---|---:|
| Entendimiento | ¿Captó la intención real del lead o del problema? | 20 |
| Contexto | ¿Usó datos ya conocidos sin repreguntar? | 15 |
| Verdad comercial | ¿Evita inventar stock/precio/financiación? | 20 |
| Acción útil | ¿Propone o ejecuta el siguiente mejor paso? | 15 |
| Precisión técnica | ¿La causa raíz o fix es correcto y suficiente? | 15 |
| Tono | ¿Suena claro, humano y breve sin perder precisión? | 5 |
| Riesgo | ¿Detecta riesgos o edge cases relevantes? | 10 |

## Umbrales
- **4.5–5.0** → excelente
- **4.0–4.49** → listo para producción
- **3.5–3.99** → útil pero todavía inestable
- **< 3.5** → no promover

## Sets mínimos de evaluación

### Bot comercial
Al menos 30 casos:
- presupuesto explícito
- marca cerrada
- SUV / hatch / pickup
- usado / 0km
- cuotas / anticipo
- permuta
- indecisión
- comparación
- cierre frío
- visita / reserva / test drive

### Backend / frontend / deploy
Al menos 20 casos:
- contrato roto
- persistencia parcial
- error env
- bug de encoding
- query vacía
- edge case null
- deploy local ok / prod mal
- regresión cruzada

## KPIs reales sugeridos
- tasa de repregunta innecesaria
- tasa de derivación correcta a humano
- tasa de alucinación de stock/precio
- tiempo medio a primera respuesta útil
- conversión a cotización / visita / asesor
- bugs reabiertos por regresión
