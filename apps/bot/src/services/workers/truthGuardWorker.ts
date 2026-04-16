/**
 * truthGuardWorker.ts — Worker de validación de verdad comercial.
 *
 * Checkpoint final antes de enviar la respuesta al cliente.
 * Llama a guardResponse + loggea issues + retorna el texto
 * definitivo (sanitizado si es necesario).
 */

import type { CatalogItem } from '../catalog.js';
import type { ConvState } from '../state.js';
import type { RouterAction } from '../runtimeRouter.js';
import { guardResponse, safeBlockingReply } from '../truthGuard.js';
import { logPipelineEvent } from '../pipelineLogger.js';

export interface GuardWorkerParams {
  instance: string;
  remoteJid: string;
  responseText: string;
  presentedVehicleId?: string;
  catalog: CatalogItem[];
  state: ConvState;
  action: RouterAction;
}

export interface GuardWorkerResult {
  finalText: string;      // Texto que puede enviarse (sanitizado si guardResponse falló)
  passed: boolean;
  blocked: boolean;       // true si la respuesta original fue reemplazada
}

/**
 * Valida la respuesta y retorna el texto definitivo.
 * Si hay issues bloqueantes → reemplaza el texto con safeBlockingReply.
 * Si hay warnings → loggea y deja pasar.
 */
export async function runTruthGuardWorker(params: GuardWorkerParams): Promise<GuardWorkerResult> {
  const result = guardResponse({
    presentedVehicleId: params.presentedVehicleId,
    catalog: params.catalog,
    state: params.state,
    action: params.action,
    responseText: params.responseText,
  });

  // Log siempre, incluso cuando pasa — para trazabilidad
  logPipelineEvent({
    ts: new Date().toISOString(),
    instance: params.instance,
    remoteJid: params.remoteJid,
    action: params.action,
    guardPassed: result.passed,
    guardIssues: result.issues.length > 0 ? result.issues : undefined,
  });

  if (!result.passed) {
    const blocking = result.issues.filter(i => i.severity === 'block');
    console.warn(
      `[truthGuard] BLOCKED action=${params.action} vehicle=${params.presentedVehicleId ?? 'none'} issues=${JSON.stringify(blocking)}`
    );
    return {
      finalText: safeBlockingReply(result.issues),
      passed: false,
      blocked: true,
    };
  }

  // Warnings — loggear pero no bloquear
  const warnings = result.issues.filter(i => i.severity === 'warn');
  if (warnings.length > 0) {
    console.info(`[truthGuard] WARN action=${params.action} warnings=${JSON.stringify(warnings)}`);
  }

  return {
    finalText: params.responseText,
    passed: true,
    blocked: false,
  };
}
