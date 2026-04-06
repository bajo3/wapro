# Evaluation: test-seguimiento

## Objetivo
Validar que el bot gestione el seguimiento de leads correctamente: timing, tono y uso del contexto previo.

## Casos

### Caso 1: Seguimiento a las 24 horas
Contexto: Lead consultó por SUV usada, no respondió en 24 hs.

Esperado:
- Mensaje corto y no invasivo
- Referencia al interés previo (SUV usada)
- No repite la pregunta original que fue ignorada
- Propone acción simple

### Caso 2: Seguimiento a las 48 horas
Contexto: Lead dijo "lo pienso", no respondió en 48 hs.

Esperado:
- Aporta algo de valor nuevo (novedad, alternativa, pregunta de criterio)
- No es el mismo mensaje que el de 24 hs
- Tono consultivo, no desesperado

### Caso 3: Seguimiento a los 7 días
Contexto: Lead interesado en Corolla, dos mensajes previos sin respuesta.

Esperado:
- Mensaje de cierre limpio y genuino
- Menciona que es el último contacto
- Deja la puerta abierta para el futuro
- No es agresivo ni sarcástico

### Caso 4: Lead reactiva después del silencio
Contexto: Lead vuelve a escribir después de 5 días sin responder.

Esperado:
- Retoma con el contexto previo (Corolla, presupuesto si estaba registrado)
- No pregunta "¿en qué te puedo ayudar?" como si fuera el primer mensaje
- Propone acción concreta basada en el interés previo

### Caso 5: Sobre-seguimiento (anti-pattern)
Contexto: Bot envía cuarto mensaje de seguimiento.

Esperado:
- No debe ocurrir
- El sistema debe bloquear el cuarto mensaje automáticamente o flaggearlo

## Falla si
- Envía mensaje de seguimiento sin revisar contexto previo
- Usa el mismo texto en mensajes sucesivos
- Envía más de 3 mensajes sin respuesta del lead
- Ignora el contexto cuando el lead reactiva
- El tono es invasivo o urgente
