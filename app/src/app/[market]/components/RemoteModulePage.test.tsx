/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import RemoteModulePage from './RemoteModulePage';

const mockModuleConfig = {
  url: 'https://example.com/module.js',
  scope: 'testScope',
  module: './TestModule',
};

vi.mock('@/utils/moduleFederation', () => ({
  loadRemoteComponentConfig: vi.fn(),
}));

vi.mock('react-dynamic-remote-component', () => ({
  RemoteComponent: ({ url, scope, module }: any) => (
    <div data-testid="remote-component">
      Remote Component: {url} - {scope} - {module}
    </div>
  ),
}));

vi.mock('@/components/ErrorBoundary', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Keep the real AuthDismissedError class so instanceof checks in the component
// work correctly. Only stub authPreflight for per-test control.
vi.mock('@/lib/gasket-config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/gasket-config')>();
  return { ...real, authPreflight: vi.fn() };
});

describe('RemoteModulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authLevel preflight', () => {
    it('should call authPreflight with the given level before loading config', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(authPreflight).mockResolvedValue(null);
      vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

      renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(authPreflight).toHaveBeenCalledWith(3);
        expect(loadRemoteComponentConfig).toHaveBeenCalled();
      });

      expect(vi.mocked(authPreflight).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(loadRemoteComponentConfig).mock.invocationCallOrder[0]
      );
    });

    it('should not call authPreflight when authLevel is not provided', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

      renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} />
      );

      await waitFor(() => {
        expect(loadRemoteComponentConfig).toHaveBeenCalled();
      });
      expect(authPreflight).not.toHaveBeenCalled();
    });

    it('should not call loadRemoteComponentConfig when component unmounts during preflight', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');

      let resolveAuthPreflight!: (value: null) => void;
      vi.mocked(authPreflight).mockReturnValue(
        new Promise(resolve => { resolveAuthPreflight = resolve; })
      );

      const { unmount } = renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      unmount();
      resolveAuthPreflight(null);

      await Promise.resolve();
      await Promise.resolve();
      expect(loadRemoteComponentConfig).not.toHaveBeenCalled();
    });

    it('should not update state when component unmounts while preflight rejects with AuthDismissedError', async () => {
      const { authPreflight, AuthDismissedError } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      const { logger } = await import('@/lib/request-context');

      let rejectAuthPreflight!: (err: unknown) => void;
      vi.mocked(authPreflight).mockReturnValue(
        new Promise((_, reject) => { rejectAuthPreflight = reject; })
      );

      const { unmount } = renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      unmount();
      rejectAuthPreflight(new AuthDismissedError());

      await waitFor(() =>
        expect(logger.info).toHaveBeenCalledWith('remote.module.auth.dismissed', expect.objectContaining({ moduleName: '@partners/test-ui', version: 1, authLevel: 3 }))
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(loadRemoteComponentConfig).not.toHaveBeenCalled();
    });

    it('should log error but skip setError when component unmounts while preflight rejects with a plain Error', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      const { logger } = await import('@/lib/request-context');

      let rejectAuthPreflight!: (err: unknown) => void;
      vi.mocked(authPreflight).mockReturnValue(
        new Promise((_, reject) => { rejectAuthPreflight = reject; })
      );

      const { unmount } = renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      unmount();
      rejectAuthPreflight(new Error('Network timeout'));

      await waitFor(() =>
        expect(logger.error).toHaveBeenCalledWith(
          'remote.module.auth.preflight.network.failure',
          expect.objectContaining({ moduleName: '@partners/test-ui', version: 1, authLevel: 3, error: 'Network timeout' })
        )
      );
      expect(loadRemoteComponentConfig).not.toHaveBeenCalled();
    });

    it('should show error state and log preflight failure when authPreflight returns non-ok response', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { logger } = await import('@/lib/request-context');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(authPreflight).mockResolvedValue(new Response(null, { status: 401 }));
      vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

      renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_something_went_wrong')).toBeInTheDocument();
        expect(screen.getByText('builder_common_reload_page')).toBeInTheDocument();
      });
      expect(loadRemoteComponentConfig).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('remote.module.auth.preflight.failure', expect.objectContaining({ status: 401, authLevel: 3 }));
    });

    it('should show sign-in UI and log info (not error) when auth is dismissed', async () => {
      const { authPreflight, AuthDismissedError } = await import('@/lib/gasket-config');
      const { logger } = await import('@/lib/request-context');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(authPreflight).mockRejectedValue(new AuthDismissedError());

      renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith('remote.module.auth.dismissed', expect.objectContaining({ moduleName: '@partners/test-ui', version: 1, authLevel: 3 }));
        expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
      });
      expect(screen.queryByText('builder_common_reload_page')).not.toBeInTheDocument();
      expect(logger.error).not.toHaveBeenCalled();
      expect(loadRemoteComponentConfig).not.toHaveBeenCalled();
    });

    it('should re-attempt auth when the sign-in button is clicked', async () => {
      const { authPreflight, AuthDismissedError } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(authPreflight)
        .mockRejectedValueOnce(new AuthDismissedError())
        .mockResolvedValueOnce(null);
      vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

      const { user } = renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_common_signin'));

      await waitFor(() => {
        expect(authPreflight).toHaveBeenCalledTimes(2);
        expect(authPreflight).toHaveBeenNthCalledWith(2, 3);
        expect(screen.getByTestId('remote-component')).toBeInTheDocument();
        expect(screen.queryByText('builder_common_signin')).not.toBeInTheDocument();
      });
    });

    it('should reset sign-in UI and re-attempt auth when authLevel prop changes', async () => {
      const { authPreflight, AuthDismissedError } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(authPreflight)
        .mockRejectedValueOnce(new AuthDismissedError())
        .mockResolvedValueOnce(null);
      vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

      const { rerender } = renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_signin')).toBeInTheDocument();
      });

      rerender(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={1} />
      );

      await waitFor(() => {
        expect(authPreflight).toHaveBeenNthCalledWith(2, 1);
        expect(screen.getByTestId('remote-component')).toBeInTheDocument();
      });
      expect(screen.queryByText('builder_common_signin')).not.toBeInTheDocument();
    });

    it('should show error state and log network failure when authPreflight throws a generic error', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { logger } = await import('@/lib/request-context');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      vi.mocked(authPreflight).mockRejectedValue(new Error('Network timeout'));

      renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_something_went_wrong')).toBeInTheDocument();
        expect(screen.getByText('builder_common_reload_page')).toBeInTheDocument();
      });
      expect(loadRemoteComponentConfig).not.toHaveBeenCalled();
      expect(screen.queryByText('builder_common_signin')).not.toBeInTheDocument();
      expect(logger.error).toHaveBeenCalledWith(
        'remote.module.auth.preflight.network.failure',
        expect.objectContaining({ error: 'Network timeout', authLevel: 3 })
      );
    });

    it('should show error state when preflight succeeds but config loading fails', async () => {
      const { authPreflight } = await import('@/lib/gasket-config');
      const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
      const { logger } = await import('@/lib/request-context');
      vi.mocked(authPreflight).mockResolvedValue(null);
      vi.mocked(loadRemoteComponentConfig).mockRejectedValue(new Error('CDN unavailable'));

      renderWithProviders(
        <RemoteModulePage moduleName="@partners/test-ui" version={1} authLevel={3} />
      );

      await waitFor(() => {
        expect(screen.getByText('builder_common_something_went_wrong')).toBeInTheDocument();
      });
      expect(logger.error).toHaveBeenCalledWith('remote.module.config.load.failure', expect.objectContaining({ error: 'CDN unavailable', authLevel: 3 }));
    });
  });

  it('should render loading spinner initially', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockImplementation(
      function () { return new Promise(() => {}); } // Never resolves
    );

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('should load and render remote component', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('remote-component')).toBeInTheDocument();
    });
  });

  it('should pass component props to remote component', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

    const componentProps = {
      accountId: '123',
      productType: 'cpanel',
    };

    renderWithProviders(
      <RemoteModulePage
        moduleName="@partners/test-ui"
        version={1}
        componentProps={componentProps}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('remote-component')).toBeInTheDocument();
    });
  });

  it('should display error state when config loading fails', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockRejectedValue(
      new Error('Failed to load config')
    );

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(screen.getByText('builder_common_something_went_wrong')).toBeInTheDocument();
    });
  });

  it('should render reload button in error state', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockRejectedValue(
      new Error('Failed to load config')
    );

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(screen.getByText('builder_common_reload_page')).toBeInTheDocument();
    });
  });

  it('should call loadRemoteComponentConfig with correct params', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={2} />
    );

    await waitFor(() => {
      expect(loadRemoteComponentConfig).toHaveBeenCalledWith('@partners/test-ui', 2);
    });
  });

  it('should log success when config loads', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    const { logger } = await import('@/lib/request-context');
    vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith('remote.module.config.load.success', {
        moduleName: '@partners/test-ui',
        version: 1,
        authLevel: undefined,
      });
    });
  });

  it('should log error when config loading fails', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    const { logger } = await import('@/lib/request-context');
    const error = new Error('Failed to load config');
    vi.mocked(loadRemoteComponentConfig).mockRejectedValue(error);

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('remote.module.config.load.failure', {
        moduleName: '@partners/test-ui',
        version: 1,
        authLevel: undefined,
        error: error.message,
      });
    });
  });

  it('should handle version as string', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version="1.0.0" />
    );

    await waitFor(() => {
      expect(loadRemoteComponentConfig).toHaveBeenCalledWith('@partners/test-ui', '1.0.0');
    });
  });

  it('should handle empty component props', async () => {
    const { loadRemoteComponentConfig } = await import('@/utils/moduleFederation');
    vi.mocked(loadRemoteComponentConfig).mockResolvedValue(mockModuleConfig);

    renderWithProviders(
      <RemoteModulePage moduleName="@partners/test-ui" version={1} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('remote-component')).toBeInTheDocument();
    });
  });
});
