# Evaluation: Multi-Intent

Casos donde el lead expresa 2 o 3 intenciones simultáneas en el mismo mensaje.
El bot debe priorizar, no ignorar, y responder con coherencia sin abrumarlo.

---

## Caso 1: SUV 0km + permuta + cuotas
**Input lead:** "Hola, estoy buscando un SUV 0km, tengo un auto para dejar en parte de pago y me gustaría saber si tienen cuotas"

**Contexto acumulado:** ninguno (primer contacto)

**Comportamiento esperado:**
- Registrar las 3 intenciones: tipo=SUV, condición=0km, permuta=sí, financiación=cuotas
- No ignorar ninguna de las tres
- Priorizar confirmar si tienen SUVs 0km disponibles (dato más sensible)
- Mencionar que pueden evaluar la permuta y la financiación
- Pedir UN dato útil para filtrar mejor (ej: presupuesto o marca preferida)
- NO responder las 3 en detalle si no tiene datos confirmados

**Respuesta inaceptable:**
- Ignorar permuta o cuotas y solo hablar de SUVs
- Inventar que tienen "planes de cuotas disponibles" sin confirmación
- Hacer 3 preguntas en el mismo mensaje
- Responder genérico sin capturar las 3 intenciones

**Score mínimo:** 80/100
**Dimensiones críticas:** Entendimiento (20), Contexto (15), Verdad comercial (20)

---

## Caso 2: Marca cerrada + presupuesto + urgencia
**Input lead:** "Necesito un Toyota, tengo hasta 25000 dólares, lo necesito lo antes posible"

**Contexto acumulado:** ninguno

**Comportamiento esperado:**
- Capturar: marca=Toyota, presupuesto=25000 USD, urgencia=alta
- Consultar catálogo con estos filtros (no inventar unidades)
- Si hay stock: presentar opciones reales dentro del presupuesto
- Si no hay stock: decirlo claramente y ofrecer alternativa cercana o acción (lista de espera, aviso de stock)
- Reconocer la urgencia — proponer paso concreto rápido (ver unidad hoy, cotización, llamada)

**Respuesta inaceptable:**
- Ignorar el presupuesto de 25000 USD
- Ofrecer Toyotas sin verificar si están dentro del presupuesto
- Mezclar ARS y USD en la respuesta
- No proponer ningún siguiente paso

**Score mínimo:** 85/100

---

## Caso 3: Comparación + financiación + usado
**Input lead:** "¿Qué me conviene más, un Corolla o un Vios? Estoy pensando en tomar algo usado y con financiación"

**Contexto acumulado:** ninguno

**Comportamiento esperado:**
- Capturar: comparación Corolla vs Vios, condición=usado, financiación=sí
- No inventar precios ni disponibilidad
- Orientar brevemente sobre la diferencia entre ambos (categoría, uso típico)
- Explicar que la financiación depende de datos del cliente — no inventar tasas ni cuotas
- Pedir dato útil para avanzar: presupuesto, o preferir ver uno de los dos

**Respuesta inaceptable:**
- Comparar Corolla y Vios con datos inventados (precio exacto, km, año sin confirmar)
- Dar tasas de financiación no verificadas
- Ignorar que quiere usado
- Respuesta de 5 párrafos sin proponer acción

**Score mínimo:** 80/100

---

## Qué evalúa este set
- Priorización correcta de intenciones múltiples
- No perder datos ya expresados al responder
- No inventar para satisfacer todas las intenciones a la vez
- Proponer acción clara sin abrumar
- Una sola pregunta de seguimiento como máximo
