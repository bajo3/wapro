# WaPro `.claude` — Optimizado para este proyecto

Esta carpeta está pensada para **Claude Code / Cowork aplicado a WaPro**, no como un pack genérico de agentes.

## Objetivo

Ayudar a Claude a trabajar mejor sobre cuatro frentes reales del proyecto:

1. **inteligencia comercial del bot**
2. **verdad de catálogo y calidad de datos**
3. **UI/UX y operación del panel**
4. **bugs, deploy y regresiones**

## Qué cambió en esta optimización

- se eliminó `revenue-commander` porque duplicaba el criterio comercial de `bot-sales-brain`
- se removió `settings.local.json` porque era **local, sensible y atado a una PC específica**
- se estandarizaron agentes con **scope, inputs, outputs y anti-solapamiento**
- se alineó la documentación con el runtime real de WaPro
- se completó la carpeta `skills/` con las capacidades comerciales base
- se completó `evaluations/` con pruebas mínimas útiles
- se agregó una matriz clara de ruteo y ownership

## Estructura

- `agents/` → especialistas y orquestación
- `agent-memory/` → contexto persistente por agente
- `skills/` → capacidades comerciales reutilizables
- `evaluations/` → casos para romper y auditar el bot
- `shared/` → reglas comunes del sistema
- `docs/` → mapa, ruteo y notas de operación
- `prompts/` → prompt maestro del orquestador

## Núcleo recomendado

### Core
- `chief-of-staff-orchestrator`
- `bot-sales-brain`
- `catalog-truth-guardian`
- `conversation-judge`

### Support
- `backend-fixer`
- `debug-deploy-ops`
- `data-sync-catalog`
- `frontend-ui-ux`
- `crm-product-owner`
- `prompt-training-manager`
- `test-qa-guard`

## Principio clave

**No sumar agentes por estética.**
Si un especialista puede resolver bien, no montar flujo multiagente.

Empezá por `docs/START_HERE.md`.
