/**
 * Google Business Profile Sync Skill Tools
 *
 * Tool registry consumed by buildAllSkillTools (scans for tools/index.ts).
 * Tools are added incrementally across the implementation phases:
 *   checkConnection    — verify GBP connection, initiate OAuth if needed (agent-side)
 *   getGbpProfile      — read the editable GBP listing (two-pass round-trip)
 *   getSiteBusinessInfo — read the live site's business info (agent-side)
 *   diffBusinessInfo    — per-field compare of GBP vs site (agent-side)
 *   syncField           — apply one field sync (site-to-gbp round-trip; gbp-to-site source edit)
 *   verifySiteSync      — poll the preview to confirm a gbp-to-site edit propagated
 *
 * Each tool implements computeState() to track workflow progression and enable
 * resume-after-interruption (e.g., OAuth, errors, conversation summarization).
 */

export { checkConnectionTool } from './check-connection.js';
export { getGbpProfileTool } from './get-gbp-profile.js';
export { getSiteBusinessInfoTool } from './get-site-business-info.js';
export { diffBusinessInfoTool } from './diff-business-info.js';
export { syncFieldTool } from './sync-field.js';
export { verifySiteSyncTool } from './verify-site-sync.js';
