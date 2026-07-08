/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

const { mockAppFetch } = vi.hoisted(() => ({
  mockAppFetch: vi.fn((url: string, options?: RequestInit) => fetch(url, options)),
}));

vi.mock('@/lib/gasket-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gasket-config')>();
  return {
    ...actual,
    appFetch: mockAppFetch,
  };
});

import { CommerceSettingDetail } from './CommerceSettingDetail';

const storeId: string = '339b8961-1860-48de-aa55-947634965c7a';
const stripePath: string = 'payment-methods/apps/wes-stripe-aab/stripe-payments';
const stripeLocalPath: string = `/api/commerce/settings/${storeId}/${stripePath}`;
const stripeApiHref: string = `https://settings.commerce.api.dev-godaddy.com/v2/commerce/stores/${storeId}/settings/${stripePath}`;
const businessPath: string = 'business-info';
const businessLocalPath: string = `/api/commerce/settings/${storeId}/${businessPath}`;
const businessApiHref: string = `https://settings.commerce.api.dev-godaddy.com/v2/commerce/stores/${storeId}/settings/${businessPath}`;
const nativeSlotsPath: string = 'native-slots';
const nativeSlotsLocalPath: string = `/api/commerce/settings/${storeId}/${nativeSlotsPath}`;

function jsonResponse(body: unknown, status: number = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function stripePage(revision: string) {
  return {
    id: 'gpa.stripe-payments',
    slug: stripePath,
    source: 'gpa',
    renderer: 'settings-form-v1',
    titleKey: 'GPA_STRIPE_TITLE',
    subtitle: 'Configure Stripe payment processing',
    revision,
    back: { route: '/settings/payment-methods' },
    sections: [
      {
        kind: 'fields',
        id: 'connection',
        titleKey: 'GPA_STRIPE_CONNECTION',
        fields: [
          {
            key: 'apiKey',
            type: 'secret',
            labelKey: 'GPA_STRIPE_API_KEY',
            value: '',
            required: true,
            secretState: {
              configured: true,
              updatedAt: '2026-06-09T17:56:35.947Z',
            },
          },
        ],
      },
    ],
    operations: {
      update: {
        labelKey: 'COMMON_SAVE',
        method: 'PATCH',
        href: stripeApiHref,
        idempotencyRequired: true,
        revisionRequired: true,
      },
    },
  };
}

function businessPage(revision: string, businessName: string) {
  return {
    id: 'commerce.business-info',
    slug: businessPath,
    source: 'commerce',
    renderer: 'settings-form-v1',
    title: 'Business info',
    subtitle: 'Configure business details',
    revision,
    back: { route: '/settings' },
    sections: [
      {
        kind: 'fields',
        id: 'details',
        fields: [
          {
            key: 'businessName',
            type: 'text',
            label: 'Business name',
            value: businessName,
            required: true,
          },
        ],
      },
    ],
    operations: {
      update: {
        label: 'Save',
        method: 'PATCH',
        href: businessApiHref,
        idempotencyRequired: true,
        revisionRequired: true,
      },
    },
  };
}

function nativeSlotsPage() {
  return {
    id: 'commerce.native-slots',
    slug: nativeSlotsPath,
    source: 'commerce',
    renderer: 'settings-group-v1',
    title: 'Native slots',
    subtitle: 'Configure native surfaces',
    revision: 'commerce.native-slots:current',
    sections: [
      {
        kind: 'native-slot',
        id: 'empty',
        title: 'Empty href',
        description: 'Should be filtered',
        href: '',
      },
      {
        kind: 'native-slot',
        id: 'relative',
        title: 'Relative href',
        description: 'Should be filtered',
        href: '/settings/native',
      },
      {
        kind: 'native-slot',
        id: 'malformed',
        title: 'Malformed href',
        description: 'Should be filtered',
        href: 'not a url',
      },
      {
        kind: 'native-slot',
        id: 'unsafe-protocol',
        title: 'Unsafe href',
        description: 'Should be filtered',
        // only applicable for testing, settings-api should never return this as a real href
        // eslint-disable-next-line no-script-url
        href: 'javascript:alert(1)',
      },
      {
        kind: 'native-slot',
        id: 'valid',
        title: 'Valid native slot',
        description: 'Should render',
        href: 'https://native.example.com/settings?source=commerce',
      },
    ],
  };
}

function stripeSaveCalls(): Array<Parameters<typeof fetch>> {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input, init]) => String(input).includes(stripeLocalPath) && init?.method === 'PATCH'
    );
}

function renderDetail(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <CommerceSettingDetail
      storeId={storeId}
      commercePath={stripePath}
      onCommercePathChange={() => {}}
      onLastAction={() => {}}
      onRefetchSurface={() => Promise.resolve(undefined)}
      baseDebugState={{}}
    />
  );
}

describe('CommerceSettingDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppFetch.mockImplementation((url: string, options?: RequestInit) => fetch(url, options));
  });

  afterEach(() => {
    window.history.pushState(null, '', '/');
  });

  it('shows the provider error when the page request fails', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      jsonResponse(
        {
          type: 'https://developer.godaddy.com/problems/settings/provider-invalid-response',
          title: 'The application settings provider returned an invalid response.',
          status: 502,
          detail: 'The application settings provider response could not be decoded.',
          instance: '/settings',
        },
        502
      )
    );

    renderDetail();

    expect(await screen.findByText("Couldn't load this setting")).toBeInTheDocument();
    const notice: HTMLElement = screen.getByLabelText(/Commerce setting unavailable/i);
    expect(within(notice).getByText(/provider response could not be decoded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('sends an update when replacing an already configured secret field', async () => {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url: string = String(input);
      const method: string = init?.method ?? 'GET';

      if (url.includes(stripeLocalPath) && method === 'GET') {
        return jsonResponse(stripePage('gpa.stripe-payments:configured'));
      }

      if (url.includes(stripeLocalPath) && method === 'PATCH') {
        return jsonResponse({ status: 'updated' });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const { user } = renderDetail();

    const input: HTMLElement = await screen.findByLabelText(/Stripe API key/);
    const saveButton: HTMLElement = screen.getByRole('button', { name: 'Save' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Configured secret');
    expect(saveButton).toBeDisabled();

    await user.type(input, 'sk_test_replacement');
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        stripeLocalPath,
        expect.objectContaining({
          method: 'PATCH',
        }),
        { handle401: { level: 3 } }
      );
    });

    const saveCall: Parameters<typeof fetch> | undefined = stripeSaveCalls()[0];
    expect(saveCall).toBeDefined();
    expect(saveCall?.[1]?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'If-Match': 'gpa.stripe-payments:configured',
    });
    expect(saveCall?.[1]?.headers).toHaveProperty('Idempotency-Key');
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      values: { apiKey: 'sk_test_replacement' },
      changedFields: ['apiKey'],
      revision: 'gpa.stripe-payments:configured',
    });
  });

  it('refetches revision-protected pages before saving an existing secret update', async () => {
    let pageRequestCount: number = 0;

    vi.mocked(fetch).mockImplementation((input, init) => {
      const url: string = String(input);
      const method: string = init?.method ?? 'GET';

      if (url.includes(stripeLocalPath) && method === 'GET') {
        pageRequestCount += 1;
        return jsonResponse(
          stripePage(
            pageRequestCount === 1 ? 'gpa.stripe-payments:stale' : 'gpa.stripe-payments:fresh'
          )
        );
      }

      if (url.includes(stripeLocalPath) && method === 'PATCH') {
        return jsonResponse({ result: 'success', next: { refetchPage: false } });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const { user } = renderDetail();

    const input: HTMLElement = await screen.findByLabelText(/Stripe API key/);
    await user.type(input, 'sk_test_replacement');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(stripeSaveCalls()).toHaveLength(1);
    });

    expect(pageRequestCount).toBe(2);
    const saveCall: Parameters<typeof fetch> | undefined = stripeSaveCalls()[0];
    expect(saveCall?.[1]?.headers).toMatchObject({
      'If-Match': 'gpa.stripe-payments:fresh',
    });
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      changedFields: ['apiKey'],
      revision: 'gpa.stripe-payments:fresh',
    });
  });

  it('keeps the secret update dirty when a 200 response returns a validation error', async () => {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url: string = String(input);
      const method: string = init?.method ?? 'GET';

      if (url.includes(stripeLocalPath) && method === 'GET') {
        return jsonResponse(stripePage('gpa.stripe-payments:configured'));
      }

      if (url.includes(stripeLocalPath) && method === 'PATCH') {
        return jsonResponse({
          result: 'validation-error',
          fieldErrors: { apiKey: 'GPA_STRIPE_API_KEY_INVALID' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const lastActions: string[] = [];
    const { user } = renderWithProviders(
      <CommerceSettingDetail
        storeId={storeId}
        commercePath={stripePath}
        onCommercePathChange={() => {}}
        onLastAction={(action: string) => lastActions.push(action)}
        onRefetchSurface={() => Promise.resolve(undefined)}
        baseDebugState={{}}
      />
    );

    const input: HTMLElement = await screen.findByLabelText(/Stripe API key/);
    const saveButton: HTMLElement = screen.getByRole('button', { name: 'Save' });

    await user.type(input, 'sk_test_invalid');
    await user.click(saveButton);

    await waitFor(() => {
      expect(lastActions.some((action: string) => /returned validation-error/.test(action))).toBe(
        true
      );
    });

    expect(saveButton).toBeEnabled();
    expect(input).toHaveValue('sk_test_invalid');
  });

  it('shows server-normalized values from the post-save refetch once dirty state clears', async () => {
    let pageRequestCount: number = 0;
    let saveCompleted: boolean = false;

    vi.mocked(fetch).mockImplementation((input, init) => {
      const url: string = String(input);
      const method: string = init?.method ?? 'GET';

      if (url.includes(businessLocalPath) && method === 'GET') {
        pageRequestCount += 1;
        return jsonResponse(
          saveCompleted
            ? businessPage('commerce.business-info:saved', 'New Name')
            : businessPage('commerce.business-info:current', 'Old Name')
        );
      }

      if (url.includes(businessLocalPath) && method === 'PATCH') {
        saveCompleted = true;
        return jsonResponse({ result: 'success' });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const { user } = renderWithProviders(
      <CommerceSettingDetail
        storeId={storeId}
        commercePath={businessPath}
        onCommercePathChange={() => {}}
        onLastAction={() => {}}
        onRefetchSurface={() => Promise.resolve(undefined)}
        baseDebugState={{}}
      />
    );

    const input: HTMLElement = await screen.findByLabelText(/Business name/);
    const saveButton: HTMLElement = screen.getByRole('button', { name: 'Save' });

    expect(input).toHaveValue('Old Name');
    expect(saveButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, '  New Name  ');
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    await waitFor(() => {
      expect(input).toHaveValue('New Name');
    });
    expect(saveButton).toBeDisabled();
    expect(pageRequestCount).toBe(3);

    const saveCall: Parameters<typeof fetch> | undefined = vi
      .mocked(fetch)
      .mock.calls.find(
        ([fetchInput, init]) =>
          String(fetchInput).includes(businessLocalPath) && init?.method === 'PATCH'
      );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
      values: { businessName: '  New Name  ' },
      changedFields: ['businessName'],
      revision: 'commerce.business-info:current',
    });
  });

  it('filters native slots that do not provide absolute http URLs', async () => {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url: string = String(input);
      const method: string = init?.method ?? 'GET';

      if (url.includes(nativeSlotsLocalPath) && method === 'GET') {
        return jsonResponse(nativeSlotsPage());
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = renderWithProviders(
      <CommerceSettingDetail
        storeId={storeId}
        commercePath={nativeSlotsPath}
        onCommercePathChange={() => {}}
        onLastAction={() => {}}
        onRefetchSurface={() => Promise.resolve(undefined)}
        baseDebugState={{}}
      />
    );

    expect(await screen.findByText('Valid native slot')).toBeInTheDocument();
    expect(screen.queryByText('Empty href')).not.toBeInTheDocument();
    expect(screen.queryByText('Relative href')).not.toBeInTheDocument();
    expect(screen.queryByText('Malformed href')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsafe href')).not.toBeInTheDocument();

    const nativeSlotButton: HTMLElement | undefined = screen
      .getAllByRole('button')
      .find((button) => button !== screen.getByRole('button', { name: 'Back' }));
    expect(nativeSlotButton).toBeDefined();
    await user.click(nativeSlotButton as HTMLElement);

    expect(openSpy).toHaveBeenCalled();
    expect(String(openSpy.mock.calls[openSpy.mock.calls.length - 1]?.[0])).toBe(
      `https://native.example.com/settings?source=commerce&storeId=${storeId}`
    );
    openSpy.mockRestore();
  });
});
