import Box from "@ux/box";
import Spinner from '@ux/spinner';
import text from "@ux/text";

import type { AppDomain } from '@/hooks/useAppDetails';
import { useTranslations } from '@/hooks/useTranslations';
import { getDnsRecords } from '@/utils/domain';

/**
 * DNS Configuration Instructions Component
 *
 * Displays DNS records that need to be configured for a pending domain.
 * Shows A record with anycast IP and CNAME record for www subdomain.
 *
 * @param domainDetails - Pending domain details with anycast IP
 */
export default function DomainDNS({ domainDetails }: { domainDetails: AppDomain }) {
  const t = useTranslations();
  const { fqdn, anycastIp, certificateValidationCname } = domainDetails;

  // Show provisioning message if anycast IP is not ready yet
  if (!anycastIp) {
    return (
      <Box
        orientation="vertical"
        gap="md"
        className="rounded-lg"
      >
        <Box orientation="horizontal" inlineAlignChildren="center" gap="sm">
          <Spinner size="sm" />
          <text.p className="font-semibold">{t('builder_domain_dns_provisioning')}</text.p>
        </Box>
        <text.p className="text-sm">
          {t('builder_domain_dns_provisioning_description')}
        </text.p>
      </Box>
    );
  }

  // Get DNS records based on domain type (root domain vs subdomain)
  const dnsRecords = getDnsRecords(fqdn, anycastIp, certificateValidationCname);

  return (
    <Box
      orientation="vertical"
      gap="md"
      className="rounded-lg"
    >
      <text.p className="text-sm">
        {t('builder_domain_dns_instructions')}
      </text.p>

      {/* DNS Records Table */}
      <Box orientation="vertical" gap="sm" className="mt-1">
        <Box
          orientation="horizontal"
          gap="md"
          className="font-semibold text-sm border-b border-intents-ux-border-subtle pb-1"
        >
          <div className="w-10">{t('builder_domain_dns_table_type')}</div>
          <div className="w-16">{t('builder_domain_dns_table_name')}</div>
          <div className="flex-1">{t('builder_domain_dns_table_value')}</div>
          <div className="w-10">{t('builder_domain_dns_table_ttl')}</div>
        </Box>

        {/* A Record */}
        <Box
          orientation="horizontal"
          gap="md"
          className={dnsRecords.cnameRecord ? "text-sm py-1 border-b border-intents-ux-border-subtle" : "text-sm py-1"}
        >
          <div className="w-10">{dnsRecords.aRecord.type}</div>
          <div className="w-16">{dnsRecords.aRecord.name}</div>
          <div className="flex-1">
            <code className="bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono">
              {dnsRecords.aRecord.value}
            </code>
          </div>
          <div className="w-10">{dnsRecords.aRecord.ttl}</div>
        </Box>

        {/* CNAME Record */}
        {dnsRecords.cnameRecord && (
          <Box
            orientation="horizontal"
            gap="md"
            className={dnsRecords.dcvRecord ? "text-sm py-1 border-b border-intents-ux-border-subtle" : "text-sm py-1"}
          >
            <div className="w-10">{dnsRecords.cnameRecord.type}</div>
            <div className="w-16">{dnsRecords.cnameRecord.name}</div>
            <div className="flex-1">
              <code className="bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono">
                {dnsRecords.cnameRecord.value}
              </code>
            </div>
            <div className="w-10">{dnsRecords.cnameRecord.ttl}</div>
          </Box>
        )}

        {/* DCV Record */}
        {dnsRecords.dcvRecord && (
          <Box
            orientation="horizontal"
            gap="md"
            className="text-sm py-1"
          >
            <div className="w-10">{dnsRecords.dcvRecord.type}</div>
            <div className="w-16">{dnsRecords.dcvRecord.name}</div>
            <div className="flex-1">
              <code className="bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono">
                {dnsRecords.dcvRecord.value}
              </code>
            </div>
            <div className="w-10">{dnsRecords.dcvRecord.ttl}</div>
          </Box>
        )}
      </Box>
    </Box>
  );
}
