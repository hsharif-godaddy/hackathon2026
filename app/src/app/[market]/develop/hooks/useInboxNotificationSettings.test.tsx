/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { queryKeys } from '@/lib/inbox/constants/queryKeys';
import {
  useInboxEmailNotifications,
  useInboxStaff,
  useUpdateEmailNotifications,
  useUpdateStaffNotificationEmail,
} from './useInbox';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BRAND = '550e8400-e29b-41d4-a716-446655440000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useInboxStaff', () => {
  it('fetches and transforms the staff record', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ staff: { id: 7, notification_email: 'a@b.com' } }));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useInboxStaff(BRAND), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 7, notificationEmail: 'a@b.com' });
    expect((mockFetch.mock.calls[0][0] as string)).toContain(`brandId=${BRAND}`);
  });

  it('does not fetch when enabled is false', async () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useInboxStaff(BRAND, { enabled: false }), { wrapper: Wrapper });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('errors when the staff envelope is missing', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 7, notification_email: 'a@b.com' })); // no { staff } wrapper
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useInboxStaff(BRAND), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useInboxEmailNotifications', () => {
  it('fetches and converts to camelCase', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ email_notifications: true }));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useInboxEmailNotifications(BRAND), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ emailNotifications: true });
  });
});

describe('useUpdateEmailNotifications', () => {
  it('optimistically updates the cached value then PUTs', async () => {
    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(queryKeys.inboxEmailNotifications(BRAND), { emailNotifications: true });
    mockFetch.mockResolvedValue(jsonResponse({ email_notifications: false }));

    const { result } = renderHook(() => useUpdateEmailNotifications(BRAND), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(false);
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/inbox/email-notifications');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ brandId: BRAND, emailNotifications: false });
  });

  it('rolls back the optimistic update when the PUT fails', async () => {
    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(queryKeys.inboxEmailNotifications(BRAND), { emailNotifications: true });
    mockFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

    const { result } = renderHook(() => useUpdateEmailNotifications(BRAND), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(false).catch(() => {});
    });

    expect(queryClient.getQueryData(queryKeys.inboxEmailNotifications(BRAND))).toEqual({
      emailNotifications: true,
    });
  });
});

describe('useUpdateStaffNotificationEmail', () => {
  it('PUTs the staff notification email with brandId injected', async () => {
    const { Wrapper } = createWrapper();
    mockFetch.mockResolvedValue(jsonResponse({ staff: { id: 7, notification_email: 'new@b.com' } }));
    const { result } = renderHook(() => useUpdateStaffNotificationEmail(BRAND), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ staffId: 7, notificationEmail: 'new@b.com' });
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/inbox/staff');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ brandId: BRAND, staffId: 7, notificationEmail: 'new@b.com' });
  });
});
