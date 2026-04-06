# Evaluaciones Fase 3 — Autoaprendizaje Real del Bot

Estos casos validan el pipeline completo: evaluación de outcome, scoring post-turno,
clasificación, persistencia en DB, selección de few-shot y guardrails de catálogo.

---

## Caso 1 — Respuesta que avanza → shouldSave=true, safeToReuse=true

**Setup:**
- Turno N: bot pregunta "¿Para qué lo usarías más — ciudad, ruta o familia?"
- Turno N+1: usuario responde "para ciudad, y no quiero gastar mucho en nafta"

**Señales esperadas:**
- `userGaveMoreData = true` (useCase=ciudad, fuel hint)
- `userReplied = true`
- `conversationAdvanced = true`
- `score >= 7`

**Resultado esperado:**
- `classifyMemoryEntry()` → `shouldSave=true, safeToReuse=true, memoryType=successful_question`
- Log: `[BOT_MEMORY_SAVE] type=successful_question score=7 safeToReuse=true`
- Entrada en `bot_memory` con `safe_to_reuse=TRUE`

**Criterio de éxito:** La pregunta aparece en el pool de few-shot para conversaciones con `isIndecisive=true`.

---

## Caso 2 — Respuesta genérica → safeToReuse=false

**Setup:**
- Turno N: bot responde "Tenemos muchas opciones disponibles. ¿Qué marca preferís?"
- Turno N+1: usuario repite "busco algo para ciudad"

**Señales esperadas:**
- `responseTooGeneric = true`
- `userRepeatedSameQuestion = true` (búsqueda sin avance)
- `score <= -1`

**Resultado esperado:**
- `classifyMemoryEntry()` → `shouldSave=true, safeToReuse=false, memoryType=bad_generic_reply`
- NO aparece en few-shot positivo
- Log: `[BOT_MEMORY_SKIP]` o `[BOT_MEMORY_ANTIPATTERN]`

**Criterio de éxito:** `safe_to_reuse=FALSE` en DB. El ejemplo nunca aparece en `selectFewShotExamples()`.

---

## Caso 3 — Usuario da más datos después → outcomeScore alto

**Setup:**
- Turno N: bot muestra 2 opciones de autos y pregunta "¿Cuál te llama la atención?"
- Turno N+1: usuario dice "la primera, el Cronos — ¿tiene automático?"

**Señales esperadas:**
- `userReplied = true`
- `userGaveMoreData = true` (model=Cronos, transmission query)
- `userShowedIntent = true` (pregunta específica sobre modelo)
- `score >= 8`

**Resultado esperado:**
- `memoryType = successful_reply`
- `safeToReuse = true`
- Entrada persistida en Postgres con `quality_score >= 8`

**Criterio de éxito:** Query `SELECT * FROM bot_memory WHERE quality_score >= 8 AND safe_to_reuse = TRUE` retorna la entrada.

---

## Caso 4 — Usuario repite misma duda → anti_pattern

**Setup:**
- Turno N: bot responde sobre SUVs sin dar información de precio/financiación
- Turno N+1: usuario pregunta nuevamente "¿y hay algo más barato? ¿o en cuotas?"

**Señales esperadas:**
- `userRepeatedSameQuestion = true` (misma intención, sin avance de contexto)
- `score <= -3`

**Resultado esperado:**
- `classifyMemoryEntry()` → `memoryType=anti_pattern, safeToReuse=false`
- Log: `[BOT_MEMORY_ANTIPATTERN] type=anti_pattern score=-4 reason="userRepeatedSameQuestion"`
- La entrada se guarda en DB para análisis pero `safe_to_reuse=FALSE`

**Criterio de éxito:** `SELECT COUNT(*) FROM bot_memory WHERE memory_type='anti_pattern'` crece. Never aparece en few-shot.

---

## Caso 5 — Indeciso exitoso → indecision_pattern, few-shot disponible

**Setup:**
- Contexto: `isIndecisive=true`, el bot hace UNA pregunta de flujo guiado
- Turno N: bot pregunta "¿Para qué lo usarías más — ciudad, ruta, familia o trabajo?"
- Turno N+1: usuario responde con uso concreto y avanza

**Señales esperadas:**
- `conversationAdvanced = true`
- `userGaveMoreData = true`
- `score >= 6`

**Resultado esperado:**
- `memoryType = indecision_pattern`
- `safeToReuse = true`
- En la próxima conversación con `isIndecisive=true`, `selectFewShotExamples({isIndecisive: true})` retorna este patrón

**Criterio de éxito:**
```sql
SELECT * FROM bot_memory
WHERE memory_type = 'indecision_pattern'
  AND safe_to_reuse = TRUE
  AND quality_score >= 5;
```
Retorna al menos 1 fila después de procesar el turno.

---

## Caso 6 — Financiación sin inventar → successful_reply, isSafeToLearn=true

**Setup:**
- Turno N: bot responde "Sí, financiamos hasta el 50% del valor. ¿Cuánto podés poner de anticipo?"
- Turno N+1: usuario responde con un monto concreto

**Verificación de guardrail:**
- El texto NO contiene precio específico ($X), tasa numérica, ni "en stock"
- `isSafeToLearn("Sí, financiamos hasta el 50% del valor. ¿Cuánto podés poner de anticipo?")` → `true`
- No se loguea `[MEMORY_GUARDRAIL_VIOLATION]`

**Resultado esperado:**
- `safeToReuse = true` (pasa guardrail + score >= 5)
- Entrada guardada en `bot_memory`

**Criterio de éxito:** No aparece ningún log `[MEMORY_GUARDRAIL_VIOLATION]` para esta respuesta.

---

## Caso 7 — Multi-intención → selecciona indecision_pattern en few-shot

**Setup:**
- Contexto: `multipleVehicleTypes=true` (el cliente mencionó "auto o camioneta")
- `selectFewShotExamples({multipleVehicleTypes: true}, 3)` se llama

**Lógica esperada:**
- `preferredType = 'indecision_pattern'` (multipleVehicleTypes → indecisión)
- La query primero busca `memory_type = 'indecision_pattern'`
- Si hay menos de 3 ejemplos de ese tipo, completa con otros tipos positivos

**Resultado esperado:**
- `formatFewShotBlock(examples)` retorna bloque con header "CONVERSACIONES ANTERIORES EFECTIVAS"
- Máximo 3 ejemplos en el bloque
- Ningún ejemplo tiene `memoryType = 'anti_pattern'` ni `'bad_generic_reply'`

**Criterio de éxito:** Inspeccionar el bloque few-shot en los logs del agente.

---

## Caso 8 — Urgencia real → no contamina el aprendizaje

**Setup:**
- Conversación con `highUrgency=true`, bot deriva a humano correctamente
- Turno N: bot dice "Perfecto, tomo tu urgencia. En breve te escribe un asesor."
- Turno N+1: (no hay — la conversación pasa a HUMAN_ONLY)

**Comportamiento esperado:**
- El bloque de evaluación de outcome (inicio de `handleAggregatedMessage`) se activa si llega otro mensaje
- Como `prevBotReply` contiene "asesor" pero sin señal de cierre forzado del usuario, `unnecessaryHandoff = false` (porque `highUrgency` era real)
- Score neutral — ni muy positivo ni negativo si no hay respuesta del usuario

**Criterio de éxito:** El handoff correcto no genera un `anti_pattern`. Si hay respuesta del usuario afirmativa ("perfecto"), el score sube.

---

## Caso 9 — Dato de catálogo variable → GUARDRAIL_VIOLATION log

**Setup:**
- Texto a evaluar: "El Cronos 2022 vale ARS 25.000.000 y está disponible en stock"

**Guardrails que deben activarse:**
- Regex `/\bARS\s*\d+/i` → match `ARS 25.000.000`
- Texto `disponible` → match en `FORBIDDEN_IN_MEMORY`
- Texto `en stock` → match en regex `/en\s+stock/i`

**Resultado esperado:**
- `isSafeToLearn(texto)` → `false`
- Logs: `[MEMORY_GUARDRAIL_VIOLATION] pattern="ARS" → NOT saved` (o similar)
- El texto nunca llega a `saveMemoryToDB()`

**Criterio de éxito:** Verificar en Railway logs que `[MEMORY_GUARDRAIL_VIOLATION]` aparece para cualquier texto con precio, stock o disponibilidad.

---

## Caso 10 — Anti-pattern etiquetado → no entra al few-shot positivo

**Setup:**
- En DB existe una fila con `memory_type='anti_pattern'`, `safe_to_reuse=FALSE`, `quality_score=-4`
- Se llama `selectFewShotExamples({}, 3)`

**Consulta SQL esperada:**
```sql
SELECT ... FROM bot_memory
WHERE safe_to_reuse = TRUE
  AND quality_score >= 5
  AND memory_type NOT IN ('anti_pattern', 'bad_generic_reply')
ORDER BY quality_score DESC, last_used_at ASC
LIMIT 3;
```

**Resultado esperado:**
- El anti_pattern jamás aparece en los resultados
- `formatFewShotBlock([])` retorna `''` si no hay ejemplos positivos
- El prompt del agente no recibe bloque de few-shot si no hay ejemplos seguros

**Criterio de éxito:** Insertar manualmente un anti_pattern en la tabla y verificar que `selectFewShotExamples` lo excluye siempre.

---

## Caso 11 — learnFromConversation se dispara en handoff

**Setup:**
- Conversación con intención de cierre detectada (`wantsPerson=true` o `closingIntent=true`)
- El bot ejecuta el handoff path en webhooks.ts

**Comportamiento esperado:**
- `setConversationRule(instance, remoteJid, 'HUMAN_ONLY')` se llama
- `scheduleReply(handoffReply, ...)` se llama con `{ handoff: true }`
- `learnFromConversation(instance, remoteJid)` se dispara en fire-and-forget (línea después del scheduleReply)

**Resultado esperado:**
- En Railway logs aparece: `[autoTrainer] analyzing conversation XXXXX on INSTANCE`
- `bot_learning_memory` recibe nuevas entradas si el GPT detecta patrones (objections, gaps, lead_patterns)
- Si GPT falla o la conversación es muy corta, el log dice `skipped: not_enough_turns` (no rompe el flujo)

**Criterio de éxito:** Después de 3 handoffs consecutivos, `SELECT COUNT(*) FROM bot_learning_memory` debe haber crecido al menos 1 fila (patrones de objeción o lead detectados). El bot no falla ni demora su respuesta de handoff.

---

## Caso 12 — System prompt incluye contexto de aprendizaje tras datos acumulados

**Setup:**
- `bot_learning_memory` tiene ≥ 1 fila con `pattern_type='objection'` y `status='active'`
- Se procesa un mensaje de usuario en un conversación nueva

**Comportamiento esperado:**
- `decideAgentAction()` llama `loadLearningContext()` → retorna objections/gaps/lead_patterns
- `buildLearningContextSection(ctx)` genera string no-vacío con:
  - Sección `── OBJECIONES REALES MÁS FRECUENTES ──` (si hay datos)
  - Sección `── PREGUNTAS FRECUENTES SIN BUENA RESPUESTA ──` (si hay datos)
  - Sección `── CAMINOS EXITOSOS DETECTADOS ──` (si hay datos)
- El string se inyecta en `buildAgentSystemPrompt(..., learningSection + '\n' + salesCoachSection + extraSections)`

**Resultado esperado:**
- El system prompt enviado a GPT contiene la sección de aprendizaje
- El bloque no excede 500 chars (límite implícito del formateo)
- Si `bot_learning_memory` está vacía, el prompt NO incluye la sección (retorna `''`)

**Criterio de éxito:** Habilitar log temporal de system prompt en development y verificar que la sección aparece cuando hay datos en `bot_learning_memory`.

---

## Checklist de validación en Railway

- [ ] `SELECT COUNT(*) FROM bot_memory;` — crece con cada conversación (al menos 1 entrada por turno con score)
- [ ] `SELECT * FROM bot_memory WHERE safe_to_reuse = TRUE ORDER BY quality_score DESC LIMIT 5;` — retorna filas coherentes
- [ ] `SELECT * FROM bot_memory WHERE memory_type = 'anti_pattern';` — retorna patrones de calidad negativa
- [ ] Ninguna fila en `bot_memory` contiene precios, stock o disponibilidad en `bot_reply` o `user_message`
- [ ] Logs de Railway muestran `[SELF_EVAL]` en cada turno respondido
- [ ] Logs de Railway muestran `[BOT_MEMORY_SAVE]` o `[BOT_MEMORY_SKIP]` en cada turno N+1
- [ ] Logs de Railway muestran `[MEMORY_GUARDRAIL_VIOLATION]` si se intenta guardar dato de catálogo
- [ ] Logs de Railway muestran `[autoTrainer] analyzing conversation` después de cada handoff
- [ ] Logs de Railway muestran `skipped: not_enough_turns` si la conversación tiene < 2 turnos al handoff
