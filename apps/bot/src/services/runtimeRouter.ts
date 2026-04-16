/**
 * runtimeRouter.ts — Router de decisiones del bot comercial.
 *
 * Mapea (Extracted, ConvState) → RouterDecision.
 * Función pura: sin side effects, sin GPT, sin DB.
 * Separa la lógica de routing de los handlers que la ejecutan.
 */

import type { Extracted } from './botIntelligence.js';
import type { ConvState } from './state.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type RouterAction =
  | 'SHOW_OPTIONS'       // Lista de autos filtrados (2+ resultados)
  | 'SHOW_SINGLE'        // Auto puntual (seleccionado o búsqueda exacta)
  | 'ASK_ONE_QUESTION'   // Exploración sin filtros → pedir 1 dato
  | 'HANDLE_OBJECTION'   // Objeción de precio o duda fuerte
  | 'FINANCING_FLOW'     // Cuotas / crédito / anticipo
  | 'TRADE_IN_FLOW'      // Permuta de usado
  | 'COMPARE_VEHICLES'   // Comparación explícita entre opciones
  | 'ESCALATE_HUMAN'     // Derivar a asesor humano
  | 'GREETING'           // Saludo inicial o retorno
  | 'FAREWELL'           // Despedida
  | 'CATALOG_BROWSE'     // Catálogo general paginado
  | 'RESET_SEARCH'       // Reiniciar búsqueda
  | 'COMPLAINT'          // Reclamo / queja
  | 'COORDINAR_VISITA'   // Coordinar visita al local
  | 'SAFE_FALLBACK';     // Fallback seguro sin alucinaciones

export interface RouterDecision {
  action: RouterAction;
  reason: string;          // Para logs y debugging
  confidence: 'high' | 'medium' | 'low';
  skillHint?: string;      // Skill sugerida: 'price-objection' | 'financing' | ...
}

// ── Router principal ───────────────────────────────────────────────────────────

/**
 * Decide qué acción tomar dado el extracto de GPT y el estado de conversación.
 * Función PURA — no tiene side effects, no hace async.
 */
export function routeDecision(ex: Extracted, state: ConvState): RouterDecision {

  // 1. Derivaciones inmediatas (máxima prioridad, no negociables)
  if (ex.intent === 'advisor' || ex.wantsAdvisor) {
    return {
      action: 'ESCALATE_HUMAN',
      reason: 'cliente_solicita_asesor',
      confidence: 'high',
      skillHint: 'human-handoff',
    };
  }

  if (ex.intent === 'complaint') {
    return {
      action: 'COMPLAINT',
      reason: 'cliente_reclama',
      confidence: 'high',
      skillHint: 'human-handoff',
    };
  }

  if (ex.intent === 'farewell') {
    return { action: 'FAREWELL', reason: 'despedida', confidence: 'high' };
  }

  if (ex.intent === 'greeting') {
    return { action: 'GREETING', reason: 'saludo', confidence: 'high' };
  }

  // 2. Flujos especializados
  if (ex.intent === 'catalog') {
    return { action: 'CATALOG_BROWSE', reason: 'catalogo_explicito', confidence: 'high' };
  }

  if (ex.intent === 'reset') {
    return { action: 'RESET_SEARCH', reason: 'reset_busqueda', confidence: 'high' };
  }

  if (ex.intent === 'trade_in') {
    return {
      action: 'TRADE_IN_FLOW',
      reason: 'permuta',
      confidence: 'high',
      skillHint: 'trade-in',
    };
  }

  if (ex.intent === 'visit' || ex.wantsVisit) {
    return { action: 'COORDINAR_VISITA', reason: 'visita_solicitada', confidence: 'high' };
  }

  if (ex.intent === 'credit_quote' || ex.downPayment !== undefined) {
    return {
      action: 'FINANCING_FLOW',
      reason: 'cuotas_o_credito',
      confidence: 'high',
      skillHint: 'financing',
    };
  }

  // 3. Selección puntual de vehículo
  if (ex.selectedVehicleId) {
    return {
      action: 'SHOW_SINGLE',
      reason: 'vehiculo_seleccionado_de_catalogo',
      confidence: 'high',
    };
  }

  if (ex.intent === 'specific' && (ex.brand || ex.model)) {
    return {
      action: 'SHOW_SINGLE',
      reason: 'busqueda_modelo_especifico',
      confidence: ex.confidence ?? 'medium',
    };
  }

  // 4. Objeción de precio detectada (antes de buscar)
  if (ex.leadMode === 'price_sensitive') {
    return {
      action: 'HANDLE_OBJECTION',
      reason: 'price_sensitive',
      confidence: 'medium',
      skillHint: 'price-objection',
    };
  }

  // 5. Indecisión
  if (ex.intent === 'unsure') {
    const sc = state.search_context;
    const hasContext = sc && (sc.brand || sc.maxPrice || sc.bodywork || sc.useCase);
    if (hasContext || ex.useCase || ex.bodywork) {
      return {
        action: 'SHOW_OPTIONS',
        reason: 'indeciso_con_contexto_previo',
        confidence: 'medium',
        skillHint: 'indecision',
      };
    }
    return {
      action: 'ASK_ONE_QUESTION',
      reason: 'indeciso_sin_contexto',
      confidence: 'medium',
      skillHint: 'indecision',
    };
  }

  // 6. Búsqueda / refinamiento / alternativas
  if (['search', 'refine', 'alternatives'].includes(ex.intent)) {
    // Exploratorio sin ningún filtro → preguntar uno
    if (
      ex.needsClarification &&
      ex.leadMode === 'exploratory' &&
      ex.confidence === 'low' &&
      !ex.brand && !ex.model && !ex.maxPrice && !ex.bodywork &&
      !state.search_context?.brand && !state.search_context?.maxPrice &&
      !state.search_context?.bodywork && !state.search_context?.useCase
    ) {
      return {
        action: 'ASK_ONE_QUESTION',
        reason: 'exploratorio_sin_filtros',
        confidence: 'low',
      };
    }

    return {
      action: 'SHOW_OPTIONS',
      reason: 'busqueda_con_filtros',
      confidence: ex.confidence ?? 'medium',
    };
  }

  // 7. Fallback seguro
  return {
    action: 'SAFE_FALLBACK',
    reason: 'intent_no_mapeado',
    confidence: 'low',
  };
}
