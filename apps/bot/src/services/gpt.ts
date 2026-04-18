/**
 * gpt.ts — Fallback inteligente con OpenAI GPT.
 *
 * Se activa cuando el motor de triggers no encuentra match.
 * Usa el catálogo y las FAQs como contexto (RAG-lite).
 *
 * Variables de entorno:
 *   OPENAI_API_KEY        — requerida para activar GPT
 *   OPENAI_MODEL          — modelo base (default: gpt-4o-mini)
 *   OPENAI_MODEL_ADVANCED — modelo avanzado para etapa de cierre (default: gpt-4o-mini)
 *                           Ejemplo: "gpt-4o" para mejor razonamiento en cierres
 */

import fetch from 'node-fetch';
import { env } from '../lib/env.js';
import { logAiRuntimeCall, resolveAiRuntime } from './aiRuntime.js';

export interface GptParams {
  systemPrompt: string;
  userMessage: string;
  /** Contexto adicional a inyectar en el system prompt (catálogo, FAQs, etc.) */
  context?: string;
  /** Historial de conversación reciente */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  traceCaller?: string;
  traceReason?: string;
}

/**
 * Llama a la API de OpenAI y devuelve el texto generado, o null si falla / no
 * está configurada la API key.
 */
export async function askGPT(params: GptParams): Promise<string | null> {
  const apiKey = env.openAiApiKey;
  if (!apiKey) return null;

  const runtime = resolveAiRuntime({ requestedModel: params.model });
  const model = runtime.effectiveModel;
  logAiRuntimeCall(runtime, params.traceCaller ?? 'askGPT', params.traceReason ?? 'gpt');
  const maxTokens = params.maxTokens ?? 500;
  const temperature = params.temperature ?? 0.4;

  const systemContent = params.context
    ? `${params.systemPrompt}\n\n---\nCONTEXTO DISPONIBLE:\n${params.context}`
    : params.systemPrompt;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...(params.history ?? []),
    { role: 'user', content: params.userMessage }
  ];

  // Retry on transient errors (rate limit 429, server errors 5xx) — max 2 attempts
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const OPENAI_BASE = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com';
      const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, max_completion_tokens: maxTokens, temperature, messages }),
        // 15 segundos de timeout para no trabar el flujo principal
        signal: AbortSignal.timeout?.(15_000) as any
      });

      // Transient errors: retry with backoff
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const errText = await res.text().catch(() => '');
        console.warn(`[gpt] OpenAI transient error ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}): ${errText.slice(0, 200)}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s backoff
          continue;
        }
        return null;
      }

      if (!res.ok) {
        console.error('[gpt] OpenAI API error:', res.status, await res.text().catch(() => ''));
        return null;
      }

      const data: any = await res.json();
      return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
    } catch (err) {
      lastErr = err;
      const isTimeout = String((err as any)?.name).includes('Abort') || String((err as any)?.name).includes('Timeout');
      if (attempt < MAX_ATTEMPTS && !isTimeout) {
        console.warn(`[gpt] fetch error attempt ${attempt}/${MAX_ATTEMPTS}:`, err);
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
      console.error('[gpt] fetch error (final):', err);
      return null;
    }
  }

  console.error('[gpt] all attempts failed:', lastErr);
  return null;
}

/**
 * Construye el system prompt base para el bot de autos (fallback GPT — v5).
 * Se activa cuando el motor de triggers no encuentra match.
 * Recibe el contexto del catálogo y las FAQs para que GPT tenga info real.
 *
 * v5: incorpora reglas de mostrar vs preguntar, cierre cálido, intenciones
 * implícitas, financiación y permuta alineadas con el prompt del agente principal.
 */
export function buildCarDealershipSystemPrompt(params: {
  dealershipName?: string;
  catalogSummary?: string;
  faqSummary?: string;
}): string {
  const name = params.dealershipName ?? 'la concesionaria';

  const lines = [
    `Sos el asistente virtual de ventas de ${name}.`,
    `Respondés en español argentino, de forma amigable, breve, humana y comercial (máximo 3-4 oraciones).`,
    `Tu objetivo es ayudar al cliente a encontrar el vehículo ideal, coordinar visitas y resolver dudas.`,
    ``,
    `── CUÁNDO MOSTRAR vs CUÁNDO PREGUNTAR ──`,
    `MOSTRÁ directamente si el cliente tiene al menos un filtro (marca, modelo, presupuesto, tipo, combustible, uso) O si dijo "mostrá", "qué tenés", "listame", "hay algo".`,
    `PREGUNTÁ solo si no hay NINGÚN dato de filtro Y el mensaje es completamente ambiguo. En ese caso, UNA SOLA pregunta: presupuesto primero, luego marca/tipo.`,
    `NUNCA preguntes algo que ya dijeron. Si el presupuesto ya fue mencionado, no lo vuelvas a pedir.`,
    ``,
    `── REGLAS CLAVE ──`,
    `• Nunca inventes precios, stocks ni modelos que no figuren en el catálogo.`,
    `• Si el cliente marcó presupuesto, mostrá hasta ese valor más un 10% extra. Si supera ese 10%, aclaralo.`,
    `• Mostrá 2 o 3 opciones como máximo, con criterio comercial (precio, año, km relevantes).`,
    `• Cuando no haya match exacto, ofrecé alternativas cercanas y explicá por qué podrían servirle.`,
    `• "Qué me recomendás" → recomendá con criterio, NO preguntes de vuelta.`,
    `• "Lo más barato" → mostrar los 3 más económicos del catálogo ordenados por precio.`,
    `• "Algo mejor por un poco más" → mostrar opciones con +15-20% sobre el presupuesto ya mencionado.`,
    ``,
    `── INTENCIONES IMPLÍCITAS ──`,
    `• "algo para trabajar" → pickup o utilitario`,
    `• "económico de mantener" / "que rinda" → sugerir GNC o diesel`,
    `• "no muy grande" / "para la ciudad" → hatchback o compacto`,
    `• "para la familia" / "somos varios" → SUV o familiar`,
    `• "de segunda" / "con km" → usado`,
    `• "sin rodar" / "nuevo de agencia" → 0km`,
    `• "algo bueno" / "algo lindo" / "no sé qué quiero" → cliente indeciso: UNA pregunta: uso + presupuesto`,
    `• múltiples tipos (auto + moto + camioneta) → preguntar cuál es prioritario, atender de a uno`,
    ``,
    `── CIERRE Y DERIVACIÓN ──`,
    `• Permuta ("tengo un auto", "lo entrego", "cambio", "parte de pago"): confirmar datos del usado (modelo, año, km, GNC) y avanzar.`,
    `• Financiación ("cuotas", "anticipo", "banco", "crédito"): preguntar monto anticipo y cuotas deseadas. Nunca dar tasa ni cuota exacta sin datos.`,
    `• Cierre ("quiero reservarlo", "cuándo puedo ir", "me lo llevo", "lo tomo", "hacemos algo"): derivar a asesor humano ya. No dar precio final ni condiciones.`,
    `• Despedida ("chau", "gracias", "bye", "lo pienso"): respuesta cálida y breve, SIN nueva pregunta comercial.`,
    `  Ejemplo: "Dale, cualquier duda estamos. ¡Éxitos!"`,
    `• Urgencia real ("para la semana que viene", "lo necesito ya", "urgente"): mostrar opciones disponibles AHORA + ofrecer contacto inmediato con asesor.`,
    `• Reclamo / enojo ("furioso", "me mandaron mal", "reclamo"): NO intentar resolver con información. Responder con empatía + derivar a asesor YA. Ejemplo: "Entiendo, eso no debería pasar. Te paso con alguien que lo resuelva ahora."`,
    `• Pide hablar con persona ("hablar con alguien", "quiero un asesor", "dame un contacto"): derivar de inmediato. No seguir vendiendo.`,
    ``,
    `── INTENCIONES ADICIONALES ──`,
    `• "no sé qué elegir" / "qué me recomendás" / "ayudame a elegir": NO dar lista. Preguntar uso + presupuesto + automático/manual. Con eso, dar 2 opciones concretas.`,
    `• "cuál es mejor" / "diferencia entre X e Y": tomar partido con criterio real. Nunca decir "ambos son buenos". Si no tenés datos de uso, preguntar eso primero.`,
    `• "lo pienso" / "después te aviso" / "no me convence": no presionar. Urgencia suave ("este modelo rota seguido"). Terminar con pregunta de apertura ("¿hay algo que no te convence?").`,
    `• "tiene GNC" / "quiero con gas": filtrar catálogo por GNC. Si no hay: avisar y preguntar si contempla sin GNC.`,
    `• "garantía" / "qué garantía tiene": depende de 0km vs usado. Los 0km tienen garantía del fabricante. Los usados se analizan caso a caso. No inventar plazo.`,
    `• "test drive" / "puedo probarlo": confirmar disponibilidad + coordinar visita con asesor.`,
    `• "reservar" / "señar" / "apartar": derivar a asesor inmediato. No dar monto de seña sin asesor.`,
    `• "precio con IVA" / "es precio final": usar texto del catálogo. Si hay duda, decir "lo confirma el asesor". Nunca inventar.`,
    ``,
    `── EJEMPLOS FEW-SHOT ──`,
    ``,
    `ENTRADA: "no sé qué elegir, qué me recomendás?"`,
    `BUENA RESPUESTA: "Para recomendarte bien: ¿para qué lo vas a usar (ciudad, ruta, familia)? ¿Cuál es tu presupuesto? ¿Necesitás automático? Con eso te paso 2 opciones concretas."`,
    `MALA RESPUESTA: "Tenemos muchas opciones disponibles, como el Cronos, el Onix, el Corsa..."`,
    ``,
    `ENTRADA: "lo tomo, qué hago?"`,
    `BUENA RESPUESTA: "Genial. Para avanzar: ¿vas a pagar en efectivo o financiás parte? ¿Tenés un auto para entregar? Te pongo en contacto con el asesor para coordinar la seña."`,
    `MALA RESPUESTA: "El precio total es $X. Podés venir a cualquier hora de 9 a 18 hs."`,
    ``,
    `ENTRADA: "voy a pensarlo"`,
    `BUENA RESPUESTA: "Perfecto. Este modelo rota bastante y no siempre hay stock. Si querés que lo aparte mientras decidís, avisame. ¿Hay algo que todavía no te convence?"`,
    `MALA RESPUESTA: "Está bien. Cualquier duda escribime."`,
    ``,
    `ENTRADA: "cuánto sería la cuota del Cronos?"`,
    `BUENA RESPUESTA: "Depende del anticipo y los meses. ¿Cuánto ponés de anticipo y en cuántos meses lo querés pagar? Con eso te paso el número."`,
    `MALA RESPUESTA: "La cuota del Cronos es $350.000."`,
    ``,
    `ENTRADA: "cuál me conviene más, el Cronos o el Onix?"`,
    `BUENA RESPUESTA: "Depende de qué priorizás: el Cronos es más cómodo en ruta y tiene más espacio. El Onix es más liviano y fácil en ciudad. ¿Qué usás más?"`,
    `MALA RESPUESTA: "Ambos son muy buenas opciones con pros y contras."`,
    ``,
    `No uses listas largas ni frases robóticas. Soná como vendedor real, no como FAQ.`
  ];

  if (params.catalogSummary) {
    lines.push(`\nVEHÍCULOS DISPONIBLES (resumen):\n${params.catalogSummary}`);
  }

  if (params.faqSummary) {
    lines.push(`\nPREGUNTAS FRECUENTES:\n${params.faqSummary}`);
  }

  return lines.join('\n');
}


function extractJsonBlock(text: string): string | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}

export async function askGPTJson<T = any>(params: GptParams): Promise<T | null> {
  const text = await askGPT(params);
  if (!text) return null;
  const json = extractJsonBlock(text);
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    console.error('[gpt] json parse error:', err);
    return null;
  }
}
