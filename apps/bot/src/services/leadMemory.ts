/**
 * leadMemory.ts — Memoria comercial persistente del lead v1
 *
 * Resuelve el problema central: el bot olvida todo cuando el contexto expira (30 min).
 * Este módulo lee el perfil del lead desde la DB y lo funde con la sesión activa,
 * garantizando continuidad comercial entre mensajes y recontactos.
 *
 * Exports:
 *  - loadLeadMemory()            — lee el perfil del lead de la DB (timeout 2s)
 *  - mergeMemoryIntoExtracted()  — funde datos de DB con el extracted de sesión
 *  - buildMemorySummaryBlock()   — bloque compacto para el system prompt
 *  - isRecontact()               — detecta si el cliente vuelve después de inactividad
 *  - extractShownVehicleIds()    — IDs de vehículos ya mostrados en la conversación
 *
 * PRINCIPIO: DB es el fallback. La sesión activa siempre tiene prioridad.
 * Si la sesión ya tiene un dato, la DB no lo pisa.
 */

import { pool } from './db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadMemory {
  instance: string;
  remoteJid: string;
  // Datos comerciales básicos
  preferredBrand?: string;
  preferredModel?: string;
  budgetMax?: number;
  budgetAmount?: number;
  currency?: string;
  yearMin?: number;
  yearMax?: number;
  yearExact?: number;
  transmission?: string;
  fuel?: string;
  bodywork?: string;
  hasTradeIn?: boolean;
  financingInterest?: boolean;
  useCase?: string;
  city?: string;
  color?: string;
  // Memoria comercial extendida (016_commercial_memory.sql)
  funnelStage?: string;
  mainObjection?: string;
  lastCtaOffered?: string;
  visitInterest?: boolean;
  shownVehicleIds?: string[];
  recontactCount?: number;
  // Meta
  leadScore?: number;
  leadTemperature?: string;
  lastIntent?: string;
  updatedAt?: Date;
}

// ─── Load ─────────────────────────────────────────────────────────────────────

/**
 * Carga el perfil comercial del lead desde la DB.
 * Timeout de 2 segundos para no bloquear el flujo si la DB está lenta.
 * Retorna null si no hay registro o si falla (nunca lanza).
 */
export async function loadLeadMemory(
  instance: string,
  remoteJid: string
): Promise<LeadMemory | null> {
  try {
    const result = await Promise.race([
      pool.query(
        `SELECT
          instance, remote_jid,
          preferred_brand, preferred_model,
          budget_max, budget_amount, currency,
          preferred_year_min, preferred_year_max, year_exact,
          transmission, fuel, bodywork,
          has_trade_in, financing_interest,
          use_case, city, color,
          funnel_stage, main_objection, last_cta_offered,
          visit_interest, shown_vehicle_ids, recontact_count,
          lead_score, lead_temperature, last_intent, updated_at
        FROM bot_lead_profiles
        WHERE instance = $1 AND remote_jid = $2
        LIMIT 1`,
        [instance, remoteJid]
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('leadMemory timeout')), 2000)
      ),
    ]);

    const row = (result as any).rows?.[0];
    if (!row) return null;

    return {
      instance: row.instance,
      remoteJid: row.remote_jid,
      preferredBrand: row.preferred_brand ?? undefined,
      preferredModel: row.preferred_model ?? undefined,
      budgetMax: row.budget_max !== null ? Number(row.budget_max) : undefined,
      budgetAmount: row.budget_amount !== null ? Number(row.budget_amount) : undefined,
      currency: row.currency ?? undefined,
      yearMin: row.preferred_year_min !== null ? Number(row.preferred_year_min) : undefined,
      yearMax: row.preferred_year_max !== null ? Number(row.preferred_year_max) : undefined,
      yearExact: row.year_exact !== null ? Number(row.year_exact) : undefined,
      transmission: row.transmission ?? undefined,
      fuel: row.fuel ?? undefined,
      bodywork: row.bodywork ?? undefined,
      hasTradeIn: row.has_trade_in ?? undefined,
      financingInterest: row.financing_interest ?? undefined,
      useCase: row.use_case ?? undefined,
      city: row.city ?? undefined,
      color: row.color ?? undefined,
      funnelStage: row.funnel_stage ?? undefined,
      mainObjection: row.main_objection ?? undefined,
      lastCtaOffered: row.last_cta_offered ?? undefined,
      visitInterest: row.visit_interest ?? undefined,
      shownVehicleIds: Array.isArray(row.shown_vehicle_ids) ? row.shown_vehicle_ids : undefined,
      recontactCount: row.recontact_count !== null ? Number(row.recontact_count) : 0,
      leadScore: row.lead_score !== null ? Number(row.lead_score) : undefined,
      leadTemperature: row.lead_temperature ?? undefined,
      lastIntent: row.last_intent ?? undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    };
  } catch (err) {
    // Best-effort — DB read nunca bloquea el flujo
    const msg = (err as Error).message;
    if (!msg.includes('timeout')) {
      // Solo loggear errores reales, no timeouts frecuentes
      console.warn('[leadMemory] load failed (non-blocking):', msg);
    }
    return null;
  }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Funde la memoria de la DB con el `extracted` de la sesión actual.
 *
 * REGLA: la sesión activa tiene prioridad. La DB solo completa campos vacíos.
 * Esto garantiza que datos nuevos del mensaje actual no sean pisados por datos viejos.
 */
export function mergeMemoryIntoExtracted(
  sessionExtracted: Record<string, any>,
  memory: LeadMemory | null
): Record<string, any> {
  if (!memory) return sessionExtracted;

  const merged: Record<string, any> = { ...sessionExtracted };

  // Completar solo lo que la sesión NO tiene
  if (!merged.brand && memory.preferredBrand) merged.brand = memory.preferredBrand;
  if (!merged.model && memory.preferredModel) merged.model = memory.preferredModel;
  if (!merged.maxPrice && memory.budgetMax) merged.maxPrice = memory.budgetMax;
  if (!merged.amount && memory.budgetAmount) merged.amount = memory.budgetAmount;
  if (!merged.currency && memory.currency) merged.currency = memory.currency;
  if (!merged.minYear && memory.yearMin) merged.minYear = memory.yearMin;
  if (!merged.maxYear && memory.yearMax) merged.maxYear = memory.yearMax;
  if (!merged.year && memory.yearExact) merged.year = memory.yearExact;
  if (!merged.transmission && memory.transmission) merged.transmission = memory.transmission;
  if (!merged.fuel && memory.fuel) merged.fuel = memory.fuel;
  if (!merged.bodywork && memory.bodywork) merged.bodywork = memory.bodywork;
  if (merged.hasTradeIn === undefined && memory.hasTradeIn !== undefined)
    merged.hasTradeIn = memory.hasTradeIn;
  if (merged.wantsFinancing === undefined && memory.financingInterest !== undefined)
    merged.wantsFinancing = memory.financingInterest;
  if (!merged.useCase && memory.useCase) merged.useCase = memory.useCase;
  if (!merged.city && memory.city) merged.city = memory.city;
  if (!merged.color && memory.color) merged.color = memory.color;

  return merged;
}

// ─── Recontact Detection ──────────────────────────────────────────────────────

/**
 * Determina si este mensaje es un recontacto — cliente que ya habló antes
 * pero cuyo contexto de sesión expiró o estaba vacío.
 *
 * Un recontacto requiere que:
 *  1. Haya memoria previa en la DB con al menos un dato comercial
 *  2. La sesión activa NO tenga ese contexto (contextExpired o primera vez en sesión)
 */
export function isRecontact(
  memory: LeadMemory | null,
  sessionHadContext: boolean
): boolean {
  if (!memory) return false;
  if (sessionHadContext) return false;
  return Boolean(
    memory.preferredBrand || memory.budgetMax || memory.budgetAmount || memory.useCase
  );
}

// ─── Shown Vehicle IDs ────────────────────────────────────────────────────────

/**
 * Extrae los IDs de vehículos ya mostrados en la conversación actual
 * leyendo el historial de mensajes del bot.
 *
 * Complementa los `shown_vehicle_ids` de la DB con los del turno actual.
 */
export function extractShownVehicleIdsFromHistory(
  history: Array<{ role: string; content: string }>
): string[] {
  const ids = new Set<string>();
  for (const msg of history) {
    if (msg.role !== 'assistant') continue;
    const matches = [...msg.content.matchAll(/\[id:(\w+)\]/g)];
    for (const m of matches) ids.add(m[1]);
  }
  return Array.from(ids);
}

/**
 * Combina IDs de vehículos de la DB con los del historial actual.
 * El resultado se usa para no repetir opciones al cliente.
 */
export function mergeShownVehicleIds(
  dbIds: string[] | undefined,
  historyIds: string[]
): string[] {
  const all = new Set([...(dbIds ?? []), ...historyIds]);
  return Array.from(all);
}

// ─── Memory Summary Block ─────────────────────────────────────────────────────

/**
 * Genera un bloque compacto de "memoria del lead" para inyectar en el system prompt.
 *
 * Se inyecta SOLO cuando hay datos relevantes que el agente no tiene en la sesión.
 * Si la sesión ya tiene todos los datos, no agrega ruido.
 *
 * Dos modos:
 *  - isRecontact=true  → el cliente vuelve después de inactividad. Saludo cálido.
 *  - isRecontact=false → continuación de sesión con datos de DB como refuerzo.
 */
export function buildMemorySummaryBlock(
  memory: LeadMemory | null,
  isRecontactFlag: boolean,
  options?: { skipIfEmpty?: boolean }
): string {
  if (!memory) return '';

  const known: string[] = [];

  if (memory.preferredBrand) known.push(`marca de interés: ${memory.preferredBrand}`);
  if (memory.preferredModel) known.push(`modelo de interés: ${memory.preferredModel}`);
  const budgetAmt = memory.budgetMax ?? memory.budgetAmount;
  if (budgetAmt) {
    const cur = memory.currency ?? 'ARS';
    known.push(`presupuesto confirmado: ${cur} ${Number(budgetAmt).toLocaleString('es-AR')}`);
  }
  if (memory.useCase) known.push(`uso: ${memory.useCase}`);
  if (memory.transmission) known.push(`caja: ${memory.transmission}`);
  if (memory.fuel) known.push(`combustible: ${memory.fuel}`);
  if (memory.hasTradeIn) known.push('tiene auto para entregar en permuta');
  if (memory.financingInterest) known.push('ya mostró interés en financiación');
  if (memory.visitInterest) known.push('mostró interés en visitar la agencia');
  if (memory.city) known.push(`ciudad: ${memory.city}`);

  if (!known.length && options?.skipIfEmpty) return '';

  const lines: string[] = [];

  if (isRecontactFlag) {
    const brand = memory.preferredBrand ?? 'un auto';
    const budget = budgetAmt
      ? ` a ${memory.currency ?? 'ARS'} ${Number(budgetAmt).toLocaleString('es-AR')}`
      : '';
    lines.push(`\n── CLIENTE QUE VUELVE — contexto de conversación previa recuperado ──`);
    lines.push(`✅ Datos ya confirmados en conversaciones anteriores (NO volver a preguntar):`);
    known.forEach((k) => lines.push(`  • ${k}`));
    lines.push('');
    lines.push('ACCIÓN: Saludá reconociendo que ya hablaron. Natural y breve. Ejemplo:');
    lines.push(`  "Hola de nuevo! ¿Seguís buscando ${brand}${budget}? ` +
      `Últimamente ingresó stock que puede interesarte."`);
    lines.push('  → NO preguntes datos que ya están arriba. Ir directo al siguiente paso.');
  } else {
    lines.push(`\n── MEMORIA COMERCIAL DEL LEAD (datos previos, NO re-preguntar) ──`);
    if (known.length) {
      known.forEach((k) => lines.push(`  ✅ ${k}`));
    }
  }

  // Objeción previa
  if (memory.mainObjection) {
    lines.push(`  ⚠️  Objeción principal previa: "${memory.mainObjection}"`);
    lines.push(
      '  → Tener en cuenta. Si vuelve a plantear la misma, progresar el script — no repetir el mismo ángulo.'
    );
  }

  // Último CTA
  if (memory.lastCtaOffered) {
    const ctaPreview = memory.lastCtaOffered.slice(0, 120);
    lines.push(`  📌 Último CTA ofrecido: "${ctaPreview}"`);
    if (isRecontactFlag) {
      lines.push('  → Retomar desde ahí con un ángulo nuevo si el cliente no respondió.');
    }
  }

  // Vehículos ya mostrados
  if (memory.shownVehicleIds?.length) {
    lines.push(`  🚗 Vehículos ya mostrados (IDs): ${memory.shownVehicleIds.join(', ')}`);
    lines.push('  → Si pide más opciones: mostrar vehículos DISTINTOS a estos IDs.');
  }

  // Recontact count
  if (isRecontactFlag && (memory.recontactCount ?? 0) >= 2) {
    lines.push('');
    lines.push(`  💡 Este lead ha recontactado ${memory.recontactCount} veces — alta intención de compra.`);
    lines.push('  → Ser más directo hacia el siguiente paso concreto.');
  }

  return lines.join('\n');
}

// ─── CTA Extractor ────────────────────────────────────────────────────────────

/**
 * Extrae el CTA (llamado a la acción) de una respuesta del bot.
 * Se guarda en la DB para saber dónde quedó la conversación.
 */
export function extractCtaFromReply(reply: string): string | null {
  if (!reply) return null;

  // Buscar la última pregunta de la respuesta (es el CTA)
  const lines = reply.split('\n').filter((l) => l.trim());
  const lastQuestion = lines.reverse().find((l) => l.includes('?'));
  if (lastQuestion) return lastQuestion.trim().slice(0, 200);

  // Buscar frases de cierre
  const closingMatch = reply.match(
    /(pasar[te]?\s+a\s+ver|te\s+paso\s+con\s+el|coordin[ao]|reserv[ao]|avis[aá]me|escribime)[^.!?\n]*/i
  );
  if (closingMatch) return closingMatch[0].trim().slice(0, 200);

  return null;
}

// ─── Visit Intent Detection ───────────────────────────────────────────────────

/**
 * Detecta si el mensaje del usuario indica interés en visitar la agencia.
 */
export function detectVisitInterest(userMessage: string): boolean {
  return /\b(pasar\s+a\s+ver|cu[aá]ndo\s+puedo\s+ir|quisiera\s+ir|me\s+gustar[ií]a\s+pasar|puede\s+ser\s+hoy|pu[eé]do\s+ir|cu[aá]ndo\s+atienden|quiero\s+ver(lo)?|voy\s+a\s+pasar|ir\s+a\s+la\s+agencia|visitar)\b/i.test(
    userMessage
  );
}
