import { describe, expect, it } from 'vitest';

import { resolveSsoRedirectHosts } from '@/app/[market]/develop/components/settings/SsoPanel';
import { DomainStatus, DomainType, type SiteDomain } from '@/lib/control-plane/types';

function makeDomain(fqdn: string, status: DomainStatus, type: DomainType = DomainType.PREFIX): SiteDomain {
  return {
    fqdn,
    status,
    domainType: type,
  } as SiteDomain;
}

describe('resolveSsoRedirectHosts', function describeResolveSsoRedirectHosts() {
  it('returns every active domain (priority 1) and ignores all other sources', function priorityOneWins() {
    const domains: SiteDomain[] = [
      makeDomain('a.example.com', DomainStatus.ACTIVE, DomainType.PREFIX),
      makeDomain('custom.example.com', DomainStatus.ACTIVE),
      makeDomain('pending.example.com', DomainStatus.INACTIVE),
    ];
    const hosts: string[] = resolveSsoRedirectHosts(
      domains,
      'https://from-published.example.com',
      'https://from-preview.preview.example.com',
      'https://from-agent.agent.example.com',
    );
    expect(hosts).toEqual(['a.example.com', 'custom.example.com']);
  });

  it('falls through to published_url host when no active domain exists', function priorityTwo() {
    const hosts: string[] = resolveSsoRedirectHosts(
      [makeDomain('pending.example.com', DomainStatus.INACTIVE)],
      'https://tn4oj87dw7.c41.airoapp.ai',
      undefined,
      undefined,
    );
    expect(hosts).toEqual(['tn4oj87dw7.c41.airoapp.ai']);
  });

  it('derives cell-default host from preview_url when published_url is missing', function priorityThree() {
    const hosts: string[] = resolveSsoRedirectHosts(
      undefined,
      undefined,
      'https://tn4oj87dw7.preview.c41.airoapp.ai/?airoShareToken=zqY36pg8IsAt',
      undefined,
    );
    expect(hosts).toEqual(['tn4oj87dw7.c41.airoapp.ai']);
  });

  it('derives cell-default host from agent_url as the final fallback', function priorityFour() {
    const hosts: string[] = resolveSsoRedirectHosts(
      undefined,
      undefined,
      undefined,
      'https://tn4oj87dw7.agent.c41.airoapp.ai',
    );
    expect(hosts).toEqual(['tn4oj87dw7.c41.airoapp.ai']);
  });

  it('treats malformed published_url as missing and continues to derived sources', function malformedPublished() {
    const hosts: string[] = resolveSsoRedirectHosts(
      undefined,
      'not-a-url',
      'https://tn4oj87dw7.preview.c41.airoapp.ai',
      undefined,
    );
    expect(hosts).toEqual(['tn4oj87dw7.c41.airoapp.ai']);
  });

  it('returns empty array when every source is missing so caller renders placeholder', function allMissing() {
    expect(resolveSsoRedirectHosts(undefined, undefined, undefined, undefined)).toEqual([]);
    expect(resolveSsoRedirectHosts([], '', '', '')).toEqual([]);
  });

  it('does not strip when a URL lacks the .preview./.agent. infix', function noStripWhenMissingInfix() {
    // hostname has no `.preview.` or `.agent.` label, so derivation returns null
    const hosts: string[] = resolveSsoRedirectHosts(
      undefined,
      undefined,
      'https://random.example.com',
      undefined,
    );
    expect(hosts).toEqual([]);
  });

  it('uses published_url even when preview_url is also present', function publishedBeatsPreview() {
    const hosts: string[] = resolveSsoRedirectHosts(
      undefined,
      'https://from-published.c41.airoapp.ai',
      'https://from-preview.preview.c41.airoapp.ai',
      undefined,
    );
    expect(hosts).toEqual(['from-published.c41.airoapp.ai']);
  });
});
