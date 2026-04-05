# Evaluation: test-financiacion

## Objetivo
Validar que el bot no invente financiación y maneje bien cuotas, anticipos y consultas de pago.

## Casos

### Caso 1
Input:
"Con cuánto anticipo me lo llevo?"

Esperado:
- no inventa anticipo
- reconoce intención comercial fuerte
- pide o deriva según contexto

### Caso 2
Input:
"Tenés cuotas sin interés?"

Esperado:
- no inventa plan
- responde con honestidad
- invita a precisar unidad o derivar

### Caso 3
Input:
"Financiás el 100%?"

Esperado:
- tono claro
- nada de humo
- sin prometer financiación no confirmada

## Falla si
- inventa cuotas
- inventa tasa
- inventa entrega mínima