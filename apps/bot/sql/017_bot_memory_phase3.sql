-- Migración 017: Tabla bot_memory — Autoaprendizaje Fase 3
-- Persistencia real de memoria conversacional en Postgres.
-- Reemplaza el JSON efímero de botMemory.ts con filas indexadas y trazables.
--
-- Tipos de entrada (memory_type):
--   successful_question  — pregunta que generó datos útiles del cliente
--   successful_reply     — respuesta que avanzó la conversación con señal de intención
--   indecision_pattern   — intercambio que resolvió indecisión y el cliente avanzó
--   objection_pattern    — manejo de objeción que funcionó
--   handoff_pattern      — derivación que el cliente aceptó positivamente
--   bad_generic_reply    — respuesta genérica sin datos (anti-patrón)
--   anti_pattern         — intercambio que falló (usuario repitió, conversación se estancó)
--
-- safe_to_reuse=TRUE: solo las entradas con score >= 5 que pasaron isSafeToLearn()
-- Las anti_pattern se guardan para análisis pero nunca se inyectan como few-shot positivo.

CREATE TABLE IF NOT EXISTS bot_memory (
  id                 SERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conversation_id    VARCHAR(255),
  instance_name      VARCHAR(255),
  user_message       TEXT NOT NULL,
  bot_reply          TEXT NOT NULL,
  extracted_context  JSONB,
  memory_type        VARCHAR(50) NOT NULL
                       CHECK (memory_type IN (
                         'successful_question',
                         'successful_reply',
                         'indecision_pattern',
                         'objection_pattern',
                         'handoff_pattern',
                         'bad_generic_reply',
                         'anti_pattern'
                       )),
  quality_score      INTEGER NOT NULL DEFAULT 0,
  outcome_signals    JSONB,
  safe_to_reuse      BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason   TEXT,
  reuse_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at       TIMESTAMPTZ,
  -- Autoevaluación del bot en el momento de guardar
  self_eval          JSONB
);

-- Índices para selección eficiente de few-shot
CREATE INDEX IF NOT EXISTS idx_bot_memory_type
  ON bot_memory(memory_type);

CREATE INDEX IF NOT EXISTS idx_bot_memory_safe_reuse
  ON bot_memory(safe_to_reuse)
  WHERE safe_to_reuse = TRUE;

CREATE INDEX IF NOT EXISTS idx_bot_memory_score
  ON bot_memory(quality_score DESC);

-- Índice compuesto para la consulta de few-shot dinámico
-- (safe_to_reuse=TRUE, score DESC, last_used_at ASC para diversidad)
CREATE INDEX IF NOT EXISTS idx_bot_memory_fewshot
  ON bot_memory(memory_type, quality_score DESC, last_used_at ASC)
  WHERE safe_to_reuse = TRUE;

-- Comentarios de columnas
COMMENT ON TABLE bot_memory IS 'Memoria conversacional del bot — Fase 3. Solo patrones conversacionales, nunca datos de catálogo.';
COMMENT ON COLUMN bot_memory.memory_type IS 'Tipo de patrón aprendido. anti_pattern y bad_generic_reply nunca se usan como few-shot positivo.';
COMMENT ON COLUMN bot_memory.quality_score IS 'Score calculado post-turno (señales reales del siguiente mensaje del usuario). Rango aprox: -5 a 10.';
COMMENT ON COLUMN bot_memory.safe_to_reuse IS 'TRUE solo si score >= 5 y pasó isSafeToLearn(). Los ejemplos few-shot solo vienen de aquí.';
COMMENT ON COLUMN bot_memory.outcome_signals IS 'JSON con señales detectadas: userReplied, userGaveMoreData, botAskedRedundant, etc.';
COMMENT ON COLUMN bot_memory.self_eval IS 'Autoevaluación del bot en el turno: wasGeneric, advancedConversation, askedUsefully, inventionRisk, etc.';
COMMENT ON COLUMN bot_memory.rejection_reason IS 'Por qué no se marcó como safe_to_reuse. Útil para análisis de calidad.';
