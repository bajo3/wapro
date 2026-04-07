-- 019_bot_metrics.sql
-- Métricas horarias agregadas del bot + tabla de alertas de degradación.

CREATE TABLE IF NOT EXISTS bot_metrics_hourly (
  id                    BIGSERIAL PRIMARY KEY,
  hour_bucket           TIMESTAMPTZ NOT NULL,
  instance_name         VARCHAR(255) NOT NULL,

  -- Volumen
  total_messages        INTEGER DEFAULT 0,
  responded_messages    INTEGER DEFAULT 0,
  handoff_messages      INTEGER DEFAULT 0,
  ignored_messages      INTEGER DEFAULT 0,

  -- Calidad
  hallucination_blocks  INTEGER DEFAULT 0,
  guardrail_flags       INTEGER DEFAULT 0,
  fallback_responses    INTEGER DEFAULT 0,
  dead_letter_count     INTEGER DEFAULT 0,

  -- Scoring
  avg_lead_score        DECIMAL(5,2),
  hot_leads             INTEGER DEFAULT 0,
  warm_leads            INTEGER DEFAULT 0,
  cold_leads            INTEGER DEFAULT 0,

  -- Intenciones top [{intent, count}]
  top_intents           JSONB DEFAULT '[]'::jsonb,

  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_bot_metrics_hour UNIQUE (hour_bucket, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_bmh_hour
  ON bot_metrics_hourly(hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_bmh_instance
  ON bot_metrics_hourly(instance_name, hour_bucket DESC);

-- Alertas de degradación del bot
CREATE TABLE IF NOT EXISTS bot_alerts (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  instance_name   VARCHAR(255) NOT NULL,
  alert_type      VARCHAR(80) NOT NULL,
  severity        VARCHAR(10) NOT NULL,       -- 'warn' | 'critical'
  metric_value    DECIMAL(10,4),
  threshold_value DECIMAL(10,4),
  details         JSONB DEFAULT '{}'::jsonb,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ba_unresolved
  ON bot_alerts(instance_name, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ba_type
  ON bot_alerts(alert_type, created_at DESC);
