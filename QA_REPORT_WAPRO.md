# WaPro CRM — Informe QA Senior
**Fecha:** 2026-04-05
**Scope:** Bot WhatsApp + Flujo de leads + Panel CRM
**Metodología:** Análisis de código (agent.ts, catalog.ts, intelligence.ts, panelPersistence) + simulación de conversaciones reales
**Evaluador:** QA Senior — perspectiva negocio + técnica

---

## 1. RESUMEN EJECUTIVO

El sistema WaPro tiene una arquitectura de inteligencia bien pensada (salesCoach, conversationAnalyzer, autoTrainer, learningContext), pero presenta **5 fallos críticos activos** y **8 fallos de severidad alta** que representan riesgo real de pérdida de ventas o corrupción de datos.

Los problemas más graves son:
- **El catálogo puede quedar vacío de forma silenciosa** cuando falla la conexión a Supabase y el fallback a Railway devuelve tabla vacía — el bot dice "no hay stock" aunque sí lo haya.
- **Los gastos administrativos de financiación están hardcodeados en $200.000** en el prompt del agente — dato desactualizado que genera información incorrecta al cliente.
- **El autoTrainer puede promover ejemplos de baja calidad** a `bot_examples` sin umbral de score mínimo validado, degradando el bot en producción.
- **El cambio de modo bot→humano no tiene confirmación de éxito** — si BOT_ADMIN_TOKEN no matchea, el panel muestra "Humano" pero el bot sigue respondiendo.
- **Cambio de intención a mitad de conversación** no limpia el contexto extraído correctamente — el bot puede mezclar datos del cliente A con intención del cliente B dentro de la misma sesión.

**Score general del sistema: 6.2 / 10** *(suficiente para operar, insuficiente para escalar sin riesgos)*

---

## 2. TABLA DE CASOS TESTEADOS

| # | Tipo | Input simulado | Severidad esperada | Estado |
|---|------|----------------|--------------------|--------|
| TC-01 | Normal | "hola, quiero un auto" | — | ✅ Pasa |
| TC-02 | Normal | "busco una camioneta diesel, presupuesto $25M" | — | ✅ Pasa |
| TC-03 | Normal | "quiero financiar, cuánto sería la cuota del Cronos?" | ALTO | ⚠️ Riesgo |
| TC-04 | Normal | "tengo un Gol 2018 para entregar, busco algo más grande" | — | ✅ Pasa |
| TC-05 | Normal | "quiero reservarlo, cómo hago?" | — | ✅ Pasa |
| TC-06 | Ambiguo | "busco algo lindo" | MEDIO | ⚠️ Riesgo |
| TC-07 | Ambiguo | "me recomendás el cronos o el onix?" (sin datos de perfil) | MEDIO | ⚠️ Riesgo |
| TC-08 | Ambiguo | "cuánto sale?" (sin contexto) | MEDIO | ⚠️ Parcial |
| TC-09 | Ambiguo | "tiene GNC?" (sin mencionar modelo) | ALTO | ❌ Fallo |
| TC-10 | Extremo | Catálogo vacío en DB | CRÍTICO | ❌ Fallo |
| TC-11 | Extremo | Supabase caído, fallback Railway devuelve vacío | CRÍTICO | ❌ Fallo silencioso |
| TC-12 | Extremo | "busco volskwagen gol 2022, automatics, gns" | BAJO | ✅ Pasa (typos tolerados) |
| TC-13 | Extremo | Presupuesto irrealista: "quiero un 0km último modelo por $500.000" | ALTO | ⚠️ Riesgo |
| TC-14 | Extremo | "quiero el Toyota Hilux último modelo 0km con GNC, precio en USD, automático, para el campo" | MEDIO | ✅ Pasa |
| TC-15 | Extremo | Mezcla de marcas: "busco un Renault Hilux o un Ford Tracker" | ALTO | ⚠️ Riesgo |
| TC-16 | Extremo | Cambio de intención: arranca buscando Hilux, luego pide hatchback chico | CRÍTICO | ❌ Fallo |
| TC-17 | Extremo | 15 mensajes seguidos sin respuesta (cliente spamea) | ALTO | ⚠️ Riesgo |
| TC-18 | Extremo | Mensaje en inglés: "do you have any SUVs?" | BAJO | ✅ Pasa |
| TC-19 | Flujo sistema | Lead no se genera si panelPersistence falla | CRÍTICO | ❌ Fallo silencioso |
| TC-20 | Flujo sistema | Toggle bot/humano con BOT_ADMIN_TOKEN incorrecto | CRÍTICO | ❌ Fallo silencioso |
| TC-21 | Flujo sistema | AutoTrainer promueve ejemplo con score 0.3 | ALTO | ⚠️ Riesgo |
| TC-22 | Flujo sistema | Conversación de 9+ turnos sin cierre | ALTO | ⚠️ Parcial |
| TC-23 | Comercial | "está caro" después de ver precio | — | ✅ Pasa (scripts implementados) |
| TC-24 | Comercial | "lo voy a pensar" al final de conv | — | ✅ Pasa |
| TC-25 | Comercial | "quiero ver más opciones de la competencia" | MEDIO | ⚠️ Riesgo |
| TC-26 | Comercial | Cuotas con auto de permuta: cálculo con $200K hardcoded | ALTO | ❌ Fallo de dato |
| TC-27 | Comercial | "precio con IVA, es precio final?" | MEDIO | ⚠️ Parcial |
| TC-28 | Comercial | Lead frío: saluda y no da ningún dato, 5 veces seguidas | MEDIO | ⚠️ Riesgo |
| TC-29 | Datos | ARS vs USD: cliente menciona "20 mil dólares" (sin símbolo) | CRÍTICO | ❌ Posible confusión |
| TC-30 | Datos | VehicleIds inventados: bot menciona auto sin id en catálogo | CRÍTICO | ⚠️ Depende de GPT |

---

## 3. FALLOS DETECTADOS (detalle)

---

### FALLO-01 — Catálogo silenciosamente vacío por fallback de pool
**Severidad: CRÍTICO**
**Origen:** `catalog.ts` — función `resilientCatalogQuery()`

**Descripción:**
Cuando `supabasePool` está configurado pero falla (timeout, reconexión), el sistema hace fallback al `pool` principal de Railway. Si `public.vehicles` en Railway está vacía o no tiene datos sincronizados, el catálogo retorna `[]` y el bot responde "no tenemos stock" aunque Supabase sí tenga vehículos disponibles.

**Simulación:**
> Cliente: "Hola, tienen Hilux?"
> Bot (estado actual): "Ahora no tenemos ese modelo en stock, pero te puedo avisar cuando entre. ¿Querés que te anote?"
> *(Realidad: hay 12 Hilux en Supabase, pero el fallback las ocultó)*

**Impacto:** Pérdida directa de ventas. El cliente se va creyendo que no hay stock.
**Frecuencia estimada:** Cualquier restart de Railway o inestabilidad de red hacia Supabase.

---

### FALLO-02 — $200.000 de gastos administrativos hardcodeado en prompt
**Severidad: ALTO**
**Origen:** `agent.ts` línea ~189 — sección FINANCIACIÓN Y CRÉDITO

**Descripción:**
El prompt dice literalmente: *"Siempre se suma $200.000 de gastos administrativos al total."* Este dato está fijo en el código. En un mercado con inflación como Argentina, este valor puede estar desactualizado. El bot hace cálculos con este monto y se los presenta al cliente como información confiable.

**Simulación:**
> Cliente: "Quiero financiar el Cronos que vale $18M, tengo $9M de anticipo"
> Bot: "El monto a financiar sería $9.200.000 (precio $18M - tu entrega $9M + $200.000 de gastos)."
> *(Si los gastos reales son $350.000, hay $150K de diferencia que puede generar conflictos en el cierre)*

**Impacto:** Promesas incorrectas al cliente, pérdida de confianza en el cierre.

---

### FALLO-03 — Cambio de intención a mitad de conversación no limpia estado extraído
**Severidad: CRÍTICO**
**Origen:** `agent.ts` — `extracted` context es acumulativo, no hay reset por cambio de intent

**Descripción:**
El estado extraído (`brand`, `model`, `maxPrice`, etc.) se acumula progresivamente a través de turnos. Si un cliente empieza buscando una Hilux y luego cambia completamente a buscar un auto chico para ciudad, el agente sigue con `brand=Toyota`, `model=Hilux` en el contexto, contaminando la nueva búsqueda.

**Simulación:**
> T1 Cliente: "busco una Hilux diesel, tengo hasta $30M"
> T2 Bot: [muestra 2 Hilux]
> T3 Cliente: "en realidad, olvidate, quiero algo chico para la ciudad, lo más barato que tengan"
> T4 Bot: *(todavía tiene brand=Toyota, maxPrice=30M en extracted)* → puede seguir mostrando opciones Toyota en vez de resetear al segmento hatchback económico

**Impacto:** Respuestas incoherentes, frustración del cliente, lead mal calificado en panel.

---

### FALLO-04 — BOT_ADMIN_TOKEN failure silencioso en cambio de modo
**Severidad: CRÍTICO**
**Origen:** `TicketController.ts` — `updateBotMode()` silencia errores

**Descripción:**
Cuando el operador cambia el modo de bot a "Humano" desde el panel, se llama `PUT /tickets/:ticketId/bot-mode`. `updateBotMode()` en TicketController captura errores de comunicación con el bot y no los reporta. Si `BOT_ADMIN_TOKEN` no matchea, el panel muestra "Humano" pero el bot sigue respondiendo automáticamente al cliente.

**Simulación:**
> Operador ve conversación caliente y cambia a "Humano" para tomar control
> Panel confirma cambio visual
> Bot sigue respondiendo al cliente (en paralelo con el humano)
> Cliente recibe respuestas contradictorias

**Impacto:** Situación caótica en el cierre, daño a imagen de la agencia.

---

### FALLO-05 — AutoTrainer puede promover ejemplos de baja calidad
**Severidad: ALTO**
**Origen:** `autoTrainer.ts` — `forceLearnFromConversation()`

**Descripción:**
El autoTrainer corre cada 3 horas y promueve conversaciones a `bot_examples` para few-shot learning. No hay evidencia en el código de un umbral de calidad mínimo validado antes de la promoción. Si hay una conversación donde el bot dio respuestas mediocres (pero el cliente siguió conversando), eso puede quedar como "ejemplo exitoso" y degradar futuras respuestas.

**Simulación:**
> Conversación: bot da precio incorrecto → cliente no reclama (no sabe) → conversación cierra
> autoTrainer la marca como exitosa → se promueve como ejemplo → futuras respuestas aprenden el patrón incorrecto

**Impacto:** Degradación progresiva de calidad del bot en producción, difícil de detectar.

---

### FALLO-06 — ARS vs USD: ambigüedad en presupuesto verbal sin símbolo
**Severidad: CRÍTICO**
**Origen:** `agent.ts` / `extract.ts` — parseo de presupuesto

**Descripción:**
Si un cliente dice "tengo 20 mil" sin especificar la moneda, el sistema debe inferirla. En Argentina, $20.000 en pesos es prácticamente nada para un auto, pero USD 20.000 es un presupuesto medio-alto. Si el bot infiere ARS cuando el cliente quería decir USD, filtrará el catálogo con un rango inexistente y dirá que no hay opciones, perdiendo una venta de alto valor.

**Simulación:**
> Cliente: "tengo 20 mil para gastar"
> Bot (riesgo): toma como ARS 20.000 → busca autos hasta $20K ARS → catálogo vacío → "no tenemos nada en ese rango"
> Realidad: cliente tenía USD 20.000 → hay decenas de opciones

**Impacto:** Pérdida de lead caliente por inferencia incorrecta de moneda.

---

### FALLO-07 — GNC sin modelo mencionado: bot puede aludir a stock inexistente
**Severidad: ALTO**
**Origen:** `agent.ts` — filtrado de catálogo por campo `gnc`

**Descripción:**
Si el cliente pregunta "¿tienen algo con GNC?" sin mencionar modelo, el agente filtra el catálogo. Si `vehicles.fuel` no tiene un valor estandarizado para GNC (puede venir como "GNC", "gas", "GAS", "Gas natural", "nafta/GNC"), el filtro puede fallar y el bot responde "no hay con GNC" aunque sí haya. O viceversa: responde que hay cuando el campo está mal cargado.

**Simulación:**
> DB tiene: fuel="Nafta/GNC"
> Bot busca por fuel="GNC" → no encuentra → "No tenemos autos con GNC en este momento"
> Cliente se va → hay 3 autos con GNC en stock

**Impacto:** Pérdida de ventas por datos mal normalizados + filtros sensibles a case/formato.

---

### FALLO-08 — Mezcla de marcas/modelos inventados por el cliente
**Severidad: ALTO**
**Origen:** Prompt `agent.ts` — no hay validación de combinaciones imposibles

**Descripción:**
Si el cliente escribe "busco un Renault Hilux" o "quiero el Ford Tracker", el agente debería corregir educadamente. No hay instrucción explícita para manejar combinaciones de marca+modelo imposibles. El bot puede intentar buscar "Renault Hilux" en el catálogo, no encontrar, y decir "no tenemos ese modelo" sin aclarar que la combinación es inválida.

**Simulación:**
> Cliente: "tienen el Renault Tracker?"
> Bot riesgo: "Ahora no tenemos el Renault Tracker en stock. ¿Querés ver otros modelos?"
> Bot correcto: "El Tracker es de Chevrolet. ¿Estás buscando ese o querés ver los Renault que tenemos?"

**Impacto:** Confusión comercial, oportunidad perdida de mostrar el Tracker real.

---

### FALLO-09 — Lead frío repetitivo: bot entra en loop de preguntas
**Severidad: MEDIO**
**Origen:** `agent.ts` — regla de "avanzar con lo que tenés si el cliente esquiva 2 veces", pero sin limite de intentos bien definido

**Descripción:**
Si un cliente solo saluda ("hola", "buen día", "cómo están?") varias veces sin dar datos, el bot puede entrar en un micro-loop de captura de presupuesto o tipo de auto. La regla dice "avanzar con lo que tenés" tras 2 evasiones, pero si `extracted` está vacío, no hay "algo con qué avanzar" y el sistema puede volver a preguntar.

**Simulación:**
> T1 Cliente: "hola"
> T1 Bot: "Hola! ¿Qué tipo de auto estás buscando?"
> T2 Cliente: "bien y vos?"
> T2 Bot: "Todo bien. ¿Tenés alguna marca o presupuesto en mente?"
> T3 Cliente: "por ahora solo mirando"
> T3 Bot: "Claro! ¿Cuánto manejás de presupuesto?"  ← *re-pregunta de presupuesto*
> T4 Cliente: "no sé todavía"
> T4 Bot: "¿Y qué tipo de auto buscás?" ← *pregunta diferente pero sigue insistiendo*

**Impacto:** Experiencia frustrante para el usuario. Posible bloqueo del número.

---

### FALLO-10 — VehicleIds: GPT puede inventar IDs si no hay control post-respuesta
**Severidad: CRÍTICO**
**Origen:** `agent.ts` — instrucción: "NUNCA inventés ids — solo usá los que aparecen entre corchetes"

**Descripción:**
El prompt instruye a GPT a no inventar vehicleIds, pero no hay validación en código que verifique que los IDs devueltos existan en el catálogo provisto. Si GPT "alucina" un ID, ese ID puede llegar a `panelPersistence`, vincularse a un ticket y mostrar un auto inexistente en el panel o el historial de interés del lead.

**Simulación:**
> GPT devuelve: vehicleIds: ["42", "17", "99"]
> ID 99 no existe en catálogo
> panelPersistence guarda ["42", "17", "99"] en el ticket
> Panel muestra "Lead interesado en vehículo #99" → link roto o datos incorrectos

**Impacto:** Corrupción de datos del lead, panel muestra información falsa al operador.

---

### FALLO-11 — Persistencia del lead falla silenciosamente
**Severidad: CRÍTICO**
**Origen:** `panelPersistence.ts` → `POST /webhooks/bot/messages` con `x-admin-token`

**Descripción:**
Si `panelPersistence` falla (token inválido, panel backend caído, timeout de red), el bot responde al cliente pero el lead no se registra en el panel. No hay mecanismo de retry, no hay alerta visible al operador, y no hay indicador en el bot de que la persistencia falló.

**Simulación:**
> Panel backend tiene un restart momentáneo
> Bot recibe 3 consultas en ese momento
> Las 3 conversaciones quedan sin lead generado
> Operador no ve nada en el panel
> Ventas potenciales perdidas, sin trazabilidad

**Impacto:** Leads fantasma — el cliente fue atendido pero no queda registro, no hay seguimiento.

---

### FALLO-12 — Conversación > 8 turnos sin cierre: lógica de derivación incompleta
**Severidad: ALTO**
**Origen:** `agent.ts` — `toneNote` a partir de turno 6, derivación manual después de turno 8

**Descripción:**
La regla dice "si la conversación lleva más de 8 turnos sin avance, derivar". Pero "sin avance" no está definido formalmente. Si el cliente hace preguntas variadas (precio, km, garantía, financiación) sin comprometerse, el agente puede no detectarlo como "sin avance" y seguir respondiendo indefinidamente sin escalar al humano.

**Simulación:**
> 10 turnos de preguntas técnicas sin intención de compra
> Bot sigue respondiendo: kilometraje, garantía, financiación, colores, años
> Ninguna derivación ocurre porque el cliente "sigue activo"
> Operador humano no sabe que hay una conversación larga sin cierre

**Impacto:** Tiempo perdido del bot, oportunidad sin seguimiento humano en momento clave.

---

## 4. SEVERIDAD DE CADA FALLO

| # | Fallo | Severidad | Tipo de impacto |
|---|-------|-----------|-----------------|
| FALLO-01 | Catálogo vacío silencioso por fallback de pool | **CRÍTICO** | Pérdida directa de ventas |
| FALLO-02 | $200K hardcodeado en financiación | **ALTO** | Dato incorrecto al cliente |
| FALLO-03 | Cambio de intención no limpia contexto | **CRÍTICO** | Lead mal calificado, respuestas incoherentes |
| FALLO-04 | BOT_ADMIN_TOKEN falla silenciosamente | **CRÍTICO** | Bot sigue activo en modo "Humano" |
| FALLO-05 | AutoTrainer sin umbral de calidad | **ALTO** | Degradación progresiva del bot |
| FALLO-06 | ARS vs USD ambiguo en montos verbales | **CRÍTICO** | Pérdida de lead de alto valor |
| FALLO-07 | Normalización de GNC en catálogo | **ALTO** | Filtro roto, muestra stock incorrecto |
| FALLO-08 | Mezcla de marcas/modelos inválidos | **ALTO** | Confusión comercial, oportunidad perdida |
| FALLO-09 | Loop de preguntas en lead frío | **MEDIO** | UX mala, riesgo de bloqueo |
| FALLO-10 | VehicleIds inventados sin validación | **CRÍTICO** | Corrupción de datos del lead |
| FALLO-11 | Persistencia silenciosa sin retry | **CRÍTICO** | Leads fantasma, sin trazabilidad |
| FALLO-12 | Derivación a humano por inactividad sin definición de avance | **ALTO** | Conversaciones largas sin cierre |

---

## 5. MEJORAS PROPUESTAS

---

### MEJORA-01 — Catálogo: alerta activa cuando fallback retorna vacío
**Para FALLO-01**

```typescript
// En resilientCatalogQuery — después del fallback exitoso pero con 0 rows:
if (fallbackResult.rows.length === 0 && wasSupabaseFailure) {
  console.error('[CATALOG ALERT] Supabase falló y Railway devolvió catálogo vacío. Posible pérdida de stock.');
  // Emitir a canal de alertas (Slack/webhook) si está configurado
  notifyOpsAlert('CATALOG_EMPTY_FALLBACK', { timestamp: new Date() });
}
```

Además: añadir health endpoint `GET /health/catalog` que devuelva `{ count, source, lastUpdatedAt }` para monitoreo externo.

---

### MEJORA-02 — Gastos administrativos como variable de entorno o config
**Para FALLO-02**

Mover `$200.000` a `bot_intelligence_settings` o variable de entorno `FINANCING_ADMIN_FEE_ARS`. El prompt del agente debe leer este valor en runtime, no tenerlo hardcodeado. El panel de configuración del bot debería permitir actualizarlo sin tocar código.

```typescript
// En buildAgentSystemPrompt:
const adminFee = settings?.financingAdminFee ?? 200000;
// ... en el prompt:
`  2. Siempre se suma $${adminFee.toLocaleString('es-AR')} de gastos administrativos al total.`
```

---

### MEJORA-03 — Signal de reset de intención en extracted context
**Para FALLO-03**

Agregar detección de "reset explícito" en el mensaje del usuario. Frases como "olvidate", "en realidad", "cambiando de tema", "mejor buscá algo" deben disparar limpieza parcial del contexto extraído (limpiar `brand`, `model`, `maxPrice`, `bodywork`) y forzar un nuevo ciclo de extracción desde cero.

```typescript
const RESET_SIGNALS = ['olvidate', 'en realidad', 'cambiando', 'mejor buscá', 'no, espera'];
if (RESET_SIGNALS.some(s => normalize(userMessage).includes(s))) {
  extracted = { ...extracted, brand: null, model: null, maxPrice: null, bodywork: null };
  console.log('[agent] intent reset detected — cleared stale context');
}
```

---

### MEJORA-04 — BOT_ADMIN_TOKEN: confirmar cambio de modo con ACK
**Para FALLO-04**

El endpoint de cambio de modo en el bot debe retornar `{ ok: true, mode: 'HUMAN_ONLY' }` con status 200, o un error claro. `updateBotMode()` en el panel debe leer esa respuesta y:
- Si falla: mostrar alerta visible al operador ("⚠️ No se pudo cambiar el modo del bot. Verificar conexión.")
- Si falla silenciosamente: revertir el toggle en el UI para no dar información falsa.

---

### MEJORA-05 — AutoTrainer: score mínimo de calidad antes de promover ejemplo
**Para FALLO-05**

Antes de escribir a `bot_examples`, el autoTrainer debe validar:
1. La conversación tuvo al menos 3 turnos.
2. El último mensaje del bot NO fue una respuesta genérica (detectar frases como "Claro que sí", "Entendido", "Cualquier cosa me avisás").
3. Hubo al menos un `vehicleId` sugerido (**O** la conversación derivó a humano).
4. El intent final no fue `no_match` con score < 0.5.

Solo si pasa los 4 criterios → promover.

---

### MEJORA-06 — Detección robusta de moneda en montos verbales
**Para FALLO-06**

En `extract.ts`, cuando el cliente dice "X mil" sin símbolo de moneda, aplicar heurística contextual:
- Si X < 1000 → probablemente USD (nadie dice "$200" para un auto en ARS)
- Si X >= 5.000 → probablemente ARS
- Si hay ambigüedad, preguntar explícitamente ANTES de filtrar catálogo: *"¿Me decís si son pesos o dólares? No quiero mostrarte opciones equivocadas."*

---

### MEJORA-07 — Normalización de campo fuel en catálogo
**Para FALLO-07**

Al cargar el catálogo desde la DB, normalizar el campo `fuel` antes de cachear:

```typescript
function normalizeFuel(raw: string): string {
  const r = (raw ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  if (r.includes('gnc') || r.includes('gas natural')) return 'gnc';
  if (r.includes('diesel') || r.includes('gasoil')) return 'diesel';
  if (r.includes('electr')) return 'electrico';
  if (r.includes('hibrido') || r.includes('hybrid')) return 'hibrido';
  return 'nafta'; // default
}
```

Esta normalización debe aplicarse al construir `CatalogItem` desde las rows de DB y también en el filtro del agente.

---

### MEJORA-08 — Validación de marca+modelo imposibles
**Para FALLO-08**

Agregar un mapa de marcas→modelos conocidos al prompt o a una tabla `bot_brand_models`. Cuando el agente detecte una combinación inválida, responder: *"El [modelo] es de [marca correcta]. ¿Te referís a ese o querés ver los [marca mencionada] que tenemos?"*

Ejemplo mínimo implementable en el prompt:
```
── VALIDACIÓN MARCA/MODELO ──
Si el cliente combina una marca con un modelo que no le corresponde (ej: "Renault Hilux", "Ford Tracker", "Chevrolet Amarok"):
→ Corregir amablemente indicando la marca correcta.
→ Preguntar si quiere ese modelo (con la marca correcta) o ver opciones de la marca que mencionó.
```

---

### MEJORA-09 — Límite de turns sin datos → estrategia de "mostrar catálogo general"
**Para FALLO-09**

Si después de 4 turnos el `extracted` sigue completamente vacío, en lugar de seguir preguntando, activar un fallback de "catálogo destacado":
*"Mirá, te paso los modelos que más salen últimamente para que tengas una idea:"*
→ Mostrar los 3 más baratos del catálogo ordenados por precio.
→ Esto activa FOMO suave y da al cliente algo concreto con qué interactuar.

---

### MEJORA-10 — Validación de vehicleIds post-respuesta GPT
**Para FALLO-10**

Después de obtener la respuesta de GPT y antes de persistir:

```typescript
const validIds = new Set(catalog.map(v => String(v.id)));
const sanitizedVehicleIds = (decision.vehicleIds ?? [])
  .map(String)
  .filter(id => validIds.has(id));

if (sanitizedVehicleIds.length !== (decision.vehicleIds ?? []).length) {
  console.warn('[agent] GPT returned invalid vehicleIds — sanitized', {
    original: decision.vehicleIds,
    sanitized: sanitizedVehicleIds,
  });
}
decision.vehicleIds = sanitizedVehicleIds;
```

---

### MEJORA-11 — Persistencia con retry y alerta de fallo
**Para FALLO-11**

`panelPersistence.ts` debe implementar:
1. **Retry automático**: 3 intentos con backoff exponencial (1s, 3s, 9s).
2. **Dead letter queue**: si los 3 intentos fallan, guardar en archivo local o tabla `bot_failed_messages` para reprocesar.
3. **Alerta de fallo**: log ERROR + opcional webhook a canal de ops.

```typescript
async function persistWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await persistBotMessage(payload);
      return;
    } catch (err) {
      if (attempt === maxRetries) {
        await saveToDeadLetterQueue(payload, err);
        notifyOpsAlert('PERSIST_FAILED', { payload, err });
      }
      await sleep(1000 * Math.pow(3, attempt - 1));
    }
  }
}
```

---

### MEJORA-12 — Definición formal de "conversación sin avance"
**Para FALLO-12**

Añadir a `conversationAnalyzer.ts` una función `detectStagnation()`:
- Retorna `true` si los últimos 3 mensajes del usuario NO cambiaron `extracted` (mismo contexto = cliente no avanzó en definición).
- O si se repitió la misma intención 3 veces sin acción.
- Al detectar stagnation: forzar `handoffRecommended=true` + `action=ESCALATE_HUMAN` con mensaje al operador: *"Esta conversación lleva X turnos sin avance — revisar manualmente."*

---

## 6. RE-TEST CON COMPORTAMIENTO ESPERADO CORREGIDO

---

### RE-TC-11: Supabase caído + Railway vacío
**Estado actual:** Bot dice "no hay stock" ❌
**Estado esperado con MEJORA-01:**
- Sistema detecta catálogo vacío post-fallback
- Log ERROR visible: `[CATALOG ALERT] Supabase falló, catálogo = 0 vehículos`
- Bot responde: *"Estoy teniendo un problema para acceder al catálogo ahora mismo. Te paso con un asesor para que te muestre las opciones disponibles."*  → `action=ESCALATE_HUMAN`
- Alerta llega a operaciones

---

### RE-TC-03: Cuotas con $200K hardcoded
**Estado actual:** Bot dice "$200.000 de gastos adm." (puede ser incorrecto) ⚠️
**Estado esperado con MEJORA-02:**
- Bot lee `settings.financingAdminFee` = valor real actualizado por el admin
- Bot responde con dato correcto, por ejemplo "$350.000 de gastos adm."
- Si el campo no está configurado, responde: *"Los gastos exactos los confirma el asesor — varía según el plan."* en vez de dar un número

---

### RE-TC-16: Cambio de intención Hilux → hatchback
**Estado actual:** Bot sigue con contexto de Toyota/Hilux ❌
**Estado esperado con MEJORA-03:**
> T3 Cliente: "en realidad, olvidate de la camioneta, quiero algo chico para la ciudad"
> Bot: *"Dale, empezamos de nuevo. ¿Cuánto tenés de presupuesto para el auto de ciudad?"*
> → `extracted = { brand: null, model: null, bodywork: 'hatchback', useCase: 'ciudad' }`

---

### RE-TC-20: Toggle bot/humano con token inválido
**Estado actual:** Panel muestra "Humano" pero bot sigue activo ❌
**Estado esperado con MEJORA-04:**
- `updateBotMode()` recibe error 401 del bot
- Panel revierte el toggle a estado anterior
- Muestra toast: *"⚠️ No se pudo cambiar el modo. Verificar conexión con el bot."*
- Bot continúa en estado correcto (no hay desincronización)

---

### RE-TC-06: "tengo 20 mil para gastar"
**Estado actual:** Posible interpretación como ARS $20.000 ❌
**Estado esperado con MEJORA-06:**
> Bot: *"Perfecto! ¿Me decís si son pesos o dólares? Así te muestro opciones en el rango correcto."*
> Cliente: "dólares"
> Bot: [muestra catálogo filtrado a ~USD 20.000 = ~ARS equivalente]

---

### RE-TC-09: "tienen algo con GNC?" sin modelo
**Estado actual:** Puede no encontrar por normalización de campo ❌
**Estado esperado con MEJORA-07:**
- Al cargar catálogo, `fuel="Nafta/GNC"` se normaliza a `"gnc"`
- Filtro del agente encuentra los autos correctamente
> Bot: *"Sí! Tenemos [X] opciones con GNC. ¿Tenés alguna preferencia de tipo de auto o presupuesto?"*

---

### RE-TC-10: VehicleIds inválidos de GPT
**Estado actual:** ID 99 inexistente llega al panel ❌
**Estado esperado con MEJORA-10:**
- Post-parsing de respuesta GPT: `[42, 17, 99]` → sanitización → `[42, 17]`
- Log: `[agent] vehicleId 99 no encontrado en catálogo — removido`
- Panel guarda solo `[42, 17]` → datos limpios

---

## 7. TOP 5 PRIORIDADES PARA ARREGLAR PRIMERO

| Prioridad | Fallo | Por qué primero | Esfuerzo estimado |
|-----------|-------|-----------------|-------------------|
| **#1** | FALLO-11 — Persistencia sin retry/alerta | Leads fantasma = pérdida directa de negocio sin trazabilidad. Cada fallo es una venta invisible que se pierde para siempre. | Medio (2-3h) |
| **#2** | FALLO-01 — Catálogo vacío silencioso por fallback | Puede hacer que el bot niegue stock existente en el escenario más común (inestabilidad de red). Impacto directo e inmediato. | Bajo (1-2h) |
| **#3** | FALLO-04 — BOT_ADMIN_TOKEN falla silenciosamente | Un operador que pierde control del bot en el momento de cerrar una venta es el peor escenario operativo posible. | Bajo (1-2h) |
| **#4** | FALLO-06 — ARS vs USD en montos verbales | Argentina tiene mercado bimoneda activo. Una inferencia incorrecta descarta leads de alto valor. | Medio (2-4h) |
| **#5** | FALLO-10 — VehicleIds sin validación post-GPT | Corrupción de datos de leads que afecta la calidad de toda la analítica del panel y el historial de interés de clientes. | Bajo (1h) |

---

## ANEXO: Métricas de salud del bot sugeridas

Para medir si las mejoras realmente funcionan, implementar tracking de:

1. **Tasa de catálogo vacío** — % de requests donde `catalog.length === 0`
2. **Tasa de fallback a Railway** — % de queries donde supabasePool falló
3. **Tasa de vehicleIds sanitizados** — % de respuestas donde GPT devolvió IDs inválidos
4. **Tasa de persistencia fallida** — % de mensajes que no llegaron al panel
5. **Score promedio de ejemplos promovidos por autoTrainer** — para detectar degradación
6. **% de conversaciones con reset de intención detectado** — para medir FALLO-03
7. **Latencia promedio de respuesta del bot** — alerta si supera 4s (UX critica en WhatsApp)

---

*Informe generado por análisis estático de código + simulación de conversaciones. Las simulaciones son hipotéticas basadas en la lógica del código fuente actual.*
*Versión del sistema analizada: agent.ts v6, catalog.ts (post gaming-fallback fix), intelligence.ts v2*
