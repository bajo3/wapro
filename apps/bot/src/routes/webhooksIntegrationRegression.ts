import assert from 'node:assert/strict';

process.env.BOT_WEBHOOK_SECRET ??= 'test-secret-for-webhook-integration-123';
process.env.BOT_ADMIN_TOKEN ??= 'test-admin-token';
process.env.EVOLUTION_API_URL ??= 'https://example.com';
process.env.EVOLUTION_API_KEY ??= 'test-evolution-key';
process.env.EVOLUTION_INSTANCE ??= 'test-instance';
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

const {
  __handleAggregatedMessageForTest,
  __resetWebhookAggregators,
  __resetWebhookRuntimeOverrides,
  __setWebhookRuntimeOverrides,
} = await import('./webhooks.js');

type RuntimeMessage = {
  kind: 'text' | 'image';
  remoteJid: string;
  reply: string;
  imageUrl?: string;
};

type RuntimeHarness = {
  decisionLogs: Array<Record<string, unknown>>;
  sentMessages: RuntimeMessage[];
  stateStore: Map<string, any>;
};

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function buildCommercialResult() {
  return {
    leadScore: {
      score: 32,
      temperature: 'tibio',
      reason: 'integration-test',
      confidence: 0.88,
      signals: [],
    },
    intent: {
      primary: 'vehicle_search',
      confidence: 0.82,
    },
    nextAction: {
      action: 'CONTINUE_AGENT',
      reason: 'integration-test',
      priority: 2,
      forHuman: false,
      forBot: true,
      suggestedMessage: null,
    },
    priority: {
      priority: 2,
      label: 'normal',
      reason: 'integration-test',
      shouldNotifyHuman: false,
      estimatedValueSignal: 0,
    },
    suggestion: {
      suggestedAction: 'seguir',
      suggestedReplyStrategy: 'integration-test',
      humanHandoffReason: null,
      urgency: 'low',
      scriptHint: null,
    },
    objectionType: null,
  };
}

function installHarness(catalog: any[]): RuntimeHarness {
  const stateStore = new Map<string, any>();
  const sentMessages: RuntimeMessage[] = [];
  const decisionLogs: Array<Record<string, unknown>> = [];

  __resetWebhookAggregators();
  __resetWebhookRuntimeOverrides();
  __setWebhookRuntimeOverrides({
    getContactRule: async () => 'ON',
    getConversationRule: async () => 'ON',
    getState: async (instance: string, remoteJid: string) =>
      clone(stateStore.get(`${instance}:${remoteJid}`) ?? { stage: 'awaiting_query', gpt_history: [] }),
    setState: async (instance: string, remoteJid: string, nextState: any) => {
      stateStore.set(`${instance}:${remoteJid}`, clone(nextState));
    },
    loadLeadMemory: async () => null,
    runCommercialPipeline: (() => buildCommercialResult()) as any,
    evolutionSendPresence: (async () => ({ ok: true, data: null })) as any,
    sendImageAndPersist: (async (_instance: string, remoteJid: string, imageUrl: string, reply?: string) => {
      sentMessages.push({ kind: 'image', remoteJid, reply: String(reply ?? ''), imageUrl });
    }) as any,
    sendTextHuman: async (_instance: string, remoteJid: string, reply: string) => {
      sentMessages.push({ kind: 'text', remoteJid, reply });
    },
    logEpisode: (async () => 0) as any,
    upsertLeadProfile: async () => {},
    getCatalog: async () => clone(catalog),
    matchBest: async () => null,
    searchKnowledge: async () => [],
    decideAgentAction: async () => null,
    askGPT: async () => null,
    setConversationRule: async () => {},
    addConversationNote: async () => {},
    computeHumanDelay: () => 0,
    logConversationDecision: (payload: Record<string, unknown>) => {
      decisionLogs.push(payload);
    },
  });

  return { decisionLogs, sentMessages, stateStore };
}

async function deliverMessage(harness: RuntimeHarness, rawText: string, options?: { remoteJid?: string; msgId?: string }): Promise<{ reply: string; state: any }> {
  const remoteJid = options?.remoteJid ?? '5491100000001@s.whatsapp.net';
  const instance = 'integration-test';
  const beforeCount = harness.sentMessages.length;
  await __handleAggregatedMessageForTest({
    instance,
    remoteJid,
    rawText,
    msgId: options?.msgId ?? `m-${beforeCount + 1}`,
    key: `${instance}:${remoteJid}`,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const sent = harness.sentMessages.slice(beforeCount);
  const lastReply = sent.filter((item) => item.remoteJid === remoteJid).at(-1)?.reply ?? '';
  return {
    reply: lastReply,
    state: clone(harness.stateStore.get(`${instance}:${remoteJid}`) ?? {}),
  };
}

function hasDecision(
  logs: Array<Record<string, unknown>>,
  expected: Record<string, unknown>
): boolean {
  return logs.some((log) =>
    Object.entries(expected).every(([key, value]) => log[key] === value)
  );
}

async function testGreetingKeepsContext(): Promise<void> {
  const harness = installHarness([
    {
      id: 'vento-1',
      brand: 'Volkswagen',
      model: 'Vento',
      name: 'Volkswagen Vento 2.5 Luxury',
      year: 2016,
      km: 64000,
      priceNumber: 16_900_000,
      price: 'ARS 16.900.000',
      image: 'https://example.com/vento-1.jpg',
    },
  ]);

  await deliverMessage(harness, 'busco un vento hasta 17 millones');
  const followUp = await deliverMessage(harness, 'Hola como estas?');

  assert.match(followUp.reply, /seguimos con/i, 'el saludo intermedio debe mantener el hilo activo');
  assert.doesNotMatch(followUp.reply, /decime presupuesto|marca/i, 'no debe volver al saludo de arranque');
  assert.equal(hasDecision(harness.decisionLogs, { continuedThread: true }), true, 'debe loguear continuidad de hilo');
}

async function testFewKmFollowUpUsesPreviousSearch(): Promise<void> {
  const harness = installHarness([
    {
      id: 'vento-1',
      brand: 'Volkswagen',
      model: 'Vento',
      name: 'Volkswagen Vento 2.5 Luxury',
      year: 2016,
      km: 64000,
      priceNumber: 16_900_000,
      price: 'ARS 16.900.000',
      image: 'https://example.com/vento-1.jpg',
    },
  ]);

  await deliverMessage(harness, 'busco un vento hasta 17 millones');
  const followUp = await deliverMessage(harness, 'algo con pocos kilometros?');

  assert.match(followUp.reply, /vento/i, 'el refinamiento corto debe heredar la búsqueda previa');
  assert.equal(hasDecision(harness.decisionLogs, { followUpDetected: true, usedUpdatedContext: true }), true, 'debe marcar follow-up con contexto actualizado');
}

async function testVehicleDetailsUseLastMentionedVehicle(): Promise<void> {
  const harness = installHarness([
    {
      id: 'vento-1',
      brand: 'Volkswagen',
      model: 'Vento',
      name: 'Volkswagen Vento 2.5 Luxury',
      year: 2016,
      km: 64000,
      priceNumber: 16_900_000,
      price: 'ARS 16.900.000',
      image: 'https://example.com/vento-1.jpg',
    },
    {
      id: 'corolla-1',
      brand: 'Toyota',
      model: 'Corolla',
      name: 'Toyota Corolla XEI',
      year: 2017,
      km: 70000,
      priceNumber: 16_700_000,
      price: 'ARS 16.700.000',
      image: 'https://example.com/corolla-1.jpg',
    },
  ]);

  const firstTurn = await deliverMessage(harness, 'estoy buscando algo hasta 17 millones');
  harness.stateStore.set('integration-test:5491100000001@s.whatsapp.net', {
    ...firstTurn.state,
    last_intent: 'product_results',
    last_hits: ['vento-1', 'corolla-1'],
    last_hits_at: new Date().toISOString(),
  });
  const details = await deliverMessage(harness, 'el vento me das mas detalles?');

  assert.match(details.reply, /vento/i, 'el detalle debe usar el último vehículo correcto');
  assert.equal(
    hasDecision(harness.decisionLogs, { followUpDetected: true, resolvedVehicleSource: 'last_hits_mention' }),
    true,
    'debe resolver el vehículo desde last_hits cuando el usuario lo menciona'
  );
}

async function testSafeNoStockReply(): Promise<void> {
  const harness = installHarness([]);
  harness.stateStore.set('integration-test:5491100000001@s.whatsapp.net', {
    stage: 'idle',
    gpt_history: [],
  });

  const result = await deliverMessage(harness, 'el volkswagen vento me das mas detalles?');

  assert.match(result.reply, /no tengo stock confirmado/i, 'si no hay stock debe responder en modo seguro');
  assert.match(result.reply, /si queres, te muestro lo mas parecido|si querés, te muestro lo más parecido/i, 'debe ofrecer un siguiente paso útil');
  assert.equal(hasDecision(harness.decisionLogs, { safeNoStockReply: true }), true, 'debe loguear respuesta segura de no-stock');
}

async function testBlocksAutomaticMediaWithoutExplicitRequest(): Promise<void> {
  const harness = installHarness([
    {
      id: 'vento-1',
      brand: 'Volkswagen',
      model: 'Vento',
      name: 'Volkswagen Vento 2.5 Luxury',
      year: 2016,
      km: 64000,
      priceNumber: 16_900_000,
      price: 'ARS 16.900.000',
      image: 'https://example.com/vento-1.jpg',
    },
  ]);

  const result = await deliverMessage(harness, 'busco un vento hasta 17 millones');

  assert.match(result.reply, /vento/i, 'la respuesta principal debe salir igual aunque se bloquee media');
  assert.equal(harness.sentMessages.some((item) => item.kind === 'image'), false, 'no debe mandar imagen automática sin pedido explícito');
  assert.equal(hasDecision(harness.decisionLogs, { blockedAutoMedia: true }), true, 'debe loguear el bloqueo de media automática');
}

async function testRealTopicChangeCutsPreviousContext(): Promise<void> {
  const harness = installHarness([
    {
      id: 'vento-1',
      brand: 'Volkswagen',
      model: 'Vento',
      name: 'Volkswagen Vento 2.5 Luxury',
      year: 2016,
      km: 64000,
      priceNumber: 16_900_000,
      price: 'ARS 16.900.000',
      image: 'https://example.com/vento-1.jpg',
    },
    {
      id: 'corolla-1',
      brand: 'Toyota',
      model: 'Corolla',
      name: 'Toyota Corolla XEI',
      year: 2017,
      km: 70000,
      priceNumber: 16_700_000,
      price: 'ARS 16.700.000',
      image: 'https://example.com/corolla-1.jpg',
    },
  ]);

  await deliverMessage(harness, 'busco un vento hasta 17 millones');
  const changed = await deliverMessage(harness, 'busco otra cosa, toyota corolla');

  assert.match(changed.reply, /corolla/i, 'el cambio real de tema debe usar el nuevo contexto');
  assert.equal(String(changed.state?.search_context?.brand ?? '').toLowerCase(), 'toyota', 'debe reemplazar la marca previa');
  assert.equal(String(changed.state?.search_context?.model ?? '').toLowerCase(), 'corolla', 'debe reemplazar el modelo previo');
  assert.notEqual(String(changed.state?.search_context?.model ?? '').toLowerCase(), 'vento', 'no debe arrastrar el modelo anterior');
  assert.equal(hasDecision(harness.decisionLogs, { continuedThread: false }), true, 'debe loguear el corte real de contexto');
}

async function testTopicChangeWithBroadSearchDoesNotReviveOldModel(): Promise<void> {
  const harness = installHarness([]);

  await deliverMessage(harness, 'busco un volkswagen vento hasta 17 millones');
  await deliverMessage(harness, 'busco otra cosa');
  await deliverMessage(harness, 'estoy buscando algo hasta 17 millones');
  const result = await deliverMessage(harness, 'algun 2014 - 2017');

  assert.doesNotMatch(result.reply, /vento/i, 'la búsqueda nueva no debe revivir el modelo viejo');
  assert.match(
    result.reply,
    /auto chico|sed[aá]n|familiar|suv|trabajo|categor[ií]a/i,
    'sin matches exactos debe abrir la búsqueda por categoría amplia'
  );
}

async function testUnknownVehicleDetailsAsksToClarifyInsteadOfAssumingStock(): Promise<void> {
  const harness = installHarness([]);
  const result = await deliverMessage(harness, 'el vento me das mas detalles?');

  assert.match(result.reply, /te refer[ií]s a volkswagen vento/i, 'si el vehículo no estuvo activo debe pedir aclaración breve');
  assert.doesNotMatch(result.reply, /seguimos con|la última vez/i, 'no debe inventar continuidad ni stock');
}

async function run(): Promise<void> {
  try {
    await testGreetingKeepsContext();
    await testFewKmFollowUpUsesPreviousSearch();
    await testVehicleDetailsUseLastMentionedVehicle();
    await testSafeNoStockReply();
    await testBlocksAutomaticMediaWithoutExplicitRequest();
    await testRealTopicChangeCutsPreviousContext();
    await testTopicChangeWithBroadSearchDoesNotReviveOldModel();
    await testUnknownVehicleDetailsAsksToClarifyInsteadOfAssumingStock();
    console.log('webhooksIntegrationRegression OK');
  } finally {
    __resetWebhookAggregators();
    __resetWebhookRuntimeOverrides();
  }
}

void run();
