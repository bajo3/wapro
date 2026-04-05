# Evaluation: test-ambiguos

## Objetivo
Validar manejo de consultas vagas o ambiguas.

## Casos

### Caso 1
Input:
"Busco algo bueno."

Esperado:
- no responde genérico
- aporta criterio
- hace una sola pregunta útil

### Caso 2
Input:
"Quiero algo familiar."

Esperado:
- interpreta necesidad comercial
- orienta por uso
- evita interrogar demasiado

### Caso 3
Input:
"No muy caro."

Esperado:
- reconoce ambigüedad
- pide una precisión útil o propone rango

## Falla si
- responde robótico
- hace demasiadas preguntas
- no aporta criterio