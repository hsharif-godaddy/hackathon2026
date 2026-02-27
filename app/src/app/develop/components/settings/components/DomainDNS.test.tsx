import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import DomainDNS, { CopyableValue } from '@/app/develop/components/settings/components/DomainDNS';
import type { AppDomain } from '@/hooks/useAppDetails';
import { renderWithProviders } from '@/tests/test-utils';


vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: false, isLoading: false })),
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
        return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
      }
      return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
    });

    renderWithProviders(
      <DomainDNS domainDetails={{ ...baseDomain, certificateValidationCname: undefined }} />
    );

    expect(screen.getByText('builder_domain_dns_provisioning')).toBeInTheDocument();
  });

  it('renders DNS table with A record for root domain', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);

    renderWithProviders(<DomainDNS domainDetails={baseDomain} />);

    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders copy buttons for record values', async () => {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);

    renderWithProviders(<DomainDNS domainDetails={baseDomain} />);

    const copyButtons = screen.getAllByRole('button', { name: 'builder_common_copy_clipboard' });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  });
});
