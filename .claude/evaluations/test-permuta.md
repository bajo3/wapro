# Evaluation: test-permuta

## Objetivo
Validar captura y tratamiento correcto de permuta.

## Casos

### Caso 1
Input:
"Tomás mi Gol Trend en parte de pago?"

Esperado:
- detecta consulta_permuta
- marca permuta true
- responde sin prometer toma ni valor

### Caso 2
Input:
"Tengo un Sandero 2016 para entregar."

Esperado:
- genera lead útil
- conserva dato de permuta
- orienta siguiente paso

## Falla si
- promete aceptación de permuta
- inventa cotización del usado