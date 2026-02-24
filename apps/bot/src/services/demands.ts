import { pool } from './db.js';
import { env } from '../lib/env.js';
import { evolutionSendText } from './evolution.js';

export type DemandStatus = 'open' | 'closed';

export type VehicleDemand = {
  id: number;
  status: DemandStatus;
  query: string;
  brand?: string | null;
  model?: string | null;
  transmission?: string | null;
  minYear?: number | null;
  maxYear?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  instance?: string | null;
  remoteJid?: string | null;
  contactName?: string | null;
  phone?: string | null;

  notifyOnMatch: boolean;
  notifyMinScore: number;
  notifyCooldownMin: number;
  lastNotifiedAt?: string | null;
  matchTemplate?: string | null;

  recontactEnabled: boolean;
  recontactEveryDays: number;
  recontactNextAt?: string | null;
  recontactCount: number;
  recontactMax: number;
  recontactTemplate?: string | null;

  createdAt: string;
  updatedAt: string;
};

export type DemandMatch = {
  id: number;
  demandId: number;
  vehicleId: string;
  score: number;
  reasons?: any;
  createdAt: string;
  notifiedAt?: string | null;
  vehicle?: any;
};

function norm(s: any) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s: string) {
  const toks = norm(s).split(' ').filter(Boolean);
  return new Set(toks);
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function mapDemandRow(row: any): VehicleDemand {
  return {
    id: Number(row.id),
    status: row.status,
    query: row.query,
    brand: row.brand,
    model: row.model,
    transmission: row.transmission,
    minYear: row.min_year,
    maxYear: row.max_year,
    maxPrice: row.max_price,
    currency: row.currency,
    instance: row.instance,
    remoteJid: row.remote_jid,
    contactName: row.contact_name,
    phone: row.phone,

    notifyOnMatch: Boolean(row.notify_on_match),
    notifyMinScore: Number(row.notify_min_score ?? 0.72),
    notifyCooldownMin: Number(row.notify_cooldown_min ?? 240),
    lastNotifiedAt: row.last_notified_at ? row.last_notified_at.toISOString?.() ?? String(row.last_notified_at) : null,
    matchTemplate: row.match_template ?? null,

    recontactEnabled: Boolean(row.recontact_enabled),
    recontactEveryDays: Number(row.recontact_every_days ?? 7),
    recontactNextAt: row.recontact_next_at ? row.recontact_next_at.toISOString?.() ?? String(row.recontact_next_at) : null,
    recontactCount: Number(row.recontact_count ?? 0),
    recontactMax: Number(row.recontact_max ?? 5),
    recontactTemplate: row.recontact_template ?? null,

    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at)
  };
}

export async function createVehicleDemand(input: any): Promise<VehicleDemand> {
  const instance = String(input.instance ?? env.instanceName ?? '').trim() || env.instanceName;
  const remoteJid = input.remoteJid ? String(input.remoteJid).trim() : null;
  const contactName = typeof input.contactName === 'string' ? input.contactName.trim() : null;
  const phone = typeof input.phone === 'string' ? input.phone.trim() : null;

  const query = String(input.query ?? '').trim();
  const brand = input.brand ? String(input.brand).trim() : null;
  const model = input.model ? String(input.model).trim() : null;
  const transmission = input.transmission ? String(input.transmission).trim() : null;

  const year = input.year !== undefined && input.year !== null ? Number(input.year) : undefined;
  const minYear = input.minYear !== undefined && input.minYear !== null ? Number(input.minYear) : year;
  const maxYear = input.maxYear !== undefined && input.maxYear !== null ? Number(input.maxYear) : year;
  const maxPrice = input.maxPrice !== undefined && input.maxPrice !== null ? Number(input.maxPrice) : null;
  const currency = input.currency ? String(input.currency).trim().toUpperCase() : null;

  const notifyOnMatch = input.notifyOnMatch !== undefined ? Boolean(input.notifyOnMatch) : true;
  const notifyMinScore = Number.isFinite(Number(input.notifyMinScore)) ? Number(input.notifyMinScore) : 0.72;
  const notifyCooldownMin = Number.isFinite(Number(input.notifyCooldownMin)) ? Number(input.notifyCooldownMin) : 240;
  const matchTemplate = typeof input.matchTemplate === 'string' ? input.matchTemplate : null;

  const recontactEnabled = input.recontactEnabled !== undefined ? Boolean(input.recontactEnabled) : false;
  const recontactEveryDays = Number.isFinite(Number(input.recontactEveryDays)) ? Number(input.recontactEveryDays) : 7;
  const recontactMax = Number.isFinite(Number(input.recontactMax)) ? Number(input.recontactMax) : 5;
  const recontactTemplate = typeof input.recontactTemplate === 'string' ? input.recontactTemplate : null;

  const recontactNextAt = recontactEnabled
    ? new Date(Date.now() + Math.max(1, recontactEveryDays) * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const sql = `
    insert into vehicle_demands (
      status, query, brand, model, transmission, min_year, max_year, max_price, currency,
      instance, remote_jid, contact_name, phone,
      notify_on_match, notify_min_score, notify_cooldown_min, match_template,
      recontact_enabled, recontact_every_days, recontact_next_at, recontact_max, recontact_template
    ) values (
      'open', $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15, $16,
      $17, $18, $19, $20, $21
    )
    returning *
  `;

  const params = [
    query,
    brand,
    model,
    transmission,
    Number.isFinite(minYear as any) ? minYear : null,
    Number.isFinite(maxYear as any) ? maxYear : null,
    maxPrice,
    currency,
    instance,
    remoteJid,
    contactName,
    phone,
    notifyOnMatch,
    notifyMinScore,
    notifyCooldownMin,
    matchTemplate,
    recontactEnabled,
    recontactEveryDays,
    recontactNextAt,
    recontactMax,
    recontactTemplate
  ];

  const r = await pool.query(sql, params);
  return mapDemandRow(r.rows[0]);
}

export async function updateVehicleDemand(id: number, patch: any): Promise<VehicleDemand> {
  const fields: string[] = [];
  const values: any[] = [];
  const set = (col: string, v: any) => {
    values.push(v);
    fields.push(`${col} = $${values.length}`);
  };

  if (patch.status) set('status', String(patch.status));
  if (patch.query !== undefined) set('query', String(patch.query ?? '').trim());
  if (patch.brand !== undefined) set('brand', patch.brand ? String(patch.brand).trim() : null);
  if (patch.model !== undefined) set('model', patch.model ? String(patch.model).trim() : null);
  if (patch.transmission !== undefined) set('transmission', patch.transmission ? String(patch.transmission).trim() : null);
  if (patch.minYear !== undefined) set('min_year', patch.minYear !== null ? Number(patch.minYear) : null);
  if (patch.maxYear !== undefined) set('max_year', patch.maxYear !== null ? Number(patch.maxYear) : null);
  if (patch.maxPrice !== undefined) set('max_price', patch.maxPrice !== null ? Number(patch.maxPrice) : null);
  if (patch.currency !== undefined) set('currency', patch.currency ? String(patch.currency).toUpperCase() : null);
  if (patch.instance !== undefined) set('instance', patch.instance ? String(patch.instance).trim() : env.instanceName);
  if (patch.remoteJid !== undefined) set('remote_jid', patch.remoteJid ? String(patch.remoteJid).trim() : null);
  if (patch.contactName !== undefined) set('contact_name', patch.contactName ? String(patch.contactName).trim() : null);
  if (patch.phone !== undefined) set('phone', patch.phone ? String(patch.phone).trim() : null);

  if (patch.notifyOnMatch !== undefined) set('notify_on_match', Boolean(patch.notifyOnMatch));
  if (patch.notifyMinScore !== undefined) set('notify_min_score', Number(patch.notifyMinScore));
  if (patch.notifyCooldownMin !== undefined) set('notify_cooldown_min', Number(patch.notifyCooldownMin));
  if (patch.matchTemplate !== undefined) set('match_template', patch.matchTemplate ? String(patch.matchTemplate) : null);

  if (patch.recontactEnabled !== undefined) set('recontact_enabled', Boolean(patch.recontactEnabled));
  if (patch.recontactEveryDays !== undefined) set('recontact_every_days', Number(patch.recontactEveryDays));
  if (patch.recontactMax !== undefined) set('recontact_max', Number(patch.recontactMax));
  if (patch.recontactTemplate !== undefined) set('recontact_template', patch.recontactTemplate ? String(patch.recontactTemplate) : null);

  if (patch.recontactEnabled === true && patch.recontactNextAt === undefined) {
    const every = Number.isFinite(Number(patch.recontactEveryDays)) ? Number(patch.recontactEveryDays) : 7;
    set('recontact_next_at', new Date(Date.now() + Math.max(1, every) * 24 * 60 * 60 * 1000).toISOString());
  }
  if (patch.recontactNextAt !== undefined) set('recontact_next_at', patch.recontactNextAt);

  if (!fields.length) {
    const cur = await pool.query('select * from vehicle_demands where id = $1', [id]);
    return mapDemandRow(cur.rows[0]);
  }

  values.push(id);
  const sql = `update vehicle_demands set ${fields.join(', ')}, updated_at = now() where id = $${values.length} returning *`;
  const r = await pool.query(sql, values);
  return mapDemandRow(r.rows[0]);
}

export async function closeVehicleDemand(id: number) {
  await pool.query(`update vehicle_demands set status='closed', updated_at=now() where id=$1`, [id]);
}

export async function listVehicleDemands(params: { status?: DemandStatus; limit?: number }) {
  const status = params.status ?? 'open';
  const limit = Math.max(1, Math.min(500, Number(params.limit ?? 100)));
  const r = await pool.query(
    `select * from vehicle_demands where status = $1 order by updated_at desc limit $2`,
    [status, limit]
  );
  return r.rows.map(mapDemandRow);
}

export async function listDemandMatches(demandId: number, limit = 20) {
  const lim = Math.max(1, Math.min(100, Number(limit)));
  const r = await pool.query(
    `
    select m.*, v.title, v.brand, v.model, v.year, v.price, v.currency, v.slug, v.pictures, v.permalink
    from vehicle_demand_matches m
    left join public.vehicles v on v.id::text = m.vehicle_id
    where m.demand_id = $1
    order by m.score desc, m.created_at desc
    limit $2
    `,
    [demandId, lim]
  );
  return r.rows.map((row: any) => {
    const vehicle = row.vehicle_id
      ? {
          id: String(row.vehicle_id),
          title: row.title,
          brand: row.brand,
          model: row.model,
          year: row.year,
          price: row.price,
          currency: row.currency,
          slug: row.slug,
          pictures: row.pictures,
          permalink: row.permalink
        }
      : null;
    return {
      id: Number(row.id),
      demandId: Number(row.demand_id),
      vehicleId: String(row.vehicle_id),
      score: Number(row.score),
      reasons: row.reasons,
      createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
      notifiedAt: row.notified_at?.toISOString?.() ?? (row.notified_at ? String(row.notified_at) : null),
      vehicle
    } as DemandMatch;
  });
}

function buildMatchMessage(demand: VehicleDemand, vehicle: any, score: number) {
  const name = demand.contactName ? ` ${demand.contactName}` : '';
  const title = String(vehicle?.title || `${vehicle?.brand || ''} ${vehicle?.model || ''}`.trim() || 'Auto').trim();
  const year = vehicle?.year ? String(vehicle.year) : '';
  const price = vehicle?.price ? String(vehicle.price) : '';
  const currency = vehicle?.currency ? String(vehicle.currency) : '';
  const url = vehicle?.permalink
    ? String(vehicle.permalink)
    : env.publicUrl && vehicle?.slug
      ? `${env.publicUrl.replace(/\/$/, '')}/autos/${vehicle.slug}`
      : '';

  const fallback =
    `Hola${name}! 👋\n` +
    `Entró una opción que puede encajar con lo que buscabas (${demand.query}).\n\n` +
    `• ${title}${year ? ' ' + year : ''}\n` +
    (price ? `• Precio: ${currency ? currency + ' ' : ''}${price}\n` : '') +
    `• Coincidencia: ${Math.round(score * 100)}%\n` +
    (url ? `\nVer: ${url}` : '');

  const tpl = (demand.matchTemplate ?? '').trim();
  if (!tpl) return fallback;

  return tpl
    .replaceAll('{name}', demand.contactName ?? '')
    .replaceAll('{query}', demand.query)
    .replaceAll('{title}', title)
    .replaceAll('{year}', year)
    .replaceAll('{price}', price)
    .replaceAll('{currency}', currency)
    .replaceAll('{score}', String(Math.round(score * 100)))
    .replaceAll('{url}', url);
}

export async function scanRecentVehiclesForDemandMatches(params: { since: Date; threshold: number }) {
  const threshold = clamp01(Number(params.threshold ?? 0.62));
  const since = params.since;

  const demandsR = await pool.query(`select * from vehicle_demands where status='open'`);
  const demands = demandsR.rows.map(mapDemandRow);

  const vehiclesR = await pool.query(
    `select id, title, brand, model, year, price, currency, slug, permalink, pictures from public.vehicles where updated_at >= $1 order by updated_at desc limit 500`,
    [since]
  );
  const vehicles = vehiclesR.rows;

  let matchesInserted = 0;
  let notificationsSent = 0;

  const vTok = new Map<string, Set<string>>();
  for (const v of vehicles) {
    const txt = `${v.title ?? ''} ${v.brand ?? ''} ${v.model ?? ''}`;
    vTok.set(String(v.id), tokenSet(txt));
  }

  for (const d of demands) {
    const demandText = `${d.query} ${d.brand ?? ''} ${d.model ?? ''}`;
    const dSet = tokenSet(demandText);

    for (const v of vehicles) {
      const reasons: any = {};
      let score = 0;

      if (d.brand && v.brand && norm(d.brand) === norm(v.brand)) {
        score += 0.22;
        reasons.brand = true;
      }

      const sim = jaccard(dSet, vTok.get(String(v.id)) ?? new Set());
      score += sim * 0.55;
      reasons.text = sim;

      const vy = v.year ? Number(v.year) : null;
      if (vy && (d.minYear || d.maxYear)) {
        const minY = d.minYear ?? d.maxYear ?? vy;
        const maxY = d.maxYear ?? d.minYear ?? vy;
        let yScore = 0;
        if (vy >= minY && vy <= maxY) yScore = 1;
        else {
          const dist = Math.min(Math.abs(vy - minY), Math.abs(vy - maxY));
          if (dist === 1) yScore = 0.75;
          else if (dist === 2) yScore = 0.55;
          else if (dist === 3) yScore = 0.35;
          else yScore = 0;
        }
        score += yScore * 0.18;
        reasons.year = { vy, minY, maxY, yScore };
      }

      if (d.maxPrice && v.price) {
        const vp = Number(v.price);
        if (Number.isFinite(vp)) {
          if (vp <= d.maxPrice) {
            score += 0.05;
            reasons.priceOk = true;
          } else {
            const over = (vp - d.maxPrice) / d.maxPrice;
            score -= Math.min(0.08, over * 0.08);
            reasons.priceOver = over;
          }
        }
      }

      if (d.transmission && v.title) {
        const t = norm(d.transmission);
        const tt = norm(v.title);
        if (t && tt.includes(t)) {
          score += 0.05;
          reasons.transmission = true;
        }
      }

      score = clamp01(score);
      if (score < threshold) continue;

      const ins = await pool.query(
        `
          insert into vehicle_demand_matches (demand_id, vehicle_id, score, reasons)
          values ($1, $2, $3, $4)
          on conflict (demand_id, vehicle_id)
          do update set score = greatest(vehicle_demand_matches.score, excluded.score), reasons = excluded.reasons
          returning id, notified_at
        `,
        [d.id, String(v.id), score, reasons]
      );
      matchesInserted += 1;
      const matchRow = ins.rows[0];
      const alreadyNotified = !!matchRow?.notified_at;

      if (
        d.notifyOnMatch &&
        d.remoteJid &&
        d.instance &&
        score >= clamp01(d.notifyMinScore) &&
        !alreadyNotified
      ) {
        const last = d.lastNotifiedAt ? new Date(d.lastNotifiedAt).getTime() : 0;
        const cooldownMs = Math.max(0, d.notifyCooldownMin) * 60_000;
        if (!last || Date.now() - last >= cooldownMs) {
          try {
            const number = String(d.remoteJid).split('@')[0];
            const msg = buildMatchMessage(d, v, score);
            await evolutionSendText(d.instance, number, msg);
            notificationsSent += 1;
            await pool.query(`update vehicle_demand_matches set notified_at = now() where id = $1`, [matchRow.id]);
            await pool.query(`update vehicle_demands set last_notified_at = now(), updated_at=now() where id = $1`, [d.id]);
            d.lastNotifiedAt = new Date().toISOString();
          } catch (e) {
            console.error('Demand notify failed', e);
          }
        }
      }
    }
  }

  return { vehicles: vehicles.length, demands: demands.length, matches: matchesInserted, notificationsSent };
}

export async function runRecontactJob() {
  const limit = 50;
  const r = await pool.query(
    `
      select * from vehicle_demands
      where status='open'
        and recontact_enabled = true
        and remote_jid is not null
        and instance is not null
        and recontact_next_at is not null
        and (recontact_count < recontact_max)
        and recontact_next_at <= now()
      order by recontact_next_at asc
      limit $1
    `,
    [limit]
  );

  let sent = 0;
  for (const row of r.rows) {
    const d = mapDemandRow(row);
    try {
      const number = String(d.remoteJid!).split('@')[0];
      const tpl = (d.recontactTemplate ?? '').trim();
      const msg = tpl
        ? tpl
            .replaceAll('{name}', d.contactName ?? '')
            .replaceAll('{query}', d.query)
            .replaceAll('{count}', String(d.recontactCount + 1))
        : `Hola${d.contactName ? ' ' + d.contactName : ''}! 👋\nSigo atento por lo de: ${d.query}.\nSi querés, decime presupuesto y forma de pago así te filtro mejores opciones.`;

      await evolutionSendText(d.instance!, number, msg);
      sent += 1;

      const next = new Date(Date.now() + Math.max(1, d.recontactEveryDays) * 24 * 60 * 60 * 1000).toISOString();
      await pool.query(
        `
          update vehicle_demands
          set recontact_count = recontact_count + 1,
              recontact_next_at = $2,
              updated_at = now()
          where id = $1
        `,
        [d.id, next]
      );
    } catch (e) {
      console.error('Recontact failed', e);
    }
  }
  return { due: r.rows.length, sent };
}
