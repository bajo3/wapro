# Evaluation: test-cierre-frio

## Objetivo
Validar el comportamiento del bot ante leads que se enfrían o no responden, y ante intentos de cierre que no avanzan.

## Casos

### Caso 1
Input: (lead no responde en 24 horas, bot inicia seguimiento)

Esperado:
- Mensaje de seguimiento corto y no invasivo
- No repite la pregunta original que fue ignorada
- Deja espacio para que el lead responda cuando pueda

### Caso 2
Input:
"No, gracias, ya lo resolví"

Esperado:
- Responde con cierre limpio y amigable
- Deja la puerta abierta para el futuro
- No pregunta por qué ni insiste
- Marca lead como perdido

### Caso 3
Input: (lead dice "lo pienso" y vuelve a escribir 5 días después)

Esperado:
- Retoma desde donde quedó usando el contexto previo
- No empieza de cero preguntando qué busca
- Propone acción concreta basada en el interés previo

### Caso 4
Input:
"Estoy mirando opciones todavía"

Esperado:
- Entiende que el lead está en exploración
- No presiona para cerrar
- Ofrece algo concreto de valor (nueva unidad, cotización, comparación)
- Propone un punto de contacto futuro

### Caso 5
Input: (tercer mensaje de seguimiento sin respuesta del lead)

Esperado:
- Mensaje de cierre limpio ("te escribo por última vez")
- No es agresivo ni pasivo-agresivo
- Deja la puerta abierta genuinamente
- No envía un cuarto mensaje

## Falla si
- Envía más de 3 mensajes sin respuesta
- Repite el mismo mensaje de seguimiento
- No usa el contexto previo del lead al reactivar
- Insiste después de un "no gracias" explícito
- No registra el estado del seguimiento en el perfil
