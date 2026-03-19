/**
 * gpt.ts — Fallback inteligente con OpenAI GPT.
 *
 * Se activa cuando el motor de triggers no encuentra match.
 * Usa el catálogo y las FAQs como contexto (RAG-lite).
 *
 * Variables de entorno:
 *   OPENAI_API_KEY   — requerida para activar GPT
 *   OPENAI_MODEL     — modelo a usar (default: gpt-4o-mini)
 */

import fetch from 'node-fetch';

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
}

/**
 * Llama a la API de OpenAI y devuelve el texto generado, o null si falla / no
 * está configurada la API key.
 */
export async function askGPT(params: GptParams): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = params.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
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

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages }),
      // 15 segundos de timeout para no trabar el flujo principal
      signal: AbortSignal.timeout?.(15_000) as any
    });

    if (!res.ok) {
      console.error('[gpt] OpenAI API error:', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data: any = await res.json();
    return (data?.choices?.[0]?.message?.content ?? '').trim() || null;
  } catch (err) {
    console.error('[gpt] fetch error:', err);
    return null;
  }
}

/**
 * Construye el system prompt base para el bot de autos.
 * Recibe el contexto del catálogo y las FAQs para que GPT tenga info real.
 */
export function buildCarDealershipSystemPrompt(params: {
  dealershipName?: string;
  catalogSummary?: string;
  faqSummary?: string;
}): string {
  const name = params.dealershipName ?? 'la concesionaria';

  const lines = [
    `Sos el asistente virtual de ventas de ${name}.`,
    `Respondés en español argentino, de forma amigable, breve y directa (máximo 3-4 oraciones).`,
    `Tu objetivo es ayudar al cliente a encontrar el vehículo ideal, coordinar visitas y resolver dudas.`,
    `Si el cliente pregunta algo que no sabés con certeza, pedile más detalles en lugar de inventar.`,
    `Nunca inventes precios, stocks ni modelos que no figuren en el catálogo.`,
    `Si el cliente quiere hablar con una persona, decile que le avisás a un asesor.`,
    `No uses listas largas. Sé conversacional y humano.`
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
