import { env } from '../lib/env.js';

const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
const loggedStartupTraces = new Set<string>();

export type AiProvider = 'openai' | 'disabled';

export type AiRuntimeTrace = {
  aiProvider: AiProvider;
  configuredModel: string;
  effectiveModel: string;
  fallbackModel: string | null;
};

export function resolveAiRuntime(options?: {
  requestedModel?: string;
  preferAdvanced?: boolean;
  leadScore?: number;
}): AiRuntimeTrace {
  const configuredModel = (env.openAiModel || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  const advancedModel = (env.openAiAdvancedModel || configuredModel).trim() || configuredModel;
  const aiProvider: AiProvider = env.openAiApiKey ? 'openai' : 'disabled';

  const requestedModel = String(options?.requestedModel ?? '').trim();
  const preferAdvanced = options?.preferAdvanced ?? Number(options?.leadScore ?? 0) >= 60;

  const effectiveModel = requestedModel || (preferAdvanced ? advancedModel : configuredModel);
  const fallbackModel =
    effectiveModel === configuredModel
      ? (advancedModel !== configuredModel ? advancedModel : null)
      : configuredModel;

  return {
    aiProvider,
    configuredModel,
    effectiveModel,
    fallbackModel,
  };
}

function formatAiTraceMessage(trace: AiRuntimeTrace, caller: string, reason: string): string {
  return `[ai] provider=${trace.aiProvider} configuredModel=${trace.configuredModel} effectiveModel=${trace.effectiveModel} fallbackModel=${trace.fallbackModel ?? 'none'} caller=${caller} reason=${reason}`;
}

export function logAiRuntimeStartup(trace: AiRuntimeTrace, caller: string, reason: string): void {
  const key = `${caller}|${reason}|${trace.aiProvider}|${trace.configuredModel}|${trace.effectiveModel}|${trace.fallbackModel ?? 'none'}`;
  if (loggedStartupTraces.has(key)) return;
  loggedStartupTraces.add(key);
  console.info(formatAiTraceMessage(trace, caller, reason));
}

export function logAiRuntimeCall(trace: AiRuntimeTrace, caller: string, reason: string): void {
  console.info(
    formatAiTraceMessage(trace, caller, reason)
  );
}
