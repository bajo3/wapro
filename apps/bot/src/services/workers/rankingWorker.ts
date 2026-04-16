/**
 * rankingWorker.ts — Worker de ranking de vehículos filtrados.
 *
 * Ordena los resultados filtrados por relevancia al contexto del lead.
 * filterCatalog devuelve hasta 12 items sin rankear.
 * Este worker los rankea antes de mostrar al cliente.
 *
 * Factores de ranking (mayor score = más arriba):
 * - Año más nuevo (bonus x distancia al año pedido)
 * - Precio más cercano al maxPrice del lead (sin superar)
 * - 0km si el lead pidió nuevo (isNew=true)
 * - Tiene imágenes (mejor presentación en WhatsApp)
 * - Coincidencia exacta de marca/modelo (vs inferida)
 */

import type { CatalogItem } from '../catalog.js';
import type { Extracted } from '../botIntelligence.js';
import type { ConvState } from '../state.js';

export interface RankedItem {
  item: CatalogItem;
  score: number;
  reasons: string[];  // Para debugging: por qué este score
}

/**
 * Rankea los items filtrados por relevancia al contexto del lead.
 * Retorna el array ordenado de mayor a menor relevancia.
 */
export function rankItems(
  items: CatalogItem[],
  ex: Extracted,
  searchContext: ConvState['search_context']
): RankedItem[] {
  const sc = searchContext ?? {};
  const targetMaxPrice = ex.maxPrice ?? sc.maxPrice;
  const targetYear     = ex.year ?? (ex.yearMax ? Math.floor((ex.yearMin! + ex.yearMax) / 2) : undefined) ?? sc.year;
  const wantsNew       = ex.isNew ?? undefined;
  const currentYear    = new Date().getFullYear();

  const ranked: RankedItem[] = items.map(item => {
    let score = 50; // Base score
    const reasons: string[] = [];

    // +10 si tiene imágenes (WhatsApp engagement)
    if ((item.images?.length ?? 0) > 0 || item.image) {
      score += 10;
      reasons.push('has_images');
    }

    // Año: bonus por proximidad al target, penalidad por antigüedad
    if (item.year) {
      const yearsOld = currentYear - item.year;

      if (targetYear) {
        // Coincidencia exacta de año
        const yearDiff = Math.abs(item.year - targetYear);
        if (yearDiff === 0) { score += 20; reasons.push('year_exact'); }
        else if (yearDiff <= 1) { score += 10; reasons.push('year_near'); }
        else if (yearDiff <= 2) { score += 5; reasons.push('year_close'); }
        else { score -= yearDiff * 2; }
      } else {
        // Sin target de año: bonus por más nuevo
        if (yearsOld <= 1) { score += 15; reasons.push('very_new'); }
        else if (yearsOld <= 3) { score += 8; reasons.push('recent'); }
        else if (yearsOld <= 5) { score += 3; reasons.push('mid_age'); }
        else { score -= Math.min(yearsOld, 10); }
      }
    }

    // Precio: bonus si está dentro del presupuesto y cerca del tope
    if (targetMaxPrice && item.priceNumber) {
      const ratio = item.priceNumber / targetMaxPrice;
      if (ratio <= 1.0) {
        // Dentro del presupuesto: bonus por estar cerca del tope (mejor calidad)
        if (ratio >= 0.85) { score += 15; reasons.push('price_optimal'); }
        else if (ratio >= 0.7) { score += 8; reasons.push('price_good'); }
        else { score += 3; reasons.push('price_under'); }
      }
      // Si supera el presupuesto ya fue filtrado por filterCatalog, pero por si acaso:
      else { score -= 10; }
    }

    // 0km: bonus si el lead quiere nuevo
    if (wantsNew === true && item.isNew === true) {
      score += 12;
      reasons.push('is_new');
    }

    // Penalidad por km muy alto en usado
    if (item.km && item.km > 150000) {
      score -= 8;
      reasons.push('high_km');
    } else if (item.km && item.km > 80000) {
      score -= 3;
      reasons.push('mid_km');
    }

    // Bonus por descripción rica (indica más info disponible)
    if (item.description && item.description.length > 50) {
      score += 3;
      reasons.push('rich_description');
    }

    return { item, score, reasons };
  });

  // Ordenar de mayor a menor score
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
