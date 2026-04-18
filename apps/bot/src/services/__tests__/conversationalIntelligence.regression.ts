/**
 * conversationalIntelligence.regression.ts
 *
 * Valida la inteligencia conversacional real del bot post-compactación de prompts.
 *
 * ESTRATEGIA:
 *   - routeDecision() es pura → se testea directamente con Extracted mock.
 *   - isAmbiguousOverride (inline en processMessage) se testea vía la función
 *     auxiliar exportada "resolveAmbiguous" que recrea la misma lógica.
 *   - decide() requiere DB/GPT → se valida el contrato de entrada (qué Extracted
 *     debería producir qué acción) sin llamarlo con el stack real.
 *   - Lo que NO se puede validar sin OPENAI_API_KEY está marcado explícitamente.
 *
 * Corre con:
 *   npx tsx src/services/__tests__/conversationalIntelligence.regression.ts
 */

import { routeDecision } from '../runtimeRouter.js';
import type { RouterAction } from '../runtimeRouter.js';
import type { Extracted } from '../botIntelligence.js';
import type { ConvState } from '../state.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const msg = name + (detail ? ` — ${detail}` : '');
    console.error(`  ✗ ${msg}`);
    failed++;
    failures.push(msg);
  }
}

function eq(actual: unknown, expected: unknown, name: string) {
  check(actual === expected, name, `got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

/** Replica la lógica inline de isAmbiguousOverride de processMessage */
function testAmbiguousOverride(params: {
  extracted: Extracted;
  state: ConvState;
  message: string;
  fastOverride: 'reset' | 'catalog' | 'catalog_more' | null;
}): boolean {
  const { extracted, state, message, fastOverride } = params;
  const hasActiveVehicle = !!state.lastPresentedVehicleId;
  const hasExplicitReset = fastOverride === 'reset' || fastOverride === 'catalog';
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  const hasNewStrongFilter = !!(
    extracted.brand || extracted.model || extracted.maxPrice || extracted.bodywork ||
    extracted.fuel || extracted.gnc || extracted.transmission || extracted.useCase
  );
  return (
    hasActiveVehicle &&
    !hasExplicitReset &&
    ['catalog', 'reset', 'search', 'unsure'].includes(extracted.intent) &&
    !hasNewStrongFilter &&
    (extracted.confidence === 'low' || !extracted.confidence || wordCount <= 3)
  );
}

const emptyState: ConvState = {};
const stateWithVehicle: ConvState = {
  lastPresentedVehicleId: 'v-cronos-001',
  lastPresentedVehicleTitle: 'Fiat Cronos 2023',
  lastPresentedVehiclePriceArs: 18_500_000,
};
const stateWithSnapshot: ConvState = {
  ...stateWithVehicle,
  last_hits_detail: [
    { idx: 0, id: 'v-cronos-001', name: 'Fiat Cronos 2023', brand: 'Fiat', model: 'Cronos', priceNumber: 18_500_000, currency: 'ARS' },
    { idx: 1, id: 'v-onix-002', name: 'Chevrolet Onix 2022', brand: 'Chevrolet', model: 'Onix', priceNumber: 16_800_000, currency: 'ARS' },
  ],
  last_hits_at: new Date().toISOString(),
};
const stateNoMatch: ConvState = {
  last_reply_action: 'sin_match',
  search_context: { brand: 'BMW', model: 'X5', maxPrice: 50_000_000 },
};

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 1: routeDecision — pura, sin GPT
// Valida que el router mapee correctamente Extracted → RouterAction para
// los escenarios conversacionales del spec.
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Sección 1: routeDecision (pura, sin GPT) ===\n');

// "hola"
{
  console.log('Escenario: saludo inicial');
  const ex: Extracted = { intent: 'greeting', confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'GREETING', 'saludo → GREETING');
}

// "ando viendo" / "no sé qué quiero" (sin contexto previo)
{
  console.log('\nEscenario: indeciso sin contexto');
  const ex: Extracted = { intent: 'unsure', leadMode: 'exploratory', needsClarification: true, confidence: 'low' };
  eq(routeDecision(ex, emptyState).action, 'ASK_ONE_QUESTION', '"ando viendo" sin filtros → ASK_ONE_QUESTION');
}

// "busco un auto chico que gaste poco"
{
  console.log('\nEscenario: búsqueda auto chico');
  const ex: Extracted = { intent: 'search', bodywork: 'hatch', fuelEconomyPriority: true, leadMode: 'exploratory', needsClarification: true, confidence: 'medium' };
  const r = routeDecision(ex, emptyState);
  eq(r.action, 'SHOW_OPTIONS', 'auto chico + bodywork=hatch → SHOW_OPTIONS (tiene filtro)');
}

// "tenés alguna pickup?"
{
  console.log('\nEscenario: pickup');
  const ex: Extracted = { intent: 'search', bodywork: 'pickup', confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'SHOW_OPTIONS', 'pickup → SHOW_OPTIONS');
}

// "algo para la familia"
{
  console.log('\nEscenario: algo para la familia');
  const ex: Extracted = { intent: 'search', bodywork: 'familiar', leadMode: 'exploratory', needsClarification: true, confidence: 'medium' };
  eq(routeDecision(ex, emptyState).action, 'SHOW_OPTIONS', 'familiar + bodywork → SHOW_OPTIONS');
}

// "no sé qué quiero" con contexto previo de búsqueda
{
  console.log('\nEscenario: indeciso con contexto');
  const ex: Extracted = { intent: 'unsure', leadMode: 'exploratory', confidence: 'low' };
  const state: ConvState = { search_context: { bodywork: 'suv', maxPrice: 20_000_000 } };
  eq(routeDecision(ex, state).action, 'SHOW_OPTIONS', 'unsure con search_context → SHOW_OPTIONS');
}

// "me parece caro" (price_sensitive sin presupuesto conocido)
{
  console.log('\nEscenario: objeción de precio');
  const ex: Extracted = { intent: 'search', leadMode: 'price_sensitive', confidence: 'medium' };
  eq(routeDecision(ex, emptyState).action, 'HANDLE_OBJECTION', 'price_sensitive → HANDLE_OBJECTION');
}

// "algo más barato" (price_sensitive con presupuesto en contexto)
{
  console.log('\nEscenario: más barato con presupuesto conocido');
  const ex: Extracted = { intent: 'search', leadMode: 'price_sensitive', confidence: 'medium' };
  const state: ConvState = { search_context: { maxPrice: 15_000_000 } };
  // Router → HANDLE_OBJECTION; decide() luego va a handleSearch con ese presupuesto
  eq(routeDecision(ex, state).action, 'HANDLE_OBJECTION', 'price_sensitive → HANDLE_OBJECTION (decide toma el presupuesto)');
}

// "tengo un usado para entregar"
{
  console.log('\nEscenario: permuta');
  const ex: Extracted = { intent: 'trade_in', confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'TRADE_IN_FLOW', 'trade_in → TRADE_IN_FLOW');
}

// "quiero ir a verlo"
{
  console.log('\nEscenario: visita');
  const ex: Extracted = { intent: 'visit', wantsVisit: true, confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'COORDINAR_VISITA', 'visit → COORDINAR_VISITA');
}

// "quiero hablar con alguien"
{
  console.log('\nEscenario: handoff');
  const ex: Extracted = { intent: 'advisor', wantsAdvisor: true, confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'ESCALATE_HUMAN', 'advisor → ESCALATE_HUMAN');
}

// "y si lo financio?" / "cuotas?"
{
  console.log('\nEscenario: financiación');
  const ex: Extracted = { intent: 'credit_quote', confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'FINANCING_FLOW', 'credit_quote → FINANCING_FLOW');
}

// "el 1" / "la primera" (selección numérica con snapshot activo)
{
  console.log('\nEscenario: selección numérica de snapshot');
  const ex: Extracted = { intent: 'specific', selectedVehicleId: 'v-cronos-001', confidence: 'high' };
  eq(routeDecision(ex, stateWithSnapshot).action, 'SHOW_SINGLE', 'specific+selectedId → SHOW_SINGLE');
}

// "chau" / "gracias"
{
  console.log('\nEscenario: despedida');
  const ex: Extracted = { intent: 'farewell', confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'FAREWELL', 'farewell → FAREWELL');
}

// mostrame el catálogo
{
  console.log('\nEscenario: catálogo explícito');
  const ex: Extracted = { intent: 'catalog', confidence: 'high' };
  eq(routeDecision(ex, emptyState).action, 'CATALOG_BROWSE', 'catalog → CATALOG_BROWSE');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 2: isAmbiguousOverride — protección de contexto vehicular
// Replica la lógica inline de processMessage para testearla sin llamar la fn.
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Sección 2: isAmbiguousOverride (protección contexto vehicular) ===\n');

// "ese" / "mismo" / "dale" con vehículo activo → DEBE disparar override
{
  console.log('Mensajes cortos/vagos con vehículo activo:');
  const cases = [
    { msg: 'ese',    ex: { intent: 'search' as const, confidence: 'low' as const } },
    { msg: 'mismo',  ex: { intent: 'unsure' as const, confidence: 'low' as const } },
    { msg: 'dale',   ex: { intent: 'unsure' as const, confidence: 'low' as const } },
    { msg: 'ok',     ex: { intent: 'unsure' as const, confidence: 'low' as const } },
    { msg: 'y este', ex: { intent: 'search' as const, confidence: 'low' as const } },
  ];
  for (const { msg, ex } of cases) {
    check(
      testAmbiguousOverride({ extracted: ex, state: stateWithVehicle, message: msg, fastOverride: null }),
      `"${msg}" con vehículo activo → override dispara`
    );
  }
}

// Mensajes cortos CON filtro real → NO deben disparar override
{
  console.log('\nMensajes cortos CON filtro real (no deben disparar override):');
  const cases: Array<{ msg: string; ex: Extracted }> = [
    { msg: 'pickup?',  ex: { intent: 'search', bodywork: 'pickup', confidence: 'medium' } },
    { msg: 'diesel?',  ex: { intent: 'search', fuel: 'diesel', confidence: 'medium' } },
    { msg: 'GNC?',     ex: { intent: 'search', gnc: true, confidence: 'medium' } },
    { msg: 'automático?', ex: { intent: 'search', transmission: 'automático', confidence: 'medium' } },
    { msg: 'SUV?',     ex: { intent: 'search', bodywork: 'suv', confidence: 'high' } },
    { msg: 'familiar?', ex: { intent: 'search', bodywork: 'familiar', confidence: 'medium' } },
    { msg: 'remis',    ex: { intent: 'search', useCase: 'remis', confidence: 'medium' } },
  ];
  for (const { msg, ex } of cases) {
    check(
      !testAmbiguousOverride({ extracted: ex, state: stateWithVehicle, message: msg, fastOverride: null }),
      `"${msg}" tiene filtro real → override NO dispara`
    );
  }
}

// Sin vehículo activo → override nunca dispara
{
  console.log('\nSin vehículo activo (override nunca aplica):');
  const ex: Extracted = { intent: 'search', confidence: 'low' };
  check(
    !testAmbiguousOverride({ extracted: ex, state: emptyState, message: 'ese', fastOverride: null }),
    'sin vehículo activo → override no dispara (no hay contexto que proteger)'
  );
}

// Explicit reset → override no intercepta
{
  console.log('\nReset explícito → override no intercepta:');
  const ex: Extracted = { intent: 'catalog', confidence: 'high' };
  check(
    !testAmbiguousOverride({ extracted: ex, state: stateWithVehicle, message: 'hola', fastOverride: 'reset' }),
    'reset explícito → override no aplica'
  );
  check(
    !testAmbiguousOverride({ extracted: ex, state: stateWithVehicle, message: 'mostrame el catálogo', fastOverride: 'catalog' }),
    'catalog explícito → override no aplica'
  );
}

// Confidence medium pero wordCount > 3 → no dispara (sin filtro, sin low confidence)
{
  console.log('\nMensaje largo sin filtro pero confidence medium → no dispara:');
  const ex: Extracted = { intent: 'search', confidence: 'medium' };
  check(
    !testAmbiguousOverride({ extracted: ex, state: stateWithVehicle, message: 'busco algo totalmente diferente al anterior', fastOverride: null }),
    'mensaje largo + medium confidence → override no dispara (correcto: dejar pasar a búsqueda)'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 3: routeDecision — escenario pivot post-no-match
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Sección 3: pivot post-no-match ===\n');

{
  console.log('Usuario da presupuesto nuevo después de no-match:');

  // Simulamos lo que processa processMessage después del pivot:
  // extracted.intent = 'search' (forzado por la lógica de pivot)
  // effectiveState limpia brand/model del turno anterior
  const ex: Extracted = { intent: 'search', maxPrice: 20_000_000, currency: 'ARS', confidence: 'high' };
  const r = routeDecision(ex, emptyState); // effectiveState ya sin brand/model
  eq(r.action, 'SHOW_OPTIONS', 'pivot con presupuesto → SHOW_OPTIONS (sin brand/model previo)');

  // Si brand NO está en extracted → router va a SHOW_OPTIONS no SHOW_SINGLE
  const exWithBrand: Extracted = { intent: 'search', brand: 'Ford', maxPrice: 20_000_000, confidence: 'high' };
  eq(routeDecision(exWithBrand, emptyState).action, 'SHOW_OPTIONS', 'búsqueda con brand pero intent=search → SHOW_OPTIONS');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 4: anti-invención — TruthGuard patterns (sin DB)
// Verifica que los regex de detección de alucinaciones siguen cubriendo casos
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n=== Sección 4: anti-invención (guardResponse patterns) ===\n');

// Importar guardResponse directamente desde truthGuard
import('../truthGuard.js').then(({ guardResponse }) => {
  const catalog = [
    { id: 'v-cronos-001', name: 'Fiat Cronos 2023', inStock: true, priceNumber: 18_500_000, currency: 'ARS' } as any,
    { id: 'v-out-002', name: 'Auto sin stock', inStock: false, priceNumber: 5_000_000, currency: 'ARS' } as any,
  ];
  const state: ConvState = {};

  console.log('TruthGuard — detección de alucinaciones:');

  // Cuotas inventadas sin datos reales → DEBE bloquear
  {
    const r = guardResponse({
      responseText: 'Las cuotas de ese auto son $350.000 por mes.',
      catalog,
      state,
      action: 'FINANCING_FLOW',
    });
    check(!r.passed, 'cuotas inventadas sin state.finance → blocked');
  }

  // Auto fuera de stock → DEBE bloquear
  {
    const r = guardResponse({
      presentedVehicleId: 'v-out-002',
      responseText: 'Ese auto está disponible y lo podés llevar mañana.',
      catalog,
      state,
      action: 'SHOW_SINGLE',
    });
    check(!r.passed, 'vehicle inStock=false → blocked');
  }

  // Auto inexistente en catálogo → DEBE bloquear
  {
    const r = guardResponse({
      presentedVehicleId: 'v-phantom-999',
      responseText: 'El [Modelo Inventado] está disponible.',
      catalog,
      state,
      action: 'SHOW_SINGLE',
    });
    check(!r.passed, 'vehicle no existe en catálogo → blocked');
  }

  // Respuesta limpia con auto en stock → DEBE pasar
  {
    const r = guardResponse({
      presentedVehicleId: 'v-cronos-001',
      responseText: 'El Fiat Cronos 2023 — ARS 18.500.000. Te mando fotos. ¿Querés calcular cuotas?',
      catalog,
      state,
      action: 'SHOW_SINGLE',
    });
    check(r.passed, 'respuesta válida con auto en stock → passed');
  }

  // Entrega mínima inventada → DEBE bloquear (patrón de cuotas)
  {
    const r = guardResponse({
      responseText: 'La entrega mínima es $2.000.000 por mes.',
      catalog,
      state,
      action: 'FINANCING_FLOW',
    });
    check(!r.passed, 'entrega mínima inventada con patrón de cuota → blocked');
  }

  // Respuesta sin inventar nada para entrega mínima → DEBE pasar
  {
    const r = guardResponse({
      responseText: 'La entrega mínima depende del banco y del plan. El asesor te confirma el número real.',
      catalog,
      state: { finance: { stage: 'collecting' } },
      action: 'FINANCING_FLOW',
    });
    check(r.passed, 'respuesta correcta de entrega_minima → passed');
  }

  printSummary();
}).catch(err => {
  console.error('[error] No se pudo importar truthGuard:', err.message);
  printSummary();
});

function printSummary() {
  console.log(`\n═══ Resultado: ${passed} passed, ${failed} failed ═══`);
  if (failures.length > 0) {
    console.error('\nFallos:');
    failures.forEach(f => console.error(`  - ${f}`));
  }
  console.log('\n─── Qué NO se validó (requiere OPENAI_API_KEY real) ───');
  console.log('  • Calidad real de extractIntent() con prompts compactados');
  console.log('  • Que GPT no invente brand/model en mensajes ambiguos');
  console.log('  • Que needsClarification=true en "ando viendo" real');
  console.log('  • Que selectedVehicleId se resuelva para "el primero" en contexto real');
  console.log('  • Calidad/tono de composeResponse() con el nuevo RESPONSE_SYSTEM');
  console.log('  • Que el pivot post-no-match no herede brand/model cuando GPT los saca');
  if (failed > 0) process.exit(1);
}
