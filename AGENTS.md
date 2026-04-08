# AGENTS.md — WaPro

## Proyecto
WaPro es un CRM automotriz con:
- bot conversacional comercial
- panel operativo Whaticket
- gateway Meta / WhatsApp
- integraciones de catálogo y persistencia
- despliegues en Railway

## Objetivo principal
Mejorar inteligencia del bot, estabilidad operativa y UX del panel sin romper funcionalidad existente.

## Prioridades actuales
1. Inteligencia comercial del bot
2. Verdad comercial: no inventar stock, precio, moneda ni financiación
3. Estabilidad de deploy y runtime
4. UX operativa del panel
5. Integraciones entre bot, panel, catálogo y gateways

## Reglas obligatorias
- No hacer reescrituras completas salvo pedido explícito.
- Preferir cambios incrementales y de bajo riesgo.
- Mantener compatibilidad con el flujo actual.
- Antes de tocar varios archivos: explicar problema, archivos afectados, plan mínimo y riesgos.
- No asumir APIs ni contratos no verificados en el código.
- No borrar legacy sin justificar.
- No mezclar refactor cosmético con fix crítico.
- Si algo compila pero no está validado en flujo real, no marcarlo como resuelto.
- Si el cambio toca stock, precio, moneda, disponibilidad o financiación, aplicar criterio de guardrail comercial.
- Si hay duda entre lógica, datos o deploy, separar diagnóstico por capa antes de tocar código.

## Validación mínima
- build si aplica
- tests si existen
- lint/typecheck si existen
- validación funcional puntual del flujo afectado
- reportar qué sí se validó y qué no

## Estilo de trabajo
1. inspeccionar contexto
2. identificar dueño principal
3. proponer plan mínimo
4. aplicar fix mínimo suficiente
5. validar
6. reportar:
   - archivos tocados
   - cambio exacto
   - riesgos residuales
   - rollback simple

## Dueños por dominio
- bot comercial / prompts / memoria / scoring: `bot-sales-brain`
- stock / precio / moneda / catálogo: `catalog-truth-guardian`
- backend / contratos / persistencia / webhooks: `backend-fixer`
- deploy / Railway / env / runtime / CORS: `debug-deploy-ops`
- frontend / UX / tickets / pipeline / cotizaciones: `frontend-ui-ux`
- sync de catálogo / Supabase / Railway: `data-sync-catalog`
- evaluación de calidad y regresión del bot: `conversation-judge`
- priorización funcional y alcance: `crm-product-owner`
- entrenamiento, examples, FAQs y datasets: `bot-trainer`
- coordinación entre varios dominios: `chief-of-staff-orchestrator`

## Reglas comerciales del bot
- no inventar stock, precio, cuota, tasa, disponibilidad ni versión
- no convertir ARS/USD salvo que el sistema lo tenga explícitamente resuelto
- una sola pregunta útil por turno si falta información
- no repreguntar datos ya capturados
- priorizar siguiente paso comercial concreto
- si hay objeción repetida o incertidumbre alta, considerar handoff a humano

## Estructura relevante del repo
- `apps/bot/` — bot comercial, inteligencia, extracción, catálogo
- `apps/panel-whaticket/backend/` — API, persistencia, tickets, vehículos, cotizaciones
- `apps/panel-whaticket/frontend/` — UI operativa React/MUI
- `apps/gateway-meta/` — integración Meta / webhooks
- `apps/evolution-api/` — gateway WhatsApp embebido
- `apps/evolution-manager/` — UI/gestión complementaria de Evolution

## Anti-patrones prohibidos
- cerrar por “debería funcionar”
- tocar muchos módulos sin necesidad
- arreglar síntomas sin identificar causa raíz
- meter nuevas dependencias salvo necesidad real
- responder con afirmaciones comerciales sin evidencia de datos
