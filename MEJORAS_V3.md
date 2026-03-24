# Mejoras v3 — Inteligencia del Bot

## Resumen ejecutivo

Este patch aplica las recomendaciones del documento de revisión para que el bot:
1. **No repita preguntas** sobre datos ya captados (ej: presupuesto "30 millones")
2. **Confirme datos** al inicio de cada respuesta cuando hay contexto suficiente
3. **Entienda más formatos** de presupuesto ("30m", "entre 10 y 15 millones", typos)
4. **Use el modelo correcto** según la etapa de la conversación (exploración vs. cierre)
5. **Oriente hacia cierre** en lugar de seguir haciendo preguntas cuando el interés es alto

---

## Cambios por archivo

### `src/services/extract.ts` — Extracción más inteligente

**`parseMoney` mejorado:**
- ✅ Detecta rangos: "entre 10 y 15 millones" → toma el mayor como techo
- ✅ Detecta "30m" shorthand de millones
- ✅ Tolera typos: "millon", "palos", "kilos" como sinónimo de miles
- ✅ Contexto de presupuesto: si el texto contiene "presupuesto / plata / guita / tengo"
  y hay un número suelto (ej. "tengo 30"), lo interpreta como millones de ARS

**`extractLeadFields` mejorado:**
- ✅ `maxPrice` se setea con cualquier monto si NO había uno previo (antes solo se
  seteaba si decía "hasta/máximo")
- ✅ Si el cliente usa "hasta/máximo", siempre reemplaza el maxPrice (correcto)
- ✅ Si ya había un maxPrice y el monto NO es explícito, no se pisa
  (evita que el precio de un vehículo mostrado reemplace el presupuesto del cliente)

**Nuevas funciones exportadas:**
- `formatMoney(amount, currency)` → "ARS 30 M", "ARS 800 mil", "USD 25.000"
- `buildConfirmationPhrase(extracted)` → "Perfecto, entonces buscás Corolla hasta ARS 30 M."
- `hasUsefulData(ctx)` → bool: indica si hay suficiente contexto para mostrar resultados

**Nuevos alias de marcas:**
- Typos frecuentes: `wolksvagen`, `pejeot`, `hiunday`, `renol`, `hundai`, etc.

---

### `src/services/agent.ts` — Prompts mejorados + selección de modelo

**`buildAgentSystemPrompt` mejorado (v3):**
- ✅ Inyecta en el prompt un bloque "DATA YA CONOCIDA" con los campos ya captados
- ✅ Regla explícita: "NUNCA repreguntés un campo que aparece en DATA YA CONOCIDA"
- ✅ Regla de confirmación: cuando hay marca+presupuesto, confirmar antes de mostrar opciones
- ✅ Detección de señales de cierre → action=ESCALATE_HUMAN, handoffRecommended=true

**Nuevo `buildClosingSystemPrompt` (para leadScore >= 60):**
- Prompt enfocado en cierre: empatía, beneficios del vehículo, CTA concreto
- Temperatura 0.2 (más preciso que en exploración)
- Incluye resumen del contexto del cliente

**Selección de modelo por leadScore:**
```
leadScore < 40  → OPENAI_MODEL (gpt-4o-mini por defecto) — exploración rápida
leadScore >= 40 → OPENAI_MODEL_ADVANCED — mejor razonamiento
leadScore >= 60 → OPENAI_MODEL_ADVANCED + closing prompt — máximo esfuerzo
```

---

### `src/routes/webhooks.ts` — Anti-repeat inteligente

**Problema anterior:**
El bloque anti-repeat elegía aleatoriamente entre 3 preguntas genéricas, incluyendo
"¿Cuál es tu presupuesto aproximado?" incluso cuando el cliente ya había dicho "30 millones".

**Fix aplicado:**
```typescript
// ANTES (buggy):
reply = pickOne(['¿Tenés alguna marca...?', '¿Cuál es tu presupuesto...?', '¿Para qué lo vas a usar?']);

// AHORA (inteligente):
const fallbackQuestions: string[] = [];
if (!ctx.brand && !ctx.model)   fallbackQuestions.push('¿Tenés alguna marca o modelo en mente?');
if (!ctx.maxPrice && !ctx.amount) fallbackQuestions.push('¿Cuál es tu presupuesto aproximado?');
if (!ctx.useCase && !ctx.bodywork) fallbackQuestions.push('¿Para qué lo vas a usar?');
if (ctx.brand && !ctx.transmission) fallbackQuestions.push('¿Preferís caja manual o automática?');
if (ctx.brand && !ctx.minYear)  fallbackQuestions.push('¿De qué año lo buscás?');
reply = pickOne(fallbackQuestions); // Solo preguntas relevantes
```

---

### `.env.example` — Nueva variable

```env
OPENAI_MODEL_ADVANCED=gpt-4o-mini
# Cambiar a "gpt-4o" para mejor calidad en etapa de cierre
```

---

## Flujo de conversación mejorado

### Antes (problema):
```
Cliente: "busco un corolla, tengo 30 millones"
Bot: "¿Tenés alguna marca o modelo en mente?"  ← repregunta innecesaria
Bot: "¿Cuál es tu presupuesto aproximado?"      ← repregunta innecesaria
```

### Ahora (mejorado):
```
Cliente: "busco un corolla, tengo 30 millones"
Bot: "Perfecto, entonces buscás un Corolla hasta ARS 30 M. 
      Mirá estas opciones que tenemos:
      • Corolla 2022 automático – ARS 28.5 M ✓
      • Corolla 2021 automático – ARS 26 M ✓
      ¿Cuál te interesa ver primero?"
```

```
Cliente: "me interesa el del 2022, ¿puedo ir a verlo?"
Bot: (leadScore >= 60, modelo avanzado)
     "¡Genial! El Corolla 2022 está disponible para visita.
      ¿Te parece bien esta semana? Te conecto con un asesor 
      para coordinar el horario y confirmar disponibilidad."
     → action: ESCALATE_HUMAN
```

---

## Configuración recomendada

Para producción con mejor calidad de cierre:
```env
OPENAI_MODEL=gpt-4o-mini           # Exploración (rápido, económico)
OPENAI_MODEL_ADVANCED=gpt-4o       # Cierre (mejor razonamiento)
```

Para desarrollo/testing (mínimo costo):
```env
OPENAI_MODEL=gpt-4o-mini
OPENAI_MODEL_ADVANCED=gpt-4o-mini
```

---

## Cambios adicionales (Sesión 2)

### `src/routes/webhooks.ts` — 6 fixes más

**`mergeSearchContext` ampliado:**
```
ANTES: solo persistía brand, model, minYear, maxYear, transmission, fuel, bodywork, maxPrice
AHORA: también persiste year, color, useCase, city, name, amount
```
Ahora cuando el cliente dice "lo uso para remis en Tandil" esa info viaja en el contexto acumulado y el bot no la olvida al turno siguiente.

**`filterCatalogByContext` + `scoreVehicleForContext`:** usan `ctx.amount` como fallback de `maxPrice` en filtrado y scoring. Antes solo chequeaban `maxPrice`, entonces un presupuesto guardado como `amount` no filtraba nada.

**`scoreVehicleForContext` — nuevos bonuses:**
- Año exacto (`ctx.year === item.year`): +18 puntos
- `useCase: 'remis'` + sedán/hatch: +10 puntos
- `useCase: 'campo'` + pickup: +12 puntos
- `useCase: 'familiar'` + SUV: +8 puntos

**Contexto pasado al agente:** ahora se pasa `{ ...search_context, ...extracted }` en lugar de solo `extracted`. El agente ve **todo lo acumulado en la sesión**, no solo el turno actual.

**Historial GPT aumentado a 6 turnos** (de 4) y **se persiste también cuando responde el agente estructurado** (antes solo se guardaba si respondía el GPT fallback puro).

**Reanudación al volver:** si el cliente escribe "Hola" después de que expiró el contexto (30 min), el bot responde:
> "¡Hola! Bienvenido de vuelta. La última vez estabas buscando Corolla hasta ARS 30 M. ¿Seguís con eso o te puedo ayudar con otra cosa?"

---

### `src/services/lead.ts` — Factor `budgetDefined` (+8 pts)
Tener presupuesto definido (`maxPrice` o `amount`) suma 8 puntos al leadScore. Efecto:
- Cliente sin contexto → FRIO (≈0-15 pts)
- Cliente con marca + presupuesto → sube a TIBIO más rápido (≥40 → modelo avanzado)
- Cliente con marca + presupuesto + urgencia → CALIENTE (≥60 → closing prompt)

---

### `src/services/leadProfile.ts` — Campos extendidos
Ahora persiste: `budget_amount`, `year_exact`, `use_case`, `city`, `color`. Estos datos aparecen en el panel del operador cuando atiende al cliente tras el handoff.

---

### `sql/010_v3_improvements.sql` — Nueva migración
```sql
-- Nuevas columnas
ALTER TABLE bot_lead_profiles ADD COLUMN IF NOT EXISTS budget_amount numeric;
ALTER TABLE bot_lead_profiles ADD COLUMN IF NOT EXISTS use_case text;
ALTER TABLE bot_lead_profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE bot_lead_profiles ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE bot_lead_profiles ADD COLUMN IF NOT EXISTS year_exact int;

-- Vista para panel de operadores
CREATE VIEW v_hot_leads AS ...  -- leads TIBIOS/CALIENTES con contexto
```

**Aplicar con:**
```bash
psql $DATABASE_URL -f apps/bot/sql/010_v3_improvements.sql
```

---

## Resumen total de cambios (Sesiones 1+2)

| Archivo | Cambios |
|---------|---------|
| `extract.ts` | parseMoney mejorado, maxPrice implícito, formatMoney, buildConfirmationPhrase, hasUsefulData, nuevos alias |
| `agent.ts` | Prompt v3 con DATA YA CONOCIDA, closing prompt, selectModel por leadScore |
| `gpt.ts` | Documentación de OPENAI_MODEL_ADVANCED |
| `lead.ts` | Factor budgetDefined +8pts, tipo actualizado |
| `leadProfile.ts` | Persistencia de useCase, city, color, year_exact, budget_amount |
| `state.ts` | Tipo ConvState extendido con extracted y campos extra en search_context |
| `webhooks.ts` | Anti-repeat inteligente, mergeSearchContext ampliado, filterCatalog+scoreVehicle con ctx.amount, buildVehicleReply con confirmación, reanudación por contexto vencido, historial GPT a 6 turnos persistido en agent también, mergedExtracted al agente |
| `.env.example` | OPENAI_MODEL_ADVANCED documentado |
| `sql/010_v3_improvements.sql` | Nueva migración con columnas y vista v_hot_leads |
