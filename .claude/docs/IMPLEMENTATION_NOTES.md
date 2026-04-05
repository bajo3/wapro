# Implementation Notes — WaPro

## Lo que esta carpeta debe optimizar

### Bot
- menos invención
- menos repreguntas
- mejor captura de presupuesto/intención
- mejores alternativas cuando no hay match exacto
- mejor escalado a humano

### Catálogo
- fuente de verdad clara
- moneda consistente
- modelo/versión/km visibles
- representación comercial útil

### Panel
- menos fricción operativa
- estados visibles
- acciones frecuentes accesibles
- continuidad entre bot, ticket, lead y cotización

### Operación
- build/deploy previsibles
- logs auditables
- fixes pequeños pero robustos

## Nota importante para este repo

No crear una capa paralela que ignore lo que ya existe en `apps/bot/src/services/`.

Servicios ya relevantes:
- `extract.ts`
- `guardrails.ts`
- `intelligence.ts`
- `salesIntelligence.ts`
- `salesCoach.ts`
- `learning.ts`
- `conversationAnalyzer.ts`
- `commercialAudit.ts`
- `leadMemory.ts`
- `vehicleRanker.ts`

El trabajo del sistema `.claude` es **guiar mejor cambios sobre ese runtime**, no duplicarlo en documentos.
