/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import { logger } from '@/lib/request-context';
import { useDnsConflictGate } from './useDnsConflictGate';

const mockAppFetch = vi.fn();
const mockUseDomainsQuery = vi.fn();

vi.mock('@/components/layout/DnsConflictModal', () => ({
  default: ({
    onClose,
    onConfirm,
    variant,
  }: {
    onClose: () => void;
    onConfirm: (consent: boolean) => void;
    variant: 'conflict' | 'unverified';
  }) => (
    <div>
      <span data-testid='dns-modal-variant'>{variant}</span>
      <button onClick={() => onConfirm(false)}>confirm-false</button>
      <button onClick={() => onConfirm(true)}>confirm-true</button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

vi.mock('@/hooks/useDomainsQuery', () => ({
  useDomainsQuery: () => mockUseDomainsQuery(),
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('useDnsConflictGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDomainsQuery.mockReturnValue({ data: [] });
  });

  it('skips check for airo subdomain', async () => {
    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'myapp.airoapp.ai', status: 'active' }],
      } as any,
    }));

    await expect(result.current.runGate()).resolves.toEqual({ proceed: true });
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('skips check for non-GoDaddy domain', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: false }],
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    await expect(result.current.runGate()).resolves.toEqual({ proceed: true });
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('shows conflict modal and resolves with user choice', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      json: async () => ({
        currentIps: ['93.184.216.34'],
        failedOpen: false,
        hasProductDNSConflict: true,
      }),
      ok: true,
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    const gatePromise = result.current.runGate();

    await waitFor(() => expect(result.current.modal).not.toBeNull());
    render(<>{result.current.modal}</>);
    expect(screen.getByTestId('dns-modal-variant')).toHaveTextContent('conflict');

    await act(async () => {
      screen.getByRole('button', { name: 'confirm-false' }).click();
    });

    await expect(gatePromise).resolves.toEqual({ consent: false, proceed: true });
  });

  it('shows unverified modal when failedOpen is true', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      json: async () => ({
        currentIps: null,
        failedOpen: true,
        hasProductDNSConflict: true,
      }),
      ok: true,
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    const gatePromise = result.current.runGate();

    await waitFor(() => expect(result.current.modal).not.toBeNull());
    render(<>{result.current.modal}</>);
    expect(screen.getByTestId('dns-modal-variant')).toHaveTextContent('unverified');

    await act(async () => {
      screen.getByRole('button', { name: 'confirm-true' }).click();
    });

    await expect(gatePromise).resolves.toEqual({ consent: true, proceed: true });
  });

  it('shows unverified modal when dns check returns 4xx', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid fqdn',
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    const gatePromise = result.current.runGate();

    await waitFor(() => expect(result.current.modal).not.toBeNull());
    render(<>{result.current.modal}</>);
    expect(screen.getByTestId('dns-modal-variant')).toHaveTextContent('unverified');

    await act(async () => {
      screen.getByRole('button', { name: 'confirm-false' }).click();
    });

    await expect(gatePromise).resolves.toEqual({ consent: false, proceed: true });
  });

  it('proceeds without modal when dns check reports no conflict', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        currentIps: ['93.184.216.34'],
        failedOpen: false,
        hasProductDNSConflict: false,
      }),
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    await expect(result.current.runGate()).resolves.toEqual({ proceed: true });
    expect(result.current.modal).toBeNull();
  });

  it('reuses the same pending promise for concurrent runGate calls', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        currentIps: ['93.184.216.34'],
        failedOpen: false,
        hasProductDNSConflict: true,
      }),
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'https://example.com/path', status: 'active' }],
      } as any,
    }));

    const first = result.current.runGate();
    const second = result.current.runGate();

    expect(mockAppFetch).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(result.current.modal).not.toBeNull());
    render(<>{result.current.modal}</>);
    await act(async () => {
      screen.getByRole('button', { name: 'confirm-true' }).click();
    });

    await expect(first).resolves.toEqual({ consent: true, proceed: true });
    await expect(second).resolves.toEqual({ consent: true, proceed: true });
  });

  it('fails open on dns check 5xx responses', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    await expect(result.current.runGate()).resolves.toEqual({ proceed: true });
  });

  it('returns proceed=false when modal is dismissed', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        currentIps: ['93.184.216.34'],
        failedOpen: false,
        hasProductDNSConflict: true,
      }),
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    const gatePromise = result.current.runGate();
    await waitFor(() => expect(result.current.modal).not.toBeNull());
    render(<>{result.current.modal}</>);
    await act(async () => {
      screen.getByRole('button', { name: 'close' }).click();
    });

    await expect(gatePromise).resolves.toEqual({ proceed: false, reason: 'dns_conflict' });
  });

  it('resolves pending gate promise on unmount while modal is open', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        currentIps: ['93.184.216.34'],
        failedOpen: false,
        hasProductDNSConflict: true,
      }),
    });

    const { result, unmount } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    const gatePromise = result.current.runGate();
    await waitFor(() => expect(result.current.modal).not.toBeNull());

    unmount();

    await expect(gatePromise).resolves.toEqual({ proceed: false, reason: 'dns_conflict' });
  });

  it('fails open with error log when dns check json parsing fails', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    await expect(result.current.runGate()).resolves.toEqual({ proceed: true });
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('publish.dns-conflict-gate.check-json-error', expect.any(Object));
  });

  it('fails open when dns check request errors', async () => {
    mockUseDomainsQuery.mockReturnValue({
      data: [{ domain: 'example.com', hasInternalNameservers: true }],
    });
    mockAppFetch.mockRejectedValue(new Error('network failure'));

    const { result } = renderHook(() => useDnsConflictGate({
      appId: 'app-123',
      site: {
        domains: [{ domainType: null, fqdn: 'example.com', status: 'active' }],
      } as any,
    }));

    await expect(result.current.runGate()).resolves.toEqual({ proceed: true });
  });
});
