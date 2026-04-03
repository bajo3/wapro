# Demands & Vehicle Matching System - Complete Analysis

## System Overview

The system matches customer vehicle demands with available vehicles from a catalog. When a demand is created, a scheduled matching algorithm scans all active vehicles and calculates similarity scores against each demand. Users are notified when high-scoring matches are found, with built-in recontacting capabilities.

---

## 1. MATCHING ALGORITHM FUNCTION

### Location
`/sessions/eloquent-hopeful-clarke/mnt/wapro/apps/bot/src/services/demands.ts` (lines 761-968)

### Function Signature
```typescript
export async function scanRecentVehiclesForDemandMatches(params: { 
  since: Date; 
  threshold: number 
}): Promise<{
  vehicles: number;
  demands: number;
  matches: number;
  notificationsSent: number;
}>
```

### How It Works

1. **Load all open demands** from the database
2. **Scan vehicles** from the detected vehicle source (updated since `since` parameter)
3. **For each demand**, calculate a composite similarity score against each vehicle
4. **Insert/update matches** in `vehicle_demand_matches` table only if score >= threshold
5. **Send notifications** if conditions are met (cooldown, min score, notifyOnMatch flag)
6. **Return statistics** about matches inserted and notifications sent

### Default Threshold
- Default: **0.38** (40% similarity, changed from 0.45)
- Configurable via API parameter `threshold`
- Reason: Lower threshold allows matching natural-language demands like "quiero un auto familiar" or "necesito una Hilux usada" without explicit brand/model fields

---

## 2. MATCHING FIELDS & SCORING BREAKDOWN

### Fields Extracted from Demand
```typescript
// From explicit demand fields OR extracted from demand.query
{
  brand?: string;      // Extracted or explicit
  model?: string;      // Extracted or explicit  
  transmission?: string;
  minYear?: number;
  maxYear?: number;
  maxPrice?: number;
  fuel?: string;       // Detected fuel type
  bodywork?: string;   // Inferred from query
  gnc?: boolean;       // Specific GNC flag
}
```

### Matching Components

#### A. Brand Matching (0.25 max)
```typescript
if (demandCtx.brand && v.brand) {
  if (exact_match) score += 0.25;           // "Fiat" == "Fiat"
  else if (partial_match) score += 0.12;    // "Fiat" ~in~ "Fiat Uno"
}
```

#### B. Model Matching (0.20 max)
```typescript
if (demandCtx.model && v.model) {
  if (exact_match) score += 0.20;           // "Uno" == "Uno"
  else if (partial_match) score += 0.12;    // "Uno" in title/model
}
```

#### C. Text Similarity (0.35 max)
```typescript
// Tokenize demand + vehicle text, apply synonyms, calculate similarity
const dSet = expandTokens(tokenSet(demandText));
const vSet = expandTokens(vTok.get(v.id));
const sim = textSim(dSet, vSet);  // Dice + Jaccard combo
score += sim * 0.35;

// Generic intent boost: if no brand/model but sim >= 0.18
if (!demandCtx.brand && !demandCtx.model && sim >= 0.18) {
  score += 0.12;
}
```

#### D. Year Matching (0.15 max)
```typescript
if (v.year && (demandCtx.minYear || demandCtx.maxYear)) {
  if (v.year in [minY, maxY]) yScore = 1.0;      // score += 0.15
  else if (dist == 1) yScore = 0.7;              // score += 0.105
  else if (dist == 2) yScore = 0.45;             // score += 0.0675
  else if (dist == 3) yScore = 0.2;              // score += 0.03
  else yScore = 0;                               // score += 0
}
```

#### E. Price Matching (0.12 max)
```typescript
if (demandCtx.maxPrice && v.price) {
  if (v.price <= demandCtx.maxPrice) {
    if (ratio >= 0.75) score += 0.12;             // Good price match
    else score += 0.08;                           // Lower ratio
  } else if (v.price <= extendedMax) {            // Within 10% tolerance
    score += 0.04;                                // Neutral score
  } else {
    // Over price: penalty based on % over
    score -= Math.min(0.10, (over % * 0.15));
  }
}
```

#### F. Transmission Matching (0.07 max)
```typescript
if (demandCtx.transmission) {
  const syns = [demandTx, ...(SYNONYMS[demandTx] ?? [])];
  if (vehicle.transmission matches any syn) {
    score += 0.07;
  } else if (vehicle.transmission exists {
    score -= 0.03;  // Penalize mismatch
  }
}
```

#### G. Fuel Matching (0.08 max)
```typescript
if (demandCtx.fuel) {
  if (vehicle.fuel === demandCtx.fuel) {
    score += 0.08;
  } else if (both defined) {
    score -= 0.05;  // Penalize mismatch
  }
} else if (demandCtx.gnc) {
  if (vehicleFuel === 'gnc') score += 0.08;
  else if (vehicleFuel exists) score -= 0.05;
}
```

#### H. Bodywork Matching (0.08 max)
```typescript
if (demandCtx.bodywork) {
  if (vehicle.bodywork === demandCtx.bodywork) {
    score += 0.08;
  } else if (both defined) {
    score -= 0.04;  // Penalize mismatch
  }
}
```

### Score Clamping
- Final score clamped to [0, 1]: `clamp01(score)`
- Must pass threshold to be inserted

---

## 3. SIMILARITY FUNCTIONS

### Text Similarity (Dice + Jaccard)
```typescript
function textSim(a: Set<string>, b: Set<string>): number {
  return dice(a, b) * 0.6 + jaccard(a, b) * 0.4;
}

function dice(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  const inter = [...a].filter(x => b.has(x)).length;
  return (2 * inter) / (a.size + b.size);
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  const inter = [...a].filter(x => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}
```

### Token Expansion (Synonyms)
```typescript
const SYNONYMS: Record<string, string[]> = {
  suv: ['camioneta', 'crossover', 'utilitario', '4x4', 'todoterreno'],
  camioneta: ['suv', 'crossover', 'utilitario', '4x4', 'pickup'],
  pickup: ['pick up', 'doble cabina', 'camioneta'],
  automatico: ['automatica', 'at', 'tiptronic', 'dsg', 'cvt', 'multitronic'],
  manual: ['mt', 'caja', 'caja manual', 'sincronico'],
  4x4: ['4wd', 'awd', 'cuatro por cuatro'],
  nafta: ['gasolina', 'naftero'],
  diesel: ['gasoil', 'gas oil', 'turbodiesel'],
  gnc: ['gas natural', 'gas'],
  volkswagen: ['vw', 'volk'],
  chevrolet: ['chevy', 'chevi'],
  hilux: ['hi lux', 'hi-lux'],
  // ... more
};
```

---

## 4. VEHICLE DATA STRUCTURE & FILTERING

### Vehicle Source Detection
Located in: `demands.ts` lines 166-243, `catalog.ts` lines 97-146

The system **automatically detects** the vehicles table by:
1. Searching for tables in order: `vehicles`, `Vehicles`, `vehicle`, `autos`, `cars`, `car_stock`, `stock_vehicles`, `catalog`, `vehiculos`
2. Verifying table has: id + (title OR (brand AND model)) + (price OR year)
3. Detecting column synonyms for: brand, model, version, title, price, currency, year, transmission, fuel

### Vehicle Fields Loaded for Matching
```typescript
{
  id: string;
  title: string;
  brand?: string;
  model?: string;
  year?: number;
  price?: number;
  currency?: string;
  slug?: string;
  permalink?: string;
  pictures?: any;
  transmission?: string;
  fuel?: string;
}
```

### CRITICAL FILTER: Status Field
```sql
WHERE (status IS NULL 
  OR btrim(status::text) = '' 
  OR LOWER(status::text) NOT IN ('inactive', 'archived', 'deleted', 'sold', 'paused'))
```

**This filter excludes vehicles with status = any of:**
- `inactive`
- `archived`
- `deleted`
- `sold`
- `paused`

**These vehicles are silently excluded from matching.**

### Query Limit
- Default: 2000 vehicles per scan
- Ordered by: `updated_at DESC (nulls last), id DESC`
- Applied to both demand matching and catalog

---

## 5. DATABASE SCHEMA

### `vehicle_demands` Table
```sql
CREATE TABLE vehicle_demands (
  id BIGSERIAL PRIMARY KEY,
  instance TEXT,
  remote_jid TEXT,
  contact_name TEXT,
  phone TEXT,
  query TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  min_year INT,
  max_year INT,
  max_price NUMERIC,
  currency TEXT,
  transmission TEXT,
  status TEXT DEFAULT 'open',
  
  -- Notification settings
  notify_on_match BOOLEAN DEFAULT TRUE,
  notify_min_score NUMERIC DEFAULT 0.72,
  notify_cooldown_min INT DEFAULT 240,
  last_notified_at TIMESTAMPTZ,
  match_template TEXT,
  
  -- Recontact settings
  recontact_enabled BOOLEAN DEFAULT FALSE,
  recontact_every_days INT DEFAULT 7,
  recontact_next_at TIMESTAMPTZ,
  recontact_count INT DEFAULT 0,
  recontact_max INT DEFAULT 3,
  recontact_template TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vehicle_demands_status ON vehicle_demands(status);
CREATE INDEX idx_vehicle_demands_updated_at ON vehicle_demands(updated_at DESC);
```

### `vehicle_demand_matches` Table
```sql
CREATE TABLE vehicle_demand_matches (
  id BIGSERIAL PRIMARY KEY,
  demand_id BIGINT NOT NULL REFERENCES vehicle_demands(id) ON DELETE CASCADE,
  vehicle_id TEXT NOT NULL,
  score NUMERIC NOT NULL,
  reasons JSONB DEFAULT '{}',
  notified_at TIMESTAMPTZ,
  last_shared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(demand_id, vehicle_id)
);

CREATE INDEX idx_vehicle_demand_matches_demand ON vehicle_demand_matches(demand_id, score DESC);
CREATE INDEX idx_vehicle_demand_matches_vehicle ON vehicle_demand_matches(vehicle_id);
CREATE INDEX idx_vehicle_demand_matches_notified ON vehicle_demand_matches(demand_id, notified_at);
```

### `vehicle_demand_recontacts` Table
```sql
CREATE TABLE vehicle_demand_recontacts (
  id BIGSERIAL PRIMARY KEY,
  demand_id BIGINT NOT NULL REFERENCES vehicle_demands(id) ON DELETE CASCADE,
  attempt INT NOT NULL,
  message TEXT NOT NULL,
  match_vehicle_ids JSONB DEFAULT '[]',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vehicle_demand_recontacts_demand ON vehicle_demand_recontacts(demand_id, sent_at DESC);
```

---

## 6. API ENDPOINTS

### Backend Endpoints (Bot Service)
Base: `/admin` (requires `x-admin-token` header)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/vehicle-demands` | GET | List demands (filter by status, limit) |
| `/vehicle-demands` | POST | Create new demand |
| `/vehicle-demands/:id` | PUT | Update demand settings |
| `/vehicle-demands/:id/close` | POST | Close/deactivate demand |
| `/vehicle-demands/:id/matches` | GET | List matches for a demand |
| `/vehicle-demands/:id/recontacts` | GET | List recontact history |
| `/vehicle-demands/scan` | POST | Manual matching scan |
| `/vehicle-demands/cache/reset` | POST | Clear vehicle source cache |
| `/vehicle-demands/recontact/run` | POST | Manual recontact job |

### Panel Endpoints (Frontend Proxy)
Base: `/bot` (requires user authentication)

Routes proxy to backend admin endpoints:
- `GET /bot/demands` → `GET /admin/vehicle-demands`
- `POST /bot/demands` → `POST /admin/vehicle-demands`
- `PUT /bot/demands/:id` → `PUT /admin/vehicle-demands/:id`
- `POST /bot/demands/:id/close` → `POST /admin/vehicle-demands/:id/close`
- `GET /bot/demands/:id/matches` → `GET /admin/vehicle-demands/:id/matches`
- `GET /bot/demands/:id/recontacts` → `GET /admin/vehicle-demands/:id/recontacts`
- `POST /bot/demands/scan` → `POST /admin/vehicle-demands/scan`
- `POST /bot/demands/recontact/run` → `POST /admin/vehicle-demands/recontact/run`

### Scan Endpoint Query Parameters
```
POST /admin/vehicle-demands/scan
{
  "sinceMinutes": number,  // Default: 60 (scan vehicles updated in last hour)
  "threshold": number      // Default: 0.38 (must match threshold)
}
```

---

## 7. COMMON REASONS FOR NO MATCHES

### 1. **Vehicle Status Filter**
Most common: vehicles have `status = 'sold'`, `'archived'`, `'deleted'`, `'inactive'`, or `'paused'`
- Check: `SELECT COUNT(*) FROM vehicles WHERE status IN ('sold', 'archived', ...)` 
- Fix: Set status to NULL or active value

### 2. **Threshold Too High**
If using custom threshold > 0.58, many demands won't match
- Default (0.38) allows: generic demands, text-only matches
- Higher (0.58+): requires explicit brand/model fields
- Fix: Reduce threshold via API or change default

### 3. **Vehicle Source Not Detected**
The system couldn't find a vehicles table
- Check endpoint: `GET /admin/catalog-debug` → `demands.vehicleSourceTable`
- Fix: Call `POST /admin/vehicle-demands/cache/reset` to re-detect

### 4. **Missing Vehicle Pool Connection**
When using Supabase, demands.ts falls back to Railway if connection fails
- Check: `demands.vehiclePoolIsSameAsMainPool === false` in debug output
- Check logs: Look for "vehiclePool query failed" warnings
- Fix: Ensure `env.supabaseDatabaseUrl` is set, OR sync Supabase → Railway

### 5. **Demand Context Extraction Fails**
Complex/ambiguous natural language doesn't extract properly
- Example: "un auto como Hilux" may not extract model=Hilux
- Fix: Provide explicit demand fields (brand, model, year, maxPrice)

### 6. **Text Similarity Too Low**
For natural-language demands without explicit fields:
- Vehicle title: "Fiat Uno 2020 Gasolina"
- Demand: "necesito auto simple"
- Similarity tokens may not overlap enough
- Fix: Use explicit brand/model fields or lower threshold

### 7. **Price Mismatch**
Vehicle price > demand maxPrice by > 10%
- Soft penalty: -0.03 to -0.10 score
- Demand will match if other components score high
- Hard filter: None (price is only soft constraint)

### 8. **Recent Scan Not Run**
Matches computed by scheduled job, not on-demand
- Default: Runs on schedule (check your cron/job config)
- Manual: POST `/admin/vehicle-demands/scan` with `sinceMinutes` param
- Check: `lastGoodVehicleScanAt` in debug output

### 9. **Recontact Settings Issue**
Demand created with `notifyOnMatch=false` or `notifyMinScore > 0.72`
- Notifications require: `notifyOnMatch=true`, `score >= notifyMinScore`, `lastNotifiedAt` outside cooldown
- Fix: Update demand with `PATCH /admin/vehicle-demands/:id`

---

## 8. FIELD EXTRACTION & INFERENCE

### Extract from Demand Query Text
Using `/services/extract.ts`:
- `brand`, `model`, `transmission`, `minYear`, `maxYear`, `fuel`, `bodywork`, `gnc`, `amount` (price)

### Infer Fuel from Vehicle
```typescript
function inferVehicleFuel(vehicle): string {
  const txt = norm(`${vehicle.fuel} ${vehicle.title}`);
  if (txt.includes('gnc')) return 'gnc';
  if (txt.includes('diesel')) return 'diesel';
  if (txt.includes('nafta')) return 'nafta';
  if (txt.includes('hibrido')) return 'hibrido';
  if (txt.includes('electr') || /\bev\b/.test(txt)) return 'electrico';
  return '';
}
```

### Infer Bodywork from Vehicle
```typescript
function inferVehicleBodywork(vehicle): string {
  const txt = norm(`${vehicle.title} ${vehicle.brand} ${vehicle.model}`);
  if (/\b(suv|crossover|todoterreno|4x4|awd|4wd)\b/.test(txt)) return 'suv';
  if (/\b(pickup|pick up|doble cabina)\b/.test(txt)) return 'pickup';
  if (/\b(sedan|4 puertas)\b/.test(txt)) return 'sedan';
  if (/\b(hatch|hatchback|3 puertas)\b/.test(txt)) return 'hatch';
  if (/\b(furgon|utilitario)\b/.test(txt)) return 'furgon';
  return '';
}
```

---

## 9. NOTIFICATION & RECONTACT FLOW

### Notification Conditions
```typescript
if (d.notifyOnMatch && d.remoteJid && d.instance && match.score >= notifyMinScore && !alreadyNotified) {
  // Send if cooldown passed
  const last = d.lastNotifiedAt ? new Date(d.lastNotifiedAt) : 0;
  const cooldownMs = d.notifyCooldownMin * 60_000;
  if (!last || Date.now() - last >= cooldownMs) {
    // Send top 3 matches
    await sendTextAndPersist(...);
    await pool.query('UPDATE vehicle_demands SET last_notified_at = NOW()');
  }
}
```

### Recontact Conditions
```sql
SELECT * FROM vehicle_demands
WHERE status = 'open'
  AND recontact_enabled = true
  AND remote_jid IS NOT NULL
  AND instance IS NOT NULL
  AND recontact_next_at IS NOT NULL
  AND recontact_count < recontact_max
  AND recontact_next_at <= NOW()
ORDER BY recontact_next_at ASC
LIMIT 50;
```

### Default Values
- `notifyMinScore`: 0.58 (58% match to notify)
- `notifyCooldownMin`: 240 (don't spam; wait 4 hours between notifications)
- `recontactEveryDays`: 7
- `recontactMax`: 3 (max 3 recontact attempts)

---

## 10. KEY FILES REFERENCE

| File | Purpose |
|------|---------|
| `/apps/bot/src/services/demands.ts` | Core matching algorithm, DB operations |
| `/apps/bot/src/services/catalog.ts` | Catalog loading & search (used by bot conversations) |
| `/apps/bot/src/routes/admin.ts` | Admin API endpoints |
| `/apps/bot/sql/006_vehicle_demands.sql` | Initial schema |
| `/apps/bot/sql/007_vehicle_demands_v2.sql` | Schema v2 (notifications, recontact) |
| `/apps/panel-whaticket/backend/src/routes/botDemandsRoutes.ts` | Panel proxy routes |
| `/apps/panel-whaticket/frontend/src/services/demands.js` | Frontend API wrapper |

---

## 11. QUICK DEBUGGING CHECKLIST

```bash
# 1. Check vehicle source detected
GET /admin/catalog-debug → demands.vehicleSourceTable

# 2. Check vehicle status filter
SELECT COUNT(*) FROM vehicles;
SELECT COUNT(*) FROM vehicles 
  WHERE status NOT IN ('sold', 'archived', 'deleted', 'inactive', 'paused');

# 3. Check demands exist
SELECT * FROM vehicle_demands WHERE status = 'open';

# 4. Run manual scan with lower threshold
POST /admin/vehicle-demands/scan
{ "sinceMinutes": 60, "threshold": 0.25 }

# 5. Check match results
SELECT * FROM vehicle_demand_matches 
  WHERE demand_id = :id 
  ORDER BY score DESC;

# 6. Check notification settings
SELECT notify_on_match, notify_min_score, last_notified_at 
  FROM vehicle_demands WHERE id = :id;

# 7. Reset vehicle cache if stuck
POST /admin/vehicle-demands/cache/reset

# 8. Check supabase pool (if using)
GET /admin/catalog-debug → demands.vehiclePoolIsSameAsMainPool
```

---

## Summary

The matching system is sophisticated with **8 scoring components** (brand, model, text, year, price, transmission, fuel, bodywork), **configurable threshold (default 0.38)**, **automatic synonym expansion**, and **smart status filtering**. The most common cause of no matches is **vehicle status values being one of**: sold, archived, deleted, inactive, paused. The second most common is **threshold too high** or **insufficient vehicle coverage**.

