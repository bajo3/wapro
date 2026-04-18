/**
 * fastPaths.regression.ts — Regresión de los fast-paths deterministas del bot.
 *
 * Corre con:
 *   npx tsx src/services/__tests__/fastPaths.regression.ts
 *
 * No requiere DB ni GPT — valida regex/heurísticas puras que decide el bot
 * antes de ir a OpenAI (selección numérica, financiación follow-up, reset/catálogo).
 */

import {
  detectCatalogSelection,
  detectFinancingFollowup,
  detectResetOrCatalog,
} from '../botIntelligence.js';

let passed = 0;
let failed = 0;

function eq<T>(actual: T, expected: T, name: string) {
  const ok = actual === expected;
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else    { console.error(`  ✗ ${name} — got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`); failed++; }
}

console.log('\n=== Fast-paths regression ===\n');

// ── selección numérica / ordinal ────────────────────────────────────────────
console.log('detectCatalogSelection:');
eq(detectCatalogSelection('1'), 1, 'número puro "1"');
eq(detectCatalogSelection('  2 '), 2, 'número con espacios');
eq(detectCatalogSelection('el segundo'), 2, 'ordinal "el segundo"');
eq(detectCatalogSelection('la primera'), 1, '"la primera"');
eq(detectCatalogSelection('opción 3'), 3, '"opción 3"');
eq(detectCatalogSelection('me interesa la 2'), 2, '"me interesa la 2"');
eq(detectCatalogSelection('ese me interesa'), null, 'NO matchea "ese me interesa" (sin número)');
eq(detectCatalogSelection('busco un auto de 3 puertas'), null, 'NO matchea "busco un auto de 3 puertas"');
eq(detectCatalogSelection('hola'), null, 'NO matchea saludo');

// ── follow-up de financiación ───────────────────────────────────────────────
console.log('\ndetectFinancingFollowup:');
eq(detectFinancingFollowup('lo mínimo'), true, '"lo mínimo"');
eq(detectFinancingFollowup('mínimo'), true, '"mínimo"');
eq(detectFinancingFollowup('entrega?'), true, '"entrega?"');
eq(detectFinancingFollowup('y cuotas?'), true, '"y cuotas?"');
eq(detectFinancingFollowup('cuotas'), true, '"cuotas"');
eq(detectFinancingFollowup('con cuánto entro?'), true, '"con cuánto entro?"');
eq(detectFinancingFollowup('sin entrada'), true, '"sin entrada"');
eq(detectFinancingFollowup('anticipo'), true, '"anticipo"');
eq(detectFinancingFollowup('hola'), false, 'NO matchea saludo');
eq(detectFinancingFollowup('me interesa el 2'), false, 'NO matchea selección');
eq(detectFinancingFollowup('tengo un usado para entregar'), false, 'NO matchea permuta');

// ── reset / catálogo ────────────────────────────────────────────────────────
console.log('\ndetectResetOrCatalog:');
eq(detectResetOrCatalog('hola'), 'reset', 'saludo → reset');
eq(detectResetOrCatalog('hola como estas'), 'reset', 'saludo extendido → reset');
eq(detectResetOrCatalog('buenos dias'), 'reset', 'buenos días → reset');
eq(detectResetOrCatalog('estoy buscando otra cosa'), 'reset', 'cambio de búsqueda → reset');
eq(detectResetOrCatalog('mostrame el catálogo'), 'catalog', 'pedir catálogo');
eq(detectResetOrCatalog('que autos tenés'), 'catalog', '"qué autos tenés"');
eq(detectResetOrCatalog('qué tienen disponible'), 'catalog', '"qué tienen disponible"');
eq(detectResetOrCatalog('más opciones'), 'catalog_more', '"más opciones"');
eq(detectResetOrCatalog('mostrame más'), 'catalog_more', '"mostrame más"');
eq(detectResetOrCatalog('seguí'), 'catalog_more', '"seguí"');
eq(detectResetOrCatalog('ando viendo'), null, '"ando viendo" no es reset/catalog');
eq(detectResetOrCatalog('busco un auto chico'), null, '"busco un auto chico" no es reset');
eq(detectResetOrCatalog('me parece caro'), null, 'objeción de precio no es reset');

console.log(`\n═══ Resultado: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);
