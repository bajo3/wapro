/*
 * This snippet demonstrates how to integrate anti-loop tracking when invoking
 * decideAgentAction. It should be merged into the existing webhook handler
 * within apps/bot/src/routes/webhooks.ts (handleAggregatedMessage or similar).
 */

// ... existing imports ...
import { decideAgentAction } from '../services/agent';

async function handleMessage(state: any, params: any) {
  // Determine which missing fields were requested in the previous turn
  const prevMissingFields: string[] = state.agent?.missingFields ?? [];
  const history: string[] = (state as any).missing_fields_history ?? [];
  // Consider fields repeated if they appear in both prevMissingFields and history
  const repeatedMissingFields = prevMissingFields.filter((f) => history.includes(f));

  const agentDecision = await decideAgentAction({
    ...params,
    loopData: {
      repeatedMissingFields,
      turnCount: state.user_msg_count ?? 0,
    },
  });

  // Persist the missing fields history for next turns (keep last 10 entries)
  const newHistory = [...history, ...(agentDecision?.missingFields ?? [])].slice(-10);
  const newState = { ...state, missing_fields_history: newHistory };
  // ... continue with your existing handler logic using agentDecision and newState ...
  return { agentDecision, newState };
}

export default handleMessage;