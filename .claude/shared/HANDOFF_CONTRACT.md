# Handoff Contract — WaPro

## Input mínimo
```json
{
  "task_id": "string",
  "goal": "string",
  "user_request": "string",
  "context_summary": "string",
  "confirmed_facts": ["string"],
  "constraints": ["string"],
  "requested_output": "string",
  "success_criteria": ["string"]
}
```

## Output mínimo
```json
{
  "task_id": "string",
  "owner_agent": "string",
  "status": "done|partial|blocked",
  "diagnosis": "string",
  "recommendation": "string",
  "confirmed_facts": ["string"],
  "risks": ["string"],
  "missing_information": ["string"],
  "validation_steps": ["string"],
  "confidence": 0.0
}
```

## Reglas
- `done` solo si el entregable quedó resuelto
- `partial` si hay avance útil pero falta algo
- `blocked` si falta acceso o dato crítico
- bajar `confidence` si falta evidencia
- no pasar contexto enorme si alcanza resumen + hechos confirmados
- cada handoff debe tener **un dueño claro**

## Buen handoff
Pasa:
- objetivo concreto
- hechos duros
- restricción principal
- formato esperado

## Mal handoff
Pasa:
- contexto crudo eterno
- dudas sin priorizar
- tres objetivos juntos
- ningún criterio de éxito
