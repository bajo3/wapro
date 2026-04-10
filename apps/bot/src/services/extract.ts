/**
 * extract.ts — Stub post-cleanup.
 *
 * extractLeadFields used by demands.ts to parse free-text demand queries.
 * Implement real extraction logic here when rebuilding the intelligence layer.
 */

export interface ExtractedFields {
  brand?: string;
  model?: string;
  transmission?: string;
  minYear?: number;
  maxYear?: number;
  maxPrice?: number;
  amount?: number;
  fuel?: string;
  gnc?: boolean;
  bodywork?: string;
}

/**
 * Extracts structured vehicle fields from a free-text query.
 * Stub — returns empty object until intelligence layer is rebuilt.
 */
export function extractLeadFields(_text: string): ExtractedFields {
  return {};
}
