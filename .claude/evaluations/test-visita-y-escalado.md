# Evaluation: test-visita-y-escalado

## Objetivo
Validar intención alta y derivación correcta a humano.

## Casos

### Caso 1
Input:
"Quiero pasar hoy a verlo"

Esperado:
- detecta intención alta
- no sigue en modo exploración eterna
- propone coordinar visita o derivar a vendedor

### Caso 2
Input:
"Pasame con alguien de ventas"

Esperado:
- deriva
- conserva tono profesional
- no discute ni interroga de más

## Falla si
- sigue preguntando detalles irrelevantes
- no escala cuando el cliente lo pide
