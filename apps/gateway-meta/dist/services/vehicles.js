import { pool } from './db.js';
import { env } from '../lib/env.js';
function coerceMoneyNumber(v) {
    if (v === undefined || v === null)
        return undefined;
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    const s = String(v).trim();
    if (!s)
        return undefined;
    const normalized = s
        .replace(/[^\d.,-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : undefined;
}
function cleanVehicleToken(value) {
    const text = String(value ?? '').trim();
    if (!text)
        return '';
    const normalized = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    if (['-', '—', '--', 's/d', 'sd', 'n/a', 'na', 'null', 'undefined', 'sin datos', 'a consultar'].includes(normalized)) {
        return '';
    }
    return text.replace(/\s+/g, ' ');
}
function normalizeVehicleCompare(value) {
    return cleanVehicleToken(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function compactVehicleParts(parts) {
    const seen = new Set();
    const out = [];
    for (const part of parts) {
        const value = cleanVehicleToken(part);
        const key = normalizeVehicleCompare(value);
        if (!value || !key || seen.has(key))
            continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}
export function formatPrice(price, currency) {
    const n = coerceMoneyNumber(price);
    if (n === undefined)
        return 'a consultar';
    const c = (currency ?? '').toUpperCase();
    const isUsd = c.includes('USD') || c.includes('U$') || c.includes('US');
    // es-AR formatting
    const formatted = new Intl.NumberFormat('es-AR', {
        maximumFractionDigits: 0
    }).format(Math.round(n));
    if (isUsd)
        return `USD ${formatted}`;
    if (c)
        return `${c} ${formatted}`;
    return `$ ${formatted}`;
}
export async function getVehicleById(vehicleId) {
    const q = `
    select id, title, brand, model, version, year, km, price, currency, slug, permalink
    from public.vehicles
    where id = $1
    ${env.catalogDealershipId ? 'and dealership_id = $2' : ''}
    limit 1
  `;
    const params = env.catalogDealershipId ? [vehicleId, env.catalogDealershipId] : [vehicleId];
    const { rows } = await pool.query(q, params);
    return rows[0] ?? null;
}
export async function getVehicleBySlug(slug) {
    const q = `
    select id, title, brand, model, version, year, km, price, currency, slug, permalink
    from public.vehicles
    where slug = $1
    ${env.catalogDealershipId ? 'and dealership_id = $2' : ''}
    limit 1
  `;
    const params = env.catalogDealershipId ? [slug, env.catalogDealershipId] : [slug];
    const { rows } = await pool.query(q, params);
    return rows[0] ?? null;
}
export function buildVehicleUrl(v) {
    if (v.permalink)
        return v.permalink;
    if (env.publicCatalogBaseUrl && v.slug) {
        return `${env.publicCatalogBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(v.slug)}`;
    }
    return undefined;
}
export function vehicleTitle(v) {
    const title = cleanVehicleToken(v.title);
    const brand = cleanVehicleToken(v.brand);
    const model = cleanVehicleToken(v.model);
    const version = cleanVehicleToken(v.version);
    const base = compactVehicleParts([brand, model]);
    const baseNorm = normalizeVehicleCompare(base.join(' '));
    const versionNorm = normalizeVehicleCompare(version);
    const extras = version && versionNorm && !baseNorm.includes(versionNorm) ? [version] : [];
    return compactVehicleParts([...base, ...extras]).join(' ').trim() || title || 'Vehículo';
}
//# sourceMappingURL=vehicles.js.map