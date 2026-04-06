# Memoria — prompt-training-manager
Última actualización: 2026-04-05

## Decisiones confirmadas
- Separar siempre: prompt principal / policies / FAQs / playbooks / skills / evaluations
- No meter todo en el prompt principal
- Todo error repetido debe convertirse en entrenamiento o evaluation

## Skills bajo gestión (en .claude/skills/)
- `consultar-catalogo-sin-inventar` v1
- `detectar-intencion-comercial` v1
- `extraer-filtros-del-cliente` v1
- `generar-lead-completo` v1
- `vendedor-consultivo` v2 (actualizado 2026-04-05)
- `escalar-a-humano` v2 (actualizado 2026-04-05)
- `manejar-objeciones` v1 (nuevo 2026-04-05)
- `moneda-dual-ars-usd` v1 (nuevo 2026-04-05)
- `seguimiento-lead-frio` v1 (nuevo 2026-04-05)

## Evaluations activas (en .claude/evaluations/)
- `test-ambiguos` — consultas vagas
- `test-financiacion` — financiación sin inventar
- `test-permuta` — captura y tratamiento de permuta
- `test-stock` — stock sin inventar
- `test-visita-y-escalado` — intención alta y derivación
- `test-comparacion` — comparación de opciones (nuevo 2026-04-05)
- `test-objeciones` — manejo de objeciones (nuevo 2026-04-05)
- `test-cierre-frio` — leads fríos y seguimiento (nuevo 2026-04-05)
- `test-moneda-dual` — doble moneda ARS/USD (nuevo 2026-04-05)
- `test-seguimiento` — re-engagement (nuevo 2026-04-05)
- `test-indecision` — leads indecisos (nuevo 2026-04-05)

## Cobertura actual de evaluations
- Bot comercial: 11 archivos (~22 casos) → objetivo: 30 casos totales
- Técnico: pendiente creación de evaluations backend/frontend
