# Evaluación Fase 2 — Hardening: 10 Casos de Riesgo Real

## Objetivo
Cobertura de los riesgos concretos identificados en el hardening de Fase 2.
Estos casos no son teóricos — cubren los puntos de falla más probables en producción.

---

## CASO-HARD-01: "algo urgente pero barato" — NO handoff, responde con opciones

**Input:** "quiero algo urgente pero barato, que no gaste mucha nafta"
**Expected:** El bot NO interpreta "urgente" como urgencia temporal. Detecta presupuesto bajo
  implícito y preferencia de combustible económico. Responde con opciones del catálogo.
  NO escala a humano.
**Should invent:** NO
**Should escalate:** NO
**Memory save:** NO (urgencia adjetival no es patrón de éxito, no hay avance concreto)
**Score target:** 0.95
**Risk coverage:** Falso positivo de urgencia — escalar por "urgente" adjetival interrumpe
  conversaciones de exploración válidas y molesta al cliente.
**Log esperado:**
  `[HANDOFF_SKIP] reason="adjectival_urgency" match="urgente" escalate=false`

---

## CASO-HARD-02: "necesito auto para mañana" — SÍ handoff, urgencia temporal

**Input:** "necesito el auto para mañana, ¿es posible?"
**Expected:** El bot detecta "para mañana" como urgencia temporal. Escala inmediatamente.
  Respuesta empática + coordinación rápida. handoffRecommended=true.
**Should invent:** NO (no inventar disponibilidad inmediata)
**Should escalate:** SÍ
**Memory save:** NO (handoff no genera patrón conversacional)
**Score target:** 0.95
**Risk coverage:** Falso negativo de urgencia — ignorar "para mañana" deja al cliente sin respuesta
  concreta cuando tiene fecha límite real.
**Log esperado:**
  `[HANDOFF_TRIGGER] matchReason="temporal_urgency" matchedText="para mañana" escalate=true`

---

## CASO-HARD-03: "auto o camioneta" — pide priorización, no mezcla

**Input:** "no sé si comprar auto o camioneta"
**Expected:** El bot detecta multipleVehicleTypes=true (2 tipos). Pregunta uso para decidir.
  Buena respuesta: "Depende del uso. ¿Lo usarías más para ciudad o para trabajo/campo?"
  Mala respuesta: "Tenemos ambas opciones disponibles."
**Should invent:** NO
**Should escalate:** NO
**Memory save:** SÍ si el bot avanzó con pregunta de uso (botAdvancedConversation=true)
**Score target:** 0.90
**Risk coverage:** Multi-intención sin foco — mostrar catálogos mezclados confunde al cliente.

---

## CASO-HARD-04: "auto, moto y camioneta" — fuerza foco, una a la vez

**Input:** "quiero un auto, también una moto y una camioneta para el campo"
**Expected:** El bot detecta 3+ tipos. Fuerza priorización directa.
  Buena respuesta: "Tres buenas opciones. ¿Por cuál arrancamos — el auto, la moto o la camioneta?"
  Mala respuesta: "Tenemos autos, motos y camionetas."
**Should invent:** NO
**Should escalate:** NO
**Memory save:** SÍ si el cliente responde y el bot avanzó
**Score target:** 0.95
**Risk coverage:** Multi-intención 3+ tipos — intentar responder todo a la vez genera confusión
  y no cierra ninguna venta.
**Log esperado en flags:** `multipleVehicleTypes=true`

---

## CASO-HARD-05: "somos familia grande" — extrae seatCount, orienta a 7 asientos

**Input:** "somos familia grande, necesitamos lugar para todos"
**Expected:** El bot extrae seatCount implícito (familia grande = 6-7 personas).
  Orienta a SUVs de 7 asientos o vehículos familiares grandes.
  NO ofrece sedanes de 5 plazas.
**Should invent:** NO (solo stock real con esas características)
**Should escalate:** NO
**Memory save:** SÍ si mostró opciones concretas
**Score target:** 0.85
**Risk coverage:** Ignorar contexto familiar puede llevar a recomendar autos inadecuados.

---

## CASO-HARD-06: "no sé qué quiero" — flujo guiado, pregunta natural

**Input:** "la verdad no sé qué quiero, ayudame a elegir"
**Expected:** isIndecisive=true. El bot hace UNA sola pregunta, la más valiosa del flujo guiado.
  Primera pregunta según nuevo orden: presupuesto ("¿Tenés un rango de precio en mente o estamos explorando?")
  Tono consultivo, no de encuesta.
**Should invent:** NO
**Should escalate:** NO
**Memory save:** SÍ si el cliente respondió la pregunta
**Score target:** 0.90
**Risk coverage:** Preguntas en tono de formulario generan abandono de conversación.
**Verificar:** pregunta suena humana, no técnica; NO más de 1 pregunta por turno.

---

## CASO-HARD-07: "tengo 20k dólares" — usa rate blue real, no inventar

**Input:** "tengo 20 mil dólares para gastar"
**Expected:** El bot detecta USD 20.000. Llama a getUsdToArs() para convertir a ARS.
  Filtra catálogo con rate real (no hardcode). Muestra opciones dentro del rango.
  NO inventa precios ni tipos de cambio.
**Should invent:** NO (ni precio ni tipo de cambio)
**Should escalate:** NO
**Memory save:** depende de si avanzó
**Score target:** 0.95
**Risk coverage:** Usar rate hardcodeado puede mostrar autos fuera del presupuesto real del cliente.
**Log esperado:**
  `[CATALOG_FILTER] rate=<valor_real> source=live|cache vehicles_before=X vehicles_after=Y`

---

## CASO-HARD-08: Respuesta que avanzó conversación — memory score alto, guardar

**Escenario:** Bot preguntó uso ("¿Para qué lo usarías más?"), cliente respondió "para la ciudad".
  Bot mostró 2 opciones del catálogo.
**Expected:** MemoryScore:
  - userGaveMoreData=true (+2): el cliente dio el uso
  - botAdvancedConversation=true (+2): bot mostró opciones
  - noInventionDetected=true (+3): precios reales
  - Score total=7 → shouldSavePattern=true
**Should invent:** NO
**Memory save:** SÍ
**Score target mínimo:** 4
**Risk coverage:** Si no se guarda este patrón, la memoria nunca aprende preguntas efectivas.
**Log esperado:**
  `[BOT_MEMORY_SAVE] pattern=conversational_pattern score=7 reason="userGaveMoreData+botAdvancedConversation+noInventionDetected"`

---

## CASO-HARD-09: Respuesta genérica sin avance — memory score bajo, no guardar

**Escenario:** Bot respondió "¡Hola! ¿En qué puedo ayudarte?" sin extraer ningún dato.
  Cliente no respondió en ese turno.
**Expected:** MemoryScore:
  - userGaveMoreData=false (0)
  - botAdvancedConversation=false (0)
  - responseWasSpecific=false (0)
  - noInventionDetected=true (+3)
  - Score total=3 → shouldSavePattern=false (< 4)
**Memory save:** NO
**Risk coverage:** Guardar saludos genéricos como "patrones efectivos" contamina la memoria
  y hace que el bot recomiende respuestas inútiles.
**Log esperado:**
  `[BOT_MEMORY_SKIP] pattern=conversational_pattern score=3 reason="score<4"`

---

## CASO-HARD-10: Respuesta que menciona precio exacto — NO guardar en memoria (forbidden)

**Escenario:** Bot respondió mencionando "el precio del Cronos 2022 es $18 millones".
**Expected:** isSafeToLearn("el precio del Cronos 2022 es $18 millones") = false
  La palabra "precio" está en FORBIDDEN_IN_MEMORY → patrón rechazado.
**Memory save:** NO
**Score target:** N/A (rechazado antes del score)
**Risk coverage:** Guardar precios en la memoria conversacional viola el principio de separación
  entre catálogo y aprendizaje conversacional. Los precios cambian — la memoria no debe
  contener valores que se vuelven obsoletos.
**Log esperado:**
  `[BOT_MEMORY_SKIP] pattern=conversational_pattern score=0 reason="forbidden_word_in_pattern"`

---

## Checklist de verificación post-deploy

- [ ] CASO-HARD-01: "algo urgente pero barato" → `[HANDOFF_SKIP]` visible en logs, sin escalar
- [ ] CASO-HARD-02: "para mañana" → `[HANDOFF_TRIGGER] matchedText="para mañana"` en logs
- [ ] CASO-HARD-03: "auto o camioneta" → pregunta de uso, NO catálogo mezclado
- [ ] CASO-HARD-04: "auto, moto, camioneta" → pregunta de priorización
- [ ] CASO-HARD-05: "familia grande" → seatCount extraído, SUV/familiar recomendado
- [ ] CASO-HARD-06: "no sé qué quiero" → UNA pregunta humana (no formulario)
- [ ] CASO-HARD-07: "20k dólares" → `[CATALOG_FILTER] source=live|cache` en logs
- [ ] CASO-HARD-08: patrón con avance → `[BOT_MEMORY_SAVE]` con score >= 4
- [ ] CASO-HARD-09: respuesta genérica → `[BOT_MEMORY_SKIP] reason="score<4"`
- [ ] CASO-HARD-10: mención de precio → `[BOT_MEMORY_SKIP] reason="forbidden_word_in_pattern"`
