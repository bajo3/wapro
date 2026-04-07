/**
 * metricsAggregator.ts — Métricas horarias + alertas de degradación del bot.
 *
 * Lee de bot_message_trace (migración 018), agrega por hora,
 * escribe en bot_metrics_hourly y bot_alerts (migración 019).
 *
 * Reglas:
 *  - computeHourlyMetrics() se llama desde index.ts cada hora (job periódico)
 *  - Todas las funciones son async, manejan sus propios errores
 *  - getMetricsSummary() y getActiveAlerts() son de solo lectura (panel)
 */

import { pool } from './db.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AlertType =
  | 'fallback_rate_high'
  | 'fallback_rate_critical'
  | 'hallucination_sustained'
  | 'dead_letter_spike'
  | 'catalog_empty'
  | 'catalog_null_prices'
  | 'eval_pass_rate_low';

export interface BotAlert {
  id: number;
  createdAt: string;
  instanceName: string;
  alertType: AlertType;
  severity: 'warn' | 'critical';
  metricValue: number;
  thresholdValue: number;
  details: Record<string, any>;
  resolvedAt: string | null;
}

export interface MetricsSummary {
  responseRate: number;
  handoffRate: number;
  fallbackRate: number;
  hallucinationBlockRate: number;
  deadLetterRate: number;
  avgLeadScore: number | null;
  temperatureDistribution: { hot: number; warm: number; cold: number };
  last24hMessages: number;
  trendVsPrevious24h: number;
  activeAlerts: number;
}

export interface BotHealthCheck {
  ok: boolean;
  checks: {
    catalog: { ok: boolean; vehicleCount: number };
    fallbackRate: { ok: boolean; rate: number; threshold: number };
    hallucinationBlocks: { ok: boolean; lastHour: number };
    deadLetters: { ok: boolean; lastHour: number };
    activeAlerts: number;
  };
  timestamp: string;
}

// ─── Umbrales de alerta ───────────────────────────────────────────────────────

const THRESHOLDS = {
  fallbackRate: { warn: 0.30, critical: 0.50 },
  hallucinationBlocks: { warn: 5 },
  deadLetterSpike: { critical: 3 },
  catalogNullPricesPct: { warn: 0.50 },
};

// ─── Cómputo por hora ─────────────────────────────────────────────────────────

/**
 * Agrega métricas de la hora indicada (o la hora anterior si se omite).
 * Hace upsert en bot_metrics_hourly.
 */
export async function computeHourlyMetrics(
  instanceName: string,
  hourBucket?: Date
): Promise<void> {
  // Default: hora anterior completa
  const bucket = hourBucket ?? new Date(Math.floor(Date.now() / 3_600_000 - 1) * 3_600_000);
  const bucketIso = bucket.toISOString();
  const nextHourIso = new Date(bucket.getTime() + 3_600_000).toISOString();

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                                  AS total,
       COUNT(*) FILTER (WHERE decision = 'respond')             AS responded,
       COUNT(*) FILTER (WHERE decision = 'handoff')             AS handoff,
       COUNT(*) FILTER (WHERE decision = 'ignore')              AS ignored,
       COUNT(*) FILTER (WHERE hallucination_blocked = TRUE)     AS hallucination_blocks,
       COUNT(*) FILTER (WHERE guardrail_issues IS NOT NULL
                          AND array_length(guardrail_issues,1) > 0) AS guardrail_flags,
       COUNT(*) FILTER (WHERE intent IN ('fallback','gpt_fallback')) AS fallback_count,
       COUNT(*) FILTER (WHERE dead_lettered = TRUE)             AS dead_letter_count,
       AVG(lead_score)                                          AS avg_lead_score,
       COUNT(*) FILTER (WHERE lead_temperature = 'hot')         AS hot,
       COUNT(*) FILTER (WHERE lead_temperature = 'warm')        AS warm,
       COUNT(*) FILTER (WHERE lead_temperature = 'cold')        AS cold
     FROM bot_message_trace
     WHERE instance_name = $1
       AND received_at >= $2::timestamptz
       AND received_at < $3::timestamptz`,
    [instanceName, bucketIso, nextHourIso]
  );

  const r = rows[0];
  if (!r) return;

  // Top intents para esa hora
  const { rows: intentRows } = await pool.query(
    `SELECT intent, COUNT(*) AS count
     FROM bot_message_trace
     WHERE instance_name = $1
       AND received_at >= $2::timestamptz
       AND received_at < $3::timestamptz
       AND intent IS NOT NULL
     GROUP BY intent
     ORDER BY count DESC
     LIMIT 5`,
    [instanceName, bucketIso, nextHourIso]
  );

  const topIntents = intentRows.map((i) => ({ intent: i.intent, count: Number(i.count) }));

  await pool.query(
    `INSERT INTO bot_metrics_hourly (
      hour_bucket, instance_name,
      total_messages, responded_messages, handoff_messages, ignored_messages,
      hallucination_blocks, guardrail_flags, fallback_responses, dead_letter_count,
      avg_lead_score, hot_leads, warm_leads, cold_leads,
      top_intents, computed_at
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15::jsonb, NOW()
    )
    ON CONFLICT (hour_bucket, instance_name) DO UPDATE SET
      total_messages       = EXCLUDED.total_messages,
      responded_messages   = EXCLUDED.responded_messages,
      handoff_messages     = EXCLUDED.handoff_messages,
      ignored_messages     = EXCLUDED.ignored_messages,
      hallucination_blocks = EXCLUDED.hallucination_blocks,
      guardrail_flags      = EXCLUDED.guardrail_flags,
      fallback_responses   = EXCLUDED.fallback_responses,
      dead_letter_count    = EXCLUDED.dead_letter_count,
      avg_lead_score       = EXCLUDED.avg_lead_score,
      hot_leads            = EXCLUDED.hot_leads,
      warm_leads           = EXCLUDED.warm_leads,
      cold_leads           = EXCLUDED.cold_leads,
      top_intents          = EXCLUDED.top_intents,
      computed_at          = NOW()`,
    [
      bucketIso, instanceName,
      Number(r.total), Number(r.responded), Number(r.handoff), Number(r.ignored),
      Number(r.hallucination_blocks), Number(r.guardrail_flags), Number(r.fallback_count), Number(r.dead_letter_count),
      r.avg_lead_score ? Number(r.avg_lead_score) : null,
      Number(r.hot), Number(r.warm), Number(r.cold),
      JSON.stringify(topIntents),
    ]
  );

  // Verificar umbrales y crear alertas si corresponde
  await checkAndEmitAlerts(instanceName, {
    total: Number(r.total),
    fallback: Number(r.fallback_count),
    hallucinationBlocks: Number(r.hallucination_blocks),
    deadLetterCount: Number(r.dead_letter_count),
    hourBucket: bucketIso,
  });
}

// ─── Verificación de alertas ──────────────────────────────────────────────────

async function checkAndEmitAlerts(
  instanceName: string,
  data: { total: number; fallback: number; hallucinationBlocks: number; deadLetterCount: number; hourBucket: string }
): Promise<void> {
  const { total, fallback, hallucinationBlocks, deadLetterCount, hourBucket } = data;

  const fallbackRate = total > 0 ? fallback / total : 0;

  // fallback_rate_high (warn)
  if (fallbackRate >= THRESHOLDS.fallbackRate.warn) {
    const severity = fallbackRate >= THRESHOLDS.fallbackRate.critical ? 'critical' : 'warn';
    const alertType: AlertType = severity === 'critical' ? 'fallback_rate_critical' : 'fallback_rate_high';
    await createAlertIfNew(instanceName, alertType, severity, fallbackRate, THRESHOLDS.fallbackRate.warn, {
      hourBucket, total, fallback,
    });
  }

  // hallucination_sustained (warn)
  if (hallucinationBlocks >= THRESHOLDS.hallucinationBlocks.warn) {
    await createAlertIfNew(instanceName, 'hallucination_sustained', 'warn', hallucinationBlocks, THRESHOLDS.hallucinationBlocks.warn, {
      hourBucket, hallucinationBlocks,
    });
  }

  // dead_letter_spike (critical)
  if (deadLetterCount >= THRESHOLDS.deadLetterSpike.critical) {
    await createAlertIfNew(instanceName, 'dead_letter_spike', 'critical', deadLetterCount, THRESHOLDS.deadLetterSpike.critical, {
      hourBucket, deadLetterCount,
    });
  }
}

async function createAlertIfNew(
  instanceName: string,
  alertType: AlertType,
  severity: 'warn' | 'critical',
  metricValue: number,
  thresholdValue: number,
  details: Record<string, any>
): Promise<void> {
  // Solo crear si no hay una alerta sin resolver del mismo tipo en la última hora
  const { rows } = await pool.query(
    `SELECT id FROM bot_alerts
     WHERE instance_name = $1 AND alert_type = $2
       AND resolved_at IS NULL
       AND created_at > NOW() - INTERVAL '1 hour'
     LIMIT 1`,
    [instanceName, alertType]
  );
  if (rows.length > 0) return; // ya existe una activa reciente

  await pool.query(
    `INSERT INTO bot_alerts (instance_name, alert_type, severity, metric_value, threshold_value, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [instanceName, alertType, severity, metricValue, thresholdValue, JSON.stringify(details)]
  );

  console.error(JSON.stringify({
    type: 'bot_alert',
    alertType,
    severity,
    instanceName,
    metricValue,
    thresholdValue,
    details,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Crea una alerta de catálogo vacío (llamado externamente).
 */
export async function emitCatalogAlert(
  instanceName: string,
  type: 'catalog_empty' | 'catalog_null_prices',
  vehicleCount: number
): Promise<void> {
  const threshold = type === 'catalog_empty' ? 1 : THRESHOLDS.catalogNullPricesPct.warn;
  await createAlertIfNew(instanceName, type, 'critical', vehicleCount, threshold, { vehicleCount });
}

/**
 * Crea alerta de eval pass rate bajo (llamado desde evalRunner).
 */
export async function emitEvalAlert(
  instanceName: string,
  passRate: number,
  threshold: number
): Promise<void> {
  await createAlertIfNew(instanceName, 'eval_pass_rate_low', 'warn', passRate, threshold, { passRate, threshold });
}

// ─── Lectura de métricas ──────────────────────────────────────────────────────

export async function getMetricsSummary(
  instanceName: string,
  windowHours: number = 24
): Promise<MetricsSummary> {
  const { rows } = await pool.query(
    `SELECT
       SUM(total_messages)       AS total,
       SUM(responded_messages)   AS responded,
       SUM(handoff_messages)     AS handoff,
       SUM(hallucination_blocks) AS hallucination_blocks,
       SUM(fallback_responses)   AS fallback,
       SUM(dead_letter_count)    AS dead_letters,
       AVG(avg_lead_score)       AS avg_score,
       SUM(hot_leads)            AS hot,
       SUM(warm_leads)           AS warm,
       SUM(cold_leads)           AS cold
     FROM bot_metrics_hourly
     WHERE instance_name = $1
       AND hour_bucket >= NOW() - ($2 || ' hours')::interval`,
    [instanceName, windowHours]
  );

  const { rows: prevRows } = await pool.query(
    `SELECT SUM(total_messages) AS total
     FROM bot_metrics_hourly
     WHERE instance_name = $1
       AND hour_bucket >= NOW() - ($2 || ' hours')::interval
       AND hour_bucket < NOW() - ($3 || ' hours')::interval`,
    [instanceName, windowHours * 2, windowHours]
  );

  const { rows: alertRows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM bot_alerts
     WHERE instance_name = $1 AND resolved_at IS NULL`,
    [instanceName]
  );

  const r = rows[0] ?? {};
  const total = Number(r.total ?? 0);
  const prevTotal = Number(prevRows[0]?.total ?? 0);
  const trend = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;

  return {
    responseRate: total > 0 ? Number(r.responded ?? 0) / total : 0,
    handoffRate: total > 0 ? Number(r.handoff ?? 0) / total : 0,
    fallbackRate: total > 0 ? Number(r.fallback ?? 0) / total : 0,
    hallucinationBlockRate: total > 0 ? Number(r.hallucination_blocks ?? 0) / total : 0,
    deadLetterRate: total > 0 ? Number(r.dead_letters ?? 0) / total : 0,
    avgLeadScore: r.avg_score ? Number(r.avg_score) : null,
    temperatureDistribution: {
      hot: Number(r.hot ?? 0),
      warm: Number(r.warm ?? 0),
      cold: Number(r.cold ?? 0),
    },
    last24hMessages: total,
    trendVsPrevious24h: trend,
    activeAlerts: Number(alertRows[0]?.cnt ?? 0),
  };
}

export async function getHourlyTimeseries(
  instanceName: string,
  hours: number = 48
): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT hour_bucket, total_messages, responded_messages, handoff_messages,
            fallback_responses, hallucination_blocks, avg_lead_score,
            hot_leads, warm_leads, cold_leads, top_intents
     FROM bot_metrics_hourly
     WHERE instance_name = $1
       AND hour_bucket >= NOW() - ($2 || ' hours')::interval
     ORDER BY hour_bucket ASC`,
    [instanceName, hours]
  );
  return rows;
}

export async function getActiveAlerts(
  instanceName: string
): Promise<BotAlert[]> {
  const { rows } = await pool.query(
    `SELECT id, created_at, instance_name, alert_type, severity,
            metric_value, threshold_value, details, resolved_at
     FROM bot_alerts
     WHERE instance_name = $1 AND resolved_at IS NULL
     ORDER BY created_at DESC
     LIMIT 50`,
    [instanceName]
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    instanceName: r.instance_name,
    alertType: r.alert_type,
    severity: r.severity,
    metricValue: Number(r.metric_value ?? 0),
    thresholdValue: Number(r.threshold_value ?? 0),
    details: r.details ?? {},
    resolvedAt: r.resolved_at ?? null,
  }));
}

export async function resolveAlert(alertId: number): Promise<void> {
  await pool.query(
    `UPDATE bot_alerts SET resolved_at = NOW() WHERE id = $1`,
    [alertId]
  );
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function getBotHealthCheck(instanceName: string): Promise<BotHealthCheck> {
  const [catalogRes, metricsRes, alertsRes, lastHourRes] = await Promise.allSettled([
    pool.query(`SELECT COUNT(*) AS cnt FROM vehicles WHERE is_active = TRUE`),
    getMetricsSummary(instanceName, 1),  // última hora
    getActiveAlerts(instanceName),
    pool.query(
      `SELECT SUM(hallucination_blocks) AS hall, SUM(dead_letter_count) AS dl
       FROM bot_metrics_hourly
       WHERE instance_name = $1 AND hour_bucket >= NOW() - INTERVAL '1 hour'`,
      [instanceName]
    ),
  ]);

  const vehicleCount = catalogRes.status === 'fulfilled'
    ? Number(catalogRes.value.rows[0]?.cnt ?? 0)
    : 0;

  const metrics = metricsRes.status === 'fulfilled' ? metricsRes.value : null;
  const activeAlerts = alertsRes.status === 'fulfilled' ? alertsRes.value : [];

  const hallLastHour = lastHourRes.status === 'fulfilled'
    ? Number(lastHourRes.value.rows[0]?.hall ?? 0)
    : 0;
  const dlLastHour = lastHourRes.status === 'fulfilled'
    ? Number(lastHourRes.value.rows[0]?.dl ?? 0)
    : 0;

  const fallbackRate = metrics?.fallbackRate ?? 0;
  const checks = {
    catalog: { ok: vehicleCount > 0, vehicleCount },
    fallbackRate: { ok: fallbackRate < THRESHOLDS.fallbackRate.warn, rate: fallbackRate, threshold: THRESHOLDS.fallbackRate.warn },
    hallucinationBlocks: { ok: hallLastHour < THRESHOLDS.hallucinationBlocks.warn, lastHour: hallLastHour },
    deadLetters: { ok: dlLastHour < THRESHOLDS.deadLetterSpike.critical, lastHour: dlLastHour },
    activeAlerts: activeAlerts.length,
  };

  const ok = checks.catalog.ok
    && checks.fallbackRate.ok
    && checks.hallucinationBlocks.ok
    && checks.deadLetters.ok
    && activeAlerts.filter((a) => a.severity === 'critical').length === 0;

  return { ok, checks, timestamp: new Date().toISOString() };
}
