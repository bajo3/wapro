-- 018_message_trace.sql
-- Trazabilidad completa por mensaje: correlaciona messageId con intent, scoring, decisión y persist outcome.

CREATE TABLE IF NOT EXISTS bot_message_trace (
  id                   BIGSERIAL PRIMARY KEY,
  message_id           VARCHAR(255) NOT NULL,
  instance_name        VARCHAR(255) NOT NULL,
  remote_jid           VARCHAR(255) NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Intent & decision (del decisionLogger)
  intent               VARCHAR(80),
  intent_confidence    DECIMAL(4,3),
  decision             VARCHAR(20),            -- 'respond' | 'handoff' | 'ignore'
  hallucination_risk   VARCHAR(10),            -- 'low' | 'medium' | 'high'
  hallucination_blocked BOOLEAN DEFAULT FALSE,
  guardrail_issues     TEXT[],

  -- Scoring comercial
  lead_score           INTEGER,
  lead_temperature     VARCHAR(10),
  commercial_priority  INTEGER,

  -- Panel persist outcome
  panel_persisted      BOOLEAN DEFAULT NULL,   -- null = pending
  persist_attempts     INTEGER DEFAULT 0,
  dead_lettered        BOOLEAN DEFAULT FALSE,

  -- Hashes para correlación con Railway logs
  raw_text_hash        VARCHAR(40),
  reply_hash           VARCHAR(40),
  turn_index           INTEGER,

  CONSTRAINT uq_bot_message_trace_msgid UNIQUE (message_id, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_bmt_remote_jid
  ON bot_message_trace(remote_jid, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bmt_instance_time
  ON bot_message_trace(instance_name, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bmt_hallucination
  ON bot_message_trace(hallucination_blocked)
  WHERE hallucination_blocked = TRUE;
CREATE INDEX IF NOT EXISTS idx_bmt_decision
  ON bot_message_trace(decision, received_at DESC);
