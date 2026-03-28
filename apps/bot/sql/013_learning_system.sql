-- =============================================================================
-- Migración 013: Sistema de Aprendizaje Incremental — WaPro Bot
-- =============================================================================
-- Captura conversaciones reales, scoring automático, feedback humano y
-- selección dinámica de few-shot examples para inyectar al agente.
--
-- Tablas:
--   bot_learning_captures  — Cada turno de conversación capturado
--   bot_learning_feedback  — Feedback explícito de operadores del panel
--
-- Índices optimizados para:
--   - Consultas de selección de ejemplos (status + auto_score)
--   - Agrupación por intención para few-shot relevante
--   - Historial por conversación
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS y ADD COLUMN IF NOT EXISTS
-- Aplicar con: psql $DATABASE_URL -f sql/013_learning_system.sql
-- =============================================================================

-- ─── Tabla principal: capturas de conversación ────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_learning_captures (
  id              bigserial PRIMARY KEY,
  instance        text        NOT NULL,
  remote_jid      text        NOT NULL,
  turn_index      int         NOT NULL DEFAULT 0,

  -- Lo que dijo el cliente y respondió el bot
  user_message    text        NOT NULL,
  bot_response    text        NOT NULL,

  -- Contexto de la decisión
  intent          text,
  confidence      numeric,                       -- 0–1, del agente
  source_type     text,                          -- 'faq' | 'playbook' | 'agent' | 'gpt' | 'fallback'
  extracted_context jsonb NOT NULL DEFAULT '{}'::jsonb,  -- campos conocidos al momento
  lead_score      int,                           -- score del lead en ese momento

  -- Score de calidad automático (0–1, mayor = mejor ejemplo)
  auto_score      numeric NOT NULL DEFAULT 0.5,

  -- Señales de calidad acumuladas
  human_rating    smallint,                      -- -1 bad | 0 neutral | 1 good | 2 excellent
  outcome_signal  text,                          -- 'pipeline_advance' | 'quotation' | 'visit' | 'closed_won' | 'closed_lost'
  has_error       boolean NOT NULL DEFAULT false,
  error_type      text,                          -- 'invented_price' | 'wrong_currency' | 'redundant_question' | 'hallucination'

  -- Estado de validación
  status          text NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected' | 'flagged'
  reviewed_by     text,
  reviewed_at     timestamptz,

  -- Si fue promovido a bot_examples
  promoted_to_example_id bigint REFERENCES bot_examples(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Índices para selección de ejemplos few-shot
CREATE INDEX IF NOT EXISTS idx_learning_captures_status_score
  ON bot_learning_captures(status, auto_score DESC);

CREATE INDEX IF NOT EXISTS idx_learning_captures_intent_score
  ON bot_learning_captures(intent, auto_score DESC)
  WHERE intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_captures_conversation
  ON bot_learning_captures(instance, remote_jid, turn_index DESC);

CREATE INDEX IF NOT EXISTS idx_learning_captures_source
  ON bot_learning_captures(source_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_captures_outcome
  ON bot_learning_captures(outcome_signal)
  WHERE outcome_signal IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_captures_created
  ON bot_learning_captures(created_at DESC);


-- ─── Tabla de feedback humano ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_learning_feedback (
  id              bigserial PRIMARY KEY,
  capture_id      bigint NOT NULL REFERENCES bot_learning_captures(id) ON DELETE CASCADE,

  reviewer        text NOT NULL,                 -- email o nombre del operador
  rating          smallint NOT NULL,             -- -1 | 0 | 1 | 2
  corrected_response text,                       -- respuesta ideal según el operador
  error_type      text,                          -- tipo de error detectado
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_capture
  ON bot_learning_feedback(capture_id);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_reviewer
  ON bot_learning_feedback(reviewer);


-- ─── Enriquecer bot_examples con metadatos de calidad ────────────────────────

-- Columna: origen (manual | promoted | training)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_examples' AND column_name = 'source'
  ) THEN
    ALTER TABLE bot_examples ADD COLUMN source text NOT NULL DEFAULT 'manual';
  END IF;
END $$;

-- Columna: score de calidad (para ordenamiento en selección)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_examples' AND column_name = 'quality_score'
  ) THEN
    ALTER TABLE bot_examples ADD COLUMN quality_score numeric NOT NULL DEFAULT 0.8;
  END IF;
END $$;

-- Columna: validado manualmente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_examples' AND column_name = 'validated'
  ) THEN
    ALTER TABLE bot_examples ADD COLUMN validated boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Columna: número de veces usado en el prompt (para analítica)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_examples' AND column_name = 'usage_count'
  ) THEN
    ALTER TABLE bot_examples ADD COLUMN usage_count int NOT NULL DEFAULT 0;
  END IF;
END $$;


-- ─── Vista de análisis: capturas candidatas a few-shot ────────────────────────

CREATE OR REPLACE VIEW bot_learning_candidates AS
SELECT
  lc.id,
  lc.intent,
  lc.user_message,
  lc.bot_response,
  lc.source_type,
  lc.confidence,
  lc.auto_score,
  lc.human_rating,
  lc.outcome_signal,
  lc.status,
  lc.has_error,
  lc.created_at,
  -- Score compuesto para ranking (human override > auto)
  CASE
    WHEN lc.human_rating IS NOT NULL THEN
      CASE lc.human_rating
        WHEN  2 THEN 0.95
        WHEN  1 THEN 0.80
        WHEN  0 THEN 0.50
        WHEN -1 THEN 0.05
        ELSE lc.auto_score
      END
    ELSE lc.auto_score
  END AS effective_score,
  -- Bandera de uso (para filtrar buenos candidatos)
  CASE
    WHEN lc.status = 'approved' THEN true
    WHEN lc.status = 'pending' AND lc.auto_score >= 0.70 AND NOT lc.has_error THEN true
    ELSE false
  END AS is_candidate
FROM bot_learning_captures lc;


-- ─── Función helper: actualizar score cuando llega feedback ──────────────────

CREATE OR REPLACE FUNCTION bot_apply_feedback_score()
RETURNS TRIGGER AS $$
DECLARE
  v_new_score numeric;
  v_new_status text;
BEGIN
  -- Calcular nuevo score según rating
  v_new_score := CASE NEW.rating
    WHEN  2 THEN 0.95
    WHEN  1 THEN 0.80
    WHEN  0 THEN 0.50
    WHEN -1 THEN 0.10
    ELSE 0.50
  END;

  v_new_status := CASE
    WHEN NEW.rating >= 1 THEN 'approved'
    WHEN NEW.rating = -1 THEN 'rejected'
    ELSE 'pending'
  END;

  -- Actualizar la captura correspondiente
  UPDATE bot_learning_captures
  SET
    auto_score   = v_new_score,
    human_rating = NEW.rating,
    status       = v_new_status,
    reviewed_by  = NEW.reviewer,
    reviewed_at  = now(),
    updated_at   = now()
  WHERE id = NEW.capture_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: al insertar feedback, actualizar la captura automáticamente
DROP TRIGGER IF EXISTS trg_apply_feedback ON bot_learning_feedback;
CREATE TRIGGER trg_apply_feedback
AFTER INSERT ON bot_learning_feedback
FOR EACH ROW EXECUTE FUNCTION bot_apply_feedback_score();


-- ─── Función helper: actualizar updated_at en capturas ───────────────────────

CREATE OR REPLACE FUNCTION bot_learning_captures_set_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_captures_updated ON bot_learning_captures;
CREATE TRIGGER trg_captures_updated
BEFORE UPDATE ON bot_learning_captures
FOR EACH ROW EXECUTE FUNCTION bot_learning_captures_set_updated();
