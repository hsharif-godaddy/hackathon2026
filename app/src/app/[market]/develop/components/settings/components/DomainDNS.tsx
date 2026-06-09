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
    <Box orientation="horizontal" inlineAlignChildren="center" gap="sm" wrap>
      <code className="bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono">
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

function DnsRecordCard({
  type,
  name,
  value,
  ttl
}: {
  type: string;
  name: string;
  value: string;
  ttl: string | number;
}) {
  const t = useTranslations();
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');

  return (
    <Box
      orientation="vertical"
      className="p-2 rounded-md border border-intents-ux-border-subtle bg-intents-ux-box-backgroundColor"
    >
      {isDomainConnectEnabled ? (
        <Box gap="sm" orientation="horizontal" inlineAlignChildren="center">
          <text.p>
            <strong>{t('builder_domain_dns_table_type', undefined, 'Type')}:</strong>
          </text.p>
          <text.p>{type}</text.p>
        </Box>
      ) : (
        <text.p className="!font-semibold">{type}</text.p>
      )}
      <Box gap="sm" orientation="horizontal" inlineAlignChildren="center">
        <text.p>
          <strong>{t('builder_domain_dns_table_ttl')}:</strong>
        </text.p>
        <CopyableValue value={String(ttl)} />
      </Box>
      <Box gap="sm" orientation="horizontal" inlineAlignChildren="center">
        <text.p>
          <strong>{t('builder_domain_dns_table_name')}:</strong>
        </text.p>
        <CopyableValue value={name} />
      </Box>
      <Box gap="sm" orientation="horizontal" inlineAlignChildren="center">
        <text.p>
          <strong>{t('builder_domain_dns_table_value')}:</strong>
        </text.p>
        <CopyableValue value={value} />
      </Box>
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
  const isDCVEnabled = useSwitchboard('appbuilder-domain-dcv');

  // Show provisioning message if anycast IP or DCV CNAME is not ready yet
  if (!anycastIp || (isDCVEnabled && !certificateValidationCname)) {
    return (
      <Box
        orientation="vertical"
        gap="md"
        className="rounded-2xl"
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
      className="w-full pb-2 mb-1 border-b"
    >
      <text.p className="text-sm">
        {t('builder_domain_dns_instructions')}
      </text.p>

      {/* DNS Records Cards */}
      <Box orientation="vertical" gap="sm">
        <DnsRecordCard {...dnsRecords.aRecord} />
        {dnsRecords.cnameRecord && <DnsRecordCard {...dnsRecords.cnameRecord} />}
        {dnsRecords.dcvRecord && <DnsRecordCard {...dnsRecords.dcvRecord} />}
      </Box>
    </Box>
  );
}
