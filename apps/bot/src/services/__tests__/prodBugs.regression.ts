/**
 * prodBugs.regression.ts
 *
 * Casos de prueba exactos para los 10 bugs de producción corregidos.
 * NO son unit tests automáticos — son contratos de comportamiento para
 * validación manual o futura integración con evaluaciones.
 *
 * Para cada caso: input → comportamiento esperado verificable en logs.
 */

/**
 * CASO 1 — Saludo / Soft Reset
 * Input: "hola como estas"
 * Esperado:
 *   - RESET_RE.test("hola como estas") === true  (o GPT classifica como greeting)
 *   - routerDecision.action === 'GREETING'
 *   - decide() llama composeResponse('saludo_retorno', {}, [])  ← historyLines vacío
 *   - Respuesta NO contiene "seguimos" ni referencia a conversación anterior
 *   - newState.search_context === {}
 *   - newState.last_reply_action === undefined (reset limpia)
 * Log verificable:
 *   [bot] previous_context_cleared=true reason=greeting
 */

/**
 * CASO 2 — Reset por cambio de tema
 * Input: "estoy buscando otra cosa"
 * Esperado:
 *   - RESET_RE.test("estoy buscando otra cosa") === true
 *   - fastOverride === 'reset'
 *   - search_context se limpia completamente
 *   - No usa filtros previos (marca/modelo del turno anterior)
 * Log verificable:
 *   [bot] previous_context_cleared=true reason=reset
 */

/**
 * CASO 3 — Auto chico / compacto
 * Input: "algún auto chico?"
 * Esperado:
 *   - GPT extrae bodywork='hatch', fuelEconomyPriority=true
 *   - filterCatalog excluye: pickup, suv, furgon, monovolumen (con bodywork explícito)
 *   - filterCatalog excluye: items sin bodywork detectable cuando bodywork='hatch' + fuelEconomyPriority (isCompactStrict)
 *   - Resultado: solo sedán, hatch o items genéricos sin bodywork de tamaño grande
 * Log verificable:
 *   [filter] extractedConstraints={"bodywork":"hatch","fuelEconomyPriority":true,...}
 *   [filter] filteredCountAfterHard=N  (N no incluye SUV/pickup)
 */

/**
 * CASO 4 — Detalle BYD Dolphin (precio ARS consistente)
 * Setup: BYD Dolphin en catálogo con priceNumber=24900, currency='USD'
 * Input: "el dolphin"
 * Esperado:
 *   - handleSpecificById llama getUsdToArs()
 *   - priceArs = Math.round(24900 * usdRate)  (ej: 24900 * 1300 = 32.370.000)
 *   - buildVehicleDetail muestra "ARS 32.370.000" (NO "USD 24.900")
 *   - presentedVehicle.priceNumber = 32370000, currency = 'ARS'
 *   - state.lastPresentedVehiclePriceArs = 32370000
 * Log verificable:
 *   [catalog] detail vehicleId=X rawCurrency=USD rawPrice=24900 priceArs=32370000 usdRate=1300
 */

/**
 * CASO 5 — Financiación sin mezcla USD/ARS
 * Setup: Dolphin con precio normalizado en estado (lastPresentedVehiclePriceArs=32370000)
 * Input: "quiero financiación"
 * Esperado:
 *   - handleCredit usa vehicle.price = 32370000 (ARS)
 *   - composeResponse recibe precio: "ARS 32.370.000" (no "ARS 24.900")
 *   - getCreditQuote recibe vehiclePrice=32370000 (correcto para cotizador)
 *   - No hay "ARS 24.900" en ninguna respuesta
 */

/**
 * CASO 6 — Rescate comercial por objeción de precio
 * Input: "me parece caro no llego"
 * Setup: state.search_context = {} (sin maxPrice)
 * Esperado:
 *   - detectObjection retorna PRICE_TOO_HIGH (PRICE_PATTERNS matchea)
 *   - ex.leadMode = 'price_sensitive' (GPT)
 *   - decide() entra en bloque price_sensitive
 *   - hasKnownBudget === false
 *   - composeResponse('objecion_precio_sin_presupuesto', ...) → pregunta UNA cosa
 *   - NO deriva a humano en este turno
 *   - objection_count = 1
 * Log verificable:
 *   [bot] price_objection_rescue=ask_budget no_known_budget=true
 *
 * Segundo turno: "hasta 15 millones"
 * Esperado:
 *   - maxPrice = 15000000
 *   - handleSearch filtra por presupuesto
 *   - [bot] price_objection_rescue=search_within_budget budget=15000000
 */

/**
 * CASO 7 — No-match coherente (BMW 2024)
 * Input: "tenés algún BMW 2024?"
 * Setup: Catálogo sin BMW
 * Esperado:
 *   - findClosestAlternatives intenta: misma marca (BMW → 0), luego segmento+precio, luego solo precio
 *   - Si no hay nada en el mismo segmento/precio → alternatives = []
 *   - composeResponse('sin_match', { tiene_alternativas: false, ... })
 *   - Respuesta: reconoce gap, hace UNA pregunta orientadora
 *   - NO ofrece Fiat Cronos como alternativa a BMW premium
 * Log verificable:
 *   [nomatch] alternatives_strategy=none — no reasonable alternatives found
 *
 * Variante con alternativas reales:
 *   - Si hay Mercedes C o Audi A4 en catálogo con precio similar → se ofrecen
 *   [nomatch] alternatives_strategy=segment_price count=2 top_pts=3
 */

/**
 * CASO 8 — Handoff con notificación real
 * Input: "quiero hablar con alguien"
 * Esperado:
 *   - GPT extrae wantsAdvisor=true
 *   - routerDecision.action === 'ESCALATE_HUMAN'
 *   - En processMessage: notifyAdvisorHandoff() llamada ANTES de decide()
 *   - ADVISOR_WHATSAPP_NUMBER configurado → envío WhatsApp
 * Logs verificables (en orden):
 *   [handoff] handoff_decided instance=X jid=Y reason=cliente_solicita_asesor advisor_configured=true
 *   [handoff] handoff_notify_attempted=true handoff_notify_target=ADVISOR@s.whatsapp.net
 *   [handoff] handoff_notify_result=success|error|skipped
 *
 * Si ADVISOR_WHATSAPP_NUMBER no está configurado:
 *   [handoff] handoff_notify_result=skipped handoff_notify_error="ADVISOR_WHATSAPP_NUMBER not configured"
 *   → NO fallo silencioso, queda en log
 */

/**
 * CASO 9 — Pivot de exact-match a presupuesto (caso Sandero)
 * Turno 1: "Tendrías una Sandero 2018"
 *   - No hay match → last_reply_action = 'sin_match'
 *   - search_context = { brand: 'Sandero', model: 'Sandero', year: 2018 }
 *
 * Turno 2: "alguno dentro del presupuesto de la Sandero"
 *   - prevWasNoMatch = true
 *   - hasPivotSignal = true ("dentro del presupuesto")
 *   - hasNoNewBrandModel = true
 *   - Pivot detectado: effectiveState.search_context limpia brand/model
 *   Log: [bot] pivot_from_nomatch=true dropped_brand="Sandero" dropped_model="Sandero"
 *
 * Turno 3: "uno hasta 18 millones x fa"
 *   - ex.maxPrice = 18000000
 *   - pivot detectado
 *   - filterCatalog solo filtra por maxPrice=18M (sin brand='Sandero')
 *   - Muestra autos reales ≤ $18M
 *   - NO repite el no-match textual de Sandero
 *
 * NUNCA el bot debería ofrecer Compass o Dolphin como "cercano a Sandero 2018" (salvo que comparta precio/segmento real)
 */

/**
 * CASO 10 — Anti-repetición
 * Turno 1: "Sandero 2018" → sin_match → last_reply_action = 'sin_match'
 * Turno 2: "Sandero 2018" (repite exacto, sin nuevos datos)
 *   - prevWasNoMatch = true, hasNewFilter = false, hasPivotSignal = false
 *   - NO hay pivot → busca igual → vuelve a sin_match
 *   - nota en composeResponse incluye: "No repitas la misma respuesta."
 *   - GPT debe variar el tono (ej: preguntar presupuesto de otra forma)
 *
 * Turno 2 alternativo: "algo parecido" (con pivot)
 *   - hasPivotSignal = true
 *   - Pivot → cambia estrategia → no-match o resultados diferentes
 */
