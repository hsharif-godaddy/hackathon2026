import React, { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from 'react-intl';

/**
 * Creates a new QueryClient instance for testing with default options
 *
 * @returns {QueryClient} Configured QueryClient instance for tests
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Render options for test utility
 */
interface TestRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
}

/**
 * Custom render function that wraps components with necessary providers
 * Includes QueryClient provider for testing components that use react-query
 *
 * @param {ReactElement} ui - The component to render
 * @param {TestRenderOptions} options - Optional render configuration
 * @returns Render result with user-event setup
 *
 * @example
 * const { user } = renderWithProviders(<MyComponent />);
 * await user.click(screen.getByRole('button'));
 */
export function renderWithProviders(
  ui: ReactElement,
  { queryClient, ...renderOptions }: TestRenderOptions = {}
) {
  const testQueryClient = queryClient ?? createTestQueryClient();

  return {
    user: userEvent.setup(),
    ...render(
      <IntlProvider locale="en" messages={{}}>
        <QueryClientProvider client={testQueryClient}>
          {ui}
        </QueryClientProvider>
      </IntlProvider>,
      renderOptions
    ),
  };
}

/**
 * Mock fetch responses for testing
 *
 * @param {Record<string, any>} data - Data to return from fetch
 * @param {Partial<Response>} init - Optional response configuration
 * @returns Mocked Response object
 *
 * @example
 * global.fetch = vi.fn(() => mockFetchResponse({ id: '123', name: 'Test' }));
 */
export function mockFetchResponse(
  data: unknown,
  init: Partial<Response> = {}
): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    blob: async () => new Blob([JSON.stringify(data)]),
    text: async () => JSON.stringify(data),
    ...init,
  } as Response);
}

/**
 * Mock fetch error responses for testing error states
 *
 * @param {number} status - HTTP status code
 * @param {string} statusText - Status text message
 * @returns Mocked error Response object
 *
 * @example
 * global.fetch = vi.fn(() => mockFetchError(404, 'Not Found'));
 */
export function mockFetchError(
  status: number,
  statusText: string
): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
    blob: async () => new Blob(),
    text: async () => statusText,
  } as Response);
}
