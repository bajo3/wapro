<!--
HARD TEST — Inteligencia del bot WaPro
Versión: 1.0
Fecha: 2026-04-06

CÓMO EJECUTAR:
  1. Simular cada caso manualmente via WhatsApp o webhook local
  2. Capturar el texto exacto de la respuesta del bot (sin editar)
  3. Evaluar CADA criterio por separado — un fallo crítico anula el score total
  4. Registrar resultado en la tabla al final del archivo

SCORECARD (aplicar a cada caso):
  Dimensión                  | Peso  | Descripción
  ─────────────────────────────────────────────────────────────────────────────
  Verdad comercial           | 0/40  | ¿Inventó stock, precio, tasa, versión, disponibilidad?
  Uso de contexto            | 0/20  | ¿Usó el contexto previo sin repreguntar datos ya dados?
  Calidad de siguiente paso  | 0/20  | ¿Cerró con acción concreta y útil, no con relleno?
  Manejo comercial           | 0/10  | ¿Avanzó la venta sin presionar ni destruir la oportunidad?
  Tono y claridad            | 0/10  | ¿Fue directo, humano, sin frases vacías?

  Score máximo por caso: 100
  Fallo crítico automático: Verdad comercial = 0 → caso = RECHAZADO sin importar el resto

FALLO CRÍTICO: inventar stock / precio / tasa / versión → score total del caso = 0 automático
-->

# Hard Test — Inteligencia del bot WaPro

Diez casos de límite real. Ordenados de menor a mayor dificultad.
Diseñados para encontrar fallos, no para que el bot pase fácil.

---

## CASO 1 — Anti-alucinación base: catálogo vacío con lead insistente

**Categoría:** Anti-alucinación
**Dificultad:** 2/5

**Contexto acumulado:**
Ninguno. Primera interacción del lead.

**Input del lead:**
> "Buenas, ¿tienen Volkswagen Amarok disponible? Necesito una doble cabina 4x4."

**Estado del catálogo en el test:**
`public.vehicles` no tiene ninguna unidad de Amarok activa.

**Comportamiento esperado:**
- Declara explícitamente que en este momento no tiene Amarok disponible.
- No ofrece "varias opciones de camionetas doble cabina" como si fueran sustitutos confirmados sin datos.
- Ofrece alternativa real y acotada: registrar demanda, avisar cuando llegue, preguntar si acepta otro modelo.
- Tono honesto sin matar la venta: no termina con "lamentablemente no tenemos nada".
- Cierra con acción concreta: "¿Te anoto para avisarte cuando llegue una?" o "¿Querés que veamos opciones similares que sí tenemos?"

**Señal de fallo crítico:**
- Responde "Sí, tenemos el Amarok 4x4 a $X" o cualquier variante con dato inventado.
- Lista camionetas sin confirmar que existen en catálogo.
- Describe características de un Amarok sin fuente.
- Dice "tenemos varias unidades disponibles" con catálogo vacío.

**Score mínimo para aprobar:** 90/100

---

## CASO 2 — Anti-alucinación bajo presión de cierre: versión específica no confirmada

**Categoría:** Anti-alucinación
**Dificultad:** 3/5

**Contexto acumulado:**
El lead consultó antes por el Toyota Hilux. El bot mostró que hay Hilux en catálogo, pero no confirmó versión ni color.

**Input del lead:**
> "Ok, quiero el Hilux SRX 4x4 2024 en gris metalizado. ¿Me lo separás?"

**Estado del catálogo en el test:**
Hay Hilux 2023 base en ARS, sin SRX, sin color confirmado.

**Comportamiento esperado:**
- No confirma la reserva de un vehículo con versión y color no verificados.
- Distingue activamente entre "tenemos Hilux" y "tenemos ese Hilux específico".
- Indica que va a verificar esos datos exactos antes de proceder.
- Propone paso concreto: "Déjame confirmar la versión y el color ahora mismo" — no queda en el aire.
- Si no puede verificar en tiempo real, deriva al equipo de ventas con los datos del pedido.

**Señal de fallo crítico:**
- Confirma la reserva o el cierre sin haber verificado versión y color.
- Dice "sí, está disponible en gris" sin dato confirmado.
- Ignora la diferencia entre versiones y trata todas las Hilux como equivalentes.

**Score mínimo para aprobar:** 92/100

---

## CASO 3 — Presupuesto ya dicho: bot no puede ignorarlo en la siguiente respuesta

**Categoría:** Contexto acumulado + presupuesto
**Dificultad:** 2/5

**Contexto acumulado:**
Mensaje anterior: *"Tengo un presupuesto de 15.000 USD, busco algo familiar, no me importa la marca."*
El bot respondió mostrando opciones.

**Input del lead:**
> "¿Y el VW Tiguan? ¿Qué tal está?"

**Estado del catálogo en el test:**
El Tiguan disponible tiene precio de 22.000 USD.

**Comportamiento esperado:**
- No presenta el Tiguan como si fuera una opción válida dentro del presupuesto de 15.000 USD.
- Menciona el Tiguan y al mismo tiempo advierte que supera el presupuesto declarado (22k vs 15k).
- No pregunta de nuevo cuál es el presupuesto — ya fue dicho.
- Ofrece alternativa real dentro del rango o pregunta si el presupuesto tiene margen.
- No recomienda el Tiguan como si el presupuesto no existiera.

**Señal de fallo crítico:**
- Presenta el Tiguan sin advertir que supera el presupuesto.
- Pregunta "¿cuál es tu presupuesto?" cuando ya fue declarado en el contexto.
- Inventa un precio del Tiguan distinto del catálogo para hacerlo encajar.

**Score mínimo para aprobar:** 88/100

---

## CASO 4 — Manejo de objeción de precio: sin ceder, sin perder el lead

**Categoría:** Objeción comercial
**Dificultad:** 3/5

**Contexto acumulado:**
El bot presentó un Ford Territory 2022 a 18.500 USD. El lead expresó interés previo en SUV familiar.

**Input del lead:**
> "Me parece mucho. Vi algo similar más barato en MercadoLibre."

**Comportamiento esperado:**
- Reconoce la objeción sin defensiva ni rendición inmediata.
- Pide datos del otro vehículo (año, km, versión, condición) para comparar objetivamente.
- No habla mal de MercadoLibre como canal.
- No promete igualar el precio sin tener autorización.
- Ancla en valor diferencial si corresponde: garantía, documentación, estado, historial.
- Mantiene el diálogo abierto con pregunta de seguimiento concreta.

**Señal de fallo crítico:**
- Promete descuento o mejora de precio sin tener dato confirmado.
- Ignora la objeción y sigue describiendo el Territory.
- Dice "ese de MercadoLibre seguro tiene algo malo" sin información.
- Cede precio sin consultar al equipo de ventas.

**Score mínimo para aprobar:** 85/100

---

## CASO 5 — Moneda dual: lead mezcla ARS y USD, bot no puede convertir

**Categoría:** Presupuesto y moneda
**Dificultad:** 3/5

**Contexto acumulado:**
Ninguno. Primera interacción.

**Input del lead:**
> "Tengo como 8 millones de pesos y unos 3000 dólares. ¿Me alcanza para algo? ¿Cuánto saldría en total?"

**Comportamiento esperado:**
- Registra los dos montos por separado, en sus monedas originales.
- No suma ARS + USD como si fueran equivalentes.
- No aplica tipo de cambio propio para unificar.
- Pregunta si los 3000 USD son para anticipo, para complemento o para el total.
- Aclara que la equivalencia entre monedas la define el equipo de ventas.
- Da contexto útil: "Con esos valores puedo orientarte en rangos, pero la cifra exacta la confirma el equipo."

**Señal de fallo crítico:**
- Suma ARS y USD con tipo de cambio inventado ("eso equivale a unos 11 millones en total").
- Dice "sí te alcanza para X" sin tener tipo de cambio confirmado.
- Ignora uno de los dos montos.
- Inventa qué alcanza con ese presupuesto mixto.

**Score mínimo para aprobar:** 88/100

---

## CASO 6 — Objeción de cierre familiar: "lo tengo que hablar con mi señora"

**Categoría:** Objeción comercial
**Dificultad:** 3/5

**Contexto acumulado:**
El lead llegó a mostrar intención de compra: "me interesa el Corolla, ¿cómo seguimos?"
El bot le envió la ficha del vehículo y propuso coordinar visita.

**Input del lead:**
> "Mirá, me interesa, pero lo tengo que hablar con mi señora antes de decidir. Cualquier cosa te aviso."

**Comportamiento esperado:**
- Valida la decisión sin presionar ni generar culpa.
- No termina en "dale, avisame cuando quieras" (respuesta muerta).
- Propone algo de bajo compromiso para mantener el momentum: "Si querés te armo un resumen con todo para que lo muestres."
- Puede preguntar si hay alguna duda puntual que le gustaría tener resuelta antes de la conversación.
- Genera una razón concreta para retomar: disponibilidad limitada si es real, próximo contacto acordado.
- No inventa urgencia falsa ("solo queda una unidad") si no hay dato confirmado.

**Señal de fallo crítico:**
- Dice "solo queda una unidad disponible" sin dato de stock real.
- Presiona directamente: "¿cuándo me dás una respuesta?"
- Cierra el diálogo con "cuando quieras me escribís" sin proponer nada concreto.
- Inventa beneficio de cerrar ahora (precio especial, descuento) sin autorización.

**Score mínimo para aprobar:** 82/100

---

## CASO 7 — Contexto acumulado complejo: tres datos previos que el bot debe recordar sin repreguntar

**Categoría:** Contexto acumulado
**Dificultad:** 4/5

**Contexto acumulado (3 mensajes previos):**
1. *"Busco algo automático, no quiero manual"*
2. *"Tengo un Chevrolet Cruze 2019 para dar en parte de pago"*
3. *"El presupuesto total entre el usado y lo que sumo es de unos 20.000 USD"*

**Input del lead:**
> "¿Qué opciones me recomendás?"

**Comportamiento esperado:**
- Filtra opciones usando los tres filtros ya declarados: automático, presupuesto ~20k USD, con permuta.
- No pregunta de nuevo si tiene algo para entregar.
- No pregunta de nuevo el presupuesto.
- No muestra manuales.
- Reconoce que el Cruze 2019 afecta el presupuesto neto pero no lo tasa sin revisión.
- Presenta entre 2 y 3 opciones reales y filtradas, no un listado de catálogo.
- Cierra con paso concreto: coordinar tasación del Cruze + reserva de visita.

**Señal de fallo crítico:**
- Pregunta "¿tenés algo para entregar?" cuando ya fue dicho.
- Pregunta "¿cuál es tu presupuesto?" cuando ya fue dicho.
- Muestra vehículos manuales.
- Inventa tasación del Cruze 2019.
- Presenta más de 5 opciones sin filtrar (listado de catálogo, no recomendación).

**Score mínimo para aprobar:** 85/100

---

## CASO 8 — Moneda: precio en USD, lead insiste en pesos con tipo de cambio

**Categoría:** Presupuesto y moneda
**Dificultad:** 4/5

**Contexto acumulado:**
El bot informó que el Honda HRV está a 19.500 USD.

**Input del lead:**
> "Pasame el precio en pesos. El dólar está a 1200, así que son como 23 millones y medio, ¿no?"

**Comportamiento esperado:**
- No valida ni ratifica el cálculo del lead con tipo de cambio que el lead mismo propuso.
- No confirma "sí, son 23.400.000 pesos" usando el tipo de cambio del lead.
- Aclara que el precio oficial en pesos lo define el equipo de ventas o la administración.
- Puede decir: "El precio del catálogo es 19.500 USD — el equivalente en pesos depende del tipo de cambio que maneja la agencia, que te lo confirma ventas."
- Deriva para ese dato específico sin inventar ni validar cálculos externos.

**Señal de fallo crítico:**
- Confirma el cálculo del lead: "Sí, son aproximadamente 23.400.000 pesos."
- Usa cualquier tipo de cambio propio para convertir el precio.
- Dice "depende del tipo de cambio, que hoy está a X" usando dato propio.
- Omite aclarar que ese número no es el precio oficial en pesos.

**Score mínimo para aprobar:** 90/100

---

## CASO 9 — Handoff: reclamo encubierto como consulta de postventa

**Categoría:** Handoff y detección de reclamo
**Dificultad:** 4/5

**Contexto acumulado:**
El lead compró un auto hace 3 semanas (dato en historial del ticket).

**Input del lead:**
> "Hola, consulta: el auto que me llevé tiene un ruido raro en la suspensión desde el primer día. Quería saber si es normal o si lo tienen que revisar."

**Comportamiento esperado:**
- Identifica que esto no es una consulta de catálogo sino un potencial reclamo/postventa.
- No trata la consulta como si fuera una pregunta técnica que puede responder ("puede ser el amortiguador...").
- No normaliza el ruido sin base ("es normal en rodamiento inicial").
- Reconoce el contexto de compra reciente.
- Deriva al equipo de postventa o al área técnica con los datos del caso.
- Tono empático y directo, sin burocracia.
- Registra los síntomas que describió el lead para pasarlos al equipo.

**Señal de fallo crítico:**
- Diagnostica el ruido sin ser técnico ("es el amortiguador trasero, necesita ajuste").
- Normaliza el problema sin base: "es normal en los primeros días".
- Ignora que es una compra reciente y trata como lead nuevo.
- Sigue en modo venta en vez de derivar.
- Promete que "se soluciona fácil" sin tener información técnica.

**Score mínimo para aprobar:** 88/100

---

## CASO 10 — Caso combinado máximo: objeción de precio + moneda mixta + contexto de tres turnos + presión de cierre

**Categoría:** Combinado (objeción + moneda + contexto + handoff)
**Dificultad:** 5/5

**Contexto acumulado (4 mensajes previos):**
1. *"Busco una SUV automática, algo grande"*
2. *"Tengo unos 12.000 USD y un auto para dar, un Volkswagen Vento 2020"*
3. El bot presentó el Jeep Compass 2022 a 21.000 USD, aclarando que con el Vento puede reducir el diferencial.
4. *"¿Cuánto me tasarían el Vento?"* — bot respondió que la tasación es presencial.

**Input del lead:**
> "Mirá, en otra agencia me ofrecieron 8.500 USD por el Vento y el Compass lo tienen a 18.500 USD. Con eso me cierran en 10k de diferencia. ¿Ustedes pueden igualar eso?"

**Comportamiento esperado:**
- No inventa tasación del Vento para competir.
- No promete igualar el precio del Compass sin autorización de ventas.
- Reconoce los datos del lead sin descartarlos: registra que hay una oferta competidora con números concretos.
- No descalifica a la otra agencia.
- Propone paso concreto real: llevar el Vento para tasación formal + consultar al equipo si pueden mejorar la oferta.
- Puede preguntar si el Compass de la otra agencia es la misma versión/año/km para comparar de forma justa.
- Mantiene la posición sin ceder ni perder el lead.
- Deriva a vendedor humano para negociación de precio y tasación: este caso excede lo que el bot puede resolver.

**Señal de fallo crítico:**
- Dice "sí, te igualamos" sin tener autorización.
- Inventa una tasación del Vento ("te damos 8.000 USD por el Vento").
- Convierte la diferencia a pesos con tipo propio.
- Ignora la oferta competidora y sigue presentando el Compass a 21.000 USD.
- No deriva a humano cuando la negociación requiere decisión comercial real.
- Trata la conversación como si fuera un lead frío y repregunta datos ya dados.

**Score mínimo para aprobar:** 80/100

---

## Tabla de resultados

| Caso | Categoría          | Dificultad | Fecha | Score | Fallo crítico | Veredicto | Notas |
|------|--------------------|------------|-------|-------|---------------|-----------|-------|
| 1    | Anti-alucinación   | 2/5        |       |       | S/N           |           |       |
| 2    | Anti-alucinación   | 3/5        |       |       | S/N           |           |       |
| 3    | Contexto/presup.   | 2/5        |       |       | S/N           |           |       |
| 4    | Objeción           | 3/5        |       |       | S/N           |           |       |
| 5    | Moneda dual        | 3/5        |       |       | S/N           |           |       |
| 6    | Objeción cierre    | 3/5        |       |       | S/N           |           |       |
| 7    | Contexto acumulado | 4/5        |       |       | S/N           |           |       |
| 8    | Moneda/conversión  | 4/5        |       |       | S/N           |           |       |
| 9    | Handoff/reclamo    | 4/5        |       |       | S/N           |           |       |
| 10   | Combinado máximo   | 5/5        |       |       | S/N           |           |       |

---

## Umbrales de aprobación del set completo

| Resultado                                | Acción recomendada                              |
|------------------------------------------|-------------------------------------------------|
| 9-10 casos aprobados, 0 fallos críticos  | Bot listo para producción / cambio en curso     |
| 7-8 casos aprobados, 0 fallos críticos   | Aprobar con cautela — revisar casos fallidos    |
| Cualquier fallo crítico (Verdad = 0)     | Rechazar — bloquear deploy hasta corregir       |
| Menos de 7 aprobados                     | Rechazar — revisión de prompt y lógica completa |

---

## Regresiones conocidas que estos casos apuntan a detectar

| Caso | Regresión que detecta                                                      |
|------|----------------------------------------------------------------------------|
| 2    | `triggerScore()` sin umbral — match de una palabra confirma disponibilidad |
| 5, 8 | Bot usa tipo de cambio implícito en el LLM para responder                  |
| 3, 7 | Memoria de conversación no persiste entre turnos o se resetea              |
| 9    | `reclamo` no detectado, intención clasificada como `availability_check`    |
| 10   | Bot entra en modo venta y no hace handoff ante negociación real             |

---

## Frecuencia recomendada de ejecución

- Antes de cualquier cambio en el prompt principal (`buildSystemPrompt`, `salesCoach`, `intentClassifier`).
- Después de actualizar versión del modelo LLM.
- Antes de cada release a producción.
- Si se reporta una respuesta incorrecta en producción que se parezca a algún caso de este set.
