# .claude — WaPro

Sistema de agentes, skills y evaluaciones para WaPro CRM automotriz.

## Estructura

```
.claude/
├── agents/          # Definiciones de agentes (quién es, cuándo usarlo, scope)
├── agent-memory/    # Memoria persistente por agente (decisiones, bugs, contexto)
├── docs/            # Mapas y documentación del sistema
├── evaluations/     # Casos de prueba para validar comportamiento del bot
├── prompts/         # Prompt del orquestador principal
├── shared/          # Archivos compartidos por todos los agentes
└── skills/          # Comportamientos específicos que los agentes cargan por contexto
```

## Archivos clave

| Archivo | Para qué |
|---|---|
| `docs/START_HERE.md` | Punto de entrada — rutas por tipo de tarea |
| `shared/AGENT_OPERATING_SYSTEM.md` | Reglas comunes a todos los agentes |
| `docs/AGENT_MATRIX.md` | Tabla de agentes, cuándo usarlos y qué skills usan |
| `docs/RUNTIME_MAP.md` | Mapa del código real del repo |
| `shared/HANDOFF_CONTRACT.md` | Contrato de input/output entre agentes |
| `shared/EVAL_SCORECARD.md` | Scorecard de calidad con umbrales |
| `shared/AGENT_CHECKLIST.md` | Checklist antes de cerrar cualquier caso |
| `shared/BOT_RESPONSE_POLICY.md` | Política de respuesta del bot + tabla de skills por situación |

## Agentes (11)

**Orquestación:** `chief-of-staff-orchestrator`

**Núcleo bot/comercial:** `bot-sales-brain`, `catalog-truth-guardian`, `conversation-judge`, `prompt-training-manager`

**Especialistas:** `backend-fixer`, `debug-deploy-ops`, `data-sync-catalog`, `frontend-ui-ux`, `crm-product-owner`, `test-qa-guard`

## Skills (14)

### Bot / Comerciales (9)

| Skill | Cuándo aplicar |
|---|---|
| `consultar-catalogo-sin-inventar` | Consultas de stock, precio o disponibilidad |
| `detectar-intencion-comercial` | Siempre, antes de responder |
| `extraer-filtros-del-cliente` | Cuando el lead describe lo que busca |
| `generar-lead-completo` | Al detectar interés comercial concreto |
| `vendedor-consultivo` | Para guiar y asesorar la compra |
| `manejar-objeciones` | Precio, tiempo, competencia, financiación, permuta |
| `moneda-dual-ars-usd` | Cualquier consulta con ARS y/o USD |
| `seguimiento-lead-frio` | Lead sin respuesta en 24hs+ |
| `escalar-a-humano` | Cierre, reclamo, objeción sin resolver, pedido explícito |

### Dev / Técnicas (5) — prefijo `dev-`

Solo para tareas técnicas. NO usar en flujos comerciales o del bot.

| Skill | Cuándo aplicar |
|---|---|
| `dev-systematic-debugging` | Bug, error, o comportamiento inesperado — antes de proponer fix |
| `dev-verification` | Antes de afirmar que algo está listo, funciona, o fue corregido |
| `dev-writing-plans` | Feature multi-paso con spec — antes de tocar código |
| `dev-tdd` | Implementar cualquier feature o bugfix — antes de escribir código |
| `dev-subagent-execution` | Ejecutar plan con tasks independientes en sesión actual |

## Evaluations (11)

Casos de prueba en `evaluations/`:
- `test-ambiguos`, `test-financiacion`, `test-permuta`, `test-stock`, `test-visita-y-escalado`
- `test-comparacion`, `test-objeciones`, `test-cierre-frio`, `test-moneda-dual`, `test-seguimiento`, `test-indecision`

## Regla de uso en Claude Code

```
Leer START_HERE.md → elegir agente dueño → aplicar skills relevantes → validar con AGENT_CHECKLIST.md
```
