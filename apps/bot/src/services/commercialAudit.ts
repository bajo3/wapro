/**
 * commercialAudit.ts — Audit de calidad comercial por turno v1
 *
 * Detecta en tiempo real cuando el bot:
 *  - preguntó algo que ya sabía (REPREGUNTA)
 *  - mostró más de 3 opciones (DEMASIADAS_OPCIONES)
 *  - respondió sin CTA ni siguiente paso (SIN_CTA)
 *  - no avanzó en etapa de presentación/cierre (SIN_AVANCE_COMERCIAL)
 *  - usó frases genéricas inaceptables (GENERICO_*)
 *  - respuesta muy larga sin acción (RESPUESTA_LARGA)
 *
 * PRINCIPIO: no-bloqueante. Solo loggea. Nunca lanza ni altera el flujo.
 * Los findings se acumulan en métricas a futuro para entrenar el bot.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditSeverity = 'info' | 'warn' | 'error';

export interface AuditFinding {
  code: string;
  severity: AuditSeverity;
  message: string;
}

export interface TurnAudit {
  /** true si no hay errores ni más de 1 warning */
  pass: boolean;
  findings: AuditFinding[];
  /** 0-100: calidad comercial de la respuesta */
  score: number;
}

// ─── Audit Engine ─────────────────────────────────────────────────────────────

/**
 * Audita la calidad comercial de un turno.
 * Llamar DESPUÉS de enviar la respuesta, nunca antes.
 * Fast, synchronous, no-blocking.
 */
export function auditTurnQuality(params: {
  userMessage: string;
  botReply: string;
  /** extracted ACUMULADO para este turno (ya incluye datos nuevos del mensaje) */
  extracted: Record<string, any>;
  /** extracted del turno ANTERIOR (lo que sabíamos ANTES de este mensaje) */
  prevExtracted: Record<string, any>;
  /** stage detectada antes de responder */
  stage: string;
  /** número de turno en la conversación */
  turnCount: number;
  isFirstTurn: boolean;
}): TurnAudit {
  const {
    botReply,
    extracted,
    prevExtracted,
    stage,
    turnCount,
    isFirstTurn,
  } = params;

  const findings: AuditFinding[] = [];

  // ── 1. ¿Preguntó algo que ya sabía? ────────────────────────────────────
  const fieldChecks: Array<[string, string[], string]> = [
    [
      'brand',
      ['qué marca', 'tenés alguna marca', 'hay alguna marca'],
      'REPREGUNTA_MARCA',
    ],
    [
      'maxPrice',
      [
        'cuánto tenés para', 'cuál es tu presupuesto', 'cuánto es tu presupuesto',
        'cuánto manejás', 'qué presupuesto tenés', 'cuánto tenés de presupuesto',
      ],
      'REPREGUNTA_PRESUPUESTO',
    ],
    [
      'useCase',
      ['para qué lo vas', 'para qué uso', 'para qué lo usarías'],
      'REPREGUNTA_USO',
    ],
    [
      'transmission',
      ['automático o manual', 'qué caja', 'lo necesitás automático'],
      'REPREGUNTA_CAJA',
    ],
    [
      'hasTradeIn',
      ['tenés un auto para entregar', 'vas a entregar un auto'],
      'REPREGUNTA_TRADEIN',
    ],
    [
      'wantsFinancing',
      ['querés financiar', 'te interesa financiar', 'pensás financiar'],
      'REPREGUNTA_FINANCIACION',
    ],
  ];

  const replyLower = botReply.toLowerCase();

  for (const [field, patterns, code] of fieldChecks) {
    const alreadyKnew = Boolean(
      (prevExtracted as any)?.[field] ??
      (extracted as any)?.[field]
    );
    const askingAgain = patterns.some((p) => replyLower.includes(p));
    if (alreadyKnew && askingAgain) {
      findings.push({
        code,
        severity: 'warn',
        message: `Preguntó "${field}" que ya estaba confirmado: "${(prevExtracted as any)[field] ?? (extracted as any)[field]}"`,
      });
    }
  }

  // ── 2. ¿Demasiadas opciones? ────────────────────────────────────────────
  const vehicleCount = (botReply.match(/🚗/g) ?? []).length;
  if (vehicleCount > 3) {
    findings.push({
      code: 'DEMASIADAS_OPCIONES',
      severity: 'warn',
      message: `Mostró ${vehicleCount} vehículos — máximo recomendado: 3`,
    });
  }

  // ── 3. ¿Hubo CTA? ──────────────────────────────────────────────────────
  const hasCta =
    botReply.includes('?') ||
    /(pasar|visita|reserv|coordin|llamad|te paso|escribime|asesor|hablo con|te conect|animás|calcul)/i.test(
      botReply
    );

  if (!hasCta && !isFirstTurn && turnCount > 1) {
    findings.push({
      code: 'SIN_CTA',
      severity: 'warn',
      message: 'Respuesta sin pregunta ni llamado a la acción concreto',
    });
  }

  // ── 4. Frases genéricas prohibidas ─────────────────────────────────────
  const genericChecks: Array<{ re: RegExp; code: string; msg: string }> = [
    {
      re: /ambos son (muy )?buena[s]? opcion/i,
      code: 'GENERICO_COMPARACION',
      msg: '"ambos son buenas opciones" — tomar partido según el uso del cliente',
    },
    {
      re: /tenemos (mucha\s+)?(variedad|variedad\s+de\s+modelos)/i,
      code: 'GENERICO_VARIEDAD',
      msg: '"tenemos mucha variedad" — mostrar opciones concretas en cambio',
    },
    {
      re: /depende de (sus?|tu[s]?) preferencias personales/i,
      code: 'GENERICO_PREFERENCIAS',
      msg: '"depende de preferencias" — dar opinión concreta basada en datos del lead',
    },
    {
      re: /estamos a (tu|su) disposici[oó]n/i,
      code: 'CORPORATIVO_DISPOSICION',
      msg: '"estamos a tu disposición" — suena a FAQ corporativo, no a vendedor',
    },
    {
      re: /no dudes en consul/i,
      code: 'CORPORATIVO_NODUDES',
      msg: '"no dudes en consultarnos" — suena a respuesta automática de FAQ',
    },
    {
      re: /muchas gracias por (tu\s+)?inter[eé]s/i,
      code: 'CORPORATIVO_GRACIAS',
      msg: '"muchas gracias por tu interés" — muy formal, no es venta consultiva',
    },
  ];

  for (const { re, code, msg } of genericChecks) {
    if (re.test(botReply)) {
      findings.push({ code, severity: 'error', message: msg });
    }
  }

  // ── 5. Sin avance comercial en etapa avanzada ───────────────────────────
  if (
    (stage === 'presentation' || stage === 'closing') &&
    turnCount >= 4 &&
    !isFirstTurn
  ) {
    const hasCommercialPush =
      /(pasar\s+a\s+ver|visita|reserv|financ|asesor|coordin|señ|aparta|llam[aá]|te\s+paso\s+con|animás|cuándo\s+podés)/i.test(
        botReply
      );
    if (!hasCommercialPush) {
      findings.push({
        code: 'SIN_AVANCE_COMERCIAL',
        severity: 'info',
        message: `Etapa ${stage}, turno ${turnCount}: sin propuesta concreta de avance (visita/financiación/reserva)`,
      });
    }
  }

  // ── 6. Respuesta excesivamente larga ───────────────────────────────────
  const wordCount = botReply.split(/\s+/).length;
  if (wordCount > 160) {
    findings.push({
      code: 'RESPUESTA_LARGA',
      severity: 'info',
      message: `Respuesta de ${wordCount} palabras — idealmente < 80 palabras para WhatsApp`,
    });
  }

  // ── 7. Más de una pregunta por respuesta ───────────────────────────────
  const questionCount = (botReply.match(/\?/g) ?? []).length;
  if (questionCount > 2 && turnCount <= 3) {
    findings.push({
      code: 'DEMASIADAS_PREGUNTAS',
      severity: 'warn',
      message: `${questionCount} preguntas en una sola respuesta — máximo 1 por turno`,
    });
  }

  // Calcular score
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const infos = findings.filter((f) => f.severity === 'info').length;
  const score = Math.max(0, 100 - errors * 20 - warns * 8 - infos * 3);

  const pass = errors === 0 && warns <= 1;

  return { pass, findings, score };
}

// ─── Logger ───────────────────────────────────────────────────────────────────

/**
 * Loggea el resultado del audit al console.
 * Llamar siempre después de enviar la respuesta (fuera del critical path).
 */
export function logTurnAudit(
  audit: TurnAudit,
  context: {
    instance: string;
    remoteJid: string;
    stage: string;
    turnCount: number;
  }
): void {
  if (audit.pass && audit.findings.length === 0) return; // respuesta limpia, no loggear

  const tag = `[audit:${context.instance}:${context.remoteJid.slice(0, 12)}]`;
  const level = audit.findings.some((f) => f.severity === 'error')
    ? 'error'
    : 'warn';

  console[level](
    `${tag} turno=${context.turnCount} etapa=${context.stage} score=${audit.score}/100 findings=${audit.findings.length}`
  );

  for (const f of audit.findings) {
    const icon =
      f.severity === 'error' ? '❌' : f.severity === 'warn' ? '⚠️ ' : 'ℹ️ ';
    console[level](`  ${icon} [${f.code}] ${f.message}`);
  }
}

// ─── Metrics Accumulator ──────────────────────────────────────────────────────

/**
 * Acumula métricas de audit en memoria por instancia.
 * Útil para detectar patrones sistémicos (ej: la misma pregunta siempre se repite).
 *
 * En producción esto podría volcarse a una tabla bot_audit_metrics periódicamente.
 */
interface MetricsEntry {
  total: number;
  byCode: Record<string, number>;
  avgScore: number;
  lastUpdated: Date;
}

const metricsStore = new Map<string, MetricsEntry>();

export function accumulateAuditMetrics(
  audit: TurnAudit,
  instance: string
): void {
  const key = instance;
  const existing = metricsStore.get(key) ?? {
    total: 0,
    byCode: {},
    avgScore: 100,
    lastUpdated: new Date(),
  };

  existing.total += 1;
  for (const f of audit.findings) {
    existing.byCode[f.code] = (existing.byCode[f.code] ?? 0) + 1;
  }
  // Rolling average
  existing.avgScore =
    (existing.avgScore * (existing.total - 1) + audit.score) / existing.total;
  existing.lastUpdated = new Date();

  metricsStore.set(key, existing);
}

export function getAuditMetrics(instance: string): MetricsEntry | null {
  return metricsStore.get(instance) ?? null;
}

export function getAllAuditMetrics(): Record<string, MetricsEntry> {
  return Object.fromEntries(metricsStore.entries());
}
