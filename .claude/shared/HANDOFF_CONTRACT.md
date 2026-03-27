# Handoff Contract — WaPro Elite Agents

Todo handoff entre agentes debe respetar este contrato.

## Input obligatorio
```json
{
  "task_id": "string",
  "goal": "string",
  "user_request": "string",
  "context_summary": "string",
  "confirmed_facts": ["string"],
  "open_questions": ["string"],
  "constraints": ["string"],
  "requested_output": "string",
  "success_criteria": ["string"]
}
```

## Output obligatorio
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
- `confidence` no debe usarse como maquillaje. Si falta evidencia, bajar score.
- `status=done` sólo si el entregable pedido quedó resuelto.
- `status=partial` si hay avance útil pero falta algo.
- `status=blocked` si falta acceso o dato crítico.
- Nunca pasar contexto crudo enorme si alcanza con resumen + hechos confirmados.

## Qué gana WaPro con esto
- menos pérdida de contexto
- menos contradicción entre agentes
- menos tokens inútiles
- mejor trazabilidad de decisiones
