/**
 * extractWorker.ts — Worker de extracción y filtrado de catálogo.
 *
 * Aplica los filtros del extracto GPT al catálogo cargado.
 * Thin wrapper sobre filterCatalog — centraliza el punto de entrada
 * para poder agregar pre/post procesamiento sin tocar botIntelligence.
 */

import type { CatalogItem } from '../catalog.js';
import type { Extracted } from '../botIntelligence.js';
import type { ConvState } from '../state.js';
import { filterCatalog } from '../botIntelligence.js';

export interface ExtractResult {
  items: CatalogItem[];
  totalInStock: number;
  filtersApplied: string[];
}

/**
 * Filtra el catálogo aplicando los filtros del extracto + contexto de búsqueda.
 * Retorna items filtrados + metadata de filtros aplicados para logging.
 */
export function runExtractWorker(
  catalog: CatalogItem[],
  ex: Extracted,
  searchContext: ConvState['search_context']
): ExtractResult {
  const filtersApplied: string[] = [];

  // Registrar qué filtros se van a aplicar (para pipeline logger)
  const sc = searchContext ?? {};
  const effectiveBrand = ex.brand ?? sc.brand;
  const effectiveModel = ex.model ?? sc.model;
  const effectiveBodywork = ex.bodywork ?? sc.bodywork;
  const effectiveMaxPrice = ex.maxPrice ?? sc.maxPrice;
  const effectiveYearMin = ex.yearMin ?? sc.minYear;
  const effectiveYearMax = ex.yearMax ?? sc.maxYear;
  const effectiveFuel = ex.fuel ?? sc.fuel;
  const effectiveTransmission = ex.transmission ?? sc.transmission;

  if (effectiveBrand)       filtersApplied.push(`brand=${effectiveBrand}`);
  if (effectiveModel)       filtersApplied.push(`model=${effectiveModel}`);
  if (effectiveBodywork)    filtersApplied.push(`bodywork=${effectiveBodywork}`);
  if (effectiveMaxPrice)    filtersApplied.push(`maxPrice=${effectiveMaxPrice}`);
  if (effectiveYearMin)     filtersApplied.push(`yearMin=${effectiveYearMin}`);
  if (effectiveYearMax)     filtersApplied.push(`yearMax=${effectiveYearMax}`);
  if (effectiveFuel)        filtersApplied.push(`fuel=${effectiveFuel}`);
  if (effectiveTransmission) filtersApplied.push(`transmission=${effectiveTransmission}`);
  if (ex.gnc)               filtersApplied.push('gnc=true');
  if (ex.fuelEconomyPriority) filtersApplied.push('fuelEconomy=true');

  const totalInStock = catalog.filter(i => i.inStock).length;
  const items = filterCatalog(catalog, { ...ex, search_context: searchContext });

  return { items, totalInStock, filtersApplied };
}
