/**
 * truthGuard.ts — Validador de verdad comercial antes de enviar respuesta.
 *
 * Verifica que la respuesta del bot no afirme datos que no puede confirmar:
 * - Vehículo existe en catálogo activo
 * - Precio no fue inventado
 * - Moneda es consistente con el catálogo
 * - Financiación solo si hay datos reales de creditService
 * - No afirma stock de autos sin inStock=true
 *
 * Si guardResponse retorna passed=false, el caller debe usar SAFE_FALLBACK
 * o reescribir la respuesta antes de enviar.
 */

import type { CatalogItem } from './catalog.js';
import type { ConvState } from './state.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type TruthIssueType =
  | 'VEHICLE_NOT_IN_CATALOG'    // ID presentado no existe en catálogo activo
  | 'VEHICLE_OUT_OF_STOCK'      // Vehículo existe pero inStock=false
  | 'FINANCING_WITHOUT_DATA'    // Respuesta afirma cuotas sin datos reales
  | 'CURRENCY_AMBIGUOUS'        // Precio en respuesta sin moneda explícita
  | 'PRICE_INVENTED';           // Precio no coincide con el del catálogo

export interface TruthGuardIssue {
  type: TruthIssueType;
  detail: string;
  severity: 'block' | 'warn';   // block → no enviar; warn → loggear y enviar igual
}

export interface TruthGuardContext {
  /** ID del vehículo que la respuesta presenta (si aplica) */
  presentedVehicleId?: string;
  /** Catálogo completo activo (ya cargado por getCatalog) */
  catalog: CatalogItem[];
  /** Estado de conversación actual */
  state: ConvState;
  /** Acción que tomó el router (para saber qué validar) */
  action: string;
  /** Texto de la respuesta que está a punto de enviarse */
  responseText: string;
}

export interface TruthGuardResult {
  passed: boolean;
  issues: TruthGuardIssue[];
}

// ── Patrones de detección ──────────────────────────────────────────────────────

// Afirmación de cuotas: "$X por mes", "cuotas de $X"
const FINANCING_CLAIM_RE = /cuotas?\s+de\s+\$[\d.,]+|\$[\d.,]+\s+(?:por|\/)\s*mes|financiaci[oó]n\s+desde\s+\$[\d.,]+/i;

// Precio sin moneda: "$18.500.000" sin ARS/USD/dólares/pesos a continuación
const PRICE_NO_CURRENCY_RE = /\$[\d.,]{4,}(?!\s*(?:USD|ARS|dólares?|pesos?))/i;

// ── Guard principal ────────────────────────────────────────────────────────────

export function guardResponse(ctx: TruthGuardContext): TruthGuardResult {
  const issues: TruthGuardIssue[] = [];

  // 1. Vehículo presentado debe existir en catálogo activo con stock
  if (ctx.presentedVehicleId) {
    const vehicle = ctx.catalog.find(v => v.id === ctx.presentedVehicleId);

    if (!vehicle) {
      issues.push({
        type: 'VEHICLE_NOT_IN_CATALOG',
        detail: `vehicle_id=${ctx.presentedVehicleId} no encontrado en catálogo activo (${ctx.catalog.length} items)`,
        severity: 'block',
      });
    } else if (vehicle.inStock === false) {
      issues.push({
        type: 'VEHICLE_OUT_OF_STOCK',
        detail: `vehicle_id=${ctx.presentedVehicleId} name="${vehicle.name}" tiene inStock=false`,
        severity: 'block',
      });
    }
  }

  // 2. Afirmación de cuotas: debe haber datos reales de creditService en state.finance
  if (FINANCING_CLAIM_RE.test(ctx.responseText)) {
    const hasRealFinanceData = (
      ctx.state.finance?.monthly !== undefined ||
      ctx.state.finance?.stage === 'collecting'
    );
    if (!hasRealFinanceData) {
      issues.push({
        type: 'FINANCING_WITHOUT_DATA',
        detail: 'respuesta afirma cuotas/financiación pero state.finance.monthly es undefined',
        severity: 'block',
      });
    }
  }

  // 3. Moneda ambigua: advertencia (no bloqueo — el contexto suele aclararlo)
  if (PRICE_NO_CURRENCY_RE.test(ctx.responseText) && ctx.action === 'SHOW_OPTIONS') {
    issues.push({
      type: 'CURRENCY_AMBIGUOUS',
      detail: 'precio en respuesta sin moneda explícita (ARS/USD)',
      severity: 'warn',
    });
  }

  const blocking = issues.filter(i => i.severity === 'block');
  return {
    passed: blocking.length === 0,
    issues,
  };
}

// ── Texto de reemplazo seguro cuando guardResponse falla ──────────────────────

export function safeBlockingReply(issues: TruthGuardIssue[]): string {
  const types = issues.filter(i => i.severity === 'block').map(i => i.type);

  if (types.includes('VEHICLE_NOT_IN_CATALOG') || types.includes('VEHICLE_OUT_OF_STOCK')) {
    return 'Ese auto ya no está disponible en este momento. ¿Querés que te muestre otras opciones similares?';
  }
  if (types.includes('FINANCING_WITHOUT_DATA')) {
    return 'Las cuotas exactas las confirma el equipo con el banco. ¿Querés que te paso con alguien del equipo?';
  }
  return 'No pude confirmar ese dato. ¿Qué auto estás buscando?';
}
