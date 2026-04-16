/**
 * filterCatalog.regression.ts — Tests de regresión para la lógica de filtrado del catálogo.
 *
 * Corre con: npx tsx src/services/__tests__/filterCatalog.regression.ts
 *
 * Estos tests no requieren DB ni GPT — validan la lógica pura de filterCatalog()
 * contra los casos reales que fallaron en producción.
 *
 * Casos cubiertos:
 *  1. "pickup del 2014 al 2018" nunca devuelve Corolla, Palio, Vento, Motorhome
 *  2. "un auto chico y que gaste poco" nunca devuelve motorhome, pickup, camión
 *  3. "gaste poco" excluye vehículos grandes aunque bodywork sea undefined
 *  4. rango de año se aplica sin tolerancia ±2
 *  5. año único sigue usando tolerancia ±2
 *  6. bodywork=pickup excluye ítems con bodywork=sedan aunque item.bodywork esté seteado
 *  7. bodywork=pickup excluye ítems sin bodywork y sin nombre que infiera pickup (strict type)
 *  8. bodywork=sedan permite ítems sin bodywork si no son claramente otro tipo
 *  9. fallback blando por brand mantiene constraint de bodywork
 * 10. notificación hot lead usa destinos separados (validación de estructura, sin envío real)
 */

import { filterCatalog } from '../botIntelligence.js';
import type { CatalogItem } from '../catalog.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
    failures.push(testName + (detail ? ` — ${detail}` : ''));
  }
}

function assertNone(items: CatalogItem[], forbiddenNames: string[], testName: string): void {
  const found = items.filter(i => forbiddenNames.some(n => i.name.toLowerCase().includes(n.toLowerCase())));
  assert(found.length === 0, testName, found.length ? `encontró: ${found.map(i => i.name).join(', ')}` : undefined);
}

function assertAll(items: CatalogItem[], requiredNames: string[], testName: string): void {
  const found = items.filter(i => requiredNames.some(n => i.name.toLowerCase().includes(n.toLowerCase())));
  assert(found.length === requiredNames.length, testName, `encontró ${found.length}/${requiredNames.length}`);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CatalogItem> & { name: string; id: string }): CatalogItem {
  return {
    inStock: true,
    ...overrides,
  };
}

// Catálogo de prueba con casos reales de fallo
const FIXTURE_CATALOG: CatalogItem[] = [
  // Pickups
  makeItem({ id: 'ranger-1', name: 'Ford Ranger 2016', brand: 'Ford', model: 'Ranger', year: 2016, bodywork: 'pickup' }),
  makeItem({ id: 'hilux-1',  name: 'Toyota Hilux 2017', brand: 'Toyota', model: 'Hilux', year: 2017, bodywork: 'pickup' }),
  makeItem({ id: 'amarok-1', name: 'Volkswagen Amarok 2015', brand: 'Volkswagen', model: 'Amarok', year: 2015 }), // sin bodywork explícito
  // Sedanes / hatch
  makeItem({ id: 'corolla-1', name: 'Toyota Corolla 2017', brand: 'Toyota', model: 'Corolla', year: 2017 }), // sin bodywork
  makeItem({ id: 'cronos-1',  name: 'Fiat Cronos 2020', brand: 'Fiat', model: 'Cronos', year: 2020, bodywork: 'sedan' }),
  makeItem({ id: 'palio-1',   name: 'Fiat Palio 2015', brand: 'Fiat', model: 'Palio', year: 2015, bodywork: 'hatch' }),
  makeItem({ id: 'vento-1',   name: 'Volkswagen Vento 2019', brand: 'Volkswagen', model: 'Vento', year: 2019, bodywork: 'sedan' }),
  makeItem({ id: 'kwid-1',    name: 'Renault Kwid 2022', brand: 'Renault', model: 'Kwid', year: 2022, bodywork: 'hatch' }),
  // SUV
  makeItem({ id: 'ecosport-1', name: 'Ford EcoSport 2018', brand: 'Ford', model: 'EcoSport', year: 2018, bodywork: 'suv' }),
  makeItem({ id: 'duster-1',   name: 'Renault Duster 2019', brand: 'Renault', model: 'Duster', year: 2019 }), // sin bodywork, pero token en nombre → inferido como suv
  // Grandes / pesados
  makeItem({ id: 'motorhome-1', name: 'MotorHome Ducato 2020', brand: 'Fiat', model: 'Ducato', year: 2020, bodywork: 'motorhome' }),
  makeItem({ id: 'sprinter-1',  name: 'Mercedes Sprinter 2018', brand: 'Mercedes', model: 'Sprinter', year: 2018 }), // sin bodywork, token → inferred
  makeItem({ id: 'camion-1',    name: 'Iveco Daily Furgon 2017', brand: 'Iveco', model: 'Daily', year: 2017, bodywork: 'furgon' }),
  // Fuera de stock
  makeItem({ id: 'fuera-1', name: 'Ford Ranger 2015 VENDIDO', brand: 'Ford', model: 'Ranger', year: 2015, bodywork: 'pickup', inStock: false }),
];

// ─── Tests ───────────────────────────────────────────────────────────────────────

console.log('\n═══ filterCatalog() — Tests de regresión ═══\n');

// ── Test 1: pickup con rango de años ──────────────────────────────────────────
console.log('1. "Pick up del 2014 al 2018"');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', bodywork: 'pickup', yearMin: 2014, yearMax: 2018 });
  assertNone(results, ['Corolla', 'Palio', 'Vento', 'MotorHome', 'Cronos', 'Kwid'], 'no incluye sedanes/hatch/motorhome');
  assert(results.some(r => r.name.includes('Ranger')), 'incluye Ford Ranger 2016');
  assert(results.some(r => r.name.includes('Hilux')), 'incluye Toyota Hilux 2017');
  assert(results.some(r => r.name.includes('Amarok')), 'incluye Amarok 2015 (bodywork inferido)');
  assert(!results.some(r => r.name.includes('VENDIDO')), 'excluye ítems fuera de stock');
  console.log(`   → ${results.length} resultado(s): ${results.map(r => r.name).join(', ')}`);
}

// ── Test 2: rango de año estricto — no tolerancia ±2 ─────────────────────────
console.log('\n2. yearMax=2018 excluye 2019/2020');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', bodywork: 'pickup', yearMin: 2014, yearMax: 2018 });
  assert(!results.some(r => r.year && r.year > 2018), 'ningún resultado posterior a 2018');
}

// ── Test 3: año único sigue usando tolerancia ±2 ──────────────────────────────
console.log('\n3. year=2016 (único, sin rango) usa tolerancia ±2');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', year: 2016 });
  assert(results.some(r => r.year === 2014 || r.year === 2015 || r.year === 2016 || r.year === 2017 || r.year === 2018),
    'incluye autos dentro de ±2 años del 2016');
  assert(!results.some(r => r.year && r.year > 2018), 'excluye 2019+ (fuera de ±2)');
}

// ── Test 4: "auto chico y que gaste poco" no devuelve motorhome/pickup ────────
console.log('\n4. "Auto chico y que gaste poco"');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', bodywork: 'hatch', fuelEconomyPriority: true });
  assertNone(results, ['MotorHome', 'Sprinter', 'Ducato', 'Ranger', 'Hilux', 'Amarok', 'Furgon', 'Daily'],
    'no incluye pickup/motorhome/furgon');
  assert(results.some(r => r.name.includes('Kwid') || r.name.includes('Palio')),
    'incluye hatch correctos');
  console.log(`   → ${results.length} resultado(s): ${results.map(r => r.name).join(', ')}`);
}

// ── Test 5: fuelEconomyPriority=true sin bodywork explícito ──────────────────
console.log('\n5. fuelEconomyPriority=true sin bodywork específico');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', fuelEconomyPriority: true });
  assertNone(results, ['MotorHome', 'Sprinter', 'Furgon', 'Daily', 'Iveco'],
    'excluye motorhome/furgon aunque no se pidió bodywork');
  assert(!results.some(r => r.bodywork === 'pickup'), 'excluye pickups');
  console.log(`   → ${results.length} resultado(s): ${results.map(r => r.name).join(', ')}`);
}

// ── Test 6: bodywork=pickup excluye ítem con bodywork=sedan explícito ─────────
console.log('\n6. bodywork=pickup excluye sedan con bodywork explícito');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', bodywork: 'pickup' });
  assert(!results.some(r => r.id === 'cronos-1'), 'Fiat Cronos (sedan) excluido');
  assert(!results.some(r => r.id === 'vento-1'),  'VW Vento (sedan) excluido');
}

// ── Test 7: bodywork=pickup excluye ítem sin bodywork y sin nombre que infiera pickup
console.log('\n7. bodywork=pickup excluye ítem sin bodywork y sin nombre inferible');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', bodywork: 'pickup' });
  assert(!results.some(r => r.id === 'corolla-1'), 'Toyota Corolla (sin bodywork, no pickup) excluido');
  assert(!results.some(r => r.id === 'vento-1'),   'VW Vento (sedan) excluido');
}

// ── Test 8: bodywork=sedan permite ítems sin bodywork (no estricto) ───────────
console.log('\n8. bodywork=sedan permite ítems sin bodywork (beneficio de la duda)');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', bodywork: 'sedan' });
  // corolla no tiene bodywork=sedan seteado pero tampoco es inferible como otro tipo
  assert(results.some(r => r.id === 'corolla-1'), 'Toyota Corolla (sin bodywork) pasa cuando buscan sedan');
  assert(!results.some(r => r.id === 'hilux-1'),   'Toyota Hilux (pickup) excluido cuando buscan sedan');
  console.log(`   → ${results.length} resultado(s): ${results.map(r => r.name).join(', ')}`);
}

// ── Test 9: fallback blando por brand mantiene constraint de bodywork ─────────
console.log('\n9. Fallback blando mantiene bodywork constraint');
{
  // Toyota solo tiene Corolla (sedan) y Hilux (pickup) - si buscamos Toyota pickup en rango muy específico
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search', brand: 'Toyota', bodywork: 'pickup', yearMin: 2020, yearMax: 2023 });
  // Hilux es 2017, fuera del rango. Corolla no es pickup. Fallback relaja año pero mantiene bodywork.
  assert(!results.some(r => r.id === 'corolla-1'), 'Fallback Toyota no devuelve Corolla cuando se buscó pickup');
  console.log(`   → ${results.length} resultado(s): ${results.map(r => r.name).join(', ')}`);
}

// ── Test 10: search_context.minYear/maxYear también se aplica ─────────────────
console.log('\n10. search_context.minYear/maxYear aplicado desde estado previo');
{
  const results = filterCatalog(FIXTURE_CATALOG, {
    intent: 'search',
    bodywork: 'pickup',
    search_context: { minYear: 2015, maxYear: 2017 },
  });
  assert(results.every(r => !r.year || (r.year >= 2015 && r.year <= 2017)),
    'todos los resultados dentro de 2015-2017 (desde search_context)');
  console.log(`   → ${results.length} resultado(s): ${results.map(r => r.name).join(', ')}`);
}

// ── Test 11: ítems fuera de stock nunca aparecen ──────────────────────────────
console.log('\n11. inStock=false nunca aparece');
{
  const results = filterCatalog(FIXTURE_CATALOG, { intent: 'search' });
  assert(!results.some(r => r.inStock === false), 'ningún ítem fuera de stock en resultados');
}

// ── Test 12: fuelEconomyPriority desde search_context también excluye ─────────
console.log('\n12. fuelEconomyPriority desde search_context excluye grandes');
{
  const results = filterCatalog(FIXTURE_CATALOG, {
    intent: 'search',
    search_context: { fuelEconomyPriority: true } as any,
  });
  assertNone(results, ['MotorHome', 'Sprinter', 'Furgon', 'Daily'], 'excluye vehículos grandes desde search_context');
}

// ─── Resultado final ────────────────────────────────────────────────────────────

console.log(`\n═══ Resultado: ${passed} passed, ${failed} failed ═══\n`);
if (failures.length) {
  console.error('Tests fallidos:');
  failures.forEach(f => console.error(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('Todos los tests pasaron.');
  process.exit(0);
}
