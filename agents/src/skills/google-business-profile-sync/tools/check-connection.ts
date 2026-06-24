/**
 * checkConnection — Google Business Profile sync skill
 *
 * Thin wrapper over the shared connection-check factory
 * (agents/src/services/social-connection-check.ts), configured with this
 * skill's logging labels and workflow-state vocabulary. The lookup logic is
 * shared with the `google-reviews` skill; only the `nextStep` strings differ.
 *
 * Runs entirely agent-side (reads the local SocialAssociation row) — no
 * client-action round-trip. State tracking enables resume after an OAuth
 * interruption or conversation summarization.
 */

import { createGbpConnectionCheckTool } from '../../../services/social-connection-check.js';

export const checkConnectionTool = createGbpConnectionCheckTool({
  loggerComponent: 'google-business-profile-sync-skill',
  logEventPrefix: 'google-business-profile-sync',
  description:
    'Check if a Google Business Profile is connected for this app. If not ' +
    'connected, returns a signal to initiate OAuth via social-platform__socialConnect. ' +
    'Call this first before attempting to read or sync the listing.',
  nextStepWhenConnected: 'sync-flow',
  nextStepWhenPending: 'check-connection',
});
