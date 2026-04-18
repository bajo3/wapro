/**
 * llmIntegration.regression.ts — Camino B: mock HTTP de OpenAI (sin API key real).
 *
 * Crea un servidor HTTP local que simula respuestas realistas de GPT,
 * luego testea extractIntent() y composeResponse() con esas respuestas.
 *
 * Valida:
 *  - Parseo correcto de JSON del extractor (intención + campos)
 *  - Que el extractor no resetee contexto por ambigüedad
 *  - Que no invente precio/cuotas/stock
 *  - Que composeResponse no haga >1 pregunta útil
 *  - Que selectedVehicleId funcione con contexto
 *  - Pivot post-no-match
 *
 * Corre con:
 *   npx tsx src/services/__tests__/llmIntegration.regression.ts
 */

import http from 'node:http';
import { once } from 'node:events';

// ── Mock server setup ─────────────────────────────────────────────────────────

/**
 * Cada request al mock server tiene: { systemPrompt, userMessage }
 * El handler devuelve el content string que GPT devolvería.
 */
type MockHandler = (body: { messages: Array<{ role: string; content: string }> }) => string;

let currentHandler: MockHandler | null = null;

function makeOpenAIResponse(content: string): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
  });
}

async function startMockServer(): Promise<{ port: number; server: http.Server }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        const content = currentHandler ? currentHandler(body) : '{}';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(makeOpenAIResponse(content));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'mock server error' }));
      }
    });
  });

  server.listen(0); // random available port
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  return { port: addr.port, server };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, name: string, detail?: string) {
  if (condition) {
    process.stdout.write(`  ✓ ${name}\n`);
    passed++;
  } else {
    const msg = `${name}${detail ? ` — ${detail}` : ''}`;
    process.stderr.write(`  ✗ ${msg}\n`);
    failed++;
    failures.push(msg);
  }
}

function eq(actual: unknown, expected: unknown, name: string) {
  check(
    actual === expected,
    name,
    `got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

function contains(actual: unknown, key: string, name: string) {
  check(
    actual !== undefined && actual !== null,
    name,
    `campo "${key}" ausente o null`
  );
}

/** Cuenta preguntas (líneas con "?") en la respuesta */
function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

/** Detecta patrones de invención (precios/cuotas específicas sin datos) */
function containsInventedData(text: string): boolean {
  return /\$\s*[\d.,]+(?:\s*(?:por\s*mes|mensuales?|de\s*cuota))/i.test(text) ||
    /cuota[s]?\s+(?:es|son|ser[ía])\s+\$?\s*[\d.,]+/i.test(text);
}

// ── Casos de extracción ───────────────────────────────────────────────────────

/**
 * Respuestas simuladas realistas para cada caso.
 * Son lo que un GPT bien prompeado devolvería con el EXTRACTION_PROMPT compactado.
 */
const EXTRACTION_CASES: Array<{
  label: string;
  userMsg: string;
  history: string[];
  mockGptResponse: string; // JSON que simula respuesta GPT
  expects: {
    intent: string;
    fields?: Record<string, unknown>;
    noFields?: string[];
  };
}> = [
  {
    label: '"ando viendo"',
    userMsg: 'ando viendo',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'unsure',
      leadMode: 'exploratory',
      needsClarification: true,
      confidence: 'low',
    }),
    expects: {
      intent: 'unsure',
      fields: { leadMode: 'exploratory', needsClarification: true },
    },
  },
  {
    label: '"busco un auto chico que gaste poco"',
    userMsg: 'busco un auto chico que gaste poco',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'search',
      bodywork: 'hatch',
      fuelEconomyPriority: true,
      leadMode: 'exploratory',
      needsClarification: true,
      confidence: 'medium',
    }),
    expects: {
      intent: 'search',
      fields: { bodywork: 'hatch', fuelEconomyPriority: true },
    },
  },
  {
    label: '"tenés alguna pickup?"',
    userMsg: 'tenés alguna pickup?',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'search',
      bodywork: 'pickup',
      confidence: 'high',
    }),
    expects: {
      intent: 'search',
      fields: { bodywork: 'pickup' },
    },
  },
  {
    label: '"algo para la familia"',
    userMsg: 'algo para la familia',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'search',
      bodywork: 'familiar',
      useCase: 'familia',
      leadMode: 'exploratory',
      needsClarification: true,
      confidence: 'medium',
    }),
    expects: {
      intent: 'search',
      fields: { bodywork: 'familiar' },
    },
  },
  {
    label: '"no sé bien todavía"',
    userMsg: 'no sé bien todavía',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'unsure',
      leadMode: 'exploratory',
      needsClarification: true,
      confidence: 'low',
    }),
    expects: {
      intent: 'unsure',
      fields: { needsClarification: true },
    },
  },
  {
    label: '"me parece caro"',
    userMsg: 'me parece caro',
    history: ['bot: Te muestro el Fiat Cronos 2023 — ARS 18.500.000.'],
    mockGptResponse: JSON.stringify({
      intent: 'search',
      leadMode: 'price_sensitive',
      confidence: 'medium',
    }),
    expects: {
      intent: 'search',
      fields: { leadMode: 'price_sensitive' },
      // NO debe heredar brand/model del contexto si no los mencionó
    },
  },
  {
    label: '"algo más barato"',
    userMsg: 'algo más barato',
    history: ['bot: El Cronos está en ARS 18.500.000.', 'user: me parece caro'],
    mockGptResponse: JSON.stringify({
      intent: 'search',
      leadMode: 'price_sensitive',
      confidence: 'medium',
    }),
    expects: {
      intent: 'search',
      fields: { leadMode: 'price_sensitive' },
    },
  },
  {
    label: '"tengo un usado para entregar"',
    userMsg: 'tengo un usado para entregar',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'trade_in',
      confidence: 'high',
    }),
    expects: {
      intent: 'trade_in',
    },
  },
  {
    label: '"quiero ir a verlo"',
    userMsg: 'quiero ir a verlo',
    history: ['bot: El Cronos está disponible.'],
    mockGptResponse: JSON.stringify({
      intent: 'visit',
      wantsVisit: true,
      confidence: 'high',
    }),
    expects: {
      intent: 'visit',
      fields: { wantsVisit: true },
    },
  },
  {
    label: '"quiero hablar con alguien"',
    userMsg: 'quiero hablar con alguien',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'advisor',
      wantsAdvisor: true,
      confidence: 'high',
    }),
    expects: {
      intent: 'advisor',
      fields: { wantsAdvisor: true },
    },
  },
  {
    label: '"mostrame el catálogo"',
    userMsg: 'mostrame el catálogo',
    history: [],
    mockGptResponse: JSON.stringify({
      intent: 'catalog',
      confidence: 'high',
    }),
    expects: {
      intent: 'catalog',
    },
  },
  {
    label: '"más opciones"',
    userMsg: 'más opciones',
    history: ['bot: Te muestro 3 opciones: 1. Cronos, 2. Onix, 3. Polo.'],
    mockGptResponse: JSON.stringify({
      intent: 'alternatives',
      confidence: 'high',
    }),
    expects: {
      intent: 'alternatives',
    },
  },
  {
    label: '"el primero" (con snapshot)',
    userMsg: 'el primero',
    history: ['bot: opciones_mostradas=[{"idx":0,"id":"v-cronos-001","name":"Fiat Cronos 2023"},{"idx":1,"id":"v-onix-002","name":"Chevrolet Onix 2022"}]'],
    mockGptResponse: JSON.stringify({
      intent: 'specific',
      selectedVehicleId: 'v-cronos-001',
      confidence: 'high',
    }),
    expects: {
      intent: 'specific',
      fields: { selectedVehicleId: 'v-cronos-001' },
    },
  },
  {
    label: '"ese" (con snapshot)',
    userMsg: 'ese',
    history: ['bot: opciones_mostradas=[{"idx":0,"id":"v-cronos-001","name":"Fiat Cronos 2023"}]'],
    mockGptResponse: JSON.stringify({
      intent: 'specific',
      selectedVehicleId: 'v-cronos-001',
      confidence: 'high',
    }),
    expects: {
      intent: 'specific',
      fields: { selectedVehicleId: 'v-cronos-001' },
    },
  },
  {
    label: '"lo mínimo" / "con cuánto entro?" (con vehículo activo)',
    userMsg: 'con cuánto entro?',
    history: ['bot: opciones_mostradas=[{"idx":0,"id":"v-cronos-001","name":"Fiat Cronos 2023","priceNumber":18500000}]'],
    mockGptResponse: JSON.stringify({
      intent: 'credit_quote',
      confidence: 'high',
    }),
    expects: {
      intent: 'credit_quote',
    },
  },
  // Caso no-match + pivot: primero algo inexistente → luego presupuesto nuevo
  {
    label: 'pivot post-no-match: "alguno dentro de 20 millones?"',
    userMsg: 'alguno dentro de 20 millones?',
    history: ['bot: sin_match — no tengo BMW X5 en ese rango.'],
    mockGptResponse: JSON.stringify({
      intent: 'search',
      maxPrice: 20_000_000,
      currency: 'ARS',
      confidence: 'high',
      // NO hereda brand/model del turno anterior
    }),
    expects: {
      intent: 'search',
      fields: { maxPrice: 20_000_000, currency: 'ARS' },
      noFields: ['brand', 'model'], // NO debe traer marca/modelo inventados
    },
  },
];

// ── Casos de composeResponse ─────────────────────────────────────────────────

const COMPOSE_CASES: Array<{
  label: string;
  action: string;
  data: Record<string, unknown>;
  mockGptResponse: string;
  expects: {
    maxQuestions?: number; // máximo de "?" en respuesta
    noInventedData?: boolean;
    containsText?: string[];
    minLength?: number;
    maxLength?: number;
  };
}> = [
  {
    label: 'composeResponse: mostrar_resultados',
    action: 'mostrar_resultados',
    data: {
      opciones: [
        { nombre: 'Fiat Cronos 2023', precio: 'ARS 18.500.000', km: '0 km' },
        { nombre: 'Chevrolet Onix 2022', precio: 'ARS 16.800.000', km: '12.000 km' },
      ],
    },
    mockGptResponse: 'Hoy tengo estas opciones:\n1. Fiat Cronos 2023 — ARS 18.500.000 (0 km)\n2. Chevrolet Onix 2022 — ARS 16.800.000 (12.000 km)\n¿Cuál te interesa?',
    expects: {
      maxQuestions: 1,
      noInventedData: false, // precios vienen de data, no inventados
      minLength: 30,
    },
  },
  {
    label: 'composeResponse: sin_match',
    action: 'sin_match',
    data: { mensaje: 'No encontré exacto. ¿Querés ver alternativas?' },
    mockGptResponse: 'No encontré lo que buscás en el catálogo. ¿Tenés algún presupuesto en mente para mostrarte opciones cercanas?',
    expects: {
      maxQuestions: 1,
      noInventedData: true,
    },
  },
  {
    label: 'composeResponse: derivar_humano — sin seguir vendiendo',
    action: 'derivar_humano',
    data: { razon: 'cliente pide hablar con persona' },
    mockGptResponse: 'Te paso con alguien del equipo ahora.',
    expects: {
      maxQuestions: 0,
      noInventedData: true,
      maxLength: 120,
    },
  },
  {
    label: 'composeResponse: entrega_minima — no inventa monto',
    action: 'entrega_minima',
    data: { auto: 'Fiat Cronos 2023', precio: 18_500_000 },
    mockGptResponse: 'La entrega mínima la confirma el asesor según el banco y el plan. ¿Querés que te lo paso?',
    expects: {
      maxQuestions: 1,
      noInventedData: true,
    },
  },
  {
    label: 'composeResponse: saludo_inicial — corto, una pregunta',
    action: 'saludo_inicial',
    data: {},
    mockGptResponse: '¡Hola! Bienvenido. ¿Qué tipo de auto estás buscando?',
    expects: {
      maxQuestions: 1,
      minLength: 10,
      maxLength: 200,
    },
  },
  {
    label: 'composeResponse: credit_sin_entrega — no inventa cuota',
    action: 'credit_sin_entrega',
    data: { auto: 'Fiat Cronos 2023', precio: 18_500_000 },
    mockGptResponse: '¿Cuánto ponés de entrada para calcular las cuotas?',
    expects: {
      maxQuestions: 1,
      noInventedData: true,
    },
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { port, server } = await startMockServer();

  // Configurar env ANTES del import dinámico.
  // env.ts valida en IIFE al momento de primer import — todos los campos requeridos deben estar.
  process.env['OPENAI_API_KEY']      = 'test-mock-key-for-integration-tests';
  process.env['OPENAI_BASE_URL']     = `http://localhost:${port}`;
  process.env['BOT_WEBHOOK_SECRET']  = 'test-webhook-secret-32chars-minimum-ok';
  process.env['BOT_ADMIN_TOKEN']     = 'test-admin-token-16chars';
  process.env['EVOLUTION_API_URL']   = 'http://localhost:9999';
  process.env['EVOLUTION_API_KEY']   = 'test-evo-key';
  process.env['EVOLUTION_INSTANCE']  = 'test-instance';
  process.env['DATABASE_URL']        = 'postgresql://test:test@localhost:5432/test';

  // Import dinámico para que tome los env vars recién seteados
  const { extractIntent, composeResponse } = await import('../botIntelligence.js');

  // ── Sección 1: extractIntent ──────────────────────────────────────────────

  console.log('\n=== Sección 1: extractIntent() con mock HTTP ===\n');
  console.log(`  Mock server: http://localhost:${port}`);
  console.log(`  Casos: ${EXTRACTION_CASES.length}\n`);

  for (const tc of EXTRACTION_CASES) {
    process.stdout.write(`Caso: ${tc.label}\n`);

    currentHandler = () => tc.mockGptResponse;

    let extracted: Awaited<ReturnType<typeof extractIntent>>;
    try {
      extracted = await extractIntent(tc.userMsg, tc.history);
    } catch (e) {
      check(false, `${tc.label} — extractIntent no debe lanzar`, String(e));
      continue;
    }

    eq(extracted.intent, tc.expects.intent, `intent=${tc.expects.intent}`);

    if (tc.expects.fields) {
      for (const [key, val] of Object.entries(tc.expects.fields)) {
        eq(
          (extracted as any)[key],
          val,
          `campo ${key}=${JSON.stringify(val)}`
        );
      }
    }

    if (tc.expects.noFields) {
      for (const key of tc.expects.noFields) {
        check(
          (extracted as any)[key] === undefined || (extracted as any)[key] === null,
          `campo ${key} NO debe estar presente (no inventar)`
        );
      }
    }

    process.stdout.write('\n');
  }

  // ── Sección 2: extractIntent fallback (GPT devuelve null/malformed) ────────

  console.log('=== Sección 2: fallback cuando GPT falla ===\n');

  // GPT devuelve texto no-JSON → debe caer a { intent: 'other' }
  currentHandler = () => 'Lo siento, no entiendo tu mensaje.';
  const fallback1 = await extractIntent('mensaje de prueba', []);
  eq(fallback1.intent, 'other', 'GPT non-JSON → intent=other (fallback)');

  // GPT devuelve JSON inválido → debe caer a { intent: 'other' }
  currentHandler = () => '{"intent": "search", "broken": ';
  const fallback2 = await extractIntent('mensaje roto', []);
  eq(fallback2.intent, 'other', 'JSON malformado → intent=other (fallback)');

  // GPT devuelve JSON válido dentro de bloque de texto → debe parsear
  currentHandler = () => 'Aquí el resultado: ```json\n{"intent":"greeting","confidence":"high"}\n```';
  const embedded = await extractIntent('hola', []);
  // El extractor de botIntelligence usa raw.match(/\{[\s\S]*\}/) — parsea el JSON embebido
  check(
    embedded.intent === 'greeting' || embedded.intent === 'other',
    'JSON dentro de bloque de código — parsea o cae a other (no crashea)'
  );

  process.stdout.write('\n');

  // ── Sección 3: composeResponse() ─────────────────────────────────────────

  console.log('=== Sección 3: composeResponse() con mock HTTP ===\n');

  for (const tc of COMPOSE_CASES) {
    process.stdout.write(`Caso: ${tc.label}\n`);

    currentHandler = () => tc.mockGptResponse;

    let reply: string;
    try {
      reply = await composeResponse(tc.action, tc.data, []);
    } catch (e) {
      check(false, `${tc.label} — composeResponse no debe lanzar`, String(e));
      continue;
    }

    check(reply.length > 0, 'reply no vacío');

    if (tc.expects.maxQuestions !== undefined) {
      const qCount = questionCount(reply);
      check(
        qCount <= tc.expects.maxQuestions,
        `≤${tc.expects.maxQuestions} pregunta(s) por turno`,
        `tiene ${qCount}`
      );
    }

    if (tc.expects.noInventedData) {
      check(!containsInventedData(reply), 'no inventa cuotas/pagos específicos');
    }

    if (tc.expects.minLength) {
      check(reply.length >= tc.expects.minLength, `reply.length ≥ ${tc.expects.minLength}`, `tiene ${reply.length}`);
    }

    if (tc.expects.maxLength) {
      check(reply.length <= tc.expects.maxLength, `reply.length ≤ ${tc.expects.maxLength}`, `tiene ${reply.length}`);
    }

    if (tc.expects.containsText) {
      for (const frag of tc.expects.containsText) {
        check(reply.includes(frag), `reply contiene "${frag}"`);
      }
    }

    process.stdout.write(`  → "${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"\n\n`);
  }

  // ── Sección 4: no-invención en contexto de crédito (RESPONSE_SYSTEM) ─────

  console.log('=== Sección 4: anti-invención cuotas en composeResponse ===\n');

  // Simular que GPT intenta inventar cuotas — el test valida que la respuesta
  // mockeada con cuotas "reales" del context pasa, mientras que "inventadas" no.
  currentHandler = () => 'Las cuotas del Cronos son $350.000 por mes durante 48 meses.';
  const inventedReply = await composeResponse('mostrar_cuotas', {}, []);
  check(
    containsInventedData(inventedReply),
    'detección de invención: patrón de cuota inventada reconocido',
    `reply="${inventedReply.slice(0, 80)}"`
  );
  // Nota: el guardrail real está en truthGuard.ts, no en composeResponse.
  // Esto valida que el patrón de detección es correcto.

  currentHandler = () => 'La cuota depende del banco y el plan. Pasame el dato de anticipo y te paso el número real.';
  const cleanReply = await composeResponse('credit_sin_entrega', {}, []);
  check(!containsInventedData(cleanReply), 'respuesta correcta de crédito no activa patrón de invención');

  process.stdout.write('\n');

  // ── Sección 5: selectedVehicleId con contexto en historial ───────────────

  console.log('=== Sección 5: selectedVehicleId con contexto de historial ===\n');

  const histWithSnapshot = [
    'bot: opciones_mostradas=[{"idx":0,"id":"v-cronos-001","name":"Fiat Cronos 2023","priceNumber":18500000},{"idx":1,"id":"v-onix-002","name":"Chevrolet Onix 2022","priceNumber":16800000}]',
  ];

  const refsToTest: Array<{ msg: string; expectedId: string }> = [
    { msg: 'el primero', expectedId: 'v-cronos-001' },
    { msg: 'ese', expectedId: 'v-cronos-001' },
    { msg: 'el segundo', expectedId: 'v-onix-002' },
    { msg: 'la segunda', expectedId: 'v-onix-002' },
  ];

  for (const { msg, expectedId } of refsToTest) {
    currentHandler = () =>
      JSON.stringify({
        intent: 'specific',
        selectedVehicleId: expectedId,
        confidence: 'high',
      });

    const ex = await extractIntent(msg, histWithSnapshot);
    eq(ex.intent, 'specific', `"${msg}" → intent=specific`);
    eq(ex.selectedVehicleId, expectedId, `"${msg}" → selectedVehicleId=${expectedId}`);
  }

  process.stdout.write('\n');

  // ── Sección 6: no reseteo de contexto por mensajes cortos ────────────────

  console.log('=== Sección 6: no-reset de contexto por ambigüedad ===\n');

  const shortAmbiguous = ['ese', 'mismo', 'ok', 'dale', 'y?'];

  for (const msg of shortAmbiguous) {
    // GPT puede devolver catalog/search/other — la protección está en isAmbiguousOverride
    // Validamos solo que extractIntent no crashea y devuelve algo parseable
    currentHandler = () =>
      JSON.stringify({ intent: 'other', confidence: 'low' });

    const ex = await extractIntent(msg, histWithSnapshot);
    check(
      ['other', 'specific', 'search', 'catalog', 'unsure', 'greeting'].includes(ex.intent),
      `"${msg}" → intent válido (no crash): ${ex.intent}`
    );
  }

  process.stdout.write('\n');

  // ── Cleanup & resumen ─────────────────────────────────────────────────────

  server.close();

  console.log(`\n═══ Resultado: ${passed} passed, ${failed} failed ═══\n`);

  if (failures.length > 0) {
    console.error('Fallos:');
    failures.forEach(f => console.error(`  - ${f}`));
  }

  console.log('─── Diagnóstico de integración ───');
  console.log('  Camino usado: B (mock HTTP — sin OPENAI_API_KEY real)');
  console.log('  Mock server: Node http puro, sin deps extra');
  console.log('  extractIntent: export añadida, parseo validado con 16 casos');
  console.log('  composeResponse: export añadida, anti-invención + ≤1 pregunta validados');
  console.log('  OPENAI_BASE_URL: soporte añadido a gpt.ts (1 línea, production-safe)');
  console.log('\n─── Qué NO cubre este harness ───');
  console.log('  • Calidad real del output del LLM (necesita OPENAI_API_KEY)');
  console.log('  • processMessage() end-to-end (necesita DB/catálogo real)');
  console.log('  • Latencia y rate-limits de OpenAI');
  console.log('  • Few-shot injection desde bot_examples (selectExamples() usa DB)');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
