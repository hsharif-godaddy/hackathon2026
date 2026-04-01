'use client';

import { useEffect, useRef, useState } from 'react';
import Box from "@ux/box";
import CheckmarkIcon from '@ux/icon/checkmark';
import ClipboardIcon from '@ux/icon/copy';
import Spinner from '@ux/spinner';
import text from "@ux/text";

import type { AppDomain } from '@/hooks/useAppDetails';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { getDnsRecords } from '@/utils/domain';

export function CopyableValue({ value }: { value: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail in insecure contexts
    }
  };

  return (
    <Box orientation="horizontal" inlineAlignChildren="center" gap="sm">
      <code className="bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono whitespace-nowrap">
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center text-intents-ux-content-subtle hover:text-intents-ux-content-default cursor-pointer"
        aria-label={copied ? t('builder_common_copied') : t('builder_common_copy_clipboard')}
      >
        {copied ? (
          <CheckmarkIcon className="text-intents-ux-feedbackHighContrastSuccess-feedbackColor" />
        ) : (
          <ClipboardIcon />
        )}
      </button>
    </Box>
  );
}

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
  const { data: isDCVEnabled, isLoading: isDCVLoading } = useSwitchboard('appbuilder-domain-dcv');

  // Show provisioning message if anycast IP or DCV CNAME is not ready yet
  if (!anycastIp || isDCVLoading || (isDCVEnabled && !certificateValidationCname)) {
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
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-intents-ux-border-subtle">
              <th className="text-left font-semibold pb-1 pr-4 whitespace-nowrap">{t('builder_domain_dns_table_type')}</th>
              <th className="text-left font-semibold pb-1 pr-4 whitespace-nowrap">{t('builder_domain_dns_table_name')}</th>
              <th className="text-left font-semibold pb-1 pr-4 whitespace-nowrap">{t('builder_domain_dns_table_value')}</th>
              <th className="text-left font-semibold pb-1 whitespace-nowrap">{t('builder_domain_dns_table_ttl')}</th>
            </tr>
          </thead>
          <tbody>
            {/* A Record */}
            <tr className={dnsRecords.cnameRecord ? "border-b border-intents-ux-border-subtle" : ""}>
              <td className="py-1 pr-4 whitespace-nowrap">{dnsRecords.aRecord.type}</td>
              <td className="py-1 pr-4 whitespace-nowrap">{dnsRecords.aRecord.name}</td>
              <td className="py-1 pr-4"><CopyableValue value={dnsRecords.aRecord.value} /></td>
              <td className="py-1 whitespace-nowrap">{dnsRecords.aRecord.ttl}</td>
            </tr>

            {/* CNAME Record */}
            {dnsRecords.cnameRecord && (
              <tr className={dnsRecords.dcvRecord ? "border-b border-intents-ux-border-subtle" : ""}>
                <td className="py-1 pr-4 whitespace-nowrap">{dnsRecords.cnameRecord.type}</td>
                <td className="py-1 pr-4 whitespace-nowrap">{dnsRecords.cnameRecord.name}</td>
                <td className="py-1 pr-4"><CopyableValue value={dnsRecords.cnameRecord.value} /></td>
                <td className="py-1 whitespace-nowrap">{dnsRecords.cnameRecord.ttl}</td>
              </tr>
            )}

            {/* DCV Record */}
            {dnsRecords.dcvRecord && (
              <tr>
                <td className="py-1 pr-4 whitespace-nowrap">{dnsRecords.dcvRecord.type}</td>
                <td className="py-1 pr-4 whitespace-nowrap">{dnsRecords.dcvRecord.name}</td>
                <td className="py-1 pr-4"><CopyableValue value={dnsRecords.dcvRecord.value} /></td>
                <td className="py-1 whitespace-nowrap">{dnsRecords.dcvRecord.ttl}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Box>
  );
}
