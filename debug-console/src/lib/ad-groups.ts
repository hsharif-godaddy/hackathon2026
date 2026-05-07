export const OPS_ADMIN = 'OPS-Airo-Builders-Admin';

/**
 * AD groups allowed to access the debug console (UI + most API routes).
 *
 * Matched case-insensitively. Membership in any one group grants access;
 * stricter routes (e.g. credit-pack mgmt) layer additional checks via
 * { adGroup: OPS_ADMIN }.
 */
export const DEBUG_CONSOLE_ALLOWED_GROUPS: readonly string[] = [
    'CRM_Skip',
    'Dev-Airo-Builders',
    'DEV-Airo-Escalations',
    'OPS-Airo-Builders-Admin',
    'SRE-Airo-Builders',
    'C3-ATS',
    'directors-plus',
    'legal_admin',
];
