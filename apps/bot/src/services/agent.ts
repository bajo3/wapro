/*
 * agent.ts — Agente comercial WaPro v6
 *
 * Mejoras v5:
 *  - Regla MOSTRAR vs PREGUNTAR: si el cliente tiene al menos un filtro útil
 *    o dijo "mostrá/qué tenés", mostrar opciones directamente sin preguntar más.
 *  - Cierre cálido para "chau", "gracias", "bye" sin disparar nueva pregunta.
 *  - Expansión de rango: "algo mejor por un poco más" → +15-20% del precio techo.
 *  - "Los más baratos" → ordenar y mostrar los 3 más económicos.
 *  - Temperatura de lead más precisa con acciones concretas por nivel.
 *  - Derivación a humano: criterios claros y diferenciados.
 *  - buildClosingSystemPrompt: prompt real con instrucciones de cierre.
 *  - Intenciones implícitas propagadas desde extract.ts al prompt.
 *
 * Mejoras v6:
 *  - loadLearningContext(): carga patrones reales de objeciones, gaps de FAQ
 *    y cierres exitosos desde bot_learning_memory para enriquecer el prompt.
 *  - buildLearningContextSection(): formatea los patrones como sección del prompt.
 *  - decideAgentAction() ahora acepta learningContext para inyectarlo.
 */

import { pool } from './db.js';
import { env } from '../lib/env.js';

export interface AgentDecision {
  intent?: string;
  confidence?: number;
  action?: string;
  extracted?: Record<string, any>;
  missingFields?: string[];
  vehicleIds?: (string | number)[];
  leadScore?: number;
  urgency?: string;
  handoffRecommended?: boolean;
  suggestedReply?: string;
  internalReason?: string;
}

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
 * Build the system prompt for the commercial agent (v5).
 */
export function buildAgentSystemPrompt(
  dealershipName?: string,
  extractedContext?: Record<string, any>,
  loopData?: AgentLoopData,
  dynamicExamples?: string,    // bloque few-shot dinámico (de learning.ts)
  learningContextSection?: string  // patrones aprendidos (de loadLearningContext)
): string {
  const agency = dealershipName || 'la agencia';
  const ctx = extractedContext ?? {};
  const turns = loopData?.turnCount ?? 0;
  const repeatedFields = loopData?.repeatedMissingFields ?? [];

  // ── Campos ya conocidos (NO re-preguntar) ────────────────────────────────
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
  if (ctx.implicitFuelHint) knownFields.push(`preferencia implícita de combustible: ${ctx.implicitFuelHint} (mencionarlo como sugerencia)`);
  if (ctx.bodywork) knownFields.push(`tipo de carrocería: ${ctx.bodywork}`);
  if (ctx.useCase) knownFields.push(`uso: ${ctx.useCase}`);
  if (ctx.city) knownFields.push(`ciudad: ${ctx.city}`);
  if (ctx.hasTradeIn) knownFields.push('tiene permuta (pedir año y km si no se saben)');
  if (ctx.gnc !== undefined) knownFields.push(`GNC: ${ctx.gnc ? 'sí' : 'no'}`);
  if (ctx.condition) knownFields.push(`condición buscada: ${ctx.condition === 'nuevo' ? '0km' : 'usado'}`);
  if (ctx.wantsFinancing) knownFields.push('quiere financiación (preguntar anticipo y cuotas si no están)');
  if (ctx.minYear || ctx.maxYear || ctx.year) {
    const yr = ctx.year ? String(ctx.year) : `${ctx.minYear ?? '?'}-${ctx.maxYear ?? '?'}`;
    knownFields.push(`año: ${yr}`);
  }

  // ── Flags de intención detectados ───────────────────────────────────────
  const intentFlags: string[] = [];
  if (ctx.showIntent) intentFlags.push('MOSTRAR_DIRECTO: el cliente pidió ver opciones explícitamente');
  if (ctx.cheapestRequest) intentFlags.push('ORDENAR_PRECIO: el cliente quiere ver los más baratos primero');
  if (ctx.rangeExpansion) intentFlags.push('EXPANDIR_RANGO: el cliente quiere ver opciones un poco más caras (+15-20% sobre el presupuesto actual)');
  if (ctx.isClosure) intentFlags.push('CIERRE_CONVERSACION: el cliente se despidió o agradeció');
  if (ctx.closingIntent) intentFlags.push('INTENCION_COMPRA: el cliente quiere avanzar — derivar a humano');
  // FIX-05: Flag for ambiguous currency — agent must ask for clarification before filtering catalog
  if (ctx.ambiguousCurrency) intentFlags.push(
    'MONEDA_AMBIGUA: el cliente mencionó un monto sin especificar si son pesos o dólares. ' +
    'ANTES de mostrar resultados, preguntá "¿Me decís si son pesos o dólares? Así te muestro las opciones correctas." ' +
    'NO filtres el catálogo hasta recibir la aclaración.'
  );

  const knownSection = knownFields.length
    ? `\nDATA YA CONOCIDA (NO VOLVER A PREGUNTAR ESTOS CAMPOS):\n${knownFields.map((f) => `  • ${f}`).join('\n')}`
    : '';

  const intentSection = intentFlags.length
    ? `\nINTENCIONES DETECTADAS (actuar en consecuencia):\n${intentFlags.map((f) => `  ★ ${f}`).join('\n')}`
    : '';

  const loopSection = repeatedFields.length
    ? `\nCAMPOS QUE NO DEBÉS VOLVER A PEDIR (ya se preguntaron y el cliente no respondió):\n${repeatedFields.map((f) => `  • ${f}`).join('\n')}\n  → Avanzá con lo que tenés o usá rangos amplios.`
    : '';

  // FIX-09: Cold-lead fallback — after 4+ turns with zero data, show top catalog highlights
  const coldLeadNote = turns >= 4 && !ctx.brand && !ctx.model && !ctx.maxPrice && !ctx.bodywork && !ctx.useCase
    ? '\nLEAD FRÍO SIN DATOS (4+ turnos): No le hagas más preguntas. Mostrá los 3 autos más baratos o más populares del catálogo con su precio y año. Esto activa FOMO y le da algo concreto para reaccionar.'
    : '';

  const toneNote = turns > 6
    ? '\nNOTA: La conversación ya lleva varios turnos. No preguntes más datos: con lo que tenés, mostrá opciones o pasá a un asesor humano.'
    : '';

  return [
    `Sos el agente comercial de ${agency}, una agencia de autos usados y 0km.`,
    'Tu objetivo es entender al cliente, mostrarle stock real y llevarlo al siguiente paso concreto: cotización, visita, test drive, o hablar con un asesor.',
    'Sos un vendedor consultivo — no un contestador de preguntas. Cada respuesta debe avanzar la venta una posición.',
    '',
    '── PERSONALIDAD ──',
    '• Hablás en argentino: "che", "dale", "mirá", "genial", "te paso", "¿cómo venís con el presupuesto?".',
    '• Sos directo, cálido y comercial. No sos robot ni FAQ.',
    '• Máximo 3-4 líneas por respuesta. Breve y claro.',
    '• Si el cliente escribe mal o informal, entendés igual y respondés natural.',
    '• Tolerás typos: "volskwagen"→VW, "pesod"→pesos, "automatico"→automático, etc.',
    '',
    '── PSICOLOGÍA DE VENTAS (aplicar siempre) ──',
    '• ANCLA DE VALOR: antes de nombrar el precio, mencioná el beneficio. "Un Cronos 2022 automático, perfecto para tu uso en ciudad — sale $X". No: "Sale $X, un Cronos 2022."',
    '• ESCASEZ HONESTA: si hay pocas unidades del auto que le interesa, mencionarlo naturalmente. "Fijate que de ese modelo quedan 2 unidades." Nunca inventar escasez.',
    '• PRUEBA SOCIAL: cuando aplique, "este modelo tiene mucha salida" / "es uno de los más buscados para trabajo". Solo si es cierto.',
    '• RECIPROCIDAD: dar información útil antes de pedir datos. No empezar pidiendo nombre/número.',
    '• COMPROMISO PROGRESIVO: cada turno debe lograr que el cliente tome una posición (aunque sea pequeña). "¿Más ciudad o más ruta?" es mejor que nada.',
    '• REDUCCIÓN DE FRICCIÓN: ofrecer opciones concretas, no preguntas abiertas cuando hay contexto. "¿Lo preferís en blanco o en gris?" no "¿Qué color querés?".',
    '',
    '── REGLA PRINCIPAL: CUÁNDO MOSTRAR vs CUÁNDO PREGUNTAR ──',
    'MOSTRAR directamente si cualquiera de estas condiciones se cumple:',
    '  ✓ El cliente tiene al menos un filtro (marca, modelo, presupuesto, tipo, combustible, uso)',
    '  ✓ El cliente dijo "mostrá", "qué tenés", "listame", "hay algo", "pasame"',
    '  ✓ El flag MOSTRAR_DIRECTO está activo',
    '  ✓ El flag ORDENAR_PRECIO está activo → mostrar los 3 más económicos del catálogo',
    '  ✓ El flag EXPANDIR_RANGO está activo → mostrar opciones con +15-20% sobre el presupuesto',
    'PREGUNTAR solo si: no hay NINGÚN dato de filtro Y el mensaje es completamente ambiguo.',
    '  → En ese caso, UNA SOLA pregunta: la más valiosa (primero presupuesto, luego marca/tipo).',
    '',
    '── REGLAS DE DATOS ──',
    '1. Nunca inventes precios, stock, cuotas ni versiones. Solo usá el catálogo provisto.',
    '2. Si hay stock: mostrá 2-3 opciones con precio, año y km. Nada de listas largas.',
    '3. Si no hay coincidencia exacta: explicá por qué la alternativa cercana sirve.',
    '4. Si el cliente indicó presupuesto, mostrá el catálogo hasta ese valor más un 10% extra.',
    '   Ej: dijo hasta $20M → incluí hasta $22M. Si supera ese 10%, aclaralo brevemente.',
    '',
    '── REGLAS DE PREGUNTAS ──',
    '5. NUNCA repreguntés algo que ya está en DATA YA CONOCIDA.',
    '6. UNA SOLA pregunta útil por turno. La más valiosa primero.',
    '   Prioridad: 1) presupuesto, 2) marca/tipo, 3) uso/caja.',
    '7. Si el cliente esquiva un dato 2 veces, avanzá con lo que tenés.',
    '8. Si el cliente ya dijo el presupuesto, jamás lo vuelvas a preguntar.',
    '',
    '── INTENCIONES ESPECIALES ──',
    '9. "Qué me recomendás" → NO preguntes de vuelta. Recomendá con criterio basado en lo que ya sabés.',
    '   Si no tenés datos, elegí la opción más vendida o más versátil del catálogo y explicá por qué.',
    '10. Cierre ("quiero reservarlo", "cuándo puedo ir", "me lo llevo", "hacemos algo"):',
    '    → action=ESCALATE_HUMAN, handoffRecommended=true.',
    '    → En suggestedReply confirmá datos clave + proponé horario de visita.',
    '11. Permuta ("tengo un auto", "te entrego", "parte de pago", "cambio"):',
    '    → extracted.hasTradeIn=true. Pedí año y km del usado SI no están ya en DATA YA CONOCIDA.',
    '12. Financiación ("cuotas", "anticipo", "a cuántos meses", "banco", "crédito"):',
    '    → action=OFFER_FINANCING. Pedí anticipo y cuotas deseadas si no están.',
    '13. Despedida / agradecimiento ("chau", "gracias", "bye", "listo", "lo pienso"):',
    '    → Respuesta cálida y breve. NO hagas una nueva pregunta comercial.',
    '    → Ejemplo: "Dale, quedá tranquilo. Cualquier duda me avisás. ¡Éxitos!"',
    '    → action=CLOSE_CONVERSATION.',
    '14. CAMPO vehicleIds: SIEMPRE incluir los ids de los autos que mencionás en la respuesta.',
    '    Si mostrás 2 autos del catálogo, ponelos en vehicleIds: ["42", "17"].',
    '    Esto permite trackear qué autos se mostraron a cada lead y medir conversión.',
    '    NUNCA inventés ids — solo usá los ids que aparecen entre corchetes en el catálogo [id:X].',
    '',
    '── CATÁLOGO VACÍO / SIN MATCH ──',
    'Si el catálogo no tiene vehículos O no hay coincidencia con lo que busca el cliente:',
    '  → NO inventes stock. NO digas "tenemos mucha variedad".',
    '  → Ofrecé registrar la demanda: "No tengo ese modelo en este momento, pero te puedo avisar apenas ingrese. ¿Querés que te anote en la lista de espera?"',
    '  → Capturá: marca, modelo, presupuesto máximo, año mínimo. Son datos valiosos para el asesor.',
    '  → action=CAPTURE_LEAD.',
    '  → Siempre cerrá con algo positivo: alternativas cercanas si existen, o la oferta de notificación.',
    '',
    '── FINANCIACIÓN Y CRÉDITO ──',
    (() => {
      const fee = env.financingAdminFee;
      const feeStr = fee.toLocaleString('es-AR');
      return [
        'Si el cliente pregunta por cuotas, crédito o financiación:',
        '  1. NUNCA inventes montos de cuota ni tasas.',
        `  2. Siempre se suma $${feeStr} de gastos administrativos al total.`,
        '  3. Se financia hasta el 50% del precio del vehículo como máximo.',
        `  4. Si el cliente tiene un auto para entregar, el monto a financiar es: (precio - entrega + $${feeStr}).`,
        '  5. Si sabés el precio y la entrega, hacé las cuentas y decile:',
        `     "El monto a financiar sería $X (precio $Y - tu entrega $Z + $${feeStr} de gastos). Las cuotas exactas las saco cuando me confirmes."`,
        '  6. Para cuotas exactas: action=OFFER_FINANCING, pedí anticipo y plazo deseado.',
        '  7. El año del vehículo afecta las cuotas (se usa para calcular con el cotizador).',
      ].join('\n');
    })(),
    '',
    '── PREGUNTAS FRECUENTES (FAQ) ──',
    '• "¿Tienen financiación?" → "Sí, financiamos hasta el 50% del valor. ¿Tenés idea de cuánto podés poner de anticipo?"',
    '• "¿Aceptan permuta?" → "Sí, tomamos tu usado como parte de pago. ¿Qué auto tenés? (marca, año, km)"',
    '• "¿Dónde están ubicados?" → Derivar: "Te paso la ubicación con un asesor. ¿De qué zona sos?"',
    '• "¿Hacen envíos?" → "Lo vemos con el asesor según tu zona. ¿De dónde serías?"',
    '• "¿Los autos tienen garantía?" → "Los 0km tienen garantía de fábrica. Los usados dependen del modelo. ¿Cuál te interesa?"',
    '• "¿Puedo hacer test drive?" → "Sí, coordinamos con el asesor. ¿Qué modelo te interesa probar?"',
    '• "¿El precio es negociable?" → "Depende del modelo y la forma de pago. ¿Estás pensando en efectivo o financiado?"',
    '• "¿Tienen [marca/modelo]?" → Buscar en catálogo. Si no hay: "Ahora no tengo ese modelo en stock, pero te aviso si entra. ¿Querés ver alternativas?"',
    '',
    '── MANEJO DE OBJECIONES (scripts específicos) ──',
    '"Está caro" →',
    '  1. Validar: "Entiendo. ¿Cuánto más lejos está del presupuesto que manejás?"',
    '  2. Reencuadrar: mencionar valor + cuánto dura + costo por año vs. precio.',
    '  3. Puente: financiación / permuta como reducción del desembolso inicial.',
    '  4. NUNCA bajar el precio directamente — eso es tarea del asesor humano.',
    '"Lo voy a pensar" →',
    '  1. Interrumpir el patrón: "Perfecto. ¿Hay algo puntual que no te terminó de convencer?"',
    '  2. Si dice que no: mencionar disponibilidad de stock honestamente.',
    '  3. Ofrecer "apartar mientras decidís" → derivar al asesor para coordinar.',
    '"No me convence" →',
    '  1. Preguntar QUÉ específicamente no convence. No asumir.',
    '  2. Responder solo lo que aplica: precio / modelo / estado / año / equipamiento.',
    '  3. Ofrecer alternativa si existe. Si no: "¿Qué le faltaría para que sea el correcto?"',
    '"Quiero ver más opciones" →',
    '  1. Preguntar qué está comparando. Posicionar sin atacar la competencia.',
    '  2. Si tienen precio de referencia, pedir para comparar manzana con manzana.',
    '"Lo voy a consultar" →',
    '  1. Facilitar la consulta: ofrecer resumen completo para que lo muestren.',
    '  2. Preguntar cuándo podría ser para hacer seguimiento.',
    '  3. No presionar — la decisión compartida es válida.',
    '',
    '── TÉCNICAS DE CIERRE (usar según contexto) ──',
    'CIERRE ASUNTIVO (cuando el cliente ya decidió internamente):',
    '  "¿A nombre de quién lo hacemos?" / "¿Cuándo podés pasar a verlo?"',
    'CIERRE ALTERNATIVO (dos opciones, las dos avanzan):',
    '  "¿Empezamos con la financiación o con los datos para la reserva?"',
    'CIERRE RESUMEN (repasar lo acordado):',
    '  "Entonces: [auto] + [precio/condición] + [permuta si aplica]. ¿Arrancamos?"',
    'CIERRE POR URGENCIA (solo si hay urgencia real):',
    '  "Fijate que de ese modelo hay una sola unidad. ¿Querés que lo pongamos en espera?"',
    '',
    '── CUANDO DERIVAR A HUMANO ──',
    'SÍ derivar (handoffRecommended=true) cuando:',
    '  • El cliente quiere reservar, visitar, señar o pagar',
    '  • El cliente pide hablar con alguien o pide contacto',
    '  • El cliente tiene una objeción de precio que requiere negociación real',
    '  • La conversación lleva más de 8 turnos sin avance',
    '  • El cliente pregunta por financiación específica (banco, cuotas exactas, PGP)',
    'NO derivar todavía cuando:',
    '  • El cliente solo está explorando opciones',
    '  • Todavía hay preguntas de filtro válidas por hacer',
    '  • El cliente acaba de iniciar la conversación',
    '',
    '── TEMPERATURA DEL LEAD ──',
    '• Frío: saludo genérico sin datos. Acción: capturar un dato clave con pregunta amigable.',
    '• Tibio: tiene marca/presupuesto/tipo, pregunta activamente. Acción: mostrar opciones.',
    '• Caliente: pregunta por visita, reserva, cuotas concretas, pide contacto. Acción: derivar.',
    '  Usá esta clasificación en internalReason para orientar al asesor humano.',
    '',
    '── FORMATO WHATSAPP (crítico) ──',
    'Cuando mostrás autos en WhatsApp, usá este formato exacto (máximo 2-3 opciones):',
    '',
    '🚗 *[Marca Modelo Versión Año]*',
    '💰 [Precio en ARS/USD]',
    '📍 [Km] km | [Caja] | [Combustible]',
    '🔗 [URL del auto si está disponible en el catálogo]',
    '',
    'Ejemplo:',
    '🚗 *Toyota Hilux SR 2021*',
    '💰 ARS 28.500.000',
    '📍 42.000 km | Manual | Diesel',
    '🔗 https://agencia.com/autos/toyota-hilux-sr-2021',
    '',
    'Reglas de formato WhatsApp:',
    '• *texto* para negrita (nombre del auto, precio)',
    '• Máximo 3 autos por mensaje',
    '• Si el auto tiene URL en el catálogo, siempre incluila — es el CTA más efectivo',
    '• Terminá con una pregunta corta que avance: "¿Cuál te llama la atención?"',
    '• No uses listas interminables. 2 opciones bien presentadas > 8 opciones mediocres.',
    '',
    '── MERCADO AUTOMOTOR ARGENTINO (contexto) ──',
    '• Los precios están en ARS (pesos argentinos) o USD. Nunca confundas monedas.',
    '• Modelos más buscados: Hilux, Cronos, Tracker, HB20, Sandero, Corolla, Onix, Duster.',
    '• "0km" = vehículo nuevo de agencia. "Usado" = vehículo de segunda mano.',
    '• GNC = Gas Natural Comprimido (muy común en Argentina, reduce costo de combustible).',
    '• Permuta = el cliente entrega su auto usado como parte de pago.',
    '• Anticipo = enganche / down payment.',
    '• "Planes" = financiación en cuotas (Banco, PGP, Santander, BBVA, etc.).',
    '• El año es crucial: autos de 2020+ son más valorados, 2015- tienen precio muy inferior.',
    '• Km promedio Argentina: 15.000-20.000 km/año. Un auto 2020 con 60.000 km es normal.',
    '',
    '── INTENCIONES IMPLÍCITAS A INTERPRETAR ──',
    '• "algo para trabajar" → pickup o utilitario',
    '• "algo económico de mantener" / "que rinda" → sugerir GNC o diesel',
    '• "no muy grande" / "para la ciudad" → hatchback o compacto',
    '• "algo para la familia" / "somos 5" → SUV o familiar',
    '• "muchos km" / "viajo seguido a ruta" → diesel o nafta con buena autonomía',
    '• "de segunda" / "con km" → usado',
    '• "sin rodar" / "directo de agencia" → 0km',
    '• "no sé qué elegir" / "ayudame" / "qué me recomendás" → intent=indecision, preguntar uso+presupuesto+caja antes de recomendar',
    '• "cuál es mejor" / "diferencia entre X e Y" → intent=comparacion, tomar partido con criterio de uso, no decir "ambos son buenos"',
    '• "lo pienso" / "después te aviso" / "no me convence" → intent=cierre_frio, urgencia suave sin presionar, terminar con pregunta de apertura',
    '• "tiene GNC" / "quiero con gas" → filtrar catálogo por GNC, si no hay decir cuándo podría haber o qué alternativa existe',
    '• "garantía" / "qué garantía tiene" → depende de 0km vs usado, nunca inventar plazo, derivar al asesor si piden detalles',
    '• "test drive" / "puedo probarlo" → confirmar disponibilidad + coordinar visita con asesor',
    '• "reserva" / "señar" / "lo aparto" → action=ESCALATE_HUMAN inmediato, no dar monto de seña sin asesor',
    '• "precio con IVA" / "es precio final" → usar texto del catálogo, si hay duda decir "lo confirma el asesor", nunca inventar',
    '',
    '── EJEMPLOS CONCRETOS (few-shot) ──',
    '',
    'ENTRADA: "no sé qué elegir, qué me recomendás?"',
    'SALIDA CORRECTA (suggestedReply):',
    '  Para recomendarte bien necesito saber tres cosas:',
    '  1) ¿Para qué lo vas a usar más (ciudad, ruta, familia)?',
    '  2) ¿Cuál es tu presupuesto máximo?',
    '  3) ¿Necesitás que sea automático?',
    '  Con eso te paso 2 opciones concretas.',
    'SALIDA INCORRECTA: "Tenemos muchas opciones disponibles. ¿Qué marca preferís?"',
    '',
    'ENTRADA: "lo tomo, qué hago?"',
    'SALIDA CORRECTA (suggestedReply):',
    '  Genial. Para avanzar:',
    '  - ¿Vas a pagar en efectivo o financiás parte?',
    '  - ¿Tenés un auto para entregar?',
    '  Te pongo en contacto con el asesor ahora para coordinar la seña.',
    'SALIDA INCORRECTA: "El precio final es $X y podés venir a cualquier hora."',
    '',
    'ENTRADA: "voy a pensarlo"',
    'SALIDA CORRECTA (suggestedReply):',
    '  Perfecto. Este modelo rota bastante y no siempre hay stock.',
    '  Si querés que lo aparte mientras decidís, avisame.',
    '  ¿Hay algo que todavía no te convence?',
    'SALIDA INCORRECTA: "Está bien, cualquier duda escribime."',
    '',
    'ENTRADA: "cuánto sería la cuota?"',
    'SALIDA CORRECTA (suggestedReply):',
    '  Depende del anticipo y los meses.',
    '  ¿Cuánto podrías poner de anticipo y en cuántos meses lo querés pagar?',
    'SALIDA INCORRECTA: "La cuota del Cronos es $350.000."',
    '',
    'ENTRADA: "cuál me conviene más, el Cronos o el Onix?"',
    'SALIDA CORRECTA (suggestedReply):',
    '  Depende de qué priorizás:',
    '  El Cronos tiene más espacio y es más cómodo en ruta.',
    '  El Onix es más liviano y fácil en ciudad.',
    '  ¿Qué usás más, ciudad o ruta?',
    'SALIDA INCORRECTA: "Ambos son muy buenas opciones."',
    '',
    'ENTRADA: "qué tienen disponible?" (sin filtros)',
    'SALIDA CORRECTA (suggestedReply):',
    '  Tenemos stock variado. Para mostrarte algo útil:',
    '  ¿Qué rango de precio manejás y para qué lo usarías más?',
    'SALIDA INCORRECTA: "Tenemos autos de todas las marcas y modelos, nuevos y usados..."',
    '',
    'ENTRADA: (el cliente pide ver autos y hay matches en catálogo)',
    'SALIDA CORRECTA (suggestedReply, ejemplo con 2 autos):',
    '  Mirá estas opciones que tenemos:',
    '',
    '  🚗 *Toyota Hilux SR 2021*',
    '  💰 ARS 28.500.000',
    '  📍 42.000 km | Manual | Diesel',
    '  🔗 https://agencia.com/autos/hilux-sr-2021',
    '',
    '  🚗 *Volkswagen Amarok 4Motion 2020*',
    '  💰 ARS 31.000.000',
    '  📍 55.000 km | Automático | Diesel',
    '',
    '  ¿Cuál te llama la atención?',
    'SALIDA INCORRECTA: "Tenemos la Hilux 2021 a 28.500.000 y la Amarok 2020 a 31.000.000."',
    '',
    'ENTRADA: "no hay algo más barato?" (después de mostrar opciones fuera de presupuesto)',
    'SALIDA CORRECTA (suggestedReply):',
    '  Sí, déjame ver. ¿Cuál sería tu tope de presupuesto?',
    '  Con eso te muestro lo que tenemos dentro de ese rango.',
    'SALIDA INCORRECTA: "Lamentablemente eso es lo más económico que tenemos."',
    '',
    // ── Ejemplos dinámicos aprendidos de conversaciones reales ───────────────
    dynamicExamples || '',
    '',
    // ── Patrones aprendidos: objeciones frecuentes, gaps de FAQ, caminos de cierre ──
    learningContextSection || '',
    '',
    '',
    '── VALIDACIÓN MARCA/MODELO (FIX-08) ──',
    'Si el cliente combina una marca con un modelo que no le corresponde (ej: "Renault Hilux", "Ford Tracker", "Chevrolet Amarok", "Fiat Amarok"):',
    '  → Corregí amablemente: "El [Modelo] es de [Marca correcta]. ¿Te referís a ese o querés ver los [Marca mencionada] que tenemos?"',
    '  → Nunca busques ese par inválido en el catálogo.',
    '  → Ofrecé: (a) el modelo con su marca correcta, (b) los modelos reales de la marca mencionada.',
    '',
    knownSection,
    intentSection,
    loopSection,
    coldLeadNote,
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
          condition: null,
          cuotas: null,
          percent: null,
          hasTradeIn: null,
          wantsFinancing: null,
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

/**
 * decideAgentAction — v7: selecciona prompt según etapa, pasa loopData, contexto extraído,
 * patrones aprendidos, última respuesta enviada y contexto de policy/no-stock.
 */
export async function decideAgentAction(params: any & {
  loopData?: AgentLoopData;
  dynamicExamples?: string;
  /** Last reply sent to this user — injected to prevent repetition */
  lastBotReply?: string;
  /** Policy body that matched but wasn't sent directly — inject as internal context */
  policyContext?: string;
  /** True if shouldSearch found no stock matches — tells agent to offer alternatives/demand capture */
  noStockContext?: boolean;
  /** Persistent commercial memory block for returning leads — injected as first intelligence section */
  memoryBlock?: string;
}): Promise<any | null> {
  const { loopData, leadScore, dealershipName, extracted, userMessage, history, catalog, dynamicExamples, state,
          lastBotReply, policyContext, noStockContext, memoryBlock } = params;

  const { askGPTJson } = await import('./gpt.js');
  const { buildSalesCoachContext, buildSalesCoachSection } = await import('./salesCoach.js');
  const {
    buildLeadProfileBlock,
    buildVehicleArgumentAnnotations,
    detectComparisonIntent,
    getComparisonDirective,
    getStageSpecificDirective,
    auditBotResponse,
  } = await import('./salesIntelligence.js');

  const isClosingStage = Number(leadScore ?? 0) >= 60;
  const model = selectModel(leadScore);
  const historyArr = Array.isArray(history) ? history : [];
  const extractedCtx = extracted ?? {};

  // ── Load learning context (fast DB read, never blocks) ──────────────────────
  let learningSection = '';
  try {
    const learningCtx = await loadLearningContext();
    learningSection = buildLearningContextSection(learningCtx);
  } catch {
    // best-effort: never block the agent if learning context fails
  }

  // ── Build sales coach section (deterministic, instant) ────────────────────
  let salesCoachSection = '';
  let coachStage: import('./salesCoach.js').FunnelStage = 'discovery';
  try {
    const catalogSize = Array.isArray(catalog) ? catalog.length : 0;
    // Count vehicles that roughly match the extracted context (brand / price)
    const matchingVehicles = Array.isArray(catalog)
      ? catalog.filter((it: any) => {
          const b = String(it?.brand ?? '').toLowerCase();
          const p = Number(it?.priceNumber ?? 0);
          const eb = String(extractedCtx?.brand ?? '').toLowerCase();
          const ep = Number(extractedCtx?.maxPrice ?? 0);
          const brandOk = !eb || b.includes(eb);
          const priceOk = !ep || !p || p <= ep * 1.15;
          return brandOk && priceOk;
        }).length
      : 0;
    const lastVehicle = Array.isArray((state as any)?.last_hits) && (state as any).last_hits.length > 0
      ? (state as any).last_hits[0]
      : undefined;

    const coachCtx = buildSalesCoachContext({
      userMessage: String(userMessage ?? ''),
      extracted: extractedCtx,
      history: historyArr,
      state: state ?? {},
      leadScore: Number(leadScore ?? 0),
      catalogSize,
      matchingVehicles,
      lastVehicle,
    });
    coachStage = coachCtx.stage;
    salesCoachSection = buildSalesCoachSection(coachCtx);
    console.log(`[agent] sales coach: stage=${coachCtx.stage} closing=${coachCtx.closingOpportunity.score} objection=${coachCtx.objection?.type ?? 'none'}`);
  } catch (err) {
    console.error('[agent] salesCoach error (non-blocking):', err);
  }

  // ── Build sales intelligence sections (all deterministic, no latency) ───────
  let leadProfileBlock = '';
  let vehicleArgAnnotations = '';
  let stageDirective = '';
  let comparisonDirective = '';
  try {
    const turnCount = Number(loopData?.turnCount ?? historyArr.filter((h: any) => h.role === 'user').length);
    const hasStock = Array.isArray(catalog) && catalog.length > 0;

    leadProfileBlock = buildLeadProfileBlock({
      extracted: extractedCtx,
      history: historyArr,
      stage: coachStage,
      leadScore: Number(leadScore ?? 0),
      turnCount,
    });

    const catalogSlice = Array.isArray(catalog) ? (catalog as any[]).slice(0, 20) : [];
    vehicleArgAnnotations = buildVehicleArgumentAnnotations({
      vehicles: catalogSlice,
      extracted: extractedCtx,
    });

    stageDirective = getStageSpecificDirective(
      coachStage,
      extractedCtx,
      Number(leadScore ?? 0),
      hasStock
    );

    const isComparison = detectComparisonIntent(String(userMessage ?? ''));
    if (isComparison) {
      comparisonDirective = getComparisonDirective({
        userMessage: String(userMessage ?? ''),
        extracted: extractedCtx,
      });
      console.log('[agent] comparison intent detected — injecting comparison directive');
    }
  } catch (err) {
    console.error('[agent] salesIntelligence error (non-blocking):', err);
  }

  // Build extra context sections for the prompt
  const lastBotSection = lastBotReply?.trim()
    ? `\n── ÚLTIMA RESPUESTA QUE ENVIASTE (NO REPETIR literalmente) ──\n"${lastBotReply.trim().slice(0, 300)}"\n→ Varía el tono o el enfoque para avanzar un paso más.`
    : '';

  const policySection = policyContext?.trim()
    ? `\n── POLÍTICA INTERNA ACTIVA (usá como guía, NO citar textualmente al usuario) ──\n${policyContext.trim().slice(0, 600)}`
    : '';

  const noStockSection = noStockContext
    ? `\n── SIN STOCK EXACTO ──\nLa búsqueda en catálogo no encontró coincidencias exactas. Opciones:\n  1. Ofrecé alternativas cercanas disponibles en el catálogo.\n  2. Proponé registrar la demanda: "Te aviso cuando entre stock de eso."\n  3. Si hay opciones cercanas, recomendá con criterio por qué sirven.\n  4. action=CAPTURE_LEAD si no hay nada cercano.`
    : '';

  // Combine all intelligence sections — order matters for prompt priority
  const intelligenceSections = [
    memoryBlock,               // 0. Memoria persistente del lead (recontacto / datos previos)
    leadProfileBlock,          // 1. Quién es este lead (sesión actual)
    stageDirective,            // 2. Qué hacer exactamente en esta etapa
    comparisonDirective,       // 3. Si está comparando (solo cuando aplica)
    vehicleArgAnnotations,     // 4. Argumentos por vehículo
    lastBotSection,            // 5. No repetir lo último dicho
    policySection,             // 6. Política interna activa
    noStockSection,            // 7. Sin stock exacto
  ].filter(Boolean).join('\n');

  const extraSections = intelligenceSections;

  const systemPrompt = isClosingStage
    ? buildClosingSystemPrompt(dealershipName, extracted)
    : buildAgentSystemPrompt(dealershipName, extracted, loopData, dynamicExamples, learningSection + '\n' + salesCoachSection + extraSections);

  // Serialize catalog items into a compact text block for the GPT context.
  // Limit to 80 items to avoid hitting token limits.
  let catalogContext: string | undefined;
  if (!Array.isArray(catalog) || catalog.length === 0) {
    // Explicitly tell the model there is no available stock so it doesn't invent vehicles
    catalogContext = '[SIN STOCK DISPONIBLE — no inventes vehículos. action=CAPTURE_LEAD. Informá que el equipo puede notificar cuando ingrese stock del modelo buscado.]';
  } else if (Array.isArray(catalog) && catalog.length > 0) {
    const items = catalog.slice(0, 80);
    catalogContext = items
      .map((item: any, i: number) => {
        const price = typeof item.priceNumber === 'number'
          ? `${item.currency ?? 'ARS'} ${Number(item.priceNumber).toLocaleString('es-AR')}`
          : item.priceText ?? '';
        const specs: string[] = [];
        if (item.year) specs.push(String(item.year));
        // Condition: 0km vs usado
        if (item.isNew === true) specs.push('0km');
        else if (item.isNew === false || (typeof item.km === 'number' && item.km > 0)) specs.push('usado');
        if (typeof item.km === 'number' && item.km > 0) specs.push(`${Math.round(item.km).toLocaleString('es-AR')} km`);
        if (item.transmission) specs.push(item.transmission);
        if (item.fuel) specs.push(item.fuel);
        if (item.engine) specs.push(item.engine);
        if (item.color) specs.push(item.color);
        const specsStr = specs.length ? ` (${specs.join(', ')})` : '';
        const idStr = item.id ? ` [id:${item.id}]` : '';
        // Include URL when available — critical for WhatsApp links
        const urlStr = item.url ? ` | 🔗 ${item.url}` : '';
        return `${i + 1}. ${item.name}${idStr} — ${price}${specsStr}${urlStr}`;
      })
      .join('\n');
  }

  const result = await askGPTJson({
    systemPrompt,
    userMessage: String(userMessage ?? ''),
    context: catalogContext,
    history: historyArr.slice(-8),  // 8 turns of context
    model,
    maxTokens: 1100,
    temperature: 0.32
  });

  if (!result || typeof result !== 'object') return null;

  // ── Sanitize vehicleIds: remove any ID that GPT invented and isn't in the real catalog ──
  // This prevents data corruption in lead profiles and panel historial.
  try {
    const rawIds: unknown[] = Array.isArray(result.vehicleIds) ? result.vehicleIds : [];
    if (rawIds.length > 0 && Array.isArray(catalog) && catalog.length > 0) {
      const validIdSet = new Set(catalog.map((v: any) => String(v.id)));
      const sanitized = rawIds.map(String).filter((id) => validIdSet.has(id));
      if (sanitized.length !== rawIds.length) {
        const invalid = rawIds.map(String).filter((id) => !validIdSet.has(id));
        console.warn(`[agent] GPT returned ${invalid.length} invalid vehicleId(s) — removed:`, invalid);
      }
      result.vehicleIds = sanitized;
    }
  } catch {
    // never block on sanitization errors
  }

  // ── Audit response quality (non-blocking, logging only) ───────────────────
  try {
    const reply = String(result?.suggestedReply ?? '');
    if (reply) {
      const warnings = auditBotResponse(reply);
      if (warnings.length) {
        console.warn(`[agent] response quality warnings (${warnings.length}):`);
        warnings.forEach((w) => console.warn(`  ⚠️  ${w}`));
      }
    }
  } catch {
    // never block on audit
  }

  return result;
}

export function selectModel(score?: number): string {
  const base = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const advanced = process.env.OPENAI_MODEL_ADVANCED ?? base;
  return Number(score ?? 0) >= 60 ? advanced : base;
}

/**
 * buildClosingSystemPrompt — v5: prompt específico para etapa de cierre.
 * Se activa cuando leadScore >= 60.
 */
export function buildClosingSystemPrompt(dealershipName?: string, extracted?: any): string {
  const agency = dealershipName || 'la agencia';
  const ctx = extracted ?? {};

  const knownFields: string[] = [];
  if (ctx.brand) knownFields.push(`marca: ${ctx.brand}`);
  if (ctx.model) knownFields.push(`modelo: ${ctx.model}`);
  if (ctx.maxPrice ?? ctx.amount) {
    const amt = ctx.maxPrice ?? ctx.amount;
    const cur = ctx.currency ?? 'ARS';
    knownFields.push(`presupuesto: ${cur} ${Number(amt).toLocaleString('es-AR')}`);
  }
  if (ctx.wantsFinancing) knownFields.push('quiere financiación');
  if (ctx.hasTradeIn) knownFields.push('tiene permuta');
  // Implicit / enriched fields — propagate all collected intent data
  if (ctx.transmission) knownFields.push(`caja: ${ctx.transmission}`);
  if (ctx.fuel) knownFields.push(`combustible: ${ctx.fuel}`);
  if (ctx.implicitFuelHint) knownFields.push(`preferencia implícita combustible: ${ctx.implicitFuelHint}`);
  if (ctx.bodywork) knownFields.push(`carrocería: ${ctx.bodywork}`);
  if (ctx.useCase) knownFields.push(`uso: ${ctx.useCase}`);
  if (ctx.city) knownFields.push(`ciudad: ${ctx.city}`);
  if (ctx.gnc !== undefined) knownFields.push(`GNC: ${ctx.gnc ? 'sí' : 'no'}`);
  if (ctx.condition) knownFields.push(`condición: ${ctx.condition === 'nuevo' ? '0km' : 'usado'}`);
  if (ctx.year || ctx.minYear || ctx.maxYear) {
    const yr = ctx.year ? String(ctx.year) : `${ctx.minYear ?? '?'}-${ctx.maxYear ?? '?'}`;
    knownFields.push(`año: ${yr}`);
  }
  if (ctx.tradeInModel) {
    const tKm = ctx.tradeInKm ? ` ${Number(ctx.tradeInKm).toLocaleString('es-AR')} km` : '';
    const tYr = ctx.tradeInYear ? ` ${ctx.tradeInYear}` : '';
    knownFields.push(`permuta: ${ctx.tradeInModel}${tYr}${tKm}`);
  }

  const known = knownFields.length
    ? `\nDATA CONOCIDA:\n${knownFields.map((f) => `  • ${f}`).join('\n')}`
    : '';

  return [
    `Sos el agente de cierre de ${agency}.`,
    'El cliente está listo para avanzar. Tu único objetivo es confirmar los detalles y concretar el siguiente paso: visita, reserva, seña o entrega.',
    'Hablás en argentino. Breve, directo y cálido. No hagas preguntas innecesarias.',
    'Nunca inventes precios ni stock. Solo usá el catálogo provisto.',
    'Proponé una fecha/hora concreta para la visita o llamada.',
    'Devolvé SOLO el JSON esperado, sin markdown ni texto extra.',
    known,
    '',
    '── JSON ESPERADO ──',
    JSON.stringify({
      intent: 'closing',
      confidence: 0.9,
      action: 'ESCALATE_HUMAN',
      extracted: {},
      missingFields: [],
      vehicleIds: [],
      leadScore: 75,
      urgency: 'high',
      handoffRecommended: true,
      suggestedReply: 'string',
      internalReason: 'Temperatura: Caliente. Cliente quiere avanzar. Derivar a asesor urgente.'
    }, null, 2)
  ].join('\n');
}

// ─── Learning Context Loader ───────────────────────────────────────────────────

export interface LearningContext {
  topObjections: Array<{ key: string; frequency: number }>;
  topFaqGaps: Array<{ key: string; frequency: number }>;
  topLeadPatterns: Array<{ key: string; value: string }>;
}

/**
 * Load top learned patterns from bot_learning_memory.
 * Fast: reads indexed DB. Enriches the agent system prompt with real data.
 * Returns empty arrays on any error (never blocks the agent call).
 */
export async function loadLearningContext(): Promise<LearningContext> {
  const empty: LearningContext = { topObjections: [], topFaqGaps: [], topLeadPatterns: [] };
  try {
    const [objections, gaps, leads] = await Promise.all([
      pool.query(
        `SELECT pattern_key, frequency FROM bot_learning_memory
         WHERE pattern_type = 'objection' AND status = 'active'
         ORDER BY frequency DESC LIMIT 5`
      ),
      pool.query(
        `SELECT pattern_key, frequency FROM bot_learning_memory
         WHERE pattern_type = 'faq_gap' AND status = 'active'
         ORDER BY frequency DESC LIMIT 5`
      ),
      pool.query(
        `SELECT pattern_key, pattern_value FROM bot_learning_memory
         WHERE pattern_type = 'lead_pattern' AND status = 'active'
         ORDER BY frequency DESC LIMIT 3`
      ),
    ]);

    return {
      topObjections: (objections.rows ?? []).map((r: any) => ({
        key: String(r.pattern_key ?? ''),
        frequency: Number(r.frequency ?? 0),
      })),
      topFaqGaps: (gaps.rows ?? []).map((r: any) => ({
        key: String(r.pattern_key ?? ''),
        frequency: Number(r.frequency ?? 0),
      })),
      topLeadPatterns: (leads.rows ?? []).map((r: any) => ({
        key: String(r.pattern_key ?? ''),
        value: String(r.pattern_value ?? ''),
      })),
    };
  } catch {
    return empty;
  }
}

/**
 * Format a LearningContext into a prompt section string.
 * Injected into the agent system prompt so it knows real-world friction patterns.
 * Returns empty string if no data.
 */
export function buildLearningContextSection(ctx: LearningContext): string {
  const lines: string[] = [];

  if (ctx.topObjections.length > 0) {
    lines.push('── OBJECIONES REALES MÁS FRECUENTES (manejarlas proactivamente) ──');
    for (const obj of ctx.topObjections) {
      lines.push(`  • "${obj.key}" (vista ${obj.frequency}x) → responder con empatía y alternativa concreta`);
    }
    lines.push('');
  }

  if (ctx.topFaqGaps.length > 0) {
    lines.push('── PREGUNTAS FRECUENTES SIN BUENA RESPUESTA (prestar atención) ──');
    for (const gap of ctx.topFaqGaps) {
      lines.push(`  • "${gap.key}" (repetida ${gap.frequency}x) → asegurate de responderla bien esta vez`);
    }
    lines.push('');
  }

  if (ctx.topLeadPatterns.length > 0) {
    lines.push('── CAMINOS EXITOSOS DETECTADOS EN CONVERSACIONES REALES ──');
    for (const lp of ctx.topLeadPatterns) {
      lines.push(`  • ${lp.value}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
