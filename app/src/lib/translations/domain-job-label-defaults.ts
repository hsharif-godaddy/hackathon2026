/**
 * Default English copy for domain job step translation ids returned in the API `label` field (surfaced as `labelKey` in the hook).
 * Publish matching keys in the @airo-app-builder/aab package (GoDaddy i18n UI); these strings
 * are passed as `defaultMessage` until translations are live.
 *
 * @see https://i18n.int.gdcorp.tools/org/hcx/app/aab
 */
export const DOMAIN_JOB_LABEL_DEFAULT_MESSAGES: Record<string, string> = {
  builder_domain_job_starting_connection: 'Starting connection...',
  builder_domain_job_configuring_dns: 'Configuring DNS...',
  builder_domain_job_verifying_domain: 'Verifying domain...',
  builder_domain_job_waiting_for_dns: 'Waiting for DNS setup...',
  builder_domain_job_connecting_domain: 'Connecting domain...',
  builder_domain_job_connected: 'Domain connected',
};

export function defaultMessageForDomainJobLabelKey(key: string): string | undefined {
  return DOMAIN_JOB_LABEL_DEFAULT_MESSAGES[key];
}
