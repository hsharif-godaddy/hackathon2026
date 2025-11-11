import { generateClickEID } from '@/utils/instrumentation';
import type { AppDomain } from '@/hooks/useDomainOperations';
import Spinner from '@ux/spinner';
import Button from "@ux/button";
import text from "@ux/text";
import Box from "@ux/box";

/**
 * DNS Configuration Instructions Component
 *
 * Displays DNS records that need to be configured for a pending domain.
 * Shows A record with anycast IP and CNAME record for www subdomain.
 *
 * @param domainDetails - Pending domain details with anycast IP
 */
export default function DomainDNS({ domainDetails }: { domainDetails: AppDomain }) {
  const { fqdn, anycastIp } = domainDetails;

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
          <text.p className="font-semibold">Provisioning CDN</text.p>
        </Box>
        <text.p className="text-sm">
          Your domain is being provisioned. DNS configuration instructions will appear here once the CDN is ready.
          This typically takes a few moments.
        </text.p>
      </Box>
    );
  }

  return (
    <Box
      orientation="vertical"
      gap="md"
      className="rounded-lg"
    >
      <text.p className="text-sm">
        To finish connecting your domain, you&apos;ll need to make some updates to your DNS records.
        Your DNS provider (typically where your domain is registered) can help if you get stuck.
        DNS records to add/modify with your provider:
      </text.p>

      {/* DNS Records Table */}
      <Box orientation="vertical" gap="sm" className="mt-2">
        <Box
          orientation="horizontal"
          gap="md"
          className="font-semibold text-sm border-b border-intents-ux-border-subtle pb-2"
        >
          <div className="w-20">Type</div>
          <div className="w-24">Name</div>
          <div className="flex-1">Value</div>
          <div className="w-20">TTL</div>
        </Box>

        {/* A Record */}
        <Box
          orientation="horizontal"
          gap="md"
          className="text-sm py-2 border-b border-intents-ux-border-subtle"
        >
          <div className="w-20">A</div>
          <div className="w-24">@</div>
          <div className="flex-1">
            <code className="bg-intents-ux-box-subtle rounded px-2 py-1 text-xs font-mono">
              {anycastIp}
            </code>
          </div>
          <div className="w-20">3600</div>
        </Box>

        {/* CNAME Record for www */}
        <Box
          orientation="horizontal"
          gap="md"
          className="text-sm py-2"
        >
          <div className="w-20">CNAME</div>
          <div className="w-24">www</div>
          <div className="flex-1">
            <code className="bg-intents-ux-box-subtle rounded px-2 py-1 text-xs font-mono">
              {fqdn}
            </code>
          </div>
          <div className="w-20">3600</div>
        </Box>
      </Box>
    </Box>
  );
}
