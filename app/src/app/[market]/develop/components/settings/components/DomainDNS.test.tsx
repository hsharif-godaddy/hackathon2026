/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import DomainDNS, { CopyableValue } from '@/app/[market]/develop/components/settings/components/DomainDNS';
import type { AppDomain } from '@/hooks/useAppDetails';
import { renderWithProviders } from '@/tests/test-utils';


vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => (false)),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

describe('CopyableValue', () => {
  it('renders value and copy button', () => {
    renderWithProviders(<CopyableValue value="1.2.3.4" />);

    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_common_copy_clipboard' })).toBeInTheDocument();
  });

  it('shows copied state after clicking', async () => {
    const { user } = renderWithProviders(<CopyableValue value="1.2.3.4" />);

    await user.click(screen.getByRole('button', { name: 'builder_common_copy_clipboard' }));

    expect(screen.getByRole('button', { name: 'builder_common_copied' })).toBeInTheDocument();
  });

  it('resets copied state after 2 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<CopyableValue value="1.2.3.4" />);

    await user.click(screen.getByRole('button', { name: 'builder_common_copy_clipboard' }));
    expect(screen.getByRole('button', { name: 'builder_common_copied' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'builder_common_copy_clipboard' })).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it('truncates long values visually when overflow flag is enabled', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockImplementation((feature: string) =>
      feature === 'appbuilder-dns-record-values-overflow' ? true : false
    );

    const longValue = 's1.dkim.jasongreen_co.bbc.onsecureserver.net.';
    renderWithProviders(<CopyableValue value={longValue} />);

    const code = screen.getByText(longValue);
    expect(code).toHaveClass('truncate');
  });

  it('copies the full value for long DNS records', async () => {
    const longValue = 's1.dkim.jasongreen_co.bbc.onsecureserver.net.';
    const { user } = renderWithProviders(<CopyableValue value={longValue} />);

    await user.click(screen.getByRole('button', { name: 'builder_common_copy_clipboard' }));

    expect(screen.getByRole('button', { name: 'builder_common_copied' })).toBeInTheDocument();
  });
});

describe('DomainDNS', () => {
  const baseDomain: AppDomain = {
    fqdn: 'example.com',
    anycastIp: '1.2.3.4',
    certificateValidationCname: undefined,
    status: 'pending',
    isPrimary: true,
  };

  it('shows provisioning spinner when anycastIp is missing', () => {
    renderWithProviders(
      <DomainDNS domainDetails={{ ...baseDomain, anycastIp: undefined }} />
    );

    expect(screen.getByText('builder_domain_dns_provisioning')).toBeInTheDocument();
  });

  it('shows provisioning spinner when DCV enabled and certificateValidationCname is missing', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockImplementation((feature: string) => {
      if (feature === 'appbuilder-domain-dcv') {
        return true;
      }
      if (feature === 'appbuilder-domain-connect') {
        return true;
      }
      return false;
    });

    renderWithProviders(
      <DomainDNS domainDetails={{ ...baseDomain, certificateValidationCname: undefined }} />
    );

    expect(screen.getByText('builder_domain_dns_provisioning')).toBeInTheDocument();
  });

  it('renders DNS cards with A record for root domain', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockImplementation((feature: string) => feature === 'appbuilder-domain-connect');

    renderWithProviders(<DomainDNS domainDetails={baseDomain} />);

    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    expect(screen.getByText('builder_domain_dns_instructions')).toBeInTheDocument();
    expect(screen.getAllByText('Type:')).toHaveLength(2);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('CNAME')).toBeInTheDocument();
  });

  it('renders copy buttons for record values', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockImplementation((feature: string) => feature === 'appbuilder-domain-connect');

    renderWithProviders(<DomainDNS domainDetails={baseDomain} />);

    const copyButtons = screen.getAllByRole('button', { name: 'builder_common_copy_clipboard' });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders correct DCV record for root domain when DCV enabled', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue(true);

    renderWithProviders(
      <DomainDNS
        domainDetails={{
          ...baseDomain,
          certificateValidationCname: 'abc123.validation.secureserver.net',
        }}
      />
    );

    expect(screen.getByText('_acme-challenge')).toBeInTheDocument();
    expect(screen.getByText('abc123.validation.secureserver.net')).toBeInTheDocument();
  });

  it('renders correct DCV record for subdomain when DCV enabled', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue(true);

    renderWithProviders(
      <DomainDNS
        domainDetails={{
          fqdn: 'blog.example.com',
          anycastIp: '1.2.3.4',
          certificateValidationCname: 'xyz789.validation.secureserver.net',
          status: 'pending',
          isPrimary: true,
        }}
      />
    );

    expect(screen.getByText('_acme-challenge.blog')).toBeInTheDocument();
    expect(screen.getByText('xyz789.validation.secureserver.net')).toBeInTheDocument();
  });

  it('renders correct DCV record for multi-level subdomain when DCV enabled', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue(true);

    renderWithProviders(
      <DomainDNS
        domainDetails={{
          fqdn: 'api.staging.example.com',
          anycastIp: '1.2.3.4',
          certificateValidationCname: 'def456.validation.secureserver.net',
          status: 'pending',
          isPrimary: true,
        }}
      />
    );

    expect(screen.getByText('_acme-challenge.api.staging')).toBeInTheDocument();
    expect(screen.getByText('def456.validation.secureserver.net')).toBeInTheDocument();
  });

  describe('DKIM CNAME cards', () => {
    const dkimCnameValue = 's1.dkim.example_com.f86.onsecureserver.net.';
    const domainWithDcv: AppDomain = {
      ...baseDomain,
      certificateValidationCname: 'abc123.validation.secureserver.net',
    };

    it('renders DKIM CNAME cards and SPF when dkimCnames is provided and DCV is ready', async () => {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);

      renderWithProviders(
        <DomainDNS domainDetails={domainWithDcv} dkimCnames={[dkimCnameValue]} />,
      );

      // A + CNAME (www) + DCV CNAME + SPF + DKIM CNAME = 5 Type labels
      expect(screen.getAllByText('Type:')).toHaveLength(5);
      expect(screen.getByText('secureserver1._domainkey')).toBeInTheDocument();
      expect(screen.getByText(dkimCnameValue)).toBeInTheDocument();
      // SPF always shown when DCV is ready
      expect(screen.getByText('v=spf1 include:secureserver.net -all')).toBeInTheDocument();
    });

    it('does not render email records when dkimCnames is absent (flag off)', async () => {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);

      renderWithProviders(
        <DomainDNS domainDetails={domainWithDcv} />,
      );

      // A + CNAME (www) + DCV CNAME only = 3 Type labels; no email records without dkimCnames
      expect(screen.getAllByText('Type:')).toHaveLength(3);
      expect(screen.queryByText('v=spf1 include:secureserver.net -all')).not.toBeInTheDocument();
      expect(screen.queryByText('secureserver1._domainkey')).not.toBeInTheDocument();
    });

    it('shows the SPF warning note only with email DNS records', async () => {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      const spfWarning =
        'Required: Please make sure your domain only has one SPF record. If multiple SPF records are found on your domain or if the SPF record is not added correctly, your email might not be delivered.';

      const { rerender } = renderWithProviders(
        <DomainDNS domainDetails={domainWithDcv} />,
      );

      expect(screen.queryByText(spfWarning)).not.toBeInTheDocument();

      rerender(
        <DomainDNS domainDetails={domainWithDcv} dkimCnames={[dkimCnameValue]} />,
      );

      expect(screen.getByText(spfWarning)).toBeInTheDocument();
    });

    it('renders DMARC record when dmarcExpected and DCV are present', async () => {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      const dmarcValue = 'v=DMARC1; p=reject; rua=mailto:dmarc_rua@onsecureserver.net;';

      renderWithProviders(
        <DomainDNS
          domainDetails={domainWithDcv}
          dkimCnames={[dkimCnameValue]}
          dmarcExpected={dmarcValue}
        />,
      );

      // A + CNAME (www) + DCV CNAME + SPF + DKIM CNAME + DMARC = 6 Type labels
      expect(screen.getAllByText('Type:')).toHaveLength(6);
      expect(screen.getByText('_dmarc')).toBeInTheDocument();
      expect(screen.getByText(dmarcValue)).toBeInTheDocument();
    });

    it('does not render email records when certificateValidationCname is missing (DCV not ready)', async () => {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);

      renderWithProviders(
        <DomainDNS domainDetails={baseDomain} dkimCnames={[dkimCnameValue]} />,
      );

      // DCV not ready → provisioning spinner, no DNS cards rendered
      expect(screen.getByText('builder_domain_dns_provisioning')).toBeInTheDocument();
      expect(screen.queryByText('secureserver1._domainkey')).not.toBeInTheDocument();
      expect(screen.queryByText('v=spf1 include:secureserver.net -all')).not.toBeInTheDocument();
    });

    it('uses position-based secureserver{N} naming for DKIM record names', async () => {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue(true);
      const cname1 = 's1.dkim.example_com.ab12.onsecureserver.net.';
      const cname2 = 's2.dkim.example_com.ab12.onsecureserver.net.';

      renderWithProviders(
        <DomainDNS
          domainDetails={domainWithDcv}
          dkimCnames={[cname1, cname2]}
        />,
      );

      // Index 0 → secureserver1, index 1 → secureserver2
      expect(screen.getByText('secureserver1._domainkey')).toBeInTheDocument();
      expect(screen.getByText('secureserver2._domainkey')).toBeInTheDocument();
      expect(screen.getByText(cname1)).toBeInTheDocument();
      expect(screen.getByText(cname2)).toBeInTheDocument();
    });
  });
});
