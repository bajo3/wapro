import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { pool } from '../services/db.js';
import { getUsdToArs } from '../services/exchangeRate.js';
import { evolutionSendPresence } from '../services/evolution.js';
import { getCatalog, searchCatalog, formatItemLine } from '../services/catalog.js';
import { getState, setState, seenDedupe, markDedupe } from '../services/state.js';
import { getContactRule, setContactRule } from '../services/contacts.js';
import { getConversationRule, setConversationRule, addConversationNote } from '../services/rules.js';
import { getSocket } from '../services/socket.js';
import {
  matchBest,
  matchPolicy,
  matchFaq,
  matchPlaybook,
  renderTemplate,
  logDecision,
  getIntelligenceSettings,
  searchKnowledge,
  getAbVariantsFor,
  logEpisode
} from '../services/intelligence.js';
import { buildMissingQuestions, computeMissingFields, extractLeadFields, requiredFieldsForIntent } from '../services/extract.js';
import { createHash } from 'node:crypto';
import type { ConvState } from '../services/state.js';
import { computeLeadScore, computeLeadScoreBreakdown, leadLabel } from '../services/lead.js';

import { getFinanceApr, simulateFinancing, formatArs } from '../services/finance.js';
import { sendImageAndPersist, sendTextAndPersist } from '../services/panelPersistence.js';
import { askGPT, buildCarDealershipSystemPrompt } from '../services/gpt.js';
import { decideAgentAction } from '../services/agent.js';
import {
  upsertLeadProfile,
  loadLeadMemory,
  mergeMemoryIntoExtracted,
  buildMemorySummaryBlock,
  isRecontact,
  extractCtaFromReply,
  detectVisitInterest,
  mergeShownVehicleIds,
  extractShownVehicleIdsFromHistory,
  detectTopicChange,
  clearVehicleContext,
  sanitizeBrandModel,
} from '../services/leadProfile.js';
import { rankVehiclesForLead } from '../services/vehicleRanker.js';
import { auditTurnQuality, logTurnAudit, accumulateAuditMetrics } from '../services/commercialAudit.js';
import {
  captureConversationTurn,
  selectDynamicExamples,
  formatExamplesForPrompt,
  type SourceType
} from '../services/learning.js';
import { applyGuardrail, validateReply } from '../services/guardrails.js';
import { detectStagnation } from '../services/conversationAnalyzer.js';
import {
  recordTurnMetrics,
  buildIndecisiveContextBlock,
  buildObjectionContextBlock,
  evaluateResponseOutcome,
  calculateOutcomeScore,
  classifyMemoryEntry,
  selfEvaluateResponse,
  saveMemoryToDB,
  selectFewShotExamples,
  formatFewShotBlock,
} from '../services/botMemory.js';

export const webhookRouter = Router();

function getText(msg: any): string {
  const m = msg?.message || {};
  if (typeof m.conversation === 'string') return m.conversation;
  if (typeof m.extendedTextMessage?.text === 'string') return m.extendedTextMessage.text;
  if (typeof m.imageMessage?.caption === 'string') return m.imageMessage.caption;
  if (typeof m.videoMessage?.caption === 'string') return m.videoMessage.caption;
  // buttons/list replies
  if (typeof m.buttonsResponseMessage?.selectedDisplayText === 'string') return m.buttonsResponseMessage.selectedDisplayText;
  if (typeof m.listResponseMessage?.title === 'string') return m.listResponseMessage.title;
  return '';
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function isMessagesUpsertEvent(body: any): { ok: boolean; event: string } {
  const evRaw = String(body?.event ?? '');
  const ev = evRaw.toLowerCase();

  const ok =
    ev === 'messages.upsert' ||
    ev === 'messages_upsert' ||
    ev === 'messagesupsert' ||
    evRaw === 'MESSAGES_UPSERT';

  return { ok, event: evRaw };
}

/**
 * In-memory debounce/aggregation map. For each remoteJid we keep the last
 * received message and a timer. When a new message arrives we reset the
 * timer. Once the timer fires we process the aggregated message. This
 * prevents the bot from replying multiple times when the user sends
 * several short messages in quick succession. The window duration is
 * randomized between env.humanizerMinMs and env.humanizerMaxMs.
 */
type AggregatorEntry = {
  /** map key = `${instance}:${remoteJid}` */
  key: string;
  instance: string;
  remoteJid: string;
  fromMe: boolean;
  /** last N msg ids seen within the aggregation window */
  msgIds: string[];
  /** last N raw texts (kept in order) */
  texts: string[];
  /** last media seen within the aggregation window (best-effort) */
  lastMedia?: {
    kind: 'image' | 'video' | 'document' | 'audio' | 'sticker' | 'unknown';
    caption?: string;
    url?: string;
    mimetype?: string;
    fileLength?: number;
  } | null;
  /** timestamp of the first message in the window */
  firstAt: number;
  /** timestamp of the last message in the window */
  lastAt: number;
  /** how many messages were received in the current window */
  count: number;
  timer: NodeJS.Timeout | null;
  /** scheduled send timer (typing delay). If a new message arrives, we cancel it. */
  sendTimer: NodeJS.Timeout | null;
};

const aggregators = new Map<string, AggregatorEntry>();

/**
 * Pick a random integer between min and max inclusive.
 */
function randInt(min: number, max: number): number {
  // Defensive: swap if provided in the wrong order
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function hashString(str: string): string {
  return createHash('sha1').update(str).digest('hex');
}

/**
 * Compute a human-like delay before sending a message. It picks a
 * random base delay between env.delayBaseMinMs and env.delayBaseMaxMs
 * then adds a per-character component between env.delayCharMinMs and
 * env.delayCharMaxMs times the length of the reply. The final delay
 * is capped at 8 seconds to avoid excessive waiting.
 */
function computeHumanDelay(reply: string): number {
  const base = randInt(env.delayBaseMinMs, env.delayBaseMaxMs);
  const perChar = randInt(env.delayCharMinMs, env.delayCharMaxMs);
  const delay = base + reply.length * perChar;
  return Math.min(delay, 8000);
}

/**
 * Choose a random element from an array. If the array is empty it
 * returns an empty string.
 */
function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(p: number): boolean {
  return Math.random() < p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Optionally split longer multi-line replies into two WhatsApp messages.
 * This tends to feel more human and reduces "wall of text".
 */
async function sendTextHuman(
  instance: string,
  remoteJid: string,
  reply: string,
  options?: { ticketStatus?: 'pending' | 'open' | 'closed'; botMode?: 'ON' | 'OFF' | 'HUMAN_ONLY'; handoff?: boolean }
): Promise<void> {
  if (!env.splitReplies) {
    await sendTextAndPersist(instance, remoteJid, reply, options);
    return;
  }

  const lines = reply.split('\n').filter((l) => l.trim().length > 0);
  // Only split when there is a clear header and body.
  const p = Number.isFinite(env.splitRepliesProb) ? Math.min(1, Math.max(0, env.splitRepliesProb)) : 0.25;
  if (lines.length >= 3 && chance(p)) {
    const first = lines[0];
    const rest = lines.slice(1).join('\n');
    await sendTextAndPersist(instance, remoteJid, first, options);
    await sleep(randInt(700, 1200));
    await sendTextAndPersist(instance, remoteJid, rest, options);
    return;
  }

  await sendTextAndPersist(instance, remoteJid, reply, options);
}

/**
 * Detect short acknowledgements like "ok", "jaja", "ah".
 * We treat these as low-signal and reply only occasionally.
 */
function isAckOnly(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  // Keep it tight so we don't misclassify real queries
  if (t.length > 16) return false;
  return /^(ok|oki|okey|dale|(?:de\s+una|deuna)|jaja+|aja|ah+|mmm+|joya|genial|buenisimo|buen[ií]simo|listo|gracias|grx|sorry|sry|👍|👌)$/.test(t);
}

/** Extract an option number like "2", "opcion 3", "la 1". */
function extractOptionNumber(text: string): number | null {
  const t = normalize(text);
  const m = t.match(/\b(opcion|opci[oó]n|opt|la|el)?\s*([1-8])\b/);
  if (!m) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : null;
}

function extractMedia(msg: any): AggregatorEntry['lastMedia'] {
  const m = msg?.message || {};
  const pickUrl = (obj: any) => {
    const u = obj?.url || obj?.imageUrl || obj?.mediaUrl;
    return typeof u === 'string' && u.trim() ? u.trim() : undefined;
  };

  if (m.imageMessage) {
    return {
      kind: 'image',
      caption: typeof m.imageMessage.caption === 'string' ? m.imageMessage.caption : undefined,
      url: pickUrl(m.imageMessage),
      mimetype: typeof m.imageMessage.mimetype === 'string' ? m.imageMessage.mimetype : undefined,
      fileLength: Number(m.imageMessage.fileLength ?? 0) || undefined
    };
  }
  if (m.videoMessage) {
    return {
      kind: 'video',
      caption: typeof m.videoMessage.caption === 'string' ? m.videoMessage.caption : undefined,
      url: pickUrl(m.videoMessage),
      mimetype: typeof m.videoMessage.mimetype === 'string' ? m.videoMessage.mimetype : undefined,
      fileLength: Number(m.videoMessage.fileLength ?? 0) || undefined
    };
  }
  if (m.documentMessage) {
    return {
      kind: 'document',
      caption: typeof m.documentMessage.caption === 'string' ? m.documentMessage.caption : undefined,
      url: pickUrl(m.documentMessage),
      mimetype: typeof m.documentMessage.mimetype === 'string' ? m.documentMessage.mimetype : undefined,
      fileLength: Number(m.documentMessage.fileLength ?? 0) || undefined
    };
  }
  if (m.audioMessage) {
    return {
      kind: 'audio',
      url: pickUrl(m.audioMessage),
      mimetype: typeof m.audioMessage.mimetype === 'string' ? m.audioMessage.mimetype : undefined,
      fileLength: Number(m.audioMessage.fileLength ?? 0) || undefined
    };
  }
  if (m.stickerMessage) {
    return { kind: 'sticker', url: pickUrl(m.stickerMessage) };
  }
  return null;
}

function detectNeedProfile(rawText: string) {
  const t = normalize(rawText);
  const wantsRemis = /(remis|taxi|uber|cabify)/i.test(rawText);
  const wantsPickup = /(camioneta|pickup|pick\s*up|4x4|doble\s*cabina|hilux|amarok|ranger|s10|frontier)/i.test(rawText);
  const wantsTruck = /(camion\b|camioneta\s*grande|camion\s*chico|furgon|utilitario)/i.test(rawText);
  const wantsSuv = /(suv|crossover)/i.test(rawText);
  const wantsSmall = wantsRemis || /(sedan|sed\u00e1n|hatch|compacto|economico|econ\u00f3mico)/i.test(rawText);
  return { wantsRemis, wantsPickup, wantsTruck, wantsSuv, wantsSmall, t };
}

function isVehicleItem(it: any): boolean {
  return !!(it && (it.year || it.brand || it.model || (it.category && /auto|autos|veh|car/i.test(String(it.category)) )));
}

function isTruckishName(name: string): boolean {
  const n = normalize(name);
  return /(camion\b|truck\b|furgon|utilitario|pickup|pick\s*up|hilux|amarok|ranger|s10|frontier|sprinter|ducato|master)/.test(n);
}

function mergeSearchContext(prev: any, extracted: any, topicChanged = false) {
  // Topic change: reset vehicle context, keep only budget + personal data
  const base = topicChanged
    ? {
        // Presupuesto previo como piso débil (puede seguir siendo válido)
        ...(prev?.maxPrice !== undefined ? { maxPrice: prev.maxPrice } : {}),
        ...(prev?.amount !== undefined ? { amount: prev.amount } : {}),
        ...(prev?.currency ? { currency: prev.currency } : {}),
        // Datos personales no ligados al vehículo
        ...(prev?.name ? { name: prev.name } : {}),
        ...(prev?.city ? { city: prev.city } : {}),
      }
    : { ...(prev || {}) };

  const next = { ...base };
  if (extracted?.brand) next.brand = extracted.brand;
  if (extracted?.model) next.model = extracted.model;
  if (extracted?.minYear) next.minYear = extracted.minYear;
  if (extracted?.maxYear) next.maxYear = extracted.maxYear;
  if (extracted?.year) next.year = extracted.year;
  if (extracted?.transmission) next.transmission = extracted.transmission;
  if (extracted?.fuel) next.fuel = extracted.fuel;
  if (extracted?.gnc !== undefined && extracted?.gnc !== null) next.gnc = extracted.gnc;
  if (extracted?.bodywork) next.bodywork = extracted.bodywork;
  if (extracted?.color) next.color = extracted.color;
  if (extracted?.useCase) next.useCase = extracted.useCase;
  if (extracted?.city) next.city = extracted.city;
  if (extracted?.name) next.name = extracted.name;
  // Budget: maxPrice explícito siempre gana; amount como techo implícito si no había maxPrice
  if (extracted?.maxPrice) next.maxPrice = extracted.maxPrice;
  if (extracted?.amount) {
    next.amount = extracted.amount;
    if (!next.maxPrice) next.maxPrice = extracted.amount;
  }
  if (extracted?.currency) next.currency = extracted.currency;
  return next;
}


function getItemText(it: any): string {
  return [
    it?.name,
    it?.title,
    it?.description,
    it?.category,
    it?.brand,
    it?.model,
    it?.version,
    it?.transmission,
    it?.fuel,
    it?.engine,
    it?.color
  ].filter(Boolean).join(' ');
}

function inferFuelFromItem(it: any): string {
  const explicit = normalize(String(it?.fuel || ''));
  if (explicit) {
    if (explicit.includes('gnc')) return 'gnc';
    if (explicit.includes('diesel') || explicit.includes('gasoil')) return 'diesel';
    if (explicit.includes('nafta') || explicit.includes('gasolina')) return 'nafta';
    if (explicit.includes('hibr')) return 'hibrido';
    if (explicit.includes('elect')) return 'electrico';
  }
  const txt = normalize(getItemText(it));
  if (/(?:^|\s)gnc(?:\s|$)|gas natural/.test(txt)) return 'gnc';
  if (/(?:^|\s)(diesel|gasoil|turbodiesel)(?:\s|$)/.test(txt)) return 'diesel';
  if (/(?:^|\s)(nafta|gasolina|naftero)(?:\s|$)/.test(txt)) return 'nafta';
  if (/hibrid|hybrid/.test(txt)) return 'hibrido';
  if (/electr|\bev\b/.test(txt)) return 'electrico';
  return '';
}

function inferBodyworkFromItem(it: any): string {
  const txt = normalize(getItemText(it));
  if (/(?:^|\s)(suv|crossover|todoterreno|4x4|awd|4wd)(?:\s|$)/.test(txt)) return 'suv';
  if (/(?:^|\s)(pickup|pick up|pick-up|doble cabina)(?:\s|$)/.test(txt)) return 'pickup';
  if (/(?:^|\s)(sedan|sedan 4 puertas|4 puertas)(?:\s|$)/.test(txt)) return 'sedan';
  if (/(?:^|\s)(hatch|hatchback|3 puertas)(?:\s|$)/.test(txt)) return 'hatch';
  if (/(?:^|\s)(furgon|utilitario|partner|berlingo|kangoo|vito|sprinter|ducato|master)(?:\s|$)/.test(txt)) return 'furgon';
  return '';
}

/**
 * Normalize a price to ARS for comparison purposes.
 * Usa el tipo de cambio real pasado como parámetro (no hardcodeado).
 * El rate viene de getUsdToArs() — dinámico con fallback conservador.
 */
function normalizePriceToARS(priceNumber: number, itemCurrency: string, ctxCurrency: string, usdToArsRate: number): number {
  const iCur = normalize(String(itemCurrency || 'ARS'));
  const cCur = normalize(String(ctxCurrency || 'ARS'));
  // Misma moneda — no necesita conversión
  if (iCur === cCur) return priceNumber;
  // Item en USD, presupuesto en ARS: convertir item a ARS
  if (iCur === 'usd' && cCur === 'ars') return priceNumber * usdToArsRate;
  // Item en ARS, presupuesto en USD: convertir item a USD
  if (iCur === 'ars' && cCur === 'usd') return priceNumber / usdToArsRate;
  return priceNumber;
}

async function filterCatalogByContext(catalog: any[], ctx: any): Promise<any[]> {
  const brand = ctx?.brand ? normalize(String(ctx.brand)) : '';
  const model = ctx?.model ? normalize(String(ctx.model)) : '';
  const minYear = Number(ctx?.minYear ?? 0) || undefined;
  const maxYear = Number(ctx?.maxYear ?? 0) || undefined;
  const tx = ctx?.transmission ? normalize(String(ctx.transmission)) : '';
  const fuel = ctx?.fuel ? normalize(String(ctx.fuel)) : '';
  const bodywork = ctx?.bodywork ? normalize(String(ctx.bodywork)) : '';
  const wantsGnc = ctx?.gnc === true || fuel === 'gnc';
  // v3: ctx.amount como fallback de maxPrice para filtrado
  const maxPrice = Number(ctx?.maxPrice ?? ctx?.amount ?? 0) || undefined;
  // v4: moneda del presupuesto para comparar correctamente contra precios del catálogo
  const ctxCurrency = String(ctx?.currency ?? 'ARS');

  // Obtener tipo de cambio dinámico solo si hay precios en distintas monedas
  let usdToArsRate = 1200; // fallback conservador
  let rateSource: string = 'hardcoded_fallback';
  if (maxPrice) {
    const rateResult = await getUsdToArs();
    usdToArsRate = rateResult.rate;
    rateSource = rateResult.source;
  }

  const vehiclesBeforeFilter = (catalog || []).filter((it) => isVehicleItem(it)).length;

  const result = (catalog || [])
    .filter((it) => isVehicleItem(it))
    .filter((it) => {
      const b = it?.brand ? normalize(String(it.brand)) : normalize(String(it?.category || ''));
      const m = it?.model ? normalize(String(it.model)) : normalize(String(it?.name || ''));
      const itemTx = normalize(String(it?.transmission || ''));
      const itemFuel = inferFuelFromItem(it);
      const itemBodywork = inferBodyworkFromItem(it);
      if (brand && !b.includes(brand)) return false;
      if (model && !m.includes(model)) return false;
      if (minYear && Number(it?.year || 0) && Number(it.year) < minYear) return false;
      if (maxYear && Number(it?.year || 0) && Number(it.year) > maxYear) return false;
      if (tx && itemTx && !itemTx.includes(tx)) return false;
      if (fuel && itemFuel && itemFuel !== fuel) return false;
      if (wantsGnc && itemFuel && itemFuel !== 'gnc') return false;
      if (bodywork && itemBodywork && itemBodywork !== bodywork) return false;
      if (maxPrice && Number(it?.priceNumber || 0)) {
        // v5: usa rate dinámico en vez de hardcode 1500
        const itemCurrency = String(it?.currency ?? 'ARS');
        const normalizedItemPrice = normalizePriceToARS(Number(it.priceNumber), itemCurrency, ctxCurrency, usdToArsRate);
        const normalizedMaxPrice = normalizePriceToARS(maxPrice, ctxCurrency, ctxCurrency, usdToArsRate); // identity
        if (normalizedItemPrice > normalizedMaxPrice) return false;
      }
      return true;
    });

  // Log estructurado para detectar en producción si el filtro devuelve lo esperado
  console.info('[CATALOG_FILTER]', JSON.stringify({
    rate: usdToArsRate,
    source: rateSource,
    vehicles_before: vehiclesBeforeFilter,
    vehicles_after: result.length,
    filters_applied: {
      brand: brand || null,
      model: model || null,
      maxPrice: maxPrice || null,
      currency: maxPrice ? ctxCurrency : null,
      bodywork: bodywork || null,
      transmission: tx || null,
      fuel: fuel || null,
    },
  }));

  return result;
}

function hasUsefulSearchContext(ctx: any): boolean {
  return !!(
    ctx?.brand ||
    ctx?.model ||
    ctx?.minYear ||
    ctx?.maxYear ||
    ctx?.transmission ||
    ctx?.fuel ||
    ctx?.bodywork ||
    ctx?.gnc === true ||
    ctx?.maxPrice
  );
}

function sortVehiclesForContext(items: any[], ctx: any): any[] {
  const maxPrice = Number(ctx?.maxPrice ?? 0) || 0;
  return [...(items || [])].sort((a, b) => {
    const ap = Number(a?.priceNumber || 0);
    const bp = Number(b?.priceNumber || 0);

    if (maxPrice) {
      const aIn = ap > 0 && ap <= maxPrice ? 1 : 0;
      const bIn = bp > 0 && bp <= maxPrice ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn;

      const aGap = ap > 0 ? Math.abs(maxPrice - ap) : Number.MAX_SAFE_INTEGER;
      const bGap = bp > 0 ? Math.abs(maxPrice - bp) : Number.MAX_SAFE_INTEGER;
      if (aGap !== bGap) return aGap - bGap;
    }

    const ay = Number(a?.year || 0);
    const by = Number(b?.year || 0);
    if (ay !== by) return by - ay;
    return ap - bp;
  });
}

async function getCatalogHitsWithContext(catalog: any[], rawText: string, ctx: any, limit = 3): Promise<any[]> {
  const cleanedText = normalize(rawText || '');
  const filtered = hasUsefulSearchContext(ctx)
    ? sortVehiclesForContext(await filterCatalogByContext(catalog, ctx), ctx)
    : [];

  const searchedFiltered = filtered.length ? searchCatalog(filtered, rawText, limit) : [];
  if (searchedFiltered.length) return searchedFiltered.slice(0, limit);

  if (filtered.length) return filtered.slice(0, limit);

  if (!cleanedText) return [];
  return searchCatalog(catalog, rawText, limit);
}

function isSedanHatchName(name: string): boolean {
  const n = normalize(name);
  return /(sedan|hatch|onix|gol\b|polo\b|corolla|cronos|fiesta|focus|civic|sentra|versa|etios|logan|clio|208\b|206\b)/.test(n);
}

function applyVehicleGuardrails(rawText: string, hits: any[]): { hits: any[]; changed: boolean } {
  const prof = detectNeedProfile(rawText);
  if (!hits?.length) return { hits: hits || [], changed: false };
  if (!hits.some(isVehicleItem)) return { hits, changed: false };

  // If user asks for remis/taxi/uber: exclude truck/pickup unless explicitly requested.
  if (prof.wantsRemis && !prof.wantsPickup && !prof.wantsTruck) {
    const filtered = hits.filter((it) => !isTruckishName(String(it.name || it.id || '')));
    return { hits: filtered.length ? filtered : hits, changed: filtered.length ? true : false };
  }

  // If user asks explicitly for pickup/camioneta/suv/truck: don't propose sedans/hatch.
  if ((prof.wantsPickup || prof.wantsTruck || prof.wantsSuv) && !prof.wantsSmall) {
    const filtered = hits.filter((it) => !isSedanHatchName(String(it.name || it.id || '')));
    return { hits: filtered.length ? filtered : hits, changed: filtered.length ? true : false };
  }

  return { hits, changed: false };
}

function hasStructuredSearchNeed(extracted: any): boolean {
  return Boolean(
    extracted?.brand ||
    extracted?.model ||
    extracted?.bodywork ||
    extracted?.fuel ||
    extracted?.transmission ||
    extracted?.maxPrice ||
    extracted?.amount ||
    extracted?.minYear ||
    extracted?.maxYear ||
    extracted?.year
  );
}

/**
 * detectRepeatedMissingFields — v6
 * Detecta qué campos le fueron pedidos al cliente en el turno anterior
 * pero todavía no están en el estado acumulado.
 * Se pasa como loopData.repeatedMissingFields al agente para que NO los
 * vuelva a pedir y avance con lo disponible.
 */
function detectRepeatedMissingFields(state: ConvState): string[] {
  const prevMissing: string[] = Array.isArray((state as any).missing_fields)
    ? (state as any).missing_fields
    : [];
  if (!prevMissing.length) return [];

  const ctx = state.search_context ?? {};
  const ext = (state as any).extracted ?? {};

  return prevMissing.filter(f => {
    switch (f) {
      case 'brand':        return !ctx.brand      && !ext.brand;
      case 'model':        return !ctx.model      && !ext.model;
      case 'budget':
      case 'maxPrice':     return !ctx.maxPrice   && !ext.maxPrice && !ext.amount;
      case 'transmission': return !ctx.transmission && !ext.transmission;
      case 'fuel':         return !ctx.fuel       && !ext.fuel;
      case 'bodywork':     return !ctx.bodywork   && !ext.bodywork;
      case 'year':         return !ctx.year       && !ext.year && !ext.minYear;
      case 'tradeInYear':  return !ext.tradeInYear;
      case 'tradeInKm':    return !ext.tradeInKm;
      case 'precio':       return !ext.amount     && !ctx.maxPrice;
      case 'entrada':      return ext.downPayment === undefined || ext.downPayment === null;
      case 'cuotas':       return !ext.cuotas;
      default:             return true;
    }
  });
}

function scoreVehicleForContext(it: any, ctx: any, rawText: string): number {
  let score = 0;
  const itemText = normalize(getItemText(it));
  const brand = ctx?.brand ? normalize(String(ctx.brand)) : '';
  const model = ctx?.model ? normalize(String(ctx.model)) : '';
  const tx = ctx?.transmission ? normalize(String(ctx.transmission)) : '';
  const fuel = ctx?.fuel ? normalize(String(ctx.fuel)) : '';
  const bodywork = ctx?.bodywork ? normalize(String(ctx.bodywork)) : '';
  // v3: usar ctx.amount como fallback de maxPrice para scoring
  const maxPrice = Number(ctx?.maxPrice ?? ctx?.amount ?? 0) || 0;
  const price = Number(it?.priceNumber || 0) || 0;
  const year = Number(it?.year || 0) || 0;
  const itemBodywork = inferBodyworkFromItem(it);
  const prof = detectNeedProfile(rawText);
  const wantsUtility = /(partner|berlingo|kangoo|furgon|utilitario|vito|sprinter|ducato|master)/i.test(rawText);

  if (brand && itemText.includes(brand)) score += 40;
  if (model && itemText.includes(model)) score += 55;
  if (tx && normalize(String(it?.transmission || '')).includes(tx)) score += 14;
  if (fuel && inferFuelFromItem(it) === fuel) score += 12;
  if (bodywork && itemBodywork === bodywork) score += 10;
  if (wantsUtility && itemBodywork === 'furgon') score += 18;
  if (prof.wantsSuv && itemBodywork === 'suv') score += 16;
  if ((prof.wantsPickup || prof.wantsTruck) && itemBodywork === 'pickup') score += 16;
  if (prof.wantsSmall && ['sedan', 'hatch'].includes(itemBodywork)) score += 12;

  if (maxPrice && price > 0) {
    if (price <= maxPrice) score += 35;
    else score -= Math.min(45, Math.round((price - maxPrice) / Math.max(maxPrice, 1) * 100));
  }

  // Año exacto: bonus extra si el ítem tiene exactamente el año pedido
  if (ctx?.year && year && year === Number(ctx.year)) score += 18;
  if (year && ctx?.minYear && year >= Number(ctx.minYear)) score += 8;
  if (year && ctx?.maxYear && year <= Number(ctx.maxYear)) score += 8;

  // useCase scoring: preferir utilitarios para remis, sedans para city, etc.
  if (ctx?.useCase === 'remis' && ['sedan', 'hatch'].includes(itemBodywork)) score += 10;
  if (ctx?.useCase === 'campo' && itemBodywork === 'pickup') score += 12;
  if (ctx?.useCase === 'familiar' && itemBodywork === 'suv') score += 8;

  const queryTokens = normalize(rawText).split(/\s+/).filter((t) => t.length >= 3);
  for (const token of queryTokens) {
    if (itemText.includes(token)) score += 2;
  }

  return score;
}

async function getVehicleMatches(catalog: any[], rawText: string, ctx: any, limit = 3): Promise<{
  hits: any[];
  nearby: any[];
  usedBudgetFallback: boolean;
  hasBudget: boolean;
}> {
  const baseFiltered = await filterCatalogByContext(catalog, { ...ctx, maxPrice: undefined });
  const strictFiltered = await filterCatalogByContext(catalog, ctx);
  const hasBudget = Boolean(Number(ctx?.maxPrice ?? 0));

  const withScore = (items: any[]) =>
    [...items]
      .map((it) => ({ it, score: scoreVehicleForContext(it, ctx, rawText) }))
      .sort((a, b) => b.score - a.score)
      .map((row) => row.it);

  const strictSeed = strictFiltered.length ? strictFiltered : [];
  const searchedStrict = strictSeed.length ? searchCatalog(strictSeed, rawText, Math.max(limit * 2, 8)) : [];
  const strictRanked = withScore(searchedStrict.length ? searchedStrict : strictSeed).slice(0, limit);

  if (strictRanked.length > 0) {
    return { hits: strictRanked, nearby: [], usedBudgetFallback: false, hasBudget };
  }

  if (!hasBudget) {
    const searched = searchCatalog(baseFiltered.length ? baseFiltered : catalog, rawText, Math.max(limit * 2, 8));
    const ranked = withScore(searched.length ? searched : (baseFiltered.length ? baseFiltered : catalog)).slice(0, limit);
    return { hits: ranked, nearby: [], usedBudgetFallback: false, hasBudget };
  }

  const nearby = withScore(baseFiltered.filter((it) => Number(it?.priceNumber || 0) > Number(ctx.maxPrice || 0)))
    .slice(0, Math.min(3, limit));

  return { hits: [], nearby, usedBudgetFallback: nearby.length > 0, hasBudget };
}

function summarizeSearchContext(ctx: any): string {
  const parts: string[] = [];
  if (ctx?.brand) parts.push(String(ctx.brand));
  if (ctx?.model) parts.push(String(ctx.model));
  if (ctx?.bodywork) parts.push(String(ctx.bodywork));
  if (ctx?.transmission) parts.push(String(ctx.transmission));
  if (ctx?.fuel) parts.push(String(ctx.fuel));
  return parts.join(' · ');
}

function getNextUsefulSearchQuestion(ctx: any): string {
  if (!ctx?.brand && !ctx?.model) return '¿Qué marca o modelo tenés en mente?';
  if (!ctx?.maxPrice && !ctx?.amount) return '¿Hasta qué presupuesto querés mirar?';
  if (!ctx?.bodywork) return '¿Lo querés auto, SUV, pickup o utilitario?';
  if (!ctx?.transmission) return '¿Preferís manual o automático?';
  return '¿Querés que lo afine por año o por tipo de uso?';
}

function getNextTradeInQuestion(missing: string[]): string {
  if (missing.includes('tradeInYear')) return '¿De qué año es tu usado?';
  if (missing.includes('tradeInKm')) return '¿Cuántos km tiene?';
  if (missing.includes('gnc')) return '¿Tiene GNC?';
  return '¿Qué vehículo tenés para entregar (marca/modelo)?';
}

function getNextFinanceQuestion(missing: string[]): string {
  if (missing.includes('precio')) return '¿Cuál es el precio del vehículo que querés financiar?';
  if (missing.includes('entrada')) return '¿De cuánto sería la entrada? Si es sin anticipo, decime 0.';
  return '¿En cuántas cuotas querés simularlo?';
}

function explainAlternativeReason(it: any, ctx: any): string {
  const parts: string[] = [];
  if (ctx?.brand && normalize(String(it?.brand || '')).includes(normalize(String(ctx.brand)))) parts.push('mantiene la marca');
  if (ctx?.bodywork && inferBodyworkFromItem(it) === String(ctx.bodywork)) parts.push(`es ${ctx.bodywork}`);
  if (ctx?.transmission && normalize(String(it?.transmission || '')).includes(normalize(String(ctx.transmission)))) parts.push(`viene con ${ctx.transmission}`);
  if (ctx?.fuel && inferFuelFromItem(it) === String(ctx.fuel)) parts.push(`usa ${ctx.fuel}`);
  return parts[0] || 'es de lo más cercano a lo que pedís';
}

function buildVehicleReply(rawText: string, matches: { hits: any[]; nearby: any[]; usedBudgetFallback: boolean; hasBudget: boolean }, ctx: any): string {
  const budget = Number(ctx?.maxPrice ?? ctx?.amount ?? 0) || 0;
  // Formato legible: "ARS 30 M" en vez de "ARS 30.000.000"
  const budgetTxt = budget > 0
    ? (budget >= 1_000_000
        ? `ARS ${(budget / 1_000_000) % 1 === 0 ? budget / 1_000_000 : (budget / 1_000_000).toFixed(1)} M`
        : `ARS ${budget.toLocaleString('es-AR')}`)
    : null;
  const contextTxt = summarizeSearchContext(ctx);

  // Frase de confirmación cuando hay contexto rico (marca/modelo + presupuesto)
  const hasRichContext = !!(ctx?.brand || ctx?.model) && !!(ctx?.maxPrice || ctx?.amount);
  const confirmationParts: string[] = [];
  if (hasRichContext) {
    if (ctx?.brand && ctx?.model) confirmationParts.push(`${ctx.brand} ${ctx.model}`);
    else if (ctx?.brand) confirmationParts.push(ctx.brand);
    else if (ctx?.model) confirmationParts.push(ctx.model);
    if (budgetTxt) confirmationParts.push(`hasta ${budgetTxt}`);
    if (ctx?.transmission) confirmationParts.push(`caja ${ctx.transmission}`);
  }
  const confirmationLine = confirmationParts.length ? `Entendido, buscás ${confirmationParts.join(', ')}. ` : '';

  if (matches.hits.length === 1) {
    const item = matches.hits[0];
    const intro = budgetTxt
      ? `${confirmationLine}Dentro de ${budgetTxt} la que mejor te cierra es esta:`
      : `${confirmationLine}La que mejor te encaja es esta:`;
    return `${intro}
${formatItemLine(item, 1)}

Si querés, avanzamos con visita, financiación o te paso una alternativa parecida.`;
  }

  if (matches.hits.length > 1) {
    const intro = confirmationLine
      ? `${confirmationLine}Mirá estas opciones:`
      : budgetTxt
        ? `Bien, hasta ${budgetTxt} me quedaría con estas ${matches.hits.length}:`
        : contextTxt
          ? `Perfecto, para ${contextTxt} me quedaría con estas ${matches.hits.length}:`
          : pickOne([
              'Perfecto, me quedaría con estas opciones:',
              'Para lo que buscás, estas son las que más sentido tienen:',
              'Estas son las que mejor te cierran hoy:'
            ]);

    return [
      intro,
      ...matches.hits.slice(0, 3).map((it, i) => formatItemLine(it, i + 1)),
      '',
      pickOne([
        'Si querés, te digo cuál elegiría yo según uso o presupuesto.',
        'Si querés, te separo la más conveniente y la vemos juntos.',
        'Si te gustó una, te paso más detalle o coordinamos para verla.'
      ])
    ].join('\n');
  }

  if (matches.usedBudgetFallback && matches.nearby.length) {
    const top = matches.nearby.slice(0, 3);
    const reason = explainAlternativeReason(top[0], ctx);
    return [
      budgetTxt
        ? `${confirmationLine}Dentro de ${budgetTxt} no tengo un match exacto, pero te dejo 2 o 3 cercanas porque ${reason}:`
        : 'No tengo un match exacto, pero te dejo 2 o 3 alternativas cercanas que te pueden servir:',
      ...top.map((it, i) => formatItemLine(it, i + 1)),
      '',
      'Si querés, te sigo buscando algo más económico o lo afino por marca, año o tipo de uso.'
    ].join('\n');
  }

  return '';
}

async function findReferencedVehicle(catalog: any[], rawText: string, ctx: any): Promise<any | null> {
  const normText = normalize(rawText);
  const matches = await getVehicleMatches(catalog, rawText, { ...ctx, maxPrice: undefined }, 3);
  if (matches.hits.length) return matches.hits[0];
  return catalog.find((it) => normalize(getItemText(it)).includes(normText)) || null;
}

function describeTradeIn(extracted: any): string {
  const model = extracted?.tradeInModel || extracted?.model || '';
  const year = extracted?.tradeInYear || extracted?.year || '';
  const km = extracted?.tradeInKm !== undefined && extracted?.tradeInKm !== null
    ? `${Number(extracted.tradeInKm).toLocaleString('es-AR')} km`
    : '';
  return [model, year, km].filter(Boolean).join(' ').trim();
}

/**
 * Handle an aggregated message. This function runs outside of the
 * HTTP request/response cycle. It reads the current conversation
 * state, determines intent and generates a reply. The reply is then
 * scheduled to be sent with a human-like delay. Conversation state is
 * persisted back to the database.
 */
async function handleAggregatedMessage(key: string, instance: string, remoteJid: string, rawText: string, msgId: string) {
  try {
    const number = remoteJid.split('@')[0];

    // Do not respond to admin/test numbers.
    if (env.testNumbers && env.testNumbers.length > 0 && env.testNumbers.includes(number)) {
      const e = aggregators.get(key);
      if (e?.timer) clearTimeout(e.timer);
      if (e?.sendTimer) clearTimeout(e.sendTimer);
      aggregators.delete(key);
      return;
    }

    // Hard override: private numbers (env) are treated as HUMAN_ONLY.
    if (env.privateNumbers && env.privateNumbers.length > 0 && env.privateNumbers.includes(number)) {
      const e = aggregators.get(key);
      if (e?.timer) clearTimeout(e.timer);
      if (e?.sendTimer) clearTimeout(e.sendTimer);
      aggregators.delete(key);
      try { await setContactRule(number, 'HUMAN_ONLY', 'private_numbers_env'); } catch { /* ignore */ }
      return;
    }

    // Contact rule check
    try {
      const rule = await getContactRule(number);
      if (rule && rule !== 'ON') {
        const e = aggregators.get(key);
        if (e?.timer) clearTimeout(e.timer);
        if (e?.sendTimer) clearTimeout(e.sendTimer);
        aggregators.delete(key);
        return;
      }
    } catch (err) {
      console.error('Failed to get contact rule for', number, err);
    }

    // Conversation rule check
    try {
      const convRule = await getConversationRule(instance, remoteJid);
      if (convRule && convRule !== 'ON') {
        const e = aggregators.get(key);
        if (e?.timer) clearTimeout(e.timer);
        if (e?.sendTimer) clearTimeout(e.sendTimer);
        aggregators.delete(key);
        return;
      }
    } catch (err) {
      console.error('Failed to get conversation rule for', instance, remoteJid, err);
    }

    // Conversation state
    const stateRaw: ConvState = await getState(instance, remoteJid);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // ── Lead memory: start async load in parallel (never blocks) ─────────────
    const memoryPromise = loadLeadMemory(instance, remoteJid);

    // Context timeout (30 min): if idle too long, drop accumulated search/finance context.
    const lastUserAtMs = stateRaw.last_user_at ? Date.parse(stateRaw.last_user_at) : NaN;
    const contextExpired = !Number.isNaN(lastUserAtMs) && now - lastUserAtMs > 30 * 60 * 1000;
    // v3: si el contexto expiró pero el cliente vuelve con un saludo, recuperar resumen
    // para reanudación natural ("Hola, volviste a preguntar por Corolla ARS 30 M")
    const staleContext = contextExpired ? stateRaw.search_context : undefined;

    const state: ConvState = {
      ...stateRaw,
      ...(contextExpired
        ? { search_context: undefined, search_context_at: undefined, finance: undefined, last_hits: undefined, last_hits_at: undefined }
        : {})
    };

    // ── Topic change detection (before extracting, affects prev context used) ──
    const topicChanged = detectTopicChange(rawText);

    // Merge extracted fields across turns.
    // On topic change: pass cleared prev to avoid contaminating new search with old vehicle data.
    const prevForExtract = topicChanged
      ? clearVehicleContext((state as any)?.extracted ?? (state as any)?.lead ?? {})
      : ((state as any)?.extracted ?? (state as any)?.lead ?? {});
    const extracted = extractLeadFields(rawText, prevForExtract);

    if (topicChanged) {
      console.log(`[webhooks] topic change detected for ${remoteJid.slice(0, 12)} — resetting vehicle context`);
    }

    // ── Resolve lead memory and merge into extracted ──────────────────────────
    const leadMemory = await memoryPromise;
    const sessionHadContext = Boolean(
      (state as any)?.extracted?.brand ||
      (state as any)?.extracted?.maxPrice ||
      (state as any)?.search_context?.brand ||
      (state as any)?.search_context?.maxPrice
    );
    const isRecontactTurn = isRecontact(leadMemory, sessionHadContext && !contextExpired);
    // When context expired or first visit with DB memory: fill gaps from persistent profile.
    // On topic change: skip vehicle-specific fields from memory (user wants something different).
    if (leadMemory && (contextExpired || !sessionHadContext)) {
      const enriched = mergeMemoryIntoExtracted(extracted, leadMemory, { topicChanged });
      Object.assign(extracted, enriched);
    }

    // ── Fase 3: Evaluar outcome del turno anterior ────────────────────────────
    // Cuando llega el turno N+1, evaluamos si la respuesta N fue buena
    // usando el comportamiento real del usuario como señal.
    // Este bloque es async y nunca bloquea el flujo principal.
    const prevBotReply: string | undefined = (state as any)?.agent?.suggestedReply?.trim()
      ?? ((state as any).gpt_history ?? []).slice().reverse().find((h: any) => h.role === 'assistant')?.content?.trim()
      ?? undefined;
    const prevExtractedContext: Record<string, any> = (state as any)?.extracted ?? (state as any)?.search_context ?? {};

    if (prevBotReply && prevBotReply.length > 10) {
      // Evaluar en background — no bloquea
      void (async () => {
        try {
          const currentContextForEval = { ...prevForExtract, ...extracted };
          const outcome = evaluateResponseOutcome(prevBotReply, rawText, prevExtractedContext, currentContextForEval);
          const score = calculateOutcomeScore(outcome);
          const classification = classifyMemoryEntry(prevBotReply, score, outcome, {
            ...prevExtractedContext,
            _lastUserMessage: rawText,
          });

          if (classification.shouldSave) {
            await saveMemoryToDB({
              conversationId: remoteJid,
              instanceName: instance,
              userMessage: rawText,
              botReply: prevBotReply,
              extractedContext: prevExtractedContext,
              memoryType: classification.memoryType,
              qualityScore: score,
              outcomeSignals: outcome,
              safeToReuse: classification.safeToReuse,
              rejectionReason: classification.rejectionReason,
            });
          }
        } catch {
          // nunca fallar por autoaprendizaje
        }
      })();
    }

    // Update message counters & last user timestamp.
    const userMsgCount = Math.max(0, Number(state.user_msg_count ?? 0)) + 1;
    state.user_msg_count = userMsgCount;
    state.last_user_at = nowIso;

    // Accumulate search context across turns.
    // On topic change: reset vehicle fields from prev context, keep budget/personal data.
    const nextSearchCtx = mergeSearchContext(state.search_context, extracted, topicChanged);
    state.search_context = nextSearchCtx;
    state.search_context_at = nowIso;

    // Lead score recalculated each turn.
    const leadBreakdown = computeLeadScoreBreakdown({ ...state, last_query: rawText }, extracted, now);
    state.leadScore = leadBreakdown.total;

    const aggEntry = aggregators.get(key);
    const cleanup = () => {
      const e = aggregators.get(key);
      if (e?.timer) clearTimeout(e.timer);
      if (e?.sendTimer) clearTimeout(e.sendTimer);
      aggregators.delete(key);
    };

    const lastMedia = (aggEntry as any)?.lastMedia ?? null;

    const scheduleReply = (reply: string, nextState: any, options?: { imageUrl?: string; handoff?: boolean }) => {
      const delayMs = computeHumanDelay(reply);
      void evolutionSendPresence(instance, number, 'composing', Math.min(delayMs, 5000)).catch(() => {});

      const timer = setTimeout(async () => {
        const sentIso = new Date().toISOString();
        const shouldMoveToHuman = Boolean(options?.handoff || nextState?.agent?.handoffRecommended || nextState?.last_intent === 'handoff');
        try {
          if (options?.imageUrl) {
            await sendImageAndPersist(instance, remoteJid, options.imageUrl, reply, shouldMoveToHuman ? {
              handoff: true,
              ticketStatus: 'open',
              botMode: 'HUMAN_ONLY'
            } : undefined);
          } else {
            await sendTextHuman(instance, remoteJid, reply, shouldMoveToHuman ? {
              handoff: true,
              ticketStatus: 'open',
              botMode: 'HUMAN_ONLY'
            } : undefined);
          }

          await setState(instance, remoteJid, {
            ...nextState,
            lastBotAt: sentIso,
            last_bot_reply_at: sentIso,
            last_bot_reply_hash: hashString(reply)
          });

          try {
            const intent = typeof nextState?.last_intent === 'string' && nextState.last_intent.trim()
              ? nextState.last_intent.trim()
              : undefined;
            const sources = Array.isArray(nextState?.last_sources) ? nextState.last_sources : [];
            const extractedObj = nextState?.extracted ?? nextState?.lead ?? {};
            const missingFields = Array.isArray(nextState?.missing_fields) ? nextState.missing_fields : [];
            const variant = typeof nextState?.last_variant === 'string' && nextState.last_variant.trim()
              ? nextState.last_variant.trim()
              : undefined;
            if (rawText && reply) {
              await logEpisode({
                instance, remoteJid, channel: 'whatsapp',
                user_text: rawText, reply_text: reply,
                intent, variant, sources, extracted: extractedObj, missing_fields: missingFields
              });
            }
          } catch { /* ignore episode failures */ }

          // ── Sistema de Aprendizaje: capturar turno ──────────────────────────
          if (rawText && reply) {
            const captureIntent = typeof nextState?.last_intent === 'string'
              ? nextState.last_intent.trim()
              : undefined;

            // Inferir source_type desde last_intent (v6 — orden de prioridad corregido)
            let captureSource: SourceType = 'agent';
            if (!captureIntent || captureIntent === 'fallback') {
              captureSource = 'fallback';
            } else if (captureIntent === 'gpt_fallback') {
              captureSource = 'gpt';
            } else if (captureIntent.startsWith('faq') || captureIntent.startsWith('knowledge_faq') || captureIntent === 'knowledge') {
              captureSource = 'faq';
            } else if (
              captureIntent.startsWith('policy') ||
              captureIntent.startsWith('knowledge_policy') ||
              captureIntent.startsWith('playbook') ||
              captureIntent === 'compra_directa' ||
              captureIntent === 'indecision' ||
              captureIntent === 'comparacion' ||
              captureIntent === 'cierre_frio' ||
              captureIntent === 'visita' ||
              captureIntent === 'financiacion' ||
              captureIntent === 'permuta'
            ) {
              captureSource = 'playbook';
            } else if (captureIntent.startsWith('agent_')) {
              captureSource = 'agent';
            }
            // Nota: greeting, tradein, financing, product_results quedan como 'agent' (comportamiento esperado)

            void captureConversationTurn({
              instance,
              remoteJid,
              turnIndex: Number((nextState as any)?.turn_count ?? 0),
              userMessage: rawText,
              botResponse: reply,
              intent: captureIntent,
              confidence: Number(nextState?.agent?.confidence ?? 0) || undefined,
              sourceType: captureSource,
              extractedContext: nextState?.extracted ?? nextState?.search_context ?? {},
              leadScore: typeof nextState?.leadScore === 'number' ? nextState.leadScore : undefined
            }).catch(() => {});

            // ── Autoevaluación del turno (Fase 2 — botMemory) ──────────────────
            // Registrar métricas sin bloquear. Solo datos conversacionales, nunca de catálogo.
            try {
              const questionCount = (reply.match(/\?/g) || []).length;
              const extractedFields = Object.keys(nextState?.extracted ?? nextState?.search_context ?? {})
                .filter((k) => !['instance', 'remoteJid', 'timestamp'].includes(k)).length;
              recordTurnMetrics({
                conversationId: remoteJid,
                turnIndex: Number((nextState as any)?.turn_count ?? 0),
                responseLength: reply.length,
                questionsAsked: questionCount,
                dataExtracted: extractedFields,
                followUp: false, // se actualizará en el próximo mensaje del usuario
                timestamp: new Date().toISOString(),
              });
            } catch { /* nunca fallar por métricas */ }

            // ── Fase 3: Autoevaluación del turno generado ─────────────────────
            // Se ejecuta justo después de enviar la respuesta.
            // El resultado queda en los logs y se adjunta a la entrada de DB
            // cuando el siguiente mensaje evalúe el outcome real.
            try {
              const evalContext = nextState?.extracted ?? nextState?.search_context ?? {};
              selfEvaluateResponse(rawText, reply, evalContext);
            } catch { /* nunca fallar por autoevaluación */ }
          }

          // ── Extract commercial fields from this turn for persistent memory ──
          const newShownIds = extractShownVehicleIdsFromHistory([{ role: 'assistant', content: reply }]);
          const extractedCta = extractCtaFromReply(reply);
          const hasVisitInterest = detectVisitInterest(rawText);

          void upsertLeadProfile({
            instance,
            remoteJid,
            extracted: nextState?.extracted ?? extracted,
            leadScore: nextState?.leadScore ?? state.leadScore,
            leadLabel: leadLabel(Number(nextState?.leadScore ?? state.leadScore ?? 0)),
            decision: nextState?.agent ? {
              intent: nextState.agent.intent || 'agent_fallback',
              confidence: Number(nextState.agent.confidence ?? 0),
              action: nextState.agent.action || 'FOLLOWUP',
              extracted: {},
              missingFields: Array.isArray(nextState.agent.missingFields) ? nextState.agent.missingFields : [],
              vehicleIds: [],
              urgency: nextState.agent.urgency || 'medium',
              handoffRecommended: Boolean(nextState.agent.handoffRecommended),
              suggestedReply: String(nextState.agent.suggestedReply || ''),
              internalReason: nextState.agent.internalReason || undefined
            } : null,
            lastSummary: nextState?.agent?.suggestedReply ?? null,
            // v016: commercial memory fields
            funnelStage: (nextState as any)?._coachStage ?? (nextState as any)?.stage ?? null,
            mainObjection: (nextState as any)?._mainObjection ?? null,
            lastCtaOffered: extractedCta,
            visitInterest: hasVisitInterest || null,
            // On topic change: reset shown vehicle IDs (new search, don't block any vehicle)
            shownVehicleIds: topicChanged ? [] : (newShownIds.length ? newShownIds : null),
            // Don't count topic-change turns as recontact (it's not a warm resume, it's a new search)
            incrementRecontact: isRecontactTurn && !topicChanged,
          });

          const sock = getSocket();
          if (sock) {
            sock.emit('send.message', { instance, number, text: reply, imageUrl: options?.imageUrl ?? null });
          }
        } catch (err) {
          console.error(err);
        } finally {
          cleanup();
        }
      }, delayMs);

      if (aggEntry) {
        if (aggEntry.sendTimer) clearTimeout(aggEntry.sendTimer);
        aggEntry.sendTimer = timer;
        aggregators.set(key, aggEntry);
      }
    };

    // ── Low-signal ack ──────────────────────────────────────────────────────
    if (isAckOnly(rawText)) {
      if (state.stage === 'awaiting_query') { cleanup(); return; }
      if (!chance(0.35)) { cleanup(); return; }
      scheduleReply(pickOne(['Dale 👍', 'Ok!', 'Perfecto', 'Genial 🙌']), { ...state, stage: state.stage ?? 'idle' });
      return;
    }

    // Lazy-load catalog: only fetch when the message could need vehicle data
    const catalog = await getCatalog();

    // ── Handoff detection ───────────────────────────────────────────────────
    // v3: urgencia temporal distinguida de urgencia adjetival.
    // "urgente" suelto NO escala si es adjetivo de búsqueda (ej: "quiero algo urgente barato").
    // Solo escala cuando hay contexto temporal explícito (esta semana, mañana, ya mismo, cuando antes).
    // v4 hardening: regex ampliado con "cuando antes", "para hoy", "lo quiero hoy", "urgente lo necesito"
    const TEMPORAL_URGENCY_RE = /\b(?:esta\s+semana|la\s+semana\s+que\s+viene|para\s+ma[nñ]ana|para\s+hoy|lo\s+quiero\s+(?:hoy|ya)|lo\s+necesito\s+(?:ya|urgente|r[aá]pido|hoy)|lo\s+quiero\s+ya|ya\s+mismo|cuanto\s+antes|cuando\s+antes|urgente\s+(?:lo\s+)?necesito|necesito\s+si\s+o\s+si(?:\s+esta\s+semana)?)\b/i;
    const hasTemporalUrgency = TEMPORAL_URGENCY_RE.test(rawText);

    // Capturar qué parte del texto matcheó la urgencia (para el log de trazabilidad)
    let temporalUrgencyMatch: string | null = null;
    if (hasTemporalUrgency) {
      const m = rawText.match(TEMPORAL_URGENCY_RE);
      temporalUrgencyMatch = m ? m[0] : null;
    }

    const CLOSING_INTENT_RE = /(comprar|reservar|reserva|se[ñn]a(?:r|rl|lo)?|pagar|quiero\s*ya|transferencia|me\s+lo\s+llevo|cerramos|quiero\s+verlo|quiero\s+ese|vamos\s+con|agendar|coordinar|puedo\s+ir|voy\s+ma[nñ]ana|me\s+interesa\s+ese|visita|ver\s+el\s+auto|probarlo|test\s*drive|parte\s+de\s+pago|permuta|entrego\s+mi\s+auto|hablar\s+con\s+alguien|hablar\s+con\s+una\s+persona|hablar\s+con\s+un\s+asesor|quiero\s+hablar\s+con|me\s+comunic[ao]s?\s+con|dame\s+un\s+contacto|me\s+dan\s+un\s+contacto|est[áa]\s+furioso|estoy\s+furioso|me\s+mandaron\s+mal|recl[ao]m[ao]|quiero\s+quejarme|muy\s+enojado|harto|quiero\s+ir\s+a\s+verlo|quisiera\s+ir|puedo\s+pasar|cu[aá]ndo\s+puedo\s+(?:ir|pasar|verlo)|me\s+dan\s+(?:un\s+)?turno)/i;
    const hasClosingIntent = CLOSING_INTENT_RE.test(rawText);
    const wantsHandoff = hasClosingIntent || hasTemporalUrgency;

    // Log de HANDOFF_SKIP para urgencia adjetival (ej: "urgente quiero algo barato")
    // Esto permite monitorear en Railway si el bot correctamente NO escaló.
    const hasAdjectivalUrgency = /\burgente\b/i.test(rawText) && !hasTemporalUrgency;
    if (hasAdjectivalUrgency && !wantsHandoff) {
      const adjectiveMatch = rawText.match(/\b(urgente|r[aá]pido)\b/i);
      console.info('[HANDOFF_SKIP]', JSON.stringify({
        reason: 'adjectival_urgency',
        matchReason: 'adjectival_urgency',
        match: adjectiveMatch ? adjectiveMatch[0] : 'urgente',
        input: rawText.substring(0, 100),
        escalate: false,
      }));
    }

    if (wantsHandoff) {
      const selectedVehicle = await findReferencedVehicle(catalog, rawText, state.search_context);
      const tradeInSummary = describeTradeIn(extracted);

      // Classify handoff type to tailor the reply: complaint, urgency, or standard closing
      const isComplaint = /(furioso|enojado|harto|mandaron\s+mal|reclam[ao]|quejarme)/i.test(rawText);
      const isUrgent = hasTemporalUrgency;
      const wantsPerson = /(hablar\s+con\s+alguien|hablar\s+con\s+una\s+persona|hablar\s+con\s+un\s+asesor|quiero\s+hablar\s+con|dame\s+un\s+contacto)/i.test(rawText);

      // Log estructurado de handoff para monitoreo de falsos positivos
      const handoffMatchedPatterns: string[] = [];
      if (isComplaint) handoffMatchedPatterns.push('complaint');
      if (isUrgent) handoffMatchedPatterns.push('temporal_urgency');
      if (wantsPerson) handoffMatchedPatterns.push('wants_person');
      if (!isComplaint && !isUrgent && !wantsPerson) handoffMatchedPatterns.push('closing_intent');
      console.info('[HANDOFF_TRIGGER]', JSON.stringify({
        reason: handoffMatchedPatterns.join('+'),
        matchReason: isUrgent ? 'temporal_urgency' : isComplaint ? 'complaint' : wantsPerson ? 'wants_person' : 'closing_intent',
        matchedText: temporalUrgencyMatch ?? null,
        input: rawText.substring(0, 100),
        escalate: true,
        flags: {
          highUrgency: Boolean(extracted?.highUrgency),
          wantsHandoff: true,
          multipleVehicleTypes: Boolean(extracted?.multipleVehicleTypes),
          hasTemporalUrgency,
        },
        timestamp: new Date().toISOString(),
      }));

      try {
        await setConversationRule(instance, remoteJid, 'HUMAN_ONLY');
        const pairs = Object.entries(extracted || {})
          .filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
          .slice(0, 12)
          .map(([k, v]) => `${k}=${String(v)}`);
        const handoffReason = isComplaint ? 'reclamo' : isUrgent ? 'urgencia' : wantsPerson ? 'solicitud_persona' : 'intencion_de_cierre';
        await addConversationNote(instance, remoteJid,
          `Handoff automático [${handoffReason}]. Texto: "${rawText.slice(0, 140)}"\nDatos: ${pairs.join(' | ') || 'n/a'}`);
      } catch (err) {
        console.error('Failed to set conversation rule on handoff', err);
      }

      // Build reply tailored to handoff type
      let handoffReply: string;
      if (isComplaint) {
        handoffReply = extracted?.name
          ? `Entiendo, ${extracted.name}. Lamento la situación. Te paso con un asesor ahora mismo para resolverlo.`
          : 'Entiendo, lamento lo que pasó. Te paso con un asesor ahora para resolverlo directamente.';
      } else if (isUrgent) {
        handoffReply = [
          selectedVehicle ? `Perfecto, urgencia tomada para el ${selectedVehicle.name}.` : 'Perfecto, tomo tu urgencia.',
          extracted?.name
            ? `Te contacta un asesor en breve, ${extracted.name}.`
            : 'En breve te escribe un asesor para coordinar rápido.'
        ].join(' ');
      } else if (wantsPerson) {
        handoffReply = extracted?.name
          ? `Dale, ${extracted.name}. En un momento te escribe un asesor directo.`
          : 'Claro, te paso con un asesor. En un momento te contactan.';
      } else {
        const handoffVariants = [
          [
            selectedVehicle ? `Perfecto, ya tomo interés por el ${selectedVehicle.name}.` : 'Perfecto, ya tomo tu interés.',
            tradeInSummary ? `También dejo anotado que entregás ${tradeInSummary}.` : '',
            extracted?.name && extracted?.city
              ? `Ahora te sigue un asesor para avanzar desde ${extracted.city}.`
              : 'Te paso con un asesor para avanzar con esto ahora. Decime tu nombre y zona.'
          ].filter(Boolean).join(' '),
          [
            selectedVehicle ? `Buenísimo, vamos con ${selectedVehicle.name}.` : 'Buenísimo, avanzamos con eso.',
            tradeInSummary ? `Tu usado ${tradeInSummary} queda cargado como parte de pago.` : '',
            extracted?.name
              ? `En un momento te escribe un asesor para seguir la operación, ${extracted.name}.`
              : 'En un momento te escribe un asesor para seguir la operación.'
          ].filter(Boolean).join(' ')
        ];
        handoffReply = pickOne(handoffVariants);
      }
      scheduleReply(handoffReply, {
        ...state,
        stage: 'idle',
        last_intent: 'handoff',
        extracted,
        missing_fields: [],
        agent: {
          intent: 'handoff',
          confidence: 0.95,
          action: 'ESCALATE_HUMAN',
          urgency: 'high',
          handoffRecommended: true,
          suggestedReply: handoffReply,
          missingFields: [],
          internalReason: isComplaint ? 'reclamo_cliente' : isUrgent ? 'urgencia_temporal' : wantsPerson ? 'solicitud_persona' : selectedVehicle ? `interes_concreto:${selectedVehicle.id}` : 'intencion_de_cierre',
          updatedAt: nowIso
        }
      }, { handoff: true });
      return;
    }

    // ── Financing flow continuation ───────────────────────────────────────
    // When the bot is collecting financing data, intercept ALL replies and
    // route them directly — do not fall through to the intelligence layer.
    if (state.finance?.stage === 'collecting') {
      const finance = { ...(state.finance || {}) } as any;

      // Build the list of fields still needed (from stored missing_fields or re-derive).
      const prevMissing: string[] = Array.isArray((state as any).missing_fields) && (state as any).missing_fields.length > 0
        ? [...(state as any).missing_fields]
        : (['precio', 'entrada', 'cuotas'] as const).filter(f => {
            if (f === 'precio') return !finance.price;
            if (f === 'entrada') return finance.downPayment === undefined || finance.downPayment === null;
            if (f === 'cuotas') return !finance.months;
            return false;
          });

      if (prevMissing.length > 0) {
        // Parse numeric-only replies (e.g. "24", "3000000", "0")
        const numericOnly = /^\s*\d+([.,]\d+)?\s*$/.test(rawText.trim());
        const numVal = numericOnly ? parseFloat(rawText.trim().replace(',', '.')) : NaN;
        const firstMissing = prevMissing[0];

        if (firstMissing === 'precio') {
          if (extracted?.amount && Number(extracted.amount) > 0) {
            finance.price = Number(extracted.amount);
          } else if (!Number.isNaN(numVal) && numVal > 100) {
            finance.price = numVal;
          }
        } else if (firstMissing === 'entrada') {
          if (/\b(sin\s*anticipo|sin\s*entrada|no\s*tengo|sin\s*se[ñn]a)\b/i.test(rawText) || rawText.trim() === '0') {
            finance.downPayment = 0;
          } else if (/\b(entrada|anticipo|se[ñn]a)\b/i.test(rawText) && extracted?.amount !== undefined) {
            finance.downPayment = Number(extracted.amount);
          } else if (!Number.isNaN(numVal)) {
            finance.downPayment = numVal; // includes 0
          } else if (extracted?.amount !== undefined) {
            finance.downPayment = Number(extracted.amount);
          }
        } else if (firstMissing === 'cuotas') {
          if (extracted?.cuotas) {
            finance.months = Number(extracted.cuotas);
          } else if (!Number.isNaN(numVal) && numVal >= 1 && numVal <= 120) {
            finance.months = Math.round(numVal);
          }
        }

        // Re-derive still-missing after attempting to fill
        const stillMissing: string[] = [];
        if (!finance.price) stillMissing.push('precio');
        if (finance.downPayment === undefined || finance.downPayment === null) stillMissing.push('entrada');
        if (!finance.months) stillMissing.push('cuotas');

        const { _forceFinancing: _ffi, ...scFin } = state as any;

        if (stillMissing.length < prevMissing.length) {
          // Made progress — either ask next question or run simulation
          if (stillMissing.length > 0) {
            scheduleReply(getNextFinanceQuestion(stillMissing), {
              ...scFin,
              stage: 'idle' as const,
              lastBotAt: nowIso,
              finance: { ...finance, stage: 'collecting' },
              missing_fields: stillMissing,
              last_intent: 'financing',
              extracted,
            } as any);
            return;
          }

          // All fields collected — run the simulation
          const apr = await getFinanceApr();
          const sim = simulateFinancing({
            price:       Number(finance.price),
            downPayment: Number(finance.downPayment || 0),
            months:      Number(finance.months),
            apr,
          });
          finance.apr       = apr;
          finance.monthly   = sim.monthly;
          finance.createdAt = nowIso;
          finance.stage     = 'idle';

          const simReply = [
            `✅ Simulación estimada:`,
            `• Precio: ARS ${formatArs(sim.price)}`,
            `• Entrada: ARS ${formatArs(sim.downPayment)}`,
            `• Plazo: ${sim.months} meses`,
            `• Tasa: ~${Math.round(apr * 100)}% anual`,
            `\n💳 Cuota estimada: **ARS ${formatArs(sim.monthly)} / mes**`,
            `\n¿Querés que te arme una cotización formal? Si me decís el vehículo que te interesa, lo armo ahora.`,
          ].join('\n');

          try {
            await addConversationNote(instance, remoteJid,
              `Simulación financiación: precio=${sim.price} entrada=${sim.downPayment} meses=${sim.months} apr=${apr} cuota=${Math.round(sim.monthly)}`
            );
          } catch { /* ignore */ }

          scheduleReply(simReply, {
            ...scFin,
            stage: 'idle' as const,
            lastBotAt: nowIso,
            finance,
            last_intent: 'financing',
            missing_fields: [],
            extracted,
          } as any);
          return;
        }

        // Couldn't extract a value from the reply — re-ask the same question
        if (numericOnly || /^\s*\d/.test(rawText)) {
          scheduleReply(getNextFinanceQuestion(prevMissing), {
            ...scFin,
            stage: 'idle' as const,
            lastBotAt: nowIso,
            finance: { ...finance, stage: 'collecting' },
            missing_fields: prevMissing,
            last_intent: 'financing',
            extracted,
          } as any);
          return;
        }

        // Non-numeric, unclear reply → fall through to normal handling but keep finance alive
        (state as any)._forceFinancing = true;
      }
    }

    // ── Quick follow-up: user replies with option number ────────────────────
    const lastHits: string[] = Array.isArray((state as any).last_hits) ? (state as any).last_hits : [];
    const lastHitsAtStr: string | undefined = (state as any).last_hits_at;
    const lastHitsAt = lastHitsAtStr ? Date.parse(lastHitsAtStr) : NaN;
    const lastHitsFresh = lastHits.length > 0 && !Number.isNaN(lastHitsAt) && now - lastHitsAt < 20 * 60 * 1000;
    const opt = extractOptionNumber(rawText);
    const asksPriceQuick = /(precio|cuanto|vale|valor|sale)/i.test(rawText);

    if (lastHitsFresh) {
      if (opt && opt >= 1 && opt <= lastHits.length) {
        const selectedId = lastHits[opt - 1];
        const item = catalog.find((x) => x.id === selectedId);
        if (item) {
          const detailReply = `Bien, de las que viste me quedaría con esta:\n${formatItemLine(item, opt)}\n\nSi querés, coordinamos visita, te veo financiación o te tomo la permuta.`;
          scheduleReply(detailReply, { ...state, stage: 'idle', last_intent: 'option_selected' } as any, { imageUrl: (item as any).image ?? undefined });
          return;
        }
      }
      if (asksPriceQuick && !opt) {
        scheduleReply(`¿De cuál opción querés el precio? (1-${Math.min(lastHits.length, 3)})`,
          { ...state, stage: 'idle', last_intent: 'ask_price_which' } as any);
        return;
      }
    }

    // ── Multi-turn refinement: if we just showed product results and user adds filters,
    // refine using accumulated search_context instead of starting from scratch.
    const prevIntent = String((state as any).last_intent || '');
    const hasSearchCtx = !!(state.search_context && hasUsefulSearchContext(state.search_context));
    const looksLikeRefineOnly = !/(busco|quiero|tenes|tienes|hay|mostrame|mostrar|opcion|opci[oó]n)/i.test(rawText)
      && /\b(20\d{2}|19\d{2}|manual|autom[aá]t|cvt|dsg|nafta|diesel|gasoil|gnc|suv|pickup|hatch|sedan|hasta|m[aá]ximo|palos|mil|usd|dolares?)\b/i.test(rawText);

    if ((prevIntent === 'product_results' || prevIntent === 'product_results_single') && hasSearchCtx && looksLikeRefineOnly) {
      const refined = await filterCatalogByContext(catalog, state.search_context);
      const baseHits = refined.length > 0
        ? refined.slice(0, 3)
        : searchCatalog(catalog, rawText, 3);
      const { hits } = applyVehicleGuardrails(rawText, baseHits);

      if (hits.length) {
        const header = pickOne(['Perfecto, ajusto la búsqueda 👇', 'Listo, con esos filtros te dejo estas 👇', 'Dale, refinando… mirá 👇']);
        const reply = [header, ...hits.map((it, i) => formatItemLine(it, i + 1))].join('\n');
        const nextState: ConvState = {
          ...state,
          stage: 'idle',
          last_intent: 'product_results',
          last_query: (state.last_query || '') + ' | refine: ' + rawText,
          last_hits: hits.map((it) => it.id).slice(0, 3),
          last_hits_at: nowIso,
          extracted
        } as any;
        scheduleReply(reply, nextState);
        return;
      }
    }

    let reply = '';
    const { _forceFinancing: _ff, ...stateClean } = state as any;
    let newState: ConvState = { ...stateClean, stage: 'idle', lastBotAt: nowIso, extracted, last_media: lastMedia, leadScore: leadBreakdown.total, leadScoreBreakdown: leadBreakdown as any } as any;
    let isFallback = false;

    // ── INTELLIGENCE LAYER: check FAQ / Policy / Playbook FIRST ────────────
    // This is the key improvement — knowledge base is now wired into every message.
    const knowledgeMatch = await matchBest(rawText);
    if (knowledgeMatch && knowledgeMatch.score >= 0.5) {
      const { type, row, score: kScore } = knowledgeMatch;

      if (type === 'playbook') {
        // Playbook: render template with extracted context
        const playbookCtx = { ...extracted, contact_name: extracted?.name ?? '', query: rawText };
        reply = renderTemplate(row.template, playbookCtx);
        // Check if playbook requires additional fields
        const required = requiredFieldsForIntent(row.intent, row.config);
        const missing = computeMissingFields(required, extracted);
        if (missing.length > 0) {
          const questions = buildMissingQuestions(required, missing);
          reply = reply ? `${reply}\n\n${questions}` : questions;
          (newState as any).missing_fields = missing;
          (newState as any).awaiting_playbook = row.intent;
        }
        newState.last_intent = row.intent ?? 'playbook';
        (newState as any).last_sources = [{ type: 'playbook', id: row.id }];
        (newState as any).last_variant = `playbook_${row.id}`;
        void logDecision({ instance, remoteJid, intent: row.intent, confidence: kScore, data: { type: 'playbook', id: row.id } }).catch(() => {});

      } else if (type === 'faq') {
        reply = String(row.answer ?? '');
        newState.last_intent = 'faq';
        (newState as any).last_sources = [{ type: 'faq', id: row.id }];
        void logDecision({ instance, remoteJid, intent: 'faq', confidence: kScore, data: { type: 'faq', id: row.id } }).catch(() => {});

      } else if (type === 'policy') {
        // Policies are INTERNAL RULES — never send body directly to the user.
        // Inject as context for the downstream agent so it can craft a proper response.
        (newState as any)._policyContext = String(row.body ?? '');
        (newState as any).last_sources = [{ type: 'policy', id: row.id }];
        void logDecision({ instance, remoteJid, intent: 'policy', confidence: kScore, data: { type: 'policy', id: row.id } }).catch(() => {});
        // Do NOT set reply — fall through to intent detection / agent
      }

      if (reply) {
        // Run guardrail before sending any FAQ/Playbook response
        const grResult = validateReply(reply, {
          source: type,
          lastBotReply: (state as any).agent?.suggestedReply ?? undefined
        });
        if (!grResult.ok && !grResult.safeReply) {
          console.warn(`[webhooks] guardrail blocked ${type} reply (${grResult.issues.join(',')}). Falling through to agent.`);
          // Don't return — let it fall through to agent for a better response
        } else {
          if (grResult.safeReply && grResult.safeReply !== reply) reply = grResult.safeReply;
          scheduleReply(reply, newState);
          return;
        }
      }
    }

    // ── Awaiting query from previous turn ───────────────────────────────────
    if (state.stage === 'awaiting_query') {
      const rawMatches = await getVehicleMatches(catalog, rawText, state.search_context, 3);
      const guarded = applyVehicleGuardrails(rawText, rawMatches.hits);
      const matches = { ...rawMatches, hits: guarded.hits };
      if (matches.hits.length || matches.usedBudgetFallback) {
        if (matches.hits.length === 1 && !matches.usedBudgetFallback) {
          const item = matches.hits[0];
          const detailReply = buildVehicleReply(rawText, matches, state.search_context);
          const nextState: ConvState = { ...state, stage: 'idle', last_intent: 'product_results_single', last_query: rawText, last_hits: [item.id], last_hits_at: nowIso };
          if (detailReply.trim()) {
            scheduleReply(detailReply, nextState, { imageUrl: (item as any).image ?? undefined });
            return;
          }
          // buildVehicleReply returned empty → fall through to intent detection
        } else {
          reply = buildVehicleReply(rawText, matches, state.search_context);
          if (reply.trim()) {
            newState.last_intent = 'product_results';
            newState.last_query = rawText;
            newState.last_hits = (matches.hits.length ? matches.hits : matches.nearby).map((it) => it.id).slice(0, 3);
            newState.last_hits_at = nowIso;
            // Attach the first result's photo so the user sees a preview image
            (newState as any)._firstVehicleImage = (matches.hits[0] as any)?.image ?? undefined;
          } else {
            // Empty result: fallback to next useful question
            reply = '';
          }
        }
      }
      if (!reply) {
        const nextQuestion = getNextUsefulSearchQuestion({ ...(state.search_context || {}), ...extracted });
        reply = lastMedia && !String(rawText || '').trim()
          ? 'Te vi la imagen. ¿Qué modelo o marca querés mirar?'
          : `No encontré algo lógico todavía. ${nextQuestion}`;
        newState.last_intent = 'no_match';
        newState.last_query = rawText;
        isFallback = true;
      }
    } else {
      // ── Intent detection ──────────────────────────────────────────────────
      const isGreeting = /^(hola|buenas|buen\s+d[ií]a|buen\s+tarde|buen\s+noche|hey|que\s+tal|buenos\s+d[ií]as?|buenas\s+tardes?|buenas\s+noches?)\b/i.test(rawText);
      const isSmallTalk = /(te\s*amo|te\s*amoo|amor|jaja+|😂|🤣|😍|❤️|😘)/i.test(rawText);
      const asksDemand = /(busco|estoy\s+buscando|necesi+to\s+(un\s+)?auto|quiero\s+(un\s+)?(auto|coche|camioneta)|me\s+interesa(?:ría)?\s+un)/i.test(rawText);
      const asksFinancing = /(financ|cuota|cr[eé]dito|prestamo|pr[eé]stamo|banco|entrada|anticipo)/i.test(rawText) || !!(state as any)._forceFinancing;
      const asksTradeIn = /(permuta|canje|parte\s+de\s+pago|doy\s+el\s+m[íi]o|entrego\s+el\s+auto|mi\s+(auto|coche)|tengo\s+un\s+[a-z0-9]+)/i.test(rawText);
      const asksPrice = /(precio|cuanto|vale|valor|sale|financi|cuota|entrega|presupuesto|hasta\s+\d|millones|palos)/i.test(rawText);
      const looksLikeVehicleQuery = /(auto|autos|coche|camioneta|pick\s*up|suv|fiat|ford|volkswagen|vw|renault|toyota|chevrolet|peugeot|jeep|honda|nissan|cronos|gol|amarok|hilux|duster|onix|corolla|km\b|a[ñn]os?\b|modelo\b|nafta|diesel|gnc|manual|automat)/i.test(rawText);
      const looksLikeGamingQuery = /(ps5|play\s*5|xbox|consola|auricular|headset|monitor|notebook|silla|joystick|teclado|mouse)/i.test(rawText);
      const normText = normalize(rawText);
      const hasContent = normText.length >= 3 && /[a-z0-9]/i.test(normText);
      const stage = state.stage as ConvState['stage'];
      const shouldSearch = stage === 'awaiting_query' || looksLikeGamingQuery || looksLikeVehicleQuery || hasStructuredSearchNeed(extracted) || (asksPrice && hasContent);

      if (isGreeting) {
        // v3: si el cliente vuelve después de que el contexto expiró, recordarle su búsqueda anterior
        if (staleContext && (staleContext.brand || staleContext.model || staleContext.maxPrice)) {
          const parts: string[] = [];
          if (staleContext.brand && staleContext.model) parts.push(`${staleContext.brand} ${staleContext.model}`);
          else if (staleContext.brand) parts.push(staleContext.brand);
          else if (staleContext.model) parts.push(staleContext.model);
          if (staleContext.maxPrice) {
            const amt = staleContext.maxPrice;
            parts.push(`hasta ARS ${amt >= 1_000_000 ? (amt / 1_000_000) + ' M' : amt.toLocaleString('es-AR')}`);
          }
          reply = `¡Hola! Bienvenido de vuelta. La última vez estabas buscando ${parts.join(' ')}. ¿Seguís con eso o te puedo ayudar con otra cosa?`;
          // Restaurar el contexto anterior para esta nueva sesión
          state.search_context = staleContext;
          newState.search_context = staleContext;
        } else {
          const greetVariants = [
            '¡Hola! ¿Cómo va? Contame qué auto estás buscando y te doy una mano.',
            '¡Buenas! Decime qué tenés en mente — marca, presupuesto o tipo de vehículo — y te paso lo mejor.',
            '¡Hola! Si querés decime presupuesto o marca y te filtro opciones en serio.'
          ];
          reply = pickOne(greetVariants);
        }
        newState.stage = 'awaiting_query';
        newState.last_intent = 'greeting';

      } else if (isSmallTalk) {
        reply = pickOne(['❤️ Yo también 😊', 'Jajaja 😄 ¿Qué hacés?', '😍 ¡Qué lindo! ¿En qué te ayudo?']);
        newState.stage = 'idle';
        newState.last_intent = 'smalltalk';

      } else if (asksDemand && !looksLikeVehicleQuery && !hasStructuredSearchNeed(extracted)) {
        const nextQuestion = getNextUsefulSearchQuestion(state.search_context || {});
        reply = `Perfecto. ${nextQuestion}`;
        newState.stage = 'awaiting_query';
        newState.last_intent = 'demand_intake';

      } else if (asksFinancing) {
        // Financing simulator (offline): collect price, downPayment, months.
        const finance = { ...(state.finance || {}), stage: 'collecting' } as any;

        // Try infer price from last single option.
        const lastHitsNow: string[] = Array.isArray((state as any).last_hits) ? (state as any).last_hits : [];
        if (!finance.price && lastHitsNow.length === 1) {
          const item = catalog.find((x) => x.id === lastHitsNow[0]);
          if (item?.priceNumber) finance.price = Number(item.priceNumber);
        }

        // Heuristics: if text contains "entrada/anticipo" and we parsed an amount, treat as down payment.
        if (/\b(entrada|anticipo|se[ñn]a)\b/i.test(rawText) && extracted?.amount) {
          finance.downPayment = Number(extracted.amount);
        } else if (!finance.price && extracted?.amount) {
          // If we don't have price yet, treat the first amount as price.
          finance.price = Number(extracted.amount);
        }

        if (extracted?.cuotas) finance.months = Number(extracted.cuotas);

        const missing: string[] = [];
        if (!finance.price) missing.push('precio');
        if (!finance.months) missing.push('cuotas');
        if (finance.downPayment === undefined || finance.downPayment === null) missing.push('entrada');

        if (missing.length > 0) {
          reply = `Dale, te la simulo. ${getNextFinanceQuestion(missing)}`;
          (newState as any).missing_fields = missing;
          newState.finance = finance;
        } else {
          const apr = await getFinanceApr();
          const sim = simulateFinancing({
            price: Number(finance.price),
            downPayment: Number(finance.downPayment || 0),
            months: Number(finance.months),
            apr
          });

          finance.apr = apr;
          finance.monthly = sim.monthly;
          finance.createdAt = nowIso;
          finance.stage = 'idle';
          newState.finance = finance;

          const monthlyTxt = formatArs(sim.monthly);
          const priceTxt = formatArs(sim.price);
          const downTxt = formatArs(sim.downPayment);
          const aprPct = Math.round(apr * 100);

          reply = [
            `✅ Simulación estimada:`,
            `• Precio: ARS ${priceTxt}`,
            `• Entrada: ARS ${downTxt}`,
            `• Plazo: ${sim.months} meses`,
            `• Tasa: ~${aprPct}% anual`,
            `\n💳 Cuota estimada: **ARS ${monthlyTxt} / mes**`,
            `\nSi me decís qué unidad te interesa, te armo una cotización con datos exactos.`
          ].join('\n');

          // Best-effort: persist a note for the operator.
          try {
            await addConversationNote(instance, remoteJid, `Simulación financiación: precio=${sim.price} entrada=${sim.downPayment} meses=${sim.months} apr=${apr} cuota=${Math.round(sim.monthly)}`);
          } catch {
            // ignore
          }
        }

        newState.last_intent = 'financing';

      } else if (asksTradeIn) {
        const required = requiredFieldsForIntent('permuta');
        const missing = computeMissingFields(required, extracted);
        if (missing.length > 0) {
          const knownTradeIn = describeTradeIn(extracted);
          reply = [
            knownTradeIn ? `Perfecto, ya tomo ${knownTradeIn} como parte de pago.` : 'Perfecto, podemos tomar tu usado como parte de pago.',
            getNextTradeInQuestion(missing)
          ].filter(Boolean).join(' ');
          (newState as any).missing_fields = missing;
        } else {
          const model = extracted.tradeInModel ?? extracted.model ?? '';
          const year = extracted.tradeInYear ?? extracted.year ?? '';
          const km = extracted.tradeInKm !== undefined ? ` con ${extracted.tradeInKm.toLocaleString('es-AR')} km` : '';
          reply = `Perfecto, tomo ${model} ${year}${km} como parte de pago. Si querés, te busco 2 o 3 opciones que cierren mejor con esa permuta.`;
        }
        newState.last_intent = 'tradein';

      } else if (asksPrice && !hasStructuredSearchNeed(extracted) && !hasUsefulSearchContext(state.search_context ?? {})) {
        // Solo pedir modelo si NO tenemos contexto — si ya sabemos la marca/modelo, buscamos directo
        reply = pickOne([
          'Decime qué modelo tenés en mente y te confirmo precio y disponibilidad.',
          'Pasame marca o modelo y te lo chequeo bien.',
          'Si me decís la unidad o al menos la marca, te respondo más preciso.'
        ]);
        newState.stage = 'awaiting_query';
        newState.last_intent = 'price_request';

      } else if (shouldSearch) {
        const rawMatches = await getVehicleMatches(catalog, rawText, state.search_context, 3);
        const guarded = applyVehicleGuardrails(rawText, rawMatches.hits);
        const matches = { ...rawMatches, hits: guarded.hits };
        if (matches.hits.length || matches.usedBudgetFallback) {
          if (matches.hits.length === 1 && !matches.usedBudgetFallback) {
            const item = matches.hits[0];
            const detailReply = buildVehicleReply(rawText, matches, state.search_context);
            if (detailReply.trim()) {
              const nextState: ConvState = { ...state, stage: 'idle', last_intent: 'product_results_single', last_query: rawText, last_hits: [item.id], last_hits_at: nowIso };
              scheduleReply(detailReply, nextState, { imageUrl: (item as any).image ?? undefined });
              return;
            }
            // Empty detailReply → fall through to next question
          } else {
            const candidateReply = buildVehicleReply(rawText, matches, state.search_context);
            if (candidateReply.trim()) {
              reply = candidateReply;
              newState.last_intent = 'product_results';
              newState.last_query = rawText;
              newState.last_hits = (matches.hits.length ? matches.hits : matches.nearby).map((it) => it.id).slice(0, 3);
              newState.last_hits_at = nowIso;
              // Attach the first result's photo so the user sees a preview image
              (newState as any)._firstVehicleImage = (matches.hits[0] as any)?.image ?? undefined;
            }
          }
        }
        if (!reply) {
          if (lastMedia && !String(rawText || '').trim()) {
            reply = 'Te vi la imagen. ¿Qué modelo o marca querés mirar?';
            newState.last_intent = 'no_match';
            newState.stage = 'awaiting_query';
            isFallback = true;
          } else {
            // Sin match en catálogo: no dar genérico de inmediato — dejar que el agente
            // genere una respuesta más inteligente (alternativas, lista de espera, etc.).
            // Marcamos el contexto para que el agente sepa que no hubo stock.
            (newState as any)._noStockContext = true;
            // reply queda vacío → el código cae al agente en la rama else de shouldSearch? No,
            // shouldSearch es un else-if. Usamos el flag para mejorarlo en el agente call abajo.
            // Por ahora damos una respuesta consultiva como fallback de shouldSearch.
            const ctx = { ...(state.search_context || {}), ...extracted };
            const hasModel = !!(ctx.brand || ctx.model);
            if (hasModel) {
              const what = [ctx.brand, ctx.model].filter(Boolean).join(' ');
              reply = pickOne([
                `Ahora mismo no tengo ${what} en stock, pero puedo anotarte para avisarte cuando entre. ¿Querés que te anote o preferís ver alternativas parecidas?`,
                `No tengo ${what} disponible en este momento. ¿Te sirve que te muestre algo similar o preferís esperar a que entre stock?`,
              ]);
            } else {
              const nextQuestion = getNextUsefulSearchQuestion(ctx);
              reply = `No encontré algo exacto con lo que tenés. ${nextQuestion}`;
            }
            newState.last_intent = 'no_match';
            newState.last_query = rawText;
            newState.stage = 'awaiting_query';
            isFallback = true;
          }
        }

      } else {
        // Fallback 1: full-text knowledge search
        const kResults = await searchKnowledge(rawText, 2);
        if (kResults.length > 0 && kResults[0].rank > 0) {
          const snippet = kResults[0].snippet;
          // Only use snippet if it passes the guardrail (snippets from policies can be internal)
          const snGr = validateReply(snippet, {
            source: kResults[0].type,
            lastBotReply: (state as any).agent?.suggestedReply ?? undefined
          });
          if (snGr.ok || snGr.safeReply) {
            reply = snGr.safeReply ?? snippet;
            newState.last_intent = `knowledge_${kResults[0].type}`;
            (newState as any).last_sources = [{ type: kResults[0].type, id: kResults[0].id }];
          }
          // If guardrail blocked the snippet → fall through to agent below
        }
        if (!reply) {
          // Fallback 2: agente estructurado + GPT clásico
          try {
            const catalogSummary = catalog.slice(0, 12).map((it: any) => {
              const price = it.priceFormatted ?? (it.priceNumber ? `$${it.priceNumber.toLocaleString('es-AR')}` : '');
              return `- ${it.brand ?? ''} ${it.model ?? ''} ${it.year ?? ''} ${it.version ?? ''} ${price ? `(${price})` : ''}`.replace(/\s+/g, ' ').trim();
            }).filter(Boolean).join('\n');

            const { faqs: cachedFaqs } = await (async () => {
              const r = await import('../services/intelligence.js');
              const allFaqs = await r.listFaq();
              return { faqs: allFaqs.filter((f: any) => f.enabled && !f.draft).slice(0, 8) };
            })();
            const faqSummary = cachedFaqs.map((f: any) => {
              const faqTitle = ((f.triggers ?? []).join(' / ') || f.title || '');
              return `P: ${faqTitle}\nR: ${String(f.answer ?? '').slice(0, 200)}`;
            }).join('\n\n');
            const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
            const turns = (state as any).gpt_history ?? [];
            for (const t of turns.slice(-6)) history.push({ role: t.role, content: t.content });

            // Merge search_context + extracted + lead memory para que el agente tenga el contexto completo acumulado.
            // On topic change: mergeMemoryIntoExtracted skips vehicle fields from DB memory.
            const mergedExtractedRaw = mergeMemoryIntoExtracted(
              { ...(state.search_context ?? {}), ...extracted },
              leadMemory,
              { topicChanged }
            );
            // Guardrail final: eliminar pares brand+model semánticamente inválidos (ej: "ford+strada")
            const mergedExtracted = sanitizeBrandModel(mergedExtractedRaw);

            if (mergedExtractedRaw.brand !== mergedExtracted.brand || mergedExtractedRaw.model !== mergedExtracted.model) {
              console.warn(`[webhooks] sanitizeBrandModel corrected context: ${mergedExtractedRaw.brand}+${mergedExtractedRaw.model} → ${mergedExtracted.brand}+${mergedExtracted.model ?? '(sin modelo)'}`);
            }

            // ── Shown vehicles: combinar DB + historial de sesión ────────────────
            // On topic change: no reutilizar shown_vehicle_ids anteriores (nueva búsqueda)
            const historyShownIds = extractShownVehicleIdsFromHistory(history);
            const allShownIds = topicChanged
              ? []  // reset: new topic → show fresh vehicles
              : mergeShownVehicleIds(leadMemory?.shownVehicleIds, historyShownIds);

            // ── Ranking comercial del catálogo (priorizá relevancia para este lead) ──
            let rankedCatalog: any[] = catalog;
            try {
              if (Array.isArray(catalog) && catalog.length > 0) {
                const { topVehicles, diagnosticLog } = rankVehiclesForLead({
                  vehicles: catalog as any[],
                  extracted: mergedExtracted,
                  shownVehicleIds: allShownIds,
                  maxResults: 30,
                });
                rankedCatalog = topVehicles;
                if (diagnosticLog) console.log(`[ranker] top3:\n${diagnosticLog}`);
              }
            } catch (rankErr) {
              console.error('[ranker] error (non-blocking):', rankErr);
            }

            // ── Memoria comercial: bloque para inyectar al agente ────────────────
            // On topic change: don't inject a "returning customer" block — it's misleading
            // when the user already signaled they want something completely different.
            let memoryBlock = '';
            try {
              if (!topicChanged) {
                memoryBlock = buildMemorySummaryBlock(leadMemory, isRecontactTurn, { skipIfEmpty: true });
                if (isRecontactTurn) {
                  console.log(`[leadMemory] recontact detected for ${remoteJid.slice(0, 12)} (count=${leadMemory?.recontactCount ?? 0})`);
                }
              }
            } catch { /* non-blocking */ }

            // ── Few-shot dinámico: cargar ejemplos aprendidos relevantes ────────
            let dynamicExamplesBlock: string | undefined;
            try {
              const dynamicExs = await selectDynamicExamples({
                intent: (state as any).last_intent ?? undefined,
                maxExamples: 5
              });
              if (dynamicExs.length > 0) {
                dynamicExamplesBlock = formatExamplesForPrompt(dynamicExs);
              }
            } catch { /* no bloquear el flujo principal */ }

            // ── Contexto de botMemory (Fase 2 + 3) ──────────────────────────
            // Fase 2: preguntas efectivas y manejo de objeciones (RAM/JSON).
            // Fase 3: few-shot desde Postgres (patrones con score real).
            // Solo como "ejemplos de conversaciones reales", nunca como reglas de catálogo.
            let botMemoryContextBlock: string | undefined;
            try {
              const isIndecisiveNow = Boolean(mergedExtracted?.isIndecisive);
              const hasObjection = /\b(?:est[aá]\s+caro|muy\s+caro|es\s+caro|lo\s+pienso|no\s+me\s+convence|muy\s+lejos|no\s+tengo\s+tanta\s+plata)\b/i.test(rawText);

              // Fase 3: few-shot dinámico desde DB (máximo 3 ejemplos)
              const phase3Examples = await selectFewShotExamples(mergedExtracted ?? {}, 3);
              if (phase3Examples.length > 0) {
                const phase3Block = formatFewShotBlock(phase3Examples);
                if (phase3Block) botMemoryContextBlock = phase3Block;
              }

              // Fase 2 (fallback RAM): solo si no hay ejemplos DB o para complementar
              if (!botMemoryContextBlock) {
                if (isIndecisiveNow) {
                  const block = buildIndecisiveContextBlock();
                  if (block) botMemoryContextBlock = block;
                } else if (hasObjection) {
                  const objType = /\bcar[oa]\b/i.test(rawText) ? 'caro'
                    : /\bpienso\b/i.test(rawText) ? 'lo pienso'
                    : 'no me convence';
                  const block = buildObjectionContextBlock(objType);
                  if (block) botMemoryContextBlock = block;
                }
              }
            } catch { /* nunca bloquear por memoria */ }

            // ── loopData: anti-loop + contexto para el agente v5 ──────────────
            const repeatedMissingFields = detectRepeatedMissingFields(state);
            const agentLoopData = {
              turnCount: userMsgCount,
              repeatedMissingFields
            };

            // Last bot reply for anti-repeat context
            const lastBotReply: string | undefined =
              (state as any).agent?.suggestedReply?.trim()
              ?? ((state as any).gpt_history ?? []).slice().reverse().find((h: any) => h.role === 'assistant')?.content?.trim()
              ?? undefined;

            // Policy context captured earlier (if a policy matched but we didn't send its body)
            const policyContext: string | undefined = (newState as any)._policyContext ?? (state as any)._policyContext ?? undefined;

            const agentDecision = await decideAgentAction({
              dealershipName: process.env.DEALERSHIP_NAME ?? undefined,
              userMessage: rawText,
              history,
              catalog: rankedCatalog,
              faqSummary,
              extracted: mergedExtracted,
              leadScore: state.leadScore,
              dynamicExamples: dynamicExamplesBlock,
              loopData: agentLoopData,
              lastBotReply,
              policyContext,
              noStockContext: !!(newState as any)._noStockContext,
              memoryBlock: memoryBlock || undefined,
              botMemoryContext: botMemoryContextBlock,
            });

            // ── FIX-10: Stagnation check — force handoff if conversation is stuck ──────
            if (agentDecision && !agentDecision.handoffRecommended) {
              try {
                const prevExtracted = (state as any)?.extracted_prev ?? undefined;
                const stagnation = detectStagnation({
                  history: history.slice(-10),
                  extracted: mergedExtracted,
                  prevExtracted,
                  intent: { primaryIntent: agentDecision.intent as any, subIntent: null, confidence: agentDecision.confidence ?? 0.5, signals: [], nextBestAction: 'CONTINUE_AGENT', requiresHuman: false },
                  leadScore: Number(state.leadScore ?? 0),
                  userTurnCount: Number(state.user_msg_count ?? 0),
                });
                if (stagnation.isStagnant) {
                  agentDecision.handoffRecommended = true;
                  agentDecision.internalReason = `[stagnation] ${stagnation.reason}`;
                  console.warn(`[webhooks] stagnation detected for ${remoteJid.slice(0, 12)} — forcing handoff. Reason: ${stagnation.reason}`);
                }
              } catch {
                // never block agent on stagnation errors
              }
            }

            if (agentDecision?.suggestedReply) {
              // Apply guardrail to agent response before using it
              const agentGr = validateReply(agentDecision.suggestedReply, {
                source: 'agent',
                lastBotReply
              });
              if (!agentGr.ok && !agentGr.safeReply) {
                console.warn(`[webhooks] guardrail blocked agent reply (${agentGr.issues.join(',')}). Using GPT fallback.`);
                // Fall through to GPT fallback below by not setting reply
              } else {
                if (agentGr.safeReply && agentGr.safeReply !== agentDecision.suggestedReply) {
                  agentDecision.suggestedReply = agentGr.safeReply;
                }
              }
            }

            if (agentDecision?.suggestedReply) {
              reply = agentDecision.suggestedReply;
              newState.last_intent = `agent_${agentDecision.intent || 'fallback'}`;
              (newState as any).agent = {
                intent: agentDecision.intent,
                confidence: agentDecision.confidence,
                action: agentDecision.action,
                urgency: agentDecision.urgency,
                handoffRecommended: agentDecision.handoffRecommended,
                suggestedReply: agentDecision.suggestedReply,
                missingFields: agentDecision.missingFields,
                internalReason: agentDecision.internalReason,
                updatedAt: nowIso
              };
              (newState as any).missing_fields = agentDecision.missingFields || [];
              // v3: persistir historial también cuando responde el agente estructurado
              const existingHistory = (state as any).gpt_history ?? [];
              (newState as any).gpt_history = [
                ...existingHistory,
                { role: 'user', content: rawText },
                { role: 'assistant', content: agentDecision.suggestedReply }
              ].slice(-12);
              if (agentDecision.handoffRecommended) {
                try { await setConversationRule(instance, remoteJid, 'HUMAN_ONLY'); } catch {}
              }
              void logDecision({
                instance,
                remoteJid,
                intent: newState.last_intent,
                confidence: agentDecision.confidence,
                data: {
                  type: 'agent',
                  action: agentDecision.action,
                  urgency: agentDecision.urgency,
                  handoffRecommended: agentDecision.handoffRecommended,
                  missingFields: agentDecision.missingFields || [],
                  reason: agentDecision.internalReason || null
                }
              }).catch(() => {});
            } else {
              const systemPrompt = buildCarDealershipSystemPrompt({
                dealershipName: process.env.DEALERSHIP_NAME ?? undefined,
                catalogSummary: catalogSummary || undefined,
                faqSummary: faqSummary || undefined
              });

              const gptReply = await askGPT({ systemPrompt, userMessage: rawText, history });

              if (gptReply) {
                const gptGr = applyGuardrail(gptReply, { source: 'gpt', lastBotReply });
                reply = gptGr || gptReply;
                newState.last_intent = 'gpt_fallback';
                const newHistory = [
                  ...turns,
                  { role: 'user', content: rawText },
                  { role: 'assistant', content: gptReply }
                ].slice(-12);
                (newState as any).gpt_history = newHistory;
              } else {
                reply = pickOne([
                  '¡Buenas! ¿Qué auto tenés en mente?',
                  'Contame marca o presupuesto y te filtro algo lógico.',
                  'Decime qué querés mirar y te ayudo a elegir bien.'
                ]);
                newState.stage = 'awaiting_query';
                newState.last_intent = 'fallback';
                isFallback = true;
              }
            }
          } catch (gptErr) {
            console.error('[webhooks] GPT fallback error:', gptErr);
            reply = pickOne([
              '¡Buenas! ¿Qué auto tenés en mente?',
              'Contame marca o presupuesto y te filtro algo lógico.',
              'Decime qué querés mirar y te ayudo a elegir bien.'
            ]);
            newState.stage = 'awaiting_query';
            newState.last_intent = 'fallback';
            isFallback = true;
          }
        }
      }
    }

    // ── Anti-repeat guard ───────────────────────────────────────────────────
    const replyHash = hashString(reply);
    const lastHash = (state as any).last_bot_reply_hash;
    const lastHashAt = (state as any).last_bot_reply_at;
    if (lastHash && lastHashAt && lastHash === replyHash) {
      const lastAt = Date.parse(lastHashAt);
      if (!Number.isNaN(lastAt) && now - lastAt < env.fallbackCooldownMs) {
        cleanup();
        return;
      }
    }

    // ── Anti-repeat fallback: vary the question (v3 — filtrado por campos conocidos) ──
    const lastFallbackAt = (state as any).last_fallback_at;
    if (isFallback && lastFallbackAt) {
      const lastFb = Date.parse(lastFallbackAt);
      if (!Number.isNaN(lastFb) && now - lastFb < env.fallbackCooldownMs) {
        // Construir lista de preguntas filtrando las que ya fueron respondidas
        const ctx = state.search_context ?? {};
        const fallbackQuestions: string[] = [];

        // Solo preguntar marca/modelo si no se conoce ninguno de los dos
        if (!ctx.brand && !ctx.model) {
          fallbackQuestions.push('¿Tenés alguna marca o modelo en mente?');
        }
        // Solo preguntar presupuesto si no se tiene maxPrice ni amount
        if (!ctx.maxPrice && !ctx.amount) {
          fallbackQuestions.push('¿Cuál es tu presupuesto aproximado?');
        }
        // Solo preguntar uso si no se conoce
        if (!ctx.useCase && !ctx.bodywork) {
          fallbackQuestions.push('¿Para qué lo vas a usar?');
        }
        // Preguntas adicionales si los básicos ya están cubiertos
        if (ctx.brand && !ctx.transmission) {
          fallbackQuestions.push('¿Preferís caja manual o automática?');
        }
        if (ctx.brand && !ctx.minYear && !ctx.year) {
          fallbackQuestions.push('¿De qué año lo buscás aproximadamente?');
        }

        if (fallbackQuestions.length > 0) {
          reply = pickOne(fallbackQuestions);
        }
        // Si todos los campos básicos ya están: no cambiar el reply (usar el fallback original)
        isFallback = false;
      }
    }

    if (isFallback) {
      (newState as any).last_fallback_at = nowIso;
    }

    // Guard: never send an empty message to the user
    if (!reply || !reply.trim()) {
      cleanup();
      return;
    }

    // ── Final guardrail: last line of defense before sending ──────────────────
    // Catches any remaining internal content that slipped through earlier checks.
    {
      const finalLastBotReply: string | undefined =
        (state as any).agent?.suggestedReply?.trim()
        ?? ((state as any).gpt_history ?? []).slice().reverse().find((h: any) => h.role === 'assistant')?.content?.trim()
        ?? undefined;
      const finalGr = validateReply(reply, {
        source: (newState as any).last_intent?.startsWith('agent') ? 'agent' : String((newState as any).last_intent ?? ''),
        lastBotReply: finalLastBotReply
      });
      if (!finalGr.ok) {
        if (finalGr.safeReply) {
          reply = finalGr.safeReply; // use cleaned version
        } else {
          // Internal content detected — replace with a safe fallback
          console.warn(`[webhooks] final guardrail replaced reply. Issues: ${finalGr.issues.join(',')}`);
          reply = pickOne([
            '¿Me contás qué auto buscás? Marca, uso o presupuesto y te filtro algo concreto.',
            'Decime qué necesitás y te ayudo a encontrar la mejor opción.',
            'Contame un poco más y te respondo con algo útil.',
          ]);
          isFallback = true;
          (newState as any).last_intent = 'fallback';
          newState.stage = 'awaiting_query';
        }
      }
    }

    // ── Auto-tagging de leads por intención ───────────────────────────────────
    // Clasifica el lead con una etiqueta primaria basada en el intent detectado
    // y persiste en bot_conversations (columnas añadidas en migración 014).
    try {
      const detectedIntent: string = (newState as any).last_intent ?? '';
      const INTENT_TO_TAG: Record<string, string> = {
        'stock_search':            'exploracion',
        'price_request':           'interes_precio',
        'product_results':         'vio_catalogo',
        'product_results_single':  'vio_catalogo',
        'financing_query':         'financiacion',
        'trade_in':                'permuta',
        'closing':                 'compra_inmediata',
        'visit_schedule':          'compra_inmediata',
        'agent_closing':           'compra_inmediata',
        'agent_financing_query':   'financiacion',
        'agent_trade_in':          'permuta',
        'agent_stock_search':      'exploracion',
        'gpt_fallback':            'consulta_general',
        'fallback':                'consulta_general',
      };

      // Mapear intent → tag semántico
      const rawIntentKey = detectedIntent.replace(/^agent_/, 'agent_');
      const tag = INTENT_TO_TAG[detectedIntent]
        ?? INTENT_TO_TAG[rawIntentKey]
        ?? (detectedIntent.startsWith('agent_') ? INTENT_TO_TAG[detectedIntent.replace(/^agent_/, '')] : null)
        ?? null;

      if (tag) {
        // Actualizar lead_tags (array JSONB) y lead_intent_primary en DB
        await pool.query(`
          UPDATE bot_conversations
          SET
            lead_intent_primary  = CASE WHEN lead_intent_primary IS NULL OR $3::text IN ('compra_inmediata','financiacion','permuta')
                                     THEN $3::text ELSE lead_intent_primary END,
            lead_tags            = (
              SELECT jsonb_agg(DISTINCT v)
              FROM jsonb_array_elements_text(
                COALESCE(lead_tags, '[]'::jsonb) || $4::jsonb
              ) AS v
            ),
            last_classified_at   = now()
          WHERE instance = $1 AND remote_jid = $2
        `, [instance, remoteJid, tag, JSON.stringify([tag])]).catch(() => {});
      }
    } catch { /* no bloquear flujo principal */ }

    // ── Comparador de vehículos ───────────────────────────────────────────────
    // Si el agente detectó intent=comparacion y vehicleIds con 2+ opciones,
    // construye un mensaje comparativo estructurado.
    try {
      const agentData = (newState as any).agent;
      if (
        agentData?.intent === 'comparacion' &&
        Array.isArray(agentData?.vehicleIds) &&
        agentData.vehicleIds.length >= 2 &&
        catalog
      ) {
        const ids = agentData.vehicleIds.slice(0, 3).map(String);
        const items = (catalog as any[]).filter(v => ids.includes(String(v.id)));
        if (items.length >= 2) {
          const lines = ['🔍 *Comparativa rápida:*\n'];
          for (const v of items) {
            const price = v.priceText ?? (v.priceNumber ? `${v.currency ?? 'USD'} ${Number(v.priceNumber).toLocaleString('es-AR')}` : 'a consultar');
            const specs = [
              v.year ? `${v.year}` : null,
              typeof v.km === 'number' ? `${Math.round(v.km).toLocaleString('es-AR')} km` : null,
              v.transmission ?? null,
              v.fuel ?? null,
              v.engine ?? null,
            ].filter(Boolean).join(' · ');
            lines.push(`*${v.name}*`);
            lines.push(`💰 ${price}`);
            if (specs) lines.push(`📋 ${specs}`);
            lines.push('');
          }
          // Reemplazar suggestedReply con la comparativa si el bot no la generó bien
          if (reply && reply.length < 200) {
            reply = lines.join('\n') + '\n' + reply;
            (newState as any).last_comparison = ids;
          }
        }
      }
    } catch { /* no bloquear flujo principal */ }

    // ── Commercial audit: calidad de la respuesta (non-blocking) ───────────────
    try {
      const auditStage = (newState as any)._coachStage ?? (state as any).stage ?? 'discovery';
      const prevExtracted: Record<string, any> = (state as any)?.extracted ?? (state as any)?.search_context ?? {};
      const currentExtracted: Record<string, any> = (newState as any)?.extracted ?? (newState as any)?.search_context ?? extracted;
      const audit = auditTurnQuality({
        userMessage: rawText,
        botReply: reply,
        extracted: currentExtracted,
        prevExtracted,
        stage: auditStage,
        turnCount: userMsgCount,
        isFirstTurn: userMsgCount <= 1,
      });
      logTurnAudit(audit, { instance, remoteJid, stage: auditStage, turnCount: userMsgCount });
      accumulateAuditMetrics(audit, instance);
    } catch { /* never block */ }

    scheduleReply(reply, newState, {
      imageUrl: (newState as any)._firstVehicleImage ?? undefined,
    });
  } catch (err) {
    console.error(err);
  }
}

webhookRouter.post('/evolution', async (req: Request, res: Response) => {
  try {
    // ✅ Auth: header OR query token (Evolution UI no permite headers)
    const headerSecret = String(req.header('x-bot-secret') ?? '');
    const queryToken = String((req.query as any)?.token ?? '');
    const secret = headerSecret || queryToken;

    if (!secret || secret !== env.webhookSecret) {
      return res.status(401).json({ ok: false });
    }

    const body: any = req.body;

    if (env.debugWebhooks || env.nodeEnv !== 'production') {
      console.log('[WEBHOOK] event =', body?.event, 'hasHeaderSecret=', !!headerSecret, 'hasQueryToken=', !!queryToken);
    }

    // ✅ Accept both Evolution variants
    const { ok: isUpsert, event } = isMessagesUpsertEvent(body);
    if (!isUpsert) {
      return res.status(200).json({ ok: true, ignored: true, event });
    }

    const instance = String(body?.instance ?? env.instanceName);
    const msg = body?.data;

    const remoteJid = String(msg?.key?.remoteJid ?? '');
    const fromMe = !!msg?.key?.fromMe;
    const msgId = String(msg?.key?.id ?? '');

    if (!remoteJid || !msgId) return res.status(200).json({ ok: true, ignored: true, reason: 'missing_jid_or_id' });
    if (remoteJid.endsWith('@g.us')) {
      return res.status(200).json({ ok: true, ignored: true, reason: 'group' });
    }
    if (remoteJid === 'status@broadcast') return res.status(200).json({ ok: true, ignored: true, reason: 'status' });

    // Always ignore messages sent by our own WhatsApp (fromMe). This prevents
    // feedback loops and avoids the bot reacting to operator replies.
    if (fromMe) {
      // When an operator replies from the same instance (fromMe = true), mark this conversation as human-only.
      try {
        const instanceName = instance;
        await setConversationRule(instanceName, remoteJid, 'HUMAN_ONLY');
      } catch (err) {
        console.error('Failed to set conversation rule on operator message', err);
      }
      return res.status(200).json({ ok: true, ignored: true, reason: 'from_me' });
    }

    // Avoid duplicate processing
    if (await seenDedupe(msgId)) {
      return res.status(200).json({ ok: true, dedupe: true });
    }
    await markDedupe(msgId, instance, remoteJid, fromMe ? 'OUT' : 'IN');

    const rawText = getText(msg);
    const media = extractMedia(msg);
    const text = normalize(rawText);
    // Accept media-only messages (no caption). We'll aggregate them so the bot
    // can wait for the full context (text + image/catalog) before replying.
    if (!text && !media) return res.status(200).json({ ok: true, ignored: true, reason: 'empty_text' });

    // Emit an event for inbound messages so the manager UI can update in real time.
    try {
      const sock = getSocket();
      if (sock) {
        sock.emit('messages.upsert', {
          instance,
          remoteJid,
          text: rawText,
          fromMe
        });
      }
    } catch (err) {
      console.error('Failed to emit inbound message event', err);
    }

    // Immediately queue the message for debounced processing. The handler will
    // decide if it should reply based on state, cooldowns and heuristics. We
    // respond to the webhook right away so Evolution doesn't retry.
    const key = `${instance}:${remoteJid}`;
    const nowMs = Date.now();
    const existing = aggregators.get(key);

    let entry: AggregatorEntry;
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      if (existing.sendTimer) {
        // User kept typing while we were "typing" a reply; cancel and recompute.
        clearTimeout(existing.sendTimer);
        existing.sendTimer = null;
      }
      if (rawText) existing.texts.push(rawText);
      existing.msgIds.push(msgId);
      // Keep only the last few to avoid unbounded growth
      if (existing.texts.length > 6) existing.texts = existing.texts.slice(-6);
      if (existing.msgIds.length > 6) existing.msgIds = existing.msgIds.slice(-6);
      if (media) existing.lastMedia = media;
      existing.count += 1;
      existing.lastAt = nowMs;
      entry = existing;
    } else {
      entry = {
        key,
        instance,
        remoteJid,
        fromMe,
        msgIds: [msgId],
        texts: rawText ? [rawText] : [],
        firstAt: nowMs,
        lastAt: nowMs,
        count: 1,
        timer: null,
        sendTimer: null,
        lastMedia: media
      };
    }

    // If the user sent 3 messages within 3 seconds, wait a bit more and reply once.
    const fastBurst = entry.count >= 3 && entry.lastAt - entry.firstAt <= 3000;
    const extraWait = fastBurst ? randInt(2000, 4000) : 0;
    const waitMs = randInt(env.humanizerMinMs, env.humanizerMaxMs) + extraWait;

    entry.timer = setTimeout(() => {
      // We keep the entry in the map until the reply is actually sent, so a new
      // incoming message can cancel the pending reply.
      entry.timer = null;
      let aggregatedText = entry.texts.join('\n');
      // Guard: limit length to avoid overloading GPT context (multi-paste attacks, long messages)
      if (aggregatedText.length > 2000) aggregatedText = aggregatedText.slice(0, 2000);
      const lastMsgId = entry.msgIds[entry.msgIds.length - 1] || msgId;
      handleAggregatedMessage(entry.key, entry.instance, entry.remoteJid, aggregatedText, lastMsgId);
    }, waitMs);

    aggregators.set(key, entry);

    return res.status(200).json({ ok: true, queued: true });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});
