/**
 * vehicleRanker.ts — Ranking comercial de vehículos v1
 *
 * Ordena el catálogo según relevancia para el lead actual, considerando:
 *  - match con presupuesto (principal)
 *  - match con uso / caso de uso
 *  - match con preferencias (transmisión, combustible, carrocería, GNC)
 *  - condición (0km vs usado)
 *  - año
 *  - km
 *  - vehículos ya mostrados (penalizados para aparecer al final)
 *
 * El resultado es el catálogo reordenado para pasar al agente,
 * maximizando la probabilidad de que el agente muestre opciones relevantes.
 *
 * PRINCIPIO: el agente tiene un límite de contexto. Los primeros 10-15 autos
 * que ve determinan qué va a mostrar. Si los más relevantes están arriba, mejor.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VehicleScore {
  vehicle: Record<string, any>;
  score: number;
  matchReasons: string[];
  alreadyShown: boolean;
}

export interface RankingResult {
  ranked: VehicleScore[];
  topVehicles: Array<Record<string, any>>;
  diagnosticLog: string;
}

// ─── Main Ranker ──────────────────────────────────────────────────────────────

/**
 * Rankea vehículos por relevancia para el perfil del lead.
 *
 * @param vehicles  - catálogo completo
 * @param extracted - contexto del lead (presupuesto, uso, preferencias, etc.)
 * @param shownVehicleIds - IDs ya mostrados (van al final del ranking)
 * @param maxResults - número máximo de resultados a retornar (default 15)
 */
export function rankVehiclesForLead(params: {
  vehicles: Array<Record<string, any>>;
  extracted: Record<string, any>;
  shownVehicleIds?: string[];
  maxResults?: number;
}): RankingResult {
  const { vehicles, extracted: ctx, shownVehicleIds = [], maxResults = 15 } = params;

  if (!vehicles.length) {
    return { ranked: [], topVehicles: [], diagnosticLog: 'catálogo vacío' };
  }

  const budget = Number(ctx?.maxPrice ?? ctx?.amount ?? 0);
  const wantsBrand = String(ctx?.brand ?? '').toLowerCase().trim();
  const wantsModel = String(ctx?.model ?? '').toLowerCase().trim();
  const wantsTrans = String(ctx?.transmission ?? '').toLowerCase().trim();
  const wantsFuel = String(ctx?.fuel ?? '').toLowerCase().trim();
  const wantsBodywork = String(ctx?.bodywork ?? '').toLowerCase().trim();
  const wantsGnc = !!ctx?.gnc;
  const wantsNew = ctx?.condition === 'nuevo';
  const wantsUsed = ctx?.condition === 'usado';
  const minYear = Number(ctx?.minYear ?? ctx?.year ?? 0);
  const maxYear = Number(ctx?.maxYear ?? 0);
  const useCase = String(ctx?.useCase ?? '').toLowerCase();

  const shownSet = new Set(shownVehicleIds.map(String));

  const scored = vehicles.map((v): VehicleScore => {
    let score = 50; // baseline neutral
    const reasons: string[] = [];
    const vId = String(v.id ?? '');
    const alreadyShown = shownSet.has(vId);

    // ── Penalizar autos ya mostrados ──────────────────────────────────────
    if (alreadyShown) {
      score -= 35;
      // No agregamos a reasons para no confundir al agente
    }

    const vBrand = String(v.brand ?? '').toLowerCase();
    const vModel = String(v.model ?? '').toLowerCase();
    const vName = String(v.name ?? '').toLowerCase();
    const vTrans = String(v.transmission ?? '').toLowerCase();
    const vFuel = String(v.fuel ?? '').toLowerCase();
    const vBodywork = String(v.bodywork ?? v.type ?? '').toLowerCase();
    const isNew = !!v.isNew;
    const vKm = Number(v.km ?? v.mileage ?? 0);
    const vYear = Number(v.year ?? 0);
    const vPrice = Number(v.priceNumber ?? v.price ?? 0);
    const hasGnc = !!v.gnc || vFuel.includes('gnc') || vFuel.includes('gas');

    // ── Brand / Model match (highest priority) ────────────────────────────
    if (wantsBrand) {
      const brandMatch = vBrand.includes(wantsBrand) || wantsBrand.includes(vBrand);
      if (brandMatch) {
        score += 30;
        reasons.push(`marca ${v.brand}`);
      } else {
        score -= 5; // ligera penalización si pide marca específica
      }
    }
    if (wantsModel) {
      const modelMatch = vModel.includes(wantsModel) || vName.includes(wantsModel);
      if (modelMatch) {
        score += 40;
        reasons.push(`modelo ${v.model}`);
      }
    }

    // ── Budget fit (very important) ───────────────────────────────────────
    if (budget && vPrice) {
      const diffPct = ((vPrice - budget) / budget) * 100;
      if (diffPct <= -20) {
        score += 15; // bien por debajo — puede ser demasiado barato
        reasons.push('bien dentro del presupuesto');
      } else if (diffPct <= 0) {
        score += 25; // dentro del presupuesto
        reasons.push('dentro del presupuesto');
      } else if (diffPct <= 10) {
        score += 12; // hasta 10% sobre — aceptable
        reasons.push(`${Math.round(diffPct)}% sobre el tope`);
      } else if (diffPct <= 20) {
        score -= 5; // algo por encima
      } else if (diffPct <= 35) {
        score -= 15; // bastante por encima
        reasons.push('sobre el presupuesto');
      } else {
        score -= 30; // muy por encima
        reasons.push('muy fuera del presupuesto');
      }
    }

    // ── Transmisión ───────────────────────────────────────────────────────
    if (wantsTrans && vTrans) {
      const transMatch = vTrans.includes(wantsTrans) || wantsTrans.includes(vTrans.split(' ')[0] ?? '');
      if (transMatch) {
        score += 18;
        reasons.push(v.transmission);
      } else {
        score -= 12; // transmisión incorrecta es importante
        reasons.push(`caja no coincide (quiere ${wantsTrans}, tiene ${v.transmission})`);
      }
    }

    // ── Combustible / GNC ────────────────────────────────────────────────
    if (wantsFuel && vFuel) {
      if (vFuel.includes(wantsFuel) || wantsFuel.includes(vFuel.split(' ')[0] ?? '')) {
        score += 12;
        reasons.push(v.fuel);
      }
    }
    if (wantsGnc) {
      if (hasGnc) {
        score += 25;
        reasons.push('GNC ✅');
      } else {
        score -= 8;
      }
    }

    // ── Carrocería ────────────────────────────────────────────────────────
    if (wantsBodywork && vBodywork) {
      if (vBodywork.includes(wantsBodywork) || wantsBodywork.includes(vBodywork)) {
        score += 12;
        reasons.push(v.bodywork ?? v.type ?? 'carrocería ok');
      }
    }

    // ── Condición ─────────────────────────────────────────────────────────
    if (wantsNew && isNew) {
      score += 15;
      reasons.push('0km ✅');
    } else if (wantsNew && !isNew) {
      score -= 15;
    } else if (wantsUsed && !isNew) {
      score += 10;
      reasons.push('usado ✅');
    }

    // ── Año ───────────────────────────────────────────────────────────────
    if (minYear && vYear) {
      if (vYear < minYear) {
        score -= 20;
        reasons.push(`año ${vYear} < mínimo ${minYear}`);
      } else {
        score += 5;
      }
    }
    if (maxYear && vYear && vYear > maxYear) {
      score -= 8;
    }
    if (vYear >= 2022 && !wantsUsed) {
      score += 6;
      reasons.push(`${vYear}`);
    }

    // ── Use case ──────────────────────────────────────────────────────────
    if (useCase) {
      // Trabajo / remis / taxi → GNC o diesel prioritario
      if (/trabajo|remis|taxi|uber|delivery|comercial/.test(useCase)) {
        if (hasGnc) { score += 18; reasons.push('GNC para trabajo'); }
        else if (vFuel.includes('diesel')) { score += 10; reasons.push('diesel para trabajo'); }
      }
      // Ciudad → automático preferido
      if (/ciudad|urbano|cotidiano|diario/.test(useCase) && vTrans.includes('auto')) {
        score += 10;
        reasons.push('automático para ciudad');
      }
      // Familia → SUV preferido
      if (/famil|chico|ni[ñn]o/.test(useCase) && vBodywork.includes('suv')) {
        score += 12;
        reasons.push('SUV para familia');
      }
      // Ruta → diesel preferido
      if (/ruta|viaj|autopista/.test(useCase) && vFuel.includes('diesel')) {
        score += 10;
        reasons.push('diesel para ruta');
      }
      // Campo / off-road → pickup o 4x4
      if (/campo|off.?road|4x4|tierra/.test(useCase) &&
          (vBodywork.includes('pickup') || vName.includes('4x4') || vName.includes('4wd'))) {
        score += 15;
        reasons.push('pickup/4x4 para campo');
      }
    }

    // ── Km bajo (calidad del usado) ───────────────────────────────────────
    if (!isNew && vKm > 0 && vKm < 30000) {
      score += 10;
      reasons.push(`${Math.round(vKm / 1000)}k km`);
    } else if (!isNew && vKm > 120000) {
      score -= 8; // muchos km = ligera penalización
    }

    return {
      vehicle: v,
      score,
      matchReasons: reasons.filter(Boolean).slice(0, 4),
      alreadyShown,
    };
  });

  // Separar no-mostrados de ya-mostrados
  const notShown = scored.filter((s) => !s.alreadyShown).sort((a, b) => b.score - a.score);
  const alreadyShownItems = scored.filter((s) => s.alreadyShown).sort((a, b) => b.score - a.score);

  const all = [...notShown, ...alreadyShownItems].slice(0, maxResults);

  // Diagnóstico para logs
  const top3 = all.slice(0, 3);
  const diagnosticLog = top3.length
    ? top3
        .map((s) => {
          const name = [s.vehicle.brand, s.vehicle.model, s.vehicle.year]
            .filter(Boolean)
            .join(' ');
          return `  [${String(s.vehicle.id).padEnd(6)}] score=${String(s.score).padStart(3)} ${name}${s.alreadyShown ? ' [YA VISTO]' : ''} → ${s.matchReasons.join(', ')}`;
        })
        .join('\n')
    : 'sin resultados';

  return {
    ranked: all,
    topVehicles: all.map((s) => s.vehicle),
    diagnosticLog,
  };
}
