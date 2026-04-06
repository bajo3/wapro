# Evaluation: Reactivación de lead

Casos donde un lead volvió después de silencio prolongado (7+ días).
El bot debe retomar con contexto previo, sin empezar de cero y sin presionar.

---

## Caso 1: Lead vuelve después de 10 días sin respuesta
**Input lead:** "Buenas, quería ver si todavía tienen ese Corolla que me habían comentado"

**Contexto acumulado (de conversación previa):**
- marca: Toyota, modelo: Corolla
- presupuesto: ~20000 USD
- condición: 0km o poco km
- inactividad: 10 días

**Comportamiento esperado:**
- Reconocer al lead por su nombre si está disponible
- Retomar con el contexto previo: "Estuviste consultando por el Corolla"
- Verificar disponibilidad actual (no asumir que el stock de hace 10 días sigue igual)
- Si hay stock: mostrar la unidad o pedir confirmar interés
- Si no hay: decirlo claramente, ofrecer alternativa
- Tono cálido, no presionar, no empezar como si fuera primer contacto

**Respuesta inaceptable:**
- "¡Hola! ¿En qué te puedo ayudar?" — ignorar contexto previo
- Afirmar que el Corolla está disponible sin verificarlo
- Empezar pidiendo datos que ya habían dado (marca, presupuesto)
- Tono de vendedor agresivo o de recordatorio forzado

**Score mínimo:** 85/100
**Dimensiones críticas:** Contexto (15), Verdad comercial (20), Tono (5)

---

## Caso 2: Lead reactiva con nuevo interés
**Input lead:** "Che, me olvidé de este chat. Al final me estoy inclinando más por algo pickup, ¿tienen algo?"

**Contexto acumulado (de conversación previa):**
- estaba viendo SUVs, presupuesto ~15000 USD
- inactividad: 12 días

**Comportamiento esperado:**
- Registrar el cambio de preferencia: ahora busca pickup (antes SUV)
- No insistir con las opciones de SUV de la conversación anterior
- Consultar catálogo de pickups disponibles
- Si hay: presentar opciones dentro del presupuesto conocido
- Si no hay: decirlo y ofrecer alternativa o aviso de stock
- Mencionar brevemente que el presupuesto puede seguir siendo referencia (confirmar si cambió)

**Respuesta inaceptable:**
- Ignorar el cambio de SUV a pickup
- Insistir en opciones de SUV que ya no quiere
- No verificar si el presupuesto sigue siendo el mismo

**Score mínimo:** 80/100

---

## Caso 3: Lead reactiva después de "lo voy a pensar"
**Input lead:** "Hola, la semana pasada les consulté. Ya lo pensé y quiero avanzar"

**Contexto acumulado (de conversación previa):**
- Toyota Hilux, presupuesto 30000 USD
- había dicho "lo voy a pensar"
- inactividad: 7 días

**Comportamiento esperado:**
- Reconocer el avance del lead: "Buenísimo que volviste"
- Retomar con el contexto: Hilux, presupuesto 30000 USD
- Verificar si el vehículo sigue disponible
- Si sí: proponer siguiente paso concreto (visita, cotización formal, reserva)
- Si no: ofrecer alternativa similar y proponer paso

**Respuesta inaceptable:**
- Empezar de cero pidiendo datos que ya dio
- No proponer ningún siguiente paso concreto
- Responder genérico sin cerrar con acción

**Score mínimo:** 88/100
**Dimensiones críticas:** Contexto (15), Acción útil (15)

---

## Qué evalúa este set
- Recuperación de contexto previo sin repreguntar
- Verificación de stock antes de afirmar disponibilidad
- Adaptación a cambios de preferencia del lead
- Propuesta de siguiente paso concreto
- Tono correcto: cálido, sin presionar, no empezar de cero
