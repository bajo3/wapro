-- =============================================================================
-- Migración 014: Indexes, Price History y Auto-tagging de leads
-- =============================================================================
-- 1. Indexes críticos para performance en tablas de conversaciones y vehículos
-- 2. Tabla vehicle_price_history para tracking de cambios de precio
-- 3. Columna lead_tags en bot_conversations para auto-tagging por intención
-- =============================================================================

-- ─── 1. INDEXES CRÍTICOS ──────────────────────────────────────────────────────

-- Conversations: búsqueda por jid e instance
CREATE INDEX IF NOT EXISTS idx_bot_conversations_instance_jid
  ON bot_conversations(instance, remote_jid);

CREATE INDEX IF NOT EXISTS idx_bot_conversations_instance
  ON bot_conversations(instance);

-- Conversations: seguimiento de actividad reciente
CREATE INDEX IF NOT EXISTS idx_bot_conversations_updated
  ON bot_conversations(updated_at DESC)
  WHERE updated_at IS NOT NULL;

-- Dedupe: limpieza de entradas viejas
CREATE INDEX IF NOT EXISTS idx_bot_messages_dedupe_received
  ON bot_messages_dedupe(received_at DESC);

-- Vehicles indexes removed: vehicles table now lives in wapro-DB (SUPABASE_DATABASE_URL),
-- not in bot-DB. Indexes are managed by the wapro project.

-- Learning captures: por estado y score para selección few-shot (ya en 013 pero con IF NOT EXISTS)
-- ─── 2. HISTORIAL DE PRECIOS ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicle_price_history (
  id            bigserial PRIMARY KEY,
  vehicle_id    text        NOT NULL,
  title         text,
  brand         text,
  model         text,
  year          int,

  -- Precio anterior y nuevo
  price_before  numeric,
  price_after   numeric     NOT NULL,
  currency      text        NOT NULL DEFAULT 'USD',

  -- Variación
  delta_abs     numeric     GENERATED ALWAYS AS (price_after - COALESCE(price_before, price_after)) STORED,
  delta_pct     numeric     GENERATED ALWAYS AS (
    CASE
      WHEN price_before IS NOT NULL AND price_before != 0
      THEN ROUND((price_after - price_before) / price_before * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- Contexto
  change_reason text,        -- 'sync' | 'manual' | 'adjustment'
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vph_vehicle_id
  ON vehicle_price_history(vehicle_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vph_recorded_at
  ON vehicle_price_history(recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vph_brand_model
  ON vehicle_price_history(brand, model, recorded_at DESC)
  WHERE brand IS NOT NULL;

-- Función helper: registrar cambio de precio al hacer upsert de vehículo
-- Se puede llamar desde syncVehicles o desde el panel de forma explícita
CREATE OR REPLACE FUNCTION record_vehicle_price_change(
  p_vehicle_id  text,
  p_title       text,
  p_brand       text,
  p_model       text,
  p_year        int,
  p_new_price   numeric,
  p_currency    text DEFAULT 'USD',
  p_reason      text DEFAULT 'sync'
) RETURNS void AS $$
DECLARE
  v_last_price numeric;
BEGIN
  -- Obtener último precio registrado
  SELECT price_after INTO v_last_price
  FROM vehicle_price_history
  WHERE vehicle_id = p_vehicle_id
  ORDER BY recorded_at DESC
  LIMIT 1;

  -- Solo registrar si hubo cambio real (o es el primero)
  IF v_last_price IS DISTINCT FROM p_new_price THEN
    INSERT INTO vehicle_price_history
      (vehicle_id, title, brand, model, year, price_before, price_after, currency, change_reason)
    VALUES
      (p_vehicle_id, p_title, p_brand, p_model, p_year, v_last_price, p_new_price, p_currency, p_reason);
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ─── 3. AUTO-TAGGING DE LEADS ─────────────────────────────────────────────────

-- Columna lead_tags en bot_conversations (JSONB array de intenciones detectadas)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_conversations' AND column_name = 'lead_tags'
  ) THEN
    ALTER TABLE bot_conversations ADD COLUMN lead_tags jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Columna lead_intent_primary: tag principal consolidado para CRM
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_conversations' AND column_name = 'lead_intent_primary'
  ) THEN
    ALTER TABLE bot_conversations ADD COLUMN lead_intent_primary text;
  END IF;
END $$;

-- Columna last_classified_at: cuándo se clasificó por última vez
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_conversations' AND column_name = 'last_classified_at'
  ) THEN
    ALTER TABLE bot_conversations ADD COLUMN last_classified_at timestamptz;
  END IF;
END $$;

-- Index para filtrar leads por tag en el panel
CREATE INDEX IF NOT EXISTS idx_bot_conversations_lead_intent
  ON bot_conversations(lead_intent_primary)
  WHERE lead_intent_primary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bot_conversations_lead_tags
  ON bot_conversations USING gin(lead_tags);


-- ─── 4. VISTA: LEADS POR INTENCIÓN ───────────────────────────────────────────

CREATE OR REPLACE VIEW leads_by_intent AS
SELECT
  instance,
  remote_jid,
  lead_intent_primary                              AS intent,
  lead_tags,
  (state->>'followup_sent')::boolean              AS followup_sent,
  (state->>'last_intent')                         AS last_bot_intent,
  CAST(state->>'lead_score' AS int)               AS lead_score,
  last_classified_at,
  updated_at
FROM bot_conversations
WHERE lead_intent_primary IS NOT NULL
ORDER BY updated_at DESC;
