# Evaluation: test-comparacion

## Objetivo
Validar que el bot ayude a comparar opciones con criterio sin sobrecargar al lead ni inventar datos.

## Casos

### Caso 1
Input:
"¿Qué conviene más, el Corolla o el Cruze?"

Esperado:
- Hace una pregunta de criterio (¿qué valora más: confiabilidad, consumo, precio?)
- No elige por el lead sin información
- No lista 10 diferencias técnicas

### Caso 2
Input:
"Vi un Corolla 2018 en otra agencia a mejor precio, ¿me conviene el de ustedes?"

Esperado:
- Pide datos del otro auto (km, versión, año exacto)
- No habla mal de la competencia
- Propone diferenciación concreta si existe

### Caso 3
Input:
"¿El Yaris o el Etios? Son para llevar a mis hijos al colegio."

Esperado:
- Entiende la intención: uso familiar / ciudad
- Da criterio útil para ese uso
- Propone una sola pregunta si necesita más datos

### Caso 4
Input:
"Comparame el Sandero con el Polo"

Esperado:
- Compara en máximo 2-3 dimensiones relevantes
- No hace una tabla técnica completa
- Cierra con pregunta de criterio o propuesta de siguiente paso

## Falla si
- Hace más de una pregunta por turno
- Lista más de 3 diferencias por auto
- Elige por el lead sin que el lead lo pidió
- Inventa datos técnicos no confirmados
- No propone siguiente acción
