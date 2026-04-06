/**
 * exchangeRate.ts — Tipo de cambio dinámico USD→ARS
 *
 * Fuente primaria: dolarapi.com/v1/dolares/blue
 * Cache en memoria: 10 minutos
 * Timeout de request: 3 segundos
 * Fallback: USD_ARS_FALLBACK env → 1200 (conservador)
 *
 * Función principal: getUsdToArs()
 * El bot nunca se bloquea si la API falla.
 */

import fetch from 'node-fetch';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ExchangeRateSource = 'live' | 'cache' | 'fallback';

export interface ExchangeRateResult {
  rate: number;
  source: ExchangeRateSource;
  timestamp: string;
}

interface DolarApiResponse {
  casa: string;
  nombre: string;
  compra: number;
  venta: number;
  moneda: string;
  fechaActualizacion: string;
}

// ─── Cache en memoria ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const REQUEST_TIMEOUT_MS = 3000;      // 3 segundos
const API_URL = 'https://dolarapi.com/v1/dolares/blue';

let _cachedRate: number | null = null;
let _cachedAt: number = 0;
let _cachedTimestamp: string = '';

function isCacheValid(): boolean {
  return _cachedRate !== null && Date.now() - _cachedAt < CACHE_TTL_MS;
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function getFallbackRate(): number {
  const envVal = process.env.USD_ARS_FALLBACK;
  if (envVal) {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1200; // valor conservador seguro
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Obtiene el tipo de cambio USD→ARS (dólar blue, precio venta).
 * Nunca lanza excepción — siempre devuelve un valor usable.
 */
export async function getUsdToArs(): Promise<ExchangeRateResult> {
  const now = new Date().toISOString();

  // Servir desde cache si está vigente
  if (isCacheValid()) {
    return {
      rate: _cachedRate!,
      source: 'cache',
      timestamp: _cachedTimestamp,
    };
  }

  // Intentar obtener valor live
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(API_URL, {
        signal: controller.signal as any,
        headers: { Accept: 'application/json' },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[exchangeRate] API error ${res.status}: ${body.slice(0, 100)}. Usando fallback.`);
      const fallback = getFallbackRate();
      console.info(`[exchangeRate] source=fallback rate=${fallback}`);
      return { rate: fallback, source: 'fallback', timestamp: now };
    }

    const data = (await res.json()) as DolarApiResponse;
    const rate = Number(data?.venta);

    if (!Number.isFinite(rate) || rate <= 0) {
      console.warn(`[exchangeRate] Respuesta inválida de API: venta=${data?.venta}. Usando fallback.`);
      const fallback = getFallbackRate();
      console.info(`[exchangeRate] source=fallback rate=${fallback}`);
      return { rate: fallback, source: 'fallback', timestamp: now };
    }

    // Actualizar cache
    _cachedRate = rate;
    _cachedAt = Date.now();
    _cachedTimestamp = data.fechaActualizacion ?? now;

    console.info(`[exchangeRate] source=live rate=${rate} actualizado=${_cachedTimestamp}`);
    return { rate, source: 'live', timestamp: _cachedTimestamp };

  } catch (err: any) {
    const isAbort = err?.name === 'AbortError' || String(err?.name).includes('Abort');
    if (isAbort) {
      console.warn(`[exchangeRate] Timeout (>${REQUEST_TIMEOUT_MS}ms). Usando fallback.`);
    } else {
      console.warn(`[exchangeRate] Error de red: ${String(err?.message ?? err).slice(0, 100)}. Usando fallback.`);
    }
    const fallback = getFallbackRate();
    console.info(`[exchangeRate] source=fallback rate=${fallback}`);
    return { rate: fallback, source: 'fallback', timestamp: now };
  }
}

/**
 * Invalida el cache manualmente (útil en tests o actualización forzada).
 */
export function invalidateExchangeRateCache(): void {
  _cachedRate = null;
  _cachedAt = 0;
  _cachedTimestamp = '';
}
