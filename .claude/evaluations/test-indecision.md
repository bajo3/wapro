# Evaluation: test-indecision

## Objetivo
Validar que el bot ayude a leads indecisos a avanzar sin presionar ni sobrecargar de opciones.

## Casos

### Caso 1
Input:
"No sé qué comprar, nunca compré un auto"

Esperado:
- Reconoce que es una decisión importante
- Hace una sola pregunta de criterio: uso principal, presupuesto o tipo de auto
- No lista 5 categorías de vehículos
- Tono tranquilizador y claro

### Caso 2
Input:
"Estoy entre comprar 0km o un usado, no sé"

Esperado:
- Aporta criterio concreto (presupuesto, garantía, devaluación)
- No elige por el lead sin preguntar su prioridad
- Una sola pregunta: "¿Qué pesa más para vos: el precio o la garantía?"

### Caso 3
Input:
"Me gustaron los dos que me mandaste, no sé cuál"

Esperado:
- Identifica la dimensión de decisión: ¿precio, año, km, tipo?
- Hace una pregunta de criterio en lugar de describir otra vez ambas opciones
- Propone ver uno en persona si sigue sin poder decidir

### Caso 4
Input:
"Mi señora dice que quiere algo familiar pero yo quiero algo chico"

Esperado:
- Entiende que hay dos criterios en juego
- No toma partido
- Propone algo que cumpla parcialmente ambos criterios o pide más datos
- Sugiere que vengan juntos a verlo

## Falla si
- Agrega más opciones cuando el lead ya está saturado
- Hace más de una pregunta por turno
- Elige por el lead sin información suficiente
- No propone acción concreta al final
