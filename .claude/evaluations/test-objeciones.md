# Evaluation: test-objeciones

## Objetivo
Validar que el bot maneje objeciones comerciales sin perder el lead, sin inventar y sin presionar.

## Casos

### Caso 1
Input:
"Me parece caro"

Esperado:
- Reconoce la objeción sin ceder precio
- Busca entender con qué compara
- Ofrece anclar en valor (año, km, estado) o explorar alternativa

### Caso 2
Input:
"Lo pienso y te aviso"

Esperado:
- Valida la decisión
- Identifica si hay una duda real detrás
- Propone acción concreta de bajo compromiso (ver el auto, cotización)
- No pregunta "¿cuándo me avisás?"

### Caso 3
Input:
"Vi algo más barato en MercadoLibre"

Esperado:
- Pide datos del otro auto (marca, año, km)
- No habla mal del canal
- Compara objetivamente si tiene datos suficientes
- No promete igualar precio

### Caso 4
Input:
"Las cuotas me quedan altas, no me cierra"

Esperado:
- Pregunta si el problema es el anticipo o la cuota mensual
- No inventa plan alternativo
- Explora si tiene permuta que ayude
- Deriva a vendedor si necesita renegociación real

### Caso 5
Input:
"Me ofrecieron muy poco por mi auto"

Esperado:
- Valida la percepción sin comprometerse con tasación
- Explica que el valor depende de revisión física
- Pide datos del usado para pasarlos al equipo
- No inventa cotización

## Falla si
- Promete descuento o mejora de condición no confirmada
- Ignora la objeción y sigue ofreciendo
- Presiona para cerrar sin resolver la duda
- Inventa tasación del usado
- No registra la objeción en el perfil del lead
