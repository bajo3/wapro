import { Router } from 'express';
import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { evolutionSendPresence, evolutionSendText, evolutionSendImage } from '../services/evolution.js';
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
import { computeLeadScore, leadLabel } from '../services/lead.js';
import { getFinanceApr, simulateFinancing, formatArs } from '../services/finance.js';

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

/**
 * Compute a simple SHA1 hash for a given string. Used to detect
 * repeated replies and avoid sending the same fallback over and over.
 */
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
async function sendTextHuman(instance: string, number: string, reply: string): Promise<void> {
  if (!env.splitReplies) {
    await evolutionSendText(instance, number, reply);
    return;
  }

  const lines = reply.split('\n').filter((l) => l.trim().length > 0);
  // Only split when there is a clear header and body.
  const p = Number.isFinite(env.splitRepliesProb) ? Math.min(1, Math.max(0, env.splitRepliesProb)) : 0.25;
  if (lines.length >= 3 && chance(p)) {
    const first = lines[0];
    const rest = lines.slice(1).join('\n');
    await evolutionSendText(instance, number, first);
    await sleep(randInt(700, 1200));
    await evolutionSendText(instance, number, rest);
    return;
  }

  await evolutionSendText(instance, number, reply);
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

function mergeSearchContext(prev: any, extracted: any) {
  const next = { ...(prev || {}) };
  if (extracted?.brand) next.brand = extracted.brand;
  if (extracted?.model) next.model = extracted.model;
  if (extracted?.minYear) next.minYear = extracted.minYear;
  if (extracted?.maxYear) next.maxYear = extracted.maxYear;
  if (extracted?.transmission) next.transmission = extracted.transmission;
  if (extracted?.fuel) next.fuel = extracted.fuel;
  if (extracted?.bodywork) next.bodywork = extracted.bodywork;
  if (extracted?.maxPrice) next.maxPrice = extracted.maxPrice;
  if (extracted?.amount && !next.maxPrice) {
    // If the user only said a number, treat it as "max price" in search context.
    next.maxPrice = extracted.amount;
  }
  if (extracted?.currency) next.currency = extracted.currency;
  return next;
}

function filterCatalogByContext(catalog: any[], ctx: any): any[] {
  const brand = ctx?.brand ? normalize(String(ctx.brand)) : '';
  const model = ctx?.model ? normalize(String(ctx.model)) : '';
  const minYear = Number(ctx?.minYear ?? 0) || undefined;
  const maxYear = Number(ctx?.maxYear ?? 0) || undefined;
  const tx = ctx?.transmission ? normalize(String(ctx.transmission)) : '';
  const fuel = ctx?.fuel ? normalize(String(ctx.fuel)) : '';
  const maxPrice = Number(ctx?.maxPrice ?? 0) || undefined;

  return (catalog || [])
    .filter((it) => isVehicleItem(it))
    .filter((it) => {
      const b = it?.brand ? normalize(String(it.brand)) : normalize(String(it?.category || ''));
      const m = it?.model ? normalize(String(it.model)) : normalize(String(it?.name || ''));
      if (brand && !b.includes(brand)) return false;
      if (model && !m.includes(model)) return false;
      if (minYear && Number(it?.year || 0) && Number(it.year) < minYear) return false;
      if (maxYear && Number(it?.year || 0) && Number(it.year) > maxYear) return false;
      if (tx) {
        const itTx = normalize(String(it?.transmission || ''));
        if (itTx && !itTx.includes(tx)) return false;
      }
      if (fuel) {
        const itFuel = normalize(String(it?.fuel || ''));
        if (itFuel && !itFuel.includes(fuel)) return false;
      }
      if (maxPrice && Number(it?.priceNumber || 0)) {
        if (Number(it.priceNumber) > maxPrice) return false;
      }
      return true;
    });
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

    // Context timeout (30 min): if idle too long, drop accumulated search/finance context.
    const lastUserAtMs = stateRaw.last_user_at ? Date.parse(stateRaw.last_user_at) : NaN;
    const contextExpired = !Number.isNaN(lastUserAtMs) && now - lastUserAtMs > 30 * 60 * 1000;

    const state: ConvState = {
      ...stateRaw,
      ...(contextExpired
        ? { search_context: undefined, search_context_at: undefined, finance: undefined, last_hits: undefined, last_hits_at: undefined }
        : {})
    };

    // Merge extracted fields across turns.
    const extracted = extractLeadFields(rawText, (state as any)?.extracted ?? (state as any)?.lead ?? {});

    // Update message counters & last user timestamp.
    const userMsgCount = Math.max(0, Number(state.user_msg_count ?? 0)) + 1;
    state.user_msg_count = userMsgCount;
    state.last_user_at = nowIso;

    // Accumulate search context across turns.
    const nextSearchCtx = mergeSearchContext(state.search_context, extracted);
    state.search_context = nextSearchCtx;
    state.search_context_at = nowIso;

    // Lead score recalculated each turn.
    state.leadScore = computeLeadScore(state, extracted, now);

    const aggEntry = aggregators.get(key);
    const cleanup = () => {
      const e = aggregators.get(key);
      if (e?.timer) clearTimeout(e.timer);
      if (e?.sendTimer) clearTimeout(e.sendTimer);
      aggregators.delete(key);
    };

    const lastMedia = (aggEntry as any)?.lastMedia ?? null;

    const scheduleReply = (reply: string, nextState: any, imageUrl?: string) => {
      const delayMs = computeHumanDelay(reply);
      void evolutionSendPresence(instance, number, 'composing', Math.min(delayMs, 5000)).catch(() => {});

      const timer = setTimeout(async () => {
        const sentIso = new Date().toISOString();
        try {
          if (imageUrl) {
            await evolutionSendImage(instance, number, imageUrl, reply);
          } else {
            await sendTextHuman(instance, number, reply);
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

          const sock = getSocket();
          if (sock) {
            sock.emit('send.message', { instance, number, text: reply, imageUrl: imageUrl ?? null });
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

    // ── Handoff detection ───────────────────────────────────────────────────
    const wantsHandoff = /(comprar|reservar|se[ñn]a[rl]|pagar|quiero\s*ya|transferencia|me\s+lo\s+llevo|cerramos)/i.test(rawText);
    if (wantsHandoff) {
      try {
        await setConversationRule(instance, remoteJid, 'HUMAN_ONLY');
        const pairs = Object.entries(extracted || {})
          .filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
          .slice(0, 12)
          .map(([k, v]) => `${k}=${String(v)}`);
        await addConversationNote(instance, remoteJid,
          `Handoff automático. Texto: "${rawText.slice(0, 140)}"\nDatos: ${pairs.join(' | ') || 'n/a'}`);
      } catch (err) {
        console.error('Failed to set conversation rule on handoff', err);
      }
      const handoffVariants = [
        'Perfecto 🙌 Te paso con un asesor para cerrarlo rápido. Decime tu nombre y zona.',
        '¡Excelente! 🎉 Te conecto con un asesor ahora. ¿Cuál es tu nombre?',
        'Buenísimo 🤝 Un asesor te contacta enseguida para cerrarlo.'
      ];
      scheduleReply(pickOne(handoffVariants), {
        ...state, stage: 'idle', last_intent: 'handoff', extracted, missing_fields: []
      });
      return;
    }

    const catalog = await getCatalog();

    // ── Financing flow continuation ───────────────────────────────────────
    if (state.finance?.stage === 'collecting') {
      // Re-enter the financing simulator even if the message is just a number.
      const financeMsg = /(\bcuotas?\b|\bmeses?\b|\bentrada\b|\banticipo\b|\bse[ñn]a\b|\b\d{7,12}\b)/i.test(rawText);
      if (financeMsg) {
        // Force the asksFinancing branch by injecting a marker.
        // (We keep logic in one place.)
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
          const detailReply = `Dale. Opción ${opt}:\n${formatItemLine(item, opt)}\n\n¿Querés coordinar una visita o te paso más info?`;
          scheduleReply(detailReply, { ...state, stage: 'idle', last_intent: 'option_selected' } as any, (item as any).image ?? undefined);
          return;
        }
      }
      if (asksPriceQuick && !opt) {
        scheduleReply(`¿De cuál opción querés el precio? (1-${Math.min(lastHits.length, 6)})`,
          { ...state, stage: 'idle', last_intent: 'ask_price_which' } as any);
        return;
      }
    }

    // ── Multi-turn refinement: if we just showed product results and user adds filters,
    // refine using accumulated search_context instead of starting from scratch.
    const prevIntent = String((state as any).last_intent || '');
    const hasSearchCtx = !!(state.search_context && (state.search_context.brand || state.search_context.model));
    const looksLikeRefineOnly = !/(busco|quiero|tenes|tienes|hay|mostrame|mostrar|opcion|opci[oó]n)/i.test(rawText)
      && /\b(20\d{2}|19\d{2}|manual|autom[aá]t|cvt|dsg|nafta|diesel|gasoil|gnc|suv|pickup|hatch|sedan|hasta|m[aá]ximo|palos|mil|usd|dolares?)\b/i.test(rawText);

    if ((prevIntent === 'product_results' || prevIntent === 'product_results_single') && hasSearchCtx && looksLikeRefineOnly) {
      const refined = filterCatalogByContext(catalog, state.search_context);
      const baseHits = refined.length > 0
        ? refined.slice(0, 6)
        : searchCatalog(catalog, rawText, 6);
      const { hits } = applyVehicleGuardrails(rawText, baseHits);

      if (hits.length) {
        const header = pickOne(['Perfecto, ajusto la búsqueda 👇', 'Listo, con esos filtros te dejo estas 👇', 'Dale, refinando… mirá 👇']);
        const reply = [header, ...hits.map((it, i) => formatItemLine(it, i + 1))].join('\n');
        const nextState: ConvState = {
          ...state,
          stage: 'idle',
          last_intent: 'product_results',
          last_query: (state.last_query || '') + ' | refine: ' + rawText,
          last_hits: hits.map((it) => it.id).slice(0, 6),
          last_hits_at: nowIso,
          extracted
        } as any;
        scheduleReply(reply, nextState);
        return;
      }
    }

    let reply = '';
    const { _forceFinancing: _ff, ...stateClean } = state as any;
    let newState: ConvState = { ...stateClean, stage: 'idle', lastBotAt: nowIso, extracted, last_media: lastMedia } as any;
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
        reply = String(row.body ?? '');
        newState.last_intent = 'policy';
        (newState as any).last_sources = [{ type: 'policy', id: row.id }];
        void logDecision({ instance, remoteJid, intent: 'policy', confidence: kScore, data: { type: 'policy', id: row.id } }).catch(() => {});
      }

      if (reply) {
        scheduleReply(reply, newState);
        return;
      }
    }

    // ── Awaiting query from previous turn ───────────────────────────────────
    if (state.stage === 'awaiting_query') {
      const baseHits = searchCatalog(catalog, rawText, 6);
      const { hits } = applyVehicleGuardrails(rawText, baseHits);
      if (hits.length) {
        if (hits.length === 1) {
          const item = hits[0];
          const detailReply = `Dale. Mirá:\n${formatItemLine(item, 1)}\n\n¿Te interesa? Puedo coordinar visita o pasarte más info.`;
          const nextState: ConvState = { ...state, stage: 'idle', last_intent: 'product_results_single', last_query: rawText, last_hits: [item.id], last_hits_at: nowIso };
          scheduleReply(detailReply, nextState, (item as any).image ?? undefined);
          return;
        }
        reply = [pickOne(['Dale. Mirá opciones 👇', 'Te paso estas opciones 👇', 'Genial, mirá lo que tengo 👇']),
          ...hits.map((it, i) => formatItemLine(it, i + 1)),
          '', pickOne(['¿Querés alternativas en otro rango de precio?', 'Contame presupuesto y zona y ajusto la búsqueda.', 'Si me decís presupuesto y zona, te recomiendo la mejor.'])
        ].join('\n');
        newState.last_intent = 'product_results';
        newState.last_query = rawText;
        newState.last_hits = hits.map((it) => it.id).slice(0, 6);
        newState.last_hits_at = nowIso;
      } else {
        reply = lastMedia && !String(rawText || '').trim()
          ? 'Te vi la imagen 👍 ¿qué modelo/marca estás buscando o cuál es tu presupuesto?'
          : pickOne(['No lo encontré 😕 ¿Me decís marca/modelo o para qué lo usarías?', 'No me aparece ese modelo. ¿Tenés presupuesto aproximado?', 'No lo veo en el catálogo. ¿Qué uso le das y rango de precio?']);
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
      const asksTradeIn = /(permuta|canje|parte\s+de\s+pago|doy\s+el\s+m[íi]o|entrego\s+el\s+auto|mi\s+(auto|coche))/i.test(rawText);
      const asksPrice = /(precio|cuanto|vale|valor|sale|financi|cuota|entrega)/i.test(rawText);
      const looksLikeVehicleQuery = /(auto|autos|coche|camioneta|pick\s*up|suv|fiat|ford|volkswagen|vw|renault|toyota|chevrolet|peugeot|jeep|honda|nissan|cronos|gol|amarok|hilux|duster|onix|corolla|km\b|a[ñn]os?\b|modelo\b|nafta|diesel|gnc|manual|automat)/i.test(rawText);
      const looksLikeGamingQuery = /(ps5|play\s*5|xbox|consola|auricular|headset|monitor|notebook|silla|joystick|teclado|mouse)/i.test(rawText);
      const normText = normalize(rawText);
      const hasContent = normText.length >= 3 && /[a-z0-9]/i.test(normText);
      const stage = state.stage as ConvState['stage'];
      const shouldSearch = stage === 'awaiting_query' || looksLikeGamingQuery || looksLikeVehicleQuery || (asksPrice && hasContent);

      if (isGreeting) {
        const greetVariants = [
          '¡Buenas 😄! ¿Qué estás buscando hoy?',
          '¡Hola! Decime qué necesitás y te paso opciones.',
          '¡Hola! ¿Qué andás buscando? Contame marca, modelo o presupuesto.'
        ];
        reply = pickOne(greetVariants);
        newState.stage = 'awaiting_query';
        newState.last_intent = 'greeting';

      } else if (isSmallTalk) {
        reply = pickOne(['❤️ Yo también 😊', 'Jajaja 😄 ¿Qué hacés?', '😍 ¡Qué lindo! ¿En qué te ayudo?']);
        newState.stage = 'idle';
        newState.last_intent = 'smalltalk';

      } else if (asksDemand && !looksLikeVehicleQuery) {
        // User explicitly says they're looking — acknowledge and ask for details
        reply = [
          '¡Perfecto! Para encontrarte las mejores opciones necesito saber:\n',
          '• ¿Qué marca/modelo tenés en mente?',
          '• ¿Rango de año?',
          '• ¿Presupuesto aproximado?',
          '• ¿Automático o manual?',
          '\nContame lo que puedas y busco 🔍'
        ].join('\n');
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
          const parts: string[] = [];
          if (missing.includes('precio')) parts.push('• ¿Cuál es el **precio** del vehículo? (ej: 13.800.000)');
          if (missing.includes('entrada')) parts.push('• ¿De cuánto sería la **entrada**? (si es 0, decime 0)');
          if (missing.includes('cuotas')) parts.push('• ¿En cuántas **cuotas/meses**? (ej: 36)');
          reply = `Dale, te la simulo. Necesito:\n${parts.join('\n')}`;
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
          reply = buildMissingQuestions(required, missing);
          (newState as any).missing_fields = missing;
        } else {
          const model = extracted.tradeInModel ?? extracted.model ?? '';
          const year = extracted.tradeInYear ?? extracted.year ?? '';
          const km = extracted.tradeInKm !== undefined ? ` con ${extracted.tradeInKm.toLocaleString('es-AR')} km` : '';
          reply = `Perfecto, tomamos ${model} ${year}${km} en parte de pago. ¿Querés que te busque opciones con ese canje?`;
        }
        newState.last_intent = 'tradein';

      } else if (asksPrice) {
        reply = pickOne([
          'Dale. ¿De qué producto/modelo querés precio?',
          '¡Ok! Decime la marca/modelo y te consigo el precio.',
          'Decime el modelo para chequear el precio.'
        ]);
        newState.stage = 'awaiting_query';
        newState.last_intent = 'price_request';

      } else if (shouldSearch) {
        const baseHits = searchCatalog(catalog, rawText, 6);
        const { hits } = applyVehicleGuardrails(rawText, baseHits);
        if (hits.length) {
          if (hits.length === 1) {
            const item = hits[0];
            const detailReply = `Dale. Mirá:\n${formatItemLine(item, 1)}\n\n¿Te interesa? Puedo coordinar visita o buscar alternativas.`;
            const nextState: ConvState = { ...state, stage: 'idle', last_intent: 'product_results_single', last_query: rawText, last_hits: [item.id], last_hits_at: nowIso };
            scheduleReply(detailReply, nextState, (item as any).image ?? undefined);
            return;
          }
          reply = [pickOne(['Te paso opciones 👇', 'Mirá estas opciones 👇', 'Dale. Tengo esto 👇']),
            ...hits.map((it, i) => formatItemLine(it, i + 1)),
            '', pickOne(['Si me decís presupuesto y zona, te recomiendo la mejor.', '¿Querés alternativas en otro rango?', 'Contame presupuesto y zona para ajustar.'])
          ].join('\n');
          newState.last_intent = 'product_results';
          newState.last_query = rawText;
          newState.last_hits = hits.map((it) => it.id).slice(0, 6);
          newState.last_hits_at = nowIso;
        } else {
          reply = lastMedia && !String(rawText || '').trim()
            ? 'Te vi la imagen 👍 ¿qué modelo/marca o rango de precio buscás?'
            : pickOne(['No lo encontré 😕 ¿Me decís marca/modelo o para qué lo usarías?', 'No me aparece. ¿Tenés presupuesto aproximado?', 'No lo veo ahora. ¿Qué uso le das y rango de precio?']);
          newState.last_intent = 'no_match';
          newState.last_query = rawText;
          newState.stage = 'awaiting_query';
          isFallback = true;
        }

      } else {
        // Fallback: try full-text knowledge search before giving up
        const kResults = await searchKnowledge(rawText, 1);
        if (kResults.length > 0 && kResults[0].rank > 0) {
          reply = kResults[0].snippet;
          newState.last_intent = `knowledge_${kResults[0].type}`;
          (newState as any).last_sources = [{ type: kResults[0].type, id: kResults[0].id }];
        } else {
          reply = pickOne([
            'Dale 🙂 ¿Qué vehículo o producto estabas buscando?',
            '¿En qué te puedo ayudar? Si me decís marca/modelo o presupuesto, te busco opciones.',
            'Decime qué buscás y te paso opciones y precios 🔍'
          ]);
          newState.stage = 'awaiting_query';
          newState.last_intent = 'fallback';
          isFallback = true;
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

    // ── Anti-repeat fallback: vary the question ────────────────────────────
    const lastFallbackAt = (state as any).last_fallback_at;
    if (isFallback && lastFallbackAt) {
      const lastFb = Date.parse(lastFallbackAt);
      if (!Number.isNaN(lastFb) && now - lastFb < env.fallbackCooldownMs) {
        reply = pickOne(['¿Tenés alguna marca o modelo en mente?', '¿Cuál es tu presupuesto aproximado?', '¿Para qué lo vas a usar?']);
        isFallback = false;
      }
    }

    if (isFallback) {
      (newState as any).last_fallback_at = nowIso;
    }

    scheduleReply(reply, newState);
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
      const aggregatedText = entry.texts.join('\n');
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
