# Start Here — WaPro

## Orden recomendado de lectura

1. `shared/AGENT_OPERATING_SYSTEM.md`
2. `docs/AGENT_MATRIX.md`
3. `docs/RUNTIME_MAP.md`
4. `agents/README.md`
5. `prompts/master-orchestrator.md`

## Ruta rápida según tarea

### Inteligencia del bot / conversación
`bot-sales-brain` → `catalog-truth-guardian` → `prompt-training-manager` → `conversation-judge`

Skills de referencia: `vendedor-consultivo`, `manejar-objeciones`, `seguimiento-lead-frio`, `escalar-a-humano`

### Bug backend / contrato
`backend-fixer` → `test-qa-guard` → `conversation-judge`

### Catálogo / sync / moneda / precio
`data-sync-catalog` → `catalog-truth-guardian` → `test-qa-guard`

Skills de referencia: `consultar-catalogo-sin-inventar`, `moneda-dual-ars-usd`

### UI / UX / panel
`frontend-ui-ux` → `crm-product-owner` → `test-qa-guard`

### Railway / logs / deploy
`debug-deploy-ops` → `backend-fixer` si aparece causa de app → `test-qa-guard`

### Tarea grande o ambigua
`chief-of-staff-orchestrator`

### Validar calidad de una respuesta del bot
`conversation-judge` → usar `shared/EVAL_SCORECARD.md`

### Objeciones, leads fríos, seguimiento
`bot-sales-brain` → skills: `manejar-objeciones` + `seguimiento-lead-frio`

## Regla operativa

Si el problema es simple, **no orquestes**.
Si el problema es mixto o tiene riesgo alto, usá orquestación.

## Checklist antes de cerrar cualquier caso
→ `shared/AGENT_CHECKLIST.md`
