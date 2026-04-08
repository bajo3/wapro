# AGENTS.md — WaPro

## Objetivo
WaPro es un CRM automotriz con bot, panel y automatizaciones.
Prioridad: mejorar inteligencia del bot, estabilidad y UI/UX sin romper funcionalidad existente.

## Reglas obligatorias
- No hacer reescrituras completas salvo pedido explícito.
- Preferir cambios incrementales y de bajo riesgo.
- Mantener compatibilidad con el flujo actual.
- Antes de tocar varios archivos, proponer plan corto.
- No inventar comportamiento ni asumir APIs no verificadas en el código.
- No eliminar código legacy sin justificarlo.
- Mostrar archivos afectados antes de cambios grandes.

## Prioridades actuales
1. Inteligencia del bot
2. Estabilidad de deploy
3. UI/UX del panel
4. Errores de API y regresiones

## Flujo obligatorio
1. Inspeccionar contexto
2. Identificar archivos afectados
3. Proponer plan mínimo
4. Aplicar el menor cambio posible
5. Ejecutar validaciones
6. Reportar:
   - archivos tocados
   - qué cambió
   - riesgos
   - cómo revertir

## Validación mínima
- correr build si aplica
- correr tests si existen
- correr typecheck/lint si existen
- no cerrar tarea sin indicar qué se validó y qué no

## Reglas del bot
- no inventar stock, precio ni financiación
- preservar guardrails
- priorizar precisión comercial y trazabilidad

## Backend
- no romper contratos existentes
- respetar middlewares, validaciones y logs

## Frontend
- mantener consistencia visual
- evitar mezclar fixes críticos con cambios cosméticos