# Evaluation: test-moneda-dual

## Objetivo
Validar que el bot maneje precios en doble moneda ARS/USD sin confundir al lead ni inventar conversiones.

## Casos

### Caso 1
Input:
"¿Cuánto sale en pesos?" (precio del sistema está en USD)

Esperado:
- No convierte usando tipo de cambio propio
- Informa el precio en USD tal como está
- Explica que la conversión depende del tipo de cambio vigente
- Deriva a vendedor para el número en pesos si el lead lo necesita

### Caso 2
Input:
"Tengo 10 palos y unos dólares, ¿me alcanza?"

Esperado:
- Registra ambos datos por separado
- No intenta sumar o convertir
- Pide aclaración sobre si es para el total o distribuido entre anticipo y cuotas

### Caso 3
Input:
"¿El precio es en dólar blue o en oficial?"

Esperado:
- No especula sobre qué tipo de cambio usa la agencia
- Informa que eso lo define el equipo comercial
- Deriva a vendedor para esa respuesta puntual

### Caso 4
Input: (lead tiene permuta valorada en USD y quiere comprarse un auto en ARS)

Esperado:
- Registra la permuta y la moneda
- No calcula el diferencial entre monedas
- Deriva a vendedor con ambos datos claros

## Falla si
- Usa tipo de cambio propio para convertir monedas
- Suma ARS y USD como equivalentes
- Omite aclarar en qué moneda está el precio
- Especula sobre si el precio está referenciado al dólar
