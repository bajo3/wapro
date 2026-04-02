-- =============================================================================
-- Migración 015: Memoria Incremental de Patrones — WaPro Bot
-- =============================================================================
-- Tabla de memoria que registra patrones aprendidos de conversaciones reales:
--   - Preguntas frecuentes sin respuesta (gap FAQ)
--   - Objeciones frecuentes detectadas
--   - Consultas sin match en catálogo (gap stock)
--   - Sinónimos y variantes de marcas/modelos
--   - Conversaciones que terminaron en lead / visita
--   - Sugerencias de mejora para el bot
--
-- Esta tabla es SOLO lectura para el agente. Los datos se insertan/actualizan
-- mediante la función auto_extract_learning_patterns() corrida periódicamente.
-- NO modifica precios, stock ni datos comerciales sensibles.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS y ADD COLUMN IF NOT EXISTS
-- Aplicar con: psql $DATABASE_URL -f sql/015_bot_learning_memory.sql
-- =============================================================================

-- ─── Tabla principal: patrones de memoria ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_learning_memory (
  id              bigserial PRIMARY KEY,

  -- Tipo de patrón
  pattern_type    text NOT NULL,
  -- Valores:
  --  'faq_gap'          — pregunta frecuente sin respuesta en el sistema
  --  'objection'        — objeción frecuente (precio, garantía, etc.)
  --  'stock_gap'        — búsqueda de marca/modelo no disponible en catálogo
  --  'synonym'          — variante ortográfica detectada (ej: "volskwagen"→"volkswagen")
  --  'lead_pattern'     — patrón de conversación que terminó en lead
  --  'visit_pattern'    — patrón que llevó a coordinar visita
  --  'failure_pattern'  — patrón de conversación sin resultado comercial
  --  'suggestion'       — sugerencia de mejora detectada automáticamente
  --  'unresolved'       — consulta no resuelta (fallback repetido)

  -- Contenido del patrón
  pattern_key     text NOT NULL,           -- identificador único del patrón (normalizado)
  pattern_value   text,                    -- valor asociado (ej: corrección ortográfica, respuesta sugerida)
  sample_messages text[],                  -- ejemplos de mensajes que generaron este patrón
  intent          text,                    -- intent asociado si se detectó
  frequency       int NOT NULL DEFAULT 1, -- cuántas veces se detectó
  confidence      numeric DEFAULT 0.5,     -- confianza (0-1) del patrón detectado

  -- Metadatos
  source          text DEFAULT 'auto',     -- 'auto' | 'operator'
  status          text DEFAULT 'active',   -- 'active' | 'resolved' | 'dismissed'
  notes           text,                    -- nota del operador

  -- Timestamps
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_bot_learning_memory_type_key UNIQUE (pattern_type, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_bot_learning_memory_type
  ON bot_learning_memory(pattern_type, frequency DESC);

CREATE INDEX IF NOT EXISTS idx_bot_learning_memory_status
  ON bot_learning_memory(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_learning_memory_intent
  ON bot_learning_memory(intent)
  WHERE intent IS NOT NULL;


-- ─── Función helper: upsert de patrón ────────────────────────────────────────
-- Inserta un patrón nuevo o incrementa su frecuencia si ya existe.
-- Si se agrega un sample_message nuevo, se añade al array (máximo 5 samples).

CREATE OR REPLACE FUNCTION bot_upsert_learning_pattern(
  p_type        text,
  p_key         text,
  p_value       text       DEFAULT NULL,
  p_sample      text       DEFAULT NULL,
  p_intent      text       DEFAULT NULL,
  p_confidence  numeric    DEFAULT 0.5
)
RETURNS bigint AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO bot_learning_memory
    (pattern_type, pattern_key, pattern_value, sample_messages, intent, frequency, confidence)
  VALUES
    (p_type, p_key, p_value,
     CASE WHEN p_sample IS NOT NULL THEN ARRAY[p_sample] ELSE ARRAY[]::text[] END,
     p_intent, 1, p_confidence)
  ON CONFLICT (pattern_type, pattern_key)
  DO UPDATE SET
    frequency    = bot_learning_memory.frequency + 1,
    last_seen_at = now(),
    updated_at   = now(),
    confidence   = GREATEST(bot_learning_memory.confidence, p_confidence),
    -- Agregar sample si no está ya en el array (máximo 5 muestras)
    sample_messages = CASE
      WHEN p_sample IS NOT NULL AND
           NOT (bot_learning_memory.sample_messages @> ARRAY[p_sample]) AND
           array_length(bot_learning_memory.sample_messages, 1) < 5
      THEN bot_learning_memory.sample_messages || ARRAY[p_sample]
      ELSE bot_learning_memory.sample_messages
    END,
    intent = COALESCE(bot_learning_memory.intent, p_intent),
    pattern_value = COALESCE(p_value, bot_learning_memory.pattern_value)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;


-- ─── Vista de resumen para el panel de aprendizaje ────────────────────────────
-- Agrupa los patrones activos por tipo, ordenados por frecuencia.
-- Útil para mostrar en el panel de BotLearning.

CREATE OR REPLACE VIEW bot_learning_memory_summary AS
SELECT
  pattern_type,
  COUNT(*)                       AS total_patterns,
  SUM(frequency)                 AS total_occurrences,
  MAX(last_seen_at)              AS last_activity,
  jsonb_agg(
    jsonb_build_object(
      'id',          id,
      'key',         pattern_key,
      'value',       pattern_value,
      'frequency',   frequency,
      'intent',      intent,
      'confidence',  confidence,
      'last_seen',   last_seen_at,
      'status',      status
    )
    ORDER BY frequency DESC
  ) FILTER (WHERE status = 'active') AS top_patterns
FROM bot_learning_memory
GROUP BY pattern_type
ORDER BY total_occurrences DESC;


-- ─── Trigger: updated_at automático ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION bot_learning_memory_set_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bot_learning_memory_updated ON bot_learning_memory;
CREATE TRIGGER trg_bot_learning_memory_updated
BEFORE UPDATE ON bot_learning_memory
FOR EACH ROW EXECUTE FUNCTION bot_learning_memory_set_updated();
