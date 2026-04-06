# Memoria — catalog-truth-guardian
Última actualización: 2026-04-05

## Decisiones confirmadas
- Guardrail principal: nunca afirmar stock, precio, financiación, km o versión sin evidencia del sistema
- Distinción clave: "no confirmado" ≠ "no existe"
- Skill activa: `consultar-catalogo-sin-inventar` v1 + `moneda-dual-ars-usd` v1

## Contexto de moneda
- Mercado automotriz AR opera en doble moneda ARS/USD
- Bot no debe convertir monedas con tipo de cambio propio
- Si precio está en USD y lead pregunta en ARS → derivar a vendedor
- Registrar moneda del presupuesto del lead siempre

## Datos críticos que nunca deben afirmarse sin evidencia
- stock / disponibilidad
- precio (en cualquier moneda)
- financiación / cuotas / tasa / anticipo
- kilometraje
- año / versión / transmisión / combustible
- titularidad comercial de la unidad
- tasación de permuta
