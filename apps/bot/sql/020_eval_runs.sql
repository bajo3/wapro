-- 020_eval_runs.sql
-- Resultados de runs de evaluación automática continua.

CREATE TABLE IF NOT EXISTS bot_eval_runs (
  id              BIGSERIAL PRIMARY KEY,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  instance_name   VARCHAR(255) NOT NULL,
  triggered_by    VARCHAR(30) NOT NULL DEFAULT 'scheduled',

  -- Resultados agregados
  total_cases     INTEGER NOT NULL DEFAULT 0,
  passed          INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  pass_rate       DECIMAL(4,3),
  avg_score       DECIMAL(5,2),

  -- Alerta si cae bajo umbral
  threshold       DECIMAL(4,3) DEFAULT 0.80,
  below_threshold BOOLEAN DEFAULT FALSE,

  -- Detalle por caso (JSONB para evitar tabla extra)
  case_results    JSONB DEFAULT '[]'::jsonb,
  alert_emitted   BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ber_run_at
  ON bot_eval_runs(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_ber_instance
  ON bot_eval_runs(instance_name, run_at DESC);
