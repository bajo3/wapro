-- ═══════════════════════════════════════════════════════════════════════════════
-- WaPro · MercadoLibre — Setup SQL
-- Target:  Supabase/Postgres · Project fymiuuolsdmnftgcywfl
-- Date:    2026-04-19
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS.
-- No borra datos. No hace DROP.
-- Aplicar en orden desde la consola SQL de Supabase o via psql.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── SECCIÓN 1: meli_tokens ───────────────────────────────────────────────────
-- Token OAuth de MercadoLibre. Una sola fila: id = 'main'.
-- Usada por meliVehiclesPublisher.ts (panel) y meliClient.ts (bot).
-- Columnas: exactas a lo que el código lee/escribe en prod.

CREATE TABLE IF NOT EXISTS meli_tokens (
  id            TEXT        PRIMARY KEY,              -- siempre 'main'
  access_token  TEXT,                                 -- token OAuth activo
  refresh_token TEXT,                                 -- para renovar el access_token
  expires_at    BIGINT,                               -- unix timestamp en ms
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fila placeholder: evita el error "Missing token row id=main" en primer arranque.
-- Los tokens reales se cargan via el flujo OAuth de ML.
INSERT INTO meli_tokens (id, access_token, refresh_token, expires_at)
VALUES ('main', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;


-- ── SECCIÓN 2: vehicles — columnas ML ────────────────────────────────────────
-- La migración Sequelize 20260419120000 define estas columnas pero puede no
-- haberse aplicado en Supabase. ADD COLUMN IF NOT EXISTS es idempotente.
--
-- Nombres en camelCase: Sequelize los crea quoted en PG.
-- El panel los lee via Sequelize ORM (quoted); meliSync.ts usa snake_case
-- para los campos base — no tocar esos.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS "publishToMeli"        BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "meliItemId"            TEXT,                   -- 'MLA1234567890'
  ADD COLUMN IF NOT EXISTS "meliStatus"            TEXT,                   -- 'active'|'paused'|'closed'
  ADD COLUMN IF NOT EXISTS "meliPermalink"         TEXT,                   -- URL pública del anuncio
  ADD COLUMN IF NOT EXISTS "meliCategoryId"        TEXT,                   -- ej: 'MLA1744'
  ADD COLUMN IF NOT EXISTS "meliDomainId"          TEXT,                   -- ej: 'MLA-CARS_AND_VANS'
  ADD COLUMN IF NOT EXISTS "meliListingTypeId"     TEXT,                   -- 'gold_special'|'gold'|'silver'
  ADD COLUMN IF NOT EXISTS "meliAttributes"        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "meliPayloadDraft"      JSONB,                  -- último payload enviado/validado
  ADD COLUMN IF NOT EXISTS "meliLastSyncAt"        TIMESTAMPTZ,            -- última sync exitosa
  ADD COLUMN IF NOT EXISTS "meliLastError"         TEXT,                   -- último error de sync/publish
  ADD COLUMN IF NOT EXISTS "meliValidationErrors"  JSONB        NOT NULL DEFAULT '[]'::jsonb;

-- Índices frecuentes desde el panel (filtrar por estado ML, ordenar por sync)
CREATE INDEX IF NOT EXISTS idx_vehicles_meli_item_id
  ON vehicles ("meliItemId")
  WHERE "meliItemId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_meli_status
  ON vehicles ("meliStatus")
  WHERE "meliStatus" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_publish_to_meli
  ON vehicles ("publishToMeli")
  WHERE "publishToMeli" = true;

CREATE INDEX IF NOT EXISTS idx_vehicles_meli_last_sync
  ON vehicles ("meliLastSyncAt" DESC NULLS LAST)
  WHERE "meliItemId" IS NOT NULL;


-- ── SECCIÓN 3: meli_publications ─────────────────────────────────────────────
-- Estado actual de cada publicación ML vinculada a un vehículo.
-- Separado de vehicles para poder tener historial y re-publicaciones futuras.
-- La relación activa es: vehicles."meliItemId" = meli_publications.meli_item_id

CREATE TABLE IF NOT EXISTS meli_publications (
  id               BIGSERIAL    PRIMARY KEY,
  vehicle_id       TEXT         NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  meli_item_id     TEXT         NOT NULL UNIQUE,          -- id en ML, ej 'MLA1234567890'
  meli_status      TEXT,                                  -- 'active'|'paused'|'closed'|'under_review'
  permalink        TEXT,                                  -- URL permanente del anuncio
  category_id      TEXT,
  domain_id        TEXT,
  listing_type_id  TEXT,
  price            NUMERIC(15, 2),
  currency         TEXT,                                  -- 'ARS'|'USD'
  available_qty    INTEGER      DEFAULT 1,
  payload_sent     JSONB,                                 -- payload completo enviado a POST /items
  raw_response     JSONB,                                 -- respuesta cruda de ML al publicar
  published_at     TIMESTAMPTZ  DEFAULT now(),
  last_synced_at   TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meli_pub_vehicle_id
  ON meli_publications (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_meli_pub_status
  ON meli_publications (meli_status);

CREATE INDEX IF NOT EXISTS idx_meli_pub_last_synced
  ON meli_publications (last_synced_at DESC NULLS LAST);

-- Trigger para updated_at automático en meli_publications
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_meli_publications_updated_at'
  ) THEN
    CREATE TRIGGER trg_meli_publications_updated_at
      BEFORE UPDATE ON meli_publications
      FOR EACH ROW EXECUTE FUNCTION _set_updated_at();
  END IF;
END;
$$;


-- ── SECCIÓN 4: meli_sync_logs ─────────────────────────────────────────────────
-- Audit trail append-only de todas las operaciones contra ML.
-- Una fila por cada acción (publish, sync, pause, reactivate, validate, error).
-- No se borran registros. La retención la maneja el negocio.

CREATE TABLE IF NOT EXISTS meli_sync_logs (
  id             BIGSERIAL    PRIMARY KEY,
  vehicle_id     TEXT         REFERENCES vehicles(id) ON DELETE SET NULL,
  meli_item_id   TEXT,                                   -- null si falló antes de publicar
  action         TEXT         NOT NULL,                  -- 'publish'|'sync'|'pause'|'reactivate'|'validate'|'dry-run'|'refresh_token'
  ok             BOOLEAN      NOT NULL DEFAULT false,
  status_code    INTEGER,                                -- HTTP status de la API ML
  error_message  TEXT,
  payload        JSONB,                                  -- payload enviado (sin credenciales)
  response       JSONB,                                  -- respuesta ML relevante
  triggered_by   TEXT,                                   -- 'user:42'|'cron'|'api'
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Índice principal: buscar historial de un vehículo
CREATE INDEX IF NOT EXISTS idx_meli_sync_logs_vehicle_id
  ON meli_sync_logs (vehicle_id, created_at DESC);

-- Índice para filtrar por tipo de acción
CREATE INDEX IF NOT EXISTS idx_meli_sync_logs_action
  ON meli_sync_logs (action, created_at DESC);

-- Índice parcial de errores: para alertas y monitoreo rápido
CREATE INDEX IF NOT EXISTS idx_meli_sync_logs_errors
  ON meli_sync_logs (created_at DESC)
  WHERE ok = false;


-- ── SECCIÓN 5: Validación / Diagnóstico ──────────────────────────────────────
-- Queries de verificación. No modifican datos.
-- Ejecutá estas después del setup para confirmar el estado.

-- 5a. Confirmar que meli_tokens tiene la fila 'main':
--
--   SELECT id,
--          CASE WHEN access_token IS NOT NULL THEN 'seteado' ELSE 'VACÍO' END AS access_token,
--          CASE WHEN refresh_token IS NOT NULL THEN 'seteado' ELSE 'VACÍO' END AS refresh_token,
--          expires_at,
--          updated_at
--   FROM meli_tokens
--   WHERE id = 'main';

-- 5b. Confirmar que las columnas ML existen en vehicles:
--
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'vehicles'
--     AND (column_name ILIKE '%meli%' OR column_name = 'publishToMeli')
--   ORDER BY ordinal_position;

-- 5c. Vehículos con publicación activa en ML:
--
--   SELECT id, "meliItemId", "meliStatus", "meliLastSyncAt", "meliLastError"
--   FROM vehicles
--   WHERE "meliItemId" IS NOT NULL
--   ORDER BY "meliLastSyncAt" DESC NULLS LAST
--   LIMIT 20;

-- 5d. Últimos errores de sync:
--
--   SELECT vehicle_id, meli_item_id, action, error_message, created_at
--   FROM meli_sync_logs
--   WHERE ok = false
--   ORDER BY created_at DESC
--   LIMIT 20;

-- 5e. Publicaciones ML activas vs pausadas:
--
--   SELECT meli_status, count(*) as total
--   FROM meli_publications
--   GROUP BY meli_status
--   ORDER BY total DESC;
