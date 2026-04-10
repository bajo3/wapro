/**
 * creditService.ts — Crédito automotriz.
 *
 * Reglas de negocio:
 *  - saldo = precio_auto - entrega
 *  - monto_api = saldo + 200_000  (gastos admin internos — NO decirle al cliente)
 *  - el crédito no puede superar el 50% del valor total del auto
 *  - si supera el tope → informar y sugerir mayor entrega u otro vehículo
 *
 * API: https://api.cotizadorcreditcar.com.ar/2?monto=MONTO&modelo=ANIO
 */

export interface CreditInput {
  vehiclePrice: number;   // precio total del auto en ARS
  downPayment: number;    // entrega del cliente en ARS
  vehicleYear: number;    // año del vehículo (param "modelo" de la API)
}

export type CreditPlan = {
  cuotas: number;
  valorCuota: number;
  totalFinanciado: number;
};

export type CreditResult =
  | { ok: true;  plans: CreditPlan[]; montoFinanciado: number; rawApi: any }
  | { ok: false; reason: 'exceeds_50pct' | 'api_error' | 'invalid_input'; detail: string };

const API_ADMIN_FEE = 200_000;
const MAX_CREDIT_RATIO = 0.5;

export function validateCreditInput(input: CreditInput): string | null {
  if (input.vehiclePrice <= 0) return 'El precio del auto debe ser mayor a 0.';
  if (input.downPayment < 0)  return 'La entrega no puede ser negativa.';
  if (input.downPayment >= input.vehiclePrice) return 'La entrega cubre el precio total — no hace falta financiar.';
  if (input.vehicleYear < 2000 || input.vehicleYear > new Date().getFullYear() + 1)
    return 'Año de vehículo inválido.';
  return null;
}

export async function quoteCreditAPI(monto: number, anio: number): Promise<any> {
  const url = `https://api.cotizadorcreditcar.com.ar/2?monto=${Math.round(monto)}&modelo=${anio}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Credit API error ${res.status}`);
  return res.json();
}

function parsePlans(raw: any): CreditPlan[] {
  const plans: CreditPlan[] = [];

  // The API can return different shapes — handle both array and object with cuotas keys
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const cuotas = Number(item.cuotas ?? item.plazo ?? item.meses);
      const valorCuota = Number(item.valor_cuota ?? item.cuota ?? item.monto_cuota);
      const totalFinanciado = Number(item.total ?? item.monto_total ?? item.total_a_pagar ?? 0);
      if (cuotas > 0 && valorCuota > 0) plans.push({ cuotas, valorCuota, totalFinanciado });
    }
  } else if (raw && typeof raw === 'object') {
    // Some responses are { "12": { cuota: X, total: Y }, "24": { ... } }
    for (const [key, val] of Object.entries(raw)) {
      const cuotas = Number(key);
      if (!cuotas || typeof val !== 'object' || !val) continue;
      const v = val as any;
      const valorCuota = Number(v.cuota ?? v.valor_cuota ?? v.monto_cuota ?? 0);
      const totalFinanciado = Number(v.total ?? v.total_a_pagar ?? 0);
      if (cuotas > 0 && valorCuota > 0) plans.push({ cuotas, valorCuota, totalFinanciado });
    }
  }

  return plans.sort((a, b) => a.cuotas - b.cuotas);
}

export async function getCreditQuote(input: CreditInput): Promise<CreditResult> {
  const validationError = validateCreditInput(input);
  if (validationError) return { ok: false, reason: 'invalid_input', detail: validationError };

  const saldo = input.vehiclePrice - input.downPayment;
  const montoApi = saldo + API_ADMIN_FEE;
  const tope = input.vehiclePrice * MAX_CREDIT_RATIO;

  if (montoApi > tope) {
    return {
      ok: false,
      reason: 'exceeds_50pct',
      detail: `Con esa entrega el saldo a financiar supera el 50% del valor del auto. Tope: $${Math.round(tope).toLocaleString('es-AR')}. Saldo: $${Math.round(saldo).toLocaleString('es-AR')}.`
    };
  }

  try {
    const raw = await quoteCreditAPI(montoApi, input.vehicleYear);
    const plans = parsePlans(raw);

    if (plans.length === 0) {
      return { ok: false, reason: 'api_error', detail: 'La API no devolvió planes de cuotas válidos.' };
    }

    return { ok: true, plans, montoFinanciado: saldo, rawApi: raw };
  } catch (err: any) {
    console.error('[creditService] API error:', err?.message);
    return { ok: false, reason: 'api_error', detail: 'No se pudo consultar la API de crédito en este momento.' };
  }
}

/** Formatea cuotas de forma humana para el bot. */
export function formatCreditPlans(plans: CreditPlan[], montoFinanciado: number): string {
  const lines = [`💳 Financiando $${Math.round(montoFinanciado).toLocaleString('es-AR')}:\n`];
  for (const p of plans.slice(0, 4)) {
    lines.push(`• ${p.cuotas} cuotas de $${Math.round(p.valorCuota).toLocaleString('es-AR')}`);
  }
  return lines.join('\n');
}
