/*
 * Modified agent service for WaPro
 *
 * This version introduces a v4 system prompt with anti‑loop logic and
 * Argentine tone, and updates decideAgentAction to accept optional
 * loopData (repeatedMissingFields and turnCount). Merge this into
 * your existing agent service file, preserving other exports such as
 * selectModel, buildClosingSystemPrompt, etc.
 */

export interface AgentLoopData {
  /**
   * Fields that have been requested repeatedly without user response. The agent
   * should not ask for these again and instead proceed with available data.
   */
  repeatedMissingFields?: string[];
  /**
   * Number of user turns so far in the conversation. Used to adjust tone.
   */
  turnCount?: number;
}

/**
 * Build the system prompt for the commercial agent (v4).
 *
 * The prompt instructs the assistant to speak in Argentine Spanish, guides
 * prioritisation of questions, prevents loops by avoiding repeated questions,
 * and includes a lead temperature classification for internal use. It also
 * prints known fields so the agent does not ask for them again.
 */
export function buildAgentSystemPrompt(
  dealershipName?: string,
  extractedContext?: Record<string, any>,
  loopData?: AgentLoopData
): string {
  const agency = dealershipName || 'la agencia';
  const ctx = extractedContext ?? {};
  const turns = loopData?.turnCount ?? 0;
  const repeatedFields = loopData?.repeatedMissingFields ?? [];

  // Collect known fields to avoid re‑asking.
  const knownFields: string[] = [];
  if (ctx.brand) knownFields.push(`marca: ${ctx.brand}`);
  if (ctx.model) knownFields.push(`modelo: ${ctx.model}`);
  if (ctx.maxPrice ?? ctx.amount) {
    const amt = ctx.maxPrice ?? ctx.amount;
    const cur = ctx.currency ?? 'ARS';
    knownFields.push(`presupuesto: ${cur} ${Number(amt).toLocaleString('es-AR')}`);
  }
  if (ctx.transmission) knownFields.push(`caja: ${ctx.transmission}`);
  if (ctx.fuel) knownFields.push(`combustible: ${ctx.fuel}`);
  if (ctx.bodywork) knownFields.push(`tipo de carrocería: ${ctx.bodywork}`);
  if (ctx.useCase) knownFields.push(`uso: ${ctx.useCase}`);
  if (ctx.city) knownFields.push(`ciudad: ${ctx.city}`);
  if (ctx.hasTradeIn) knownFields.push('tiene permuta');
  if (ctx.gnc !== undefined) knownFields.push(`GNC: ${ctx.gnc ? 'sí' : 'no'}`);
  if (ctx.minYear || ctx.maxYear || ctx.year) {
    const yr = ctx.year ? String(ctx.year) : `${ctx.minYear ?? '?'}-${ctx.maxYear ?? '?'}`;
    knownFields.push(`año: ${yr}`);
  }
  const knownSection = knownFields.length
    ? `\nDATA YA CONOCIDA (NO VOLVER A PREGUNTAR ESTOS CAMPOS):\n${knownFields
        .map((f) => `  • ${f}`)
        .join('\n')}`
    : '';

  const loopSection = repeatedFields.length
    ? `\nCAMPOS QUE NO DEBÉS VOLVER A PEDIR (ya se preguntaron y el cliente no respondió):\n${repeatedFields
        .map((f) => `  • ${f}`)
        .join('\n')}\n  → En ese caso, avanzá con lo que tenés o usá rangos amplios.`
    : '';
  const toneNote = turns > 6
    ? '\nNOTA: La conversación ya lleva varios turnos. Evitá preguntar más datos: con lo que tenés, mostrá opciones o pasá a un asesor humano.'
    : '';

  return [
    `Sos el agente comercial de ${agency}, una agencia de autos usados y 0km.`,
    'Tu objetivo es entender al cliente, mostrarle stock real y llevarlo al siguiente paso concreto: cotización, visita, test drive, o hablar con un asesor.',
    '',
    '── PERSONALIDAD ──',
    '• Hablás en argentino: "che", "dale", "mirá", "genial", "te paso", "¿cómo venís con el presupuesto?".',
    '• Sos directo, cálido y comercial. No sos robot ni FAQ.',
    '• Máximo 3-4 líneas por respuesta. Breve y claro.',
    '• Si el cliente escribe mal o informal, entendés igual y respondés natural.',
    '',
    '── REGLAS DE DATOS ──',
    '1. Nunca inventes precios, stock, cuotas ni versiones. Solo usá el catálogo provisto.',
    '2. Si hay stock: mostrá 2-3 opciones con precio, año y km. Nada de listas largas.',
    '3. Si no hay coincidencia exacta: explicá por qué la alternativa cercana sirve.',
    '4. Si el cliente indicó presupuesto, respetalo. Solo superarlo si lo aclarás.',
    '',
    '── REGLAS DE PREGUNTAS ──',
    '5. Si faltan datos clave, hacé UNA SOLA pregunta por turno.',
    '   Prioridad: 1) marca/modelo, 2) presupuesto, 3) uso/caja.',
    '6. NUNCA repreguntés algo que ya está en DATA YA CONOCIDA.',
    '7. Si el cliente esquiva un dato, avanzá con lo que tenés.',
    '',
    '── INTENCIONES ESPECIALES ──',
    '8. Señales de cierre ("quiero reservarlo", "cuándo puedo ir", "me lo llevo", "hacemos algo"):',
    '   → action=ESCALATE_HUMAN, handoffRecommended=true.',
    '   → En suggestedReply confirmá los datos clave + proponé horario de visita.',
    '9. Permuta ("tengo un", "te entrego", "parte de pago"):',
    '   → hasTradeIn=true, pedí año y km del usado si no los tenés.',
    '10. Financiación ("cuotas", "anticipo", "a cuántos meses"):',
    '   → action=OFFER_FINANCING, pedí: monto anticipo + cuotas deseadas.',
    '',
    '── TEMPERATURA DEL LEAD (para internalReason) ──',
    '• Frío: saludo genérico, solo pregunta de precio sin contexto.',
    '• Tibio: tiene marca/modelo o presupuesto, pregunta activamente.',
    '• Caliente: pregunta por disponibilidad, visita, reserva, cuotas concretas.',
    '• Usá esta clasificación en internalReason para orientar al asesor.',
    '',
    knownSection,
    loopSection,
    toneNote,
    '',
    '── JSON ESPERADO (sin markdown, sin texto extra) ──',
    JSON.stringify(
      {
        intent: 'stock_search',
        confidence: 0.84,
        action: 'SHOW_RESULTS',
        extracted: {
          brand: null,
          model: null,
          year: null,
          minYear: null,
          maxYear: null,
          maxPrice: null,
          currency: null,
          transmission: null,
          fuel: null,
          bodywork: null,
          cuotas: null,
          percent: null,
          hasTradeIn: null,
        },
        missingFields: [],
        vehicleIds: [],
        leadScore: 45,
        urgency: 'medium',
        handoffRecommended: false,
        suggestedReply: 'string',
        internalReason: 'Temperatura: Tibio. Busca Toyota hasta ARS 20M, sin año definido.',
      },
      null,
      2
    ),
  ].join('\n');
}

// decideAgentAction picks the right prompt depending on the lead score and passes
// loopData to buildAgentSystemPrompt. Only the changed signature and usage are
// shown here; keep the rest of your logic (model selection, tool invocation,
// streaming) intact.
export async function decideAgentAction(params: any & { loopData?: AgentLoopData }): Promise<any | null> {
  const { loopData, leadScore, dealershipName, extracted } = params;
  const isClosingStage = Number(leadScore ?? 0) >= 60;
  const model = selectModel?.(leadScore); // refer to existing selectModel implementation
  const systemPrompt = isClosingStage
    ? buildClosingSystemPrompt(dealershipName, extracted)
    : buildAgentSystemPrompt(dealershipName, extracted, loopData);
  // ...rest of your original decideAgentAction implementation goes here...
  return null;
}

// Placeholder exports to avoid breaking imports in other files. In your original
// code these should import or re‑export existing definitions.
export function selectModel(score?: number) {
  return 'gpt-4';
}

export function buildClosingSystemPrompt(dealershipName?: string, extracted?: any): string {
  return 'Cerrar conversación';
}