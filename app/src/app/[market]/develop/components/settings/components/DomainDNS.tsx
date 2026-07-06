'use client';

import { useEffect, useRef, useState } from 'react';
import Box from "@ux/box";
import CheckmarkIcon from '@ux/icon/checkmark';
import ClipboardIcon from '@ux/icon/copy';
import Spinner from '@ux/spinner';
import text from "@ux/text";

import { ContentTooltip } from '@/components/ui/ContentTooltip';
import { SWITCHBOARD_APPBUILDER_DNS_RECORD_VALUES_OVERFLOW } from '@/config/switchboard-flags';
import type { AppDomain } from '@/hooks/useAppDetails';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { getDnsRecords, parseDomain } from '@/utils/domain';

export function CopyableValue({ value }: { value: string }) {
  const t = useTranslations();
  const isTruncationEnabled =
    useSwitchboard(SWITCHBOARD_APPBUILDER_DNS_RECORD_VALUES_OVERFLOW) === true;
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

  const codeElement = isTruncationEnabled ? (
    <ContentTooltip
      content={<span className="font-mono text-xs break-all">{value}</span>}
      contentClassName="p-2 max-w-sm"
    >
      <code className="block min-w-0 max-w-full truncate bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono">
        {value}
      </code>
    </ContentTooltip>
  ) : (
    <code className="bg-intents-ux-box-subtle rounded px-1 py-0.5 text-xs font-mono">
      {value}
    </code>
  );

  return (
    <Box orientation="horizontal" inlineAlignChildren="center" gap="sm" className={isTruncationEnabled ? 'min-w-0 flex-1' : undefined} wrap={!isTruncationEnabled}>
      {codeElement}
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center text-intents-ux-content-subtle hover:text-intents-ux-content-default cursor-pointer${isTruncationEnabled ? ' shrink-0' : ''}`}
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
  ttl,
  testId
}: {
  type: string;
  name: string;
  value: string;
  ttl: string | number;
  testId?: string;
}) {
  const t = useTranslations();
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');

  return (
    <Box
      orientation="vertical"
      className="p-2 rounded-md border border-intents-ux-border-subtle bg-intents-ux-box-backgroundColor"
      data-testid={testId}
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
 * Parse DKIM CNAME records into displayable DNS record cards.
 *
 * The mail-flow service returns CNAME target values in the form
 * `s{N}.dkim.{domain_underscored}.{hash}.onsecureserver.net.`
 * The DNS record HOST names the user must create follow GoDaddy's selector
 * convention: `secureserver{N}._domainkey` (1-based index matching the
 * order returned by the mail-flow API).
 * e.g. first target → `secureserver1._domainkey`, second → `secureserver2._domainkey`
 */
function buildDkimCnameCards(
  dkimCnames: string[],
  apexDomain: string,
): Array<{ type: 'CNAME'; name: string; value: string; ttl: number }> {
  return dkimCnames.flatMap((cnameTarget, index) => {
    if (!cnameTarget.includes('.')) return [];
    return [{
      type: 'CNAME' as const,
      name: `secureserver${index + 1}._domainkey`,
      value: cnameTarget,
      ttl: 3600,
    }];
  });
}

const SPF_RECORD = {
  type: 'TXT' as const,
  name: '@',
  value: 'v=spf1 include:secureserver.net -all',
  ttl: 3600,
};

const SPF_WARNING_DEFAULT =
  'Required: Please make sure your domain only has one SPF record. If multiple SPF records are found on your domain or if the SPF record is not added correctly, your email might not be delivered.';

/**
 * DNS Configuration Instructions Component
 *
 * Displays DNS records that need to be configured for a pending domain:
 * - A record (anycast IP)
 * - CNAME for www (root domains only)
 * - DCV CNAME for ACME challenge (once provisioned)
 * - SPF TXT record (once DCV is ready)
 * - DKIM CNAME records (once provisioned AND DCV CNAME is available)
 * - DMARC TXT record (once provisioned AND DCV CNAME is available)
 *
 * @param domainDetails - Pending domain details with anycast IP
 * @param dkimCnames - CNAME targets from dkimRecordExpected; shown only after DCV is ready
 * @param dmarcExpected - Expected DMARC record value from mail-flow status response
 */
export default function DomainDNS({
  domainDetails,
  dkimCnames,
  dmarcExpected,
}: {
  domainDetails: AppDomain;
  dkimCnames?: string[];
  dmarcExpected?: string;
}) {
  const t = useTranslations();
  const { fqdn, anycastIp, certificateValidationCname } = domainDetails;
  const isDCVEnabled = useSwitchboard('appbuilder-domain-dcv') === true;

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

  const dnsRecords = getDnsRecords(fqdn, anycastIp, certificateValidationCname);

  const emailRecordsReady = isDCVEnabled && !!certificateValidationCname && !!dkimCnames?.length;
  const apexDomain = parseDomain(fqdn)?.rootDomain ?? fqdn;
  const dkimRecordCards = emailRecordsReady
    ? buildDkimCnameCards(dkimCnames!, apexDomain)
    : [];

  const dmarcRecord =
    emailRecordsReady && dmarcExpected
      ? { type: 'TXT' as const, name: '_dmarc', value: dmarcExpected, ttl: 3600 }
      : null;

  return (
    <Box
      orientation="vertical"
      gap="md"
      className="w-full pb-2 mb-1 border-b"
      data-testid="domain-dns-instructions"
    >
      <text.p className="text-sm">
        {t('builder_domain_dns_instructions')}
      </text.p>

      {emailRecordsReady && (
        <Box
          className="rounded-md border border-intents-ux-feedback-warning-borderColor bg-intents-ux-feedback-warning-backgroundColor p-3"
          orientation="vertical"
        >
          <text.p className="text-sm">
            {SPF_WARNING_DEFAULT}
          </text.p>
        </Box>
      )}

      <Box orientation="vertical" gap="sm">
        <DnsRecordCard {...dnsRecords.aRecord} testId="domain-dns-a-record" />
        {dnsRecords.cnameRecord && <DnsRecordCard {...dnsRecords.cnameRecord} />}
        {dnsRecords.dcvRecord && <DnsRecordCard {...dnsRecords.dcvRecord} />}
        {emailRecordsReady && <DnsRecordCard {...SPF_RECORD} />}
        {dkimRecordCards.map((record) => (
          <DnsRecordCard key={record.name} {...record} />
        ))}
        {dmarcRecord && <DnsRecordCard {...dmarcRecord} />}
      </Box>
    </Box>
  );
}
