/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import DomainConnectButton from '@/app/[market]/develop/components/settings/components/DomainConnectButton';
import { renderWithProviders } from '@/tests/test-utils';
import type { DomainConnectProvider } from '@/utils/domain';

const { mockAppFetch } = vi.hoisted(function hoisted() {
  return { mockAppFetch: vi.fn() };
});

vi.mock('@/lib/gasket-config', () => ({
  appFetch: mockAppFetch,
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(() => 'mock-eid'),
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

const onError: ReturnType<typeof vi.fn> = vi.fn();

const baseProps = {
  appId: 'app-123',
  fqdn: 'example.com',
  anycastIp: '1.2.3.4',
  dcv: 'abc123.validation.secureserver.net',
  provider: 'cloudflare' as DomainConnectProvider,
  onError,
};

describe('DomainConnectButton', function domainConnectButtonTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { href: string } }).location = { href: '' };
  });

  it('fetches Domain Connect URL and redirects on success', async function happyPath() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://dash.cloudflare.com/domainconnect/apply?sig=abc' }),
    });

    const { user } = renderWithProviders(<DomainConnectButton {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Connect DNS automatically' }));

    await waitFor(function waitForRedirect() {
      expect((window as unknown as { location: { href: string } }).location.href).toBe(
        'https://dash.cloudflare.com/domainconnect/apply?sig=abc',
      );
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when the response is not ok', async function notOkResponse() {
    mockAppFetch.mockResolvedValueOnce({ ok: false, status: 502 });

    const { user } = renderWithProviders(<DomainConnectButton {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Connect DNS automatically' }));

    await waitFor(function waitForOnError() {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('calls onError when the response body has an unexpected shape', async function unexpectedShape() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notUrl: 'https://example.com' }),
    });

    const { user } = renderWithProviders(<DomainConnectButton {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Connect DNS automatically' }));

    await waitFor(function waitForOnError() {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('calls onError when fetch throws a network error', async function fetchThrows() {
    mockAppFetch.mockRejectedValueOnce(new Error('Network failure'));

    const { user } = renderWithProviders(<DomainConnectButton {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Connect DNS automatically' }));

    await waitFor(function waitForOnError() {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('renders disabled with connecting label when isConnecting is true', function isConnectingDisabled() {
    renderWithProviders(<DomainConnectButton {...baseProps} isConnecting={true} />);
    const btn = screen.getByRole('button', { name: 'builder_domain_attach_connecting' });
    expect(btn).toBeDisabled();
  });
});
