"use client";

import { Suspense, useEffect, useState } from "react";
import { RemoteComponent } from "react-dynamic-remote-component";
import Button from "@ux/button";
import RefreshIcon from "@ux/icon/refresh";
import Spinner from "@ux/spinner";

import ErrorBoundary from "@/components/ErrorBoundary";
import { useTranslations } from '@/hooks/useTranslations'
import { AuthDismissedError, authPreflight } from "@/lib/gasket-config";
import { logger } from "@/lib/request-context";
import {
  loadRemoteComponentConfig,
  ModuleConfig,
} from "@/utils/moduleFederation";

class AuthPreflightFailedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Auth preflight failed: ${status}`);
    this.name = 'AuthPreflightFailedError';
    this.status = status;
  }
}

class AuthPreflightNetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'AuthPreflightNetworkError';
  }
}

/**
 * Props for the RemoteModulePage component
 */
interface RemoteModulePageProps {
  /** Name of the module federation module to load (e.g., '@partners/backups-ui') */
  moduleName: string;
  /** Version of the module to load */
  version: number | string;
  /** Additional props to pass to the loaded remote component */
  componentProps?: Record<string, unknown>;
  /**
   * Auth level to validate before loading the remote module. Remote modules
   * that call level-3 (HBI) endpoints should pass 3 here so the SSO modal
   * can intercept the re-auth challenge instead of the remote module triggering
   * a full-page SSO redirect.
   */
  authLevel?: 1 | 2 | 3;
}

/**
 * Remote module page component
 *
 * Loads and renders a remote component using module federation. Fetches the module
 * configuration dynamically, handles loading and error states, and provides error
 * boundaries for graceful failure handling.
 *
 * @param props - Component props
 * @returns Rendered remote component with loading and error handling
 *
 * @example
 * ```tsx
 * <RemoteModulePage
 *   moduleName="@partners/backups-ui"
 *   version={1}
 *   componentProps={{
 *     accountId: "123",
 *     productType: "cpanel"
 *   }}
 * />
 * ```
 */
export default function RemoteModulePage({
  moduleName,
  version,
  componentProps = {},
  authLevel,
}: RemoteModulePageProps) {
  const t = useTranslations();
  const [moduleConfig, setModuleConfig] = useState<ModuleConfig | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [authDismissed, setAuthDismissed] = useState(false);
  // Incrementing this forces the effect to re-run without changing external props,
  // used by the "Sign in" button to re-attempt auth after the user dismissed the modal.
  const [retryCount, setRetryCount] = useState(0);

  useEffect(
    function loadConfig() {
      // Reset state when moduleName, version, authLevel, or retryCount changes
      setModuleConfig(null);
      setError(null);
      setAuthDismissed(false);

      let cancelled = false;

      async function run() {
        if (authLevel) {
          let preflightResult: Response | null;
          try {
            preflightResult = await authPreflight(authLevel);
          } catch (err) {
            if (err instanceof AuthDismissedError) throw err;
            throw new AuthPreflightNetworkError(err);
          }
          if (cancelled) return null;
          if (preflightResult) {
            throw new AuthPreflightFailedError(preflightResult.status);
          }
        }
        return loadRemoteComponentConfig(moduleName, version);
      }

      run()
        .then(function handleConfig(config) {
          if (config !== null) {
            logger.info("remote.module.config.load.success", {
              moduleName,
              version,
              authLevel,
            });
            if (!cancelled) setModuleConfig(config);
          }
        })
        .catch(function handleError(err) {
          if (err instanceof AuthDismissedError) {
            logger.info("remote.module.auth.dismissed", { moduleName, version, authLevel });
            if (!cancelled) setAuthDismissed(true);
            return;
          }
          if (err instanceof AuthPreflightNetworkError) {
            logger.error("remote.module.auth.preflight.network.failure", {
              moduleName,
              version,
              authLevel,
              error: err.message,
            });
          } else if (err instanceof AuthPreflightFailedError) {
            logger.error("remote.module.auth.preflight.failure", {
              moduleName,
              version,
              authLevel,
              status: err.status,
            });
          } else {
            logger.error("remote.module.config.load.failure", {
              moduleName,
              version,
              authLevel,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
        });

      // Cleanup function to prevent state updates after unmount or prop change.
      // Note: if authPreflight is pending when this runs, the SSO modal will remain
      // open until the user dismisses it or the 5-minute timeout fires. Closing it
      // here is unsafe because pendingSsoPromise (gasket-config.ts) is a module-level
      // singleton — closing the modal would abort any other in-flight auth flow that
      // opened it concurrently.
      return () => {
        cancelled = true;
      };
    },
    [moduleName, version, authLevel, retryCount],
  );

  if (authDismissed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">
            {t('builder_common_something_went_wrong')}
          </h3>
          <Button
            onClick={() => setRetryCount(c => c + 1)}
            text={t('builder_common_signin')}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">
            {t('builder_common_something_went_wrong')}
          </h3>
          <Button
            onClick={() => window.location.reload()}
            icon={<RefreshIcon />}
            text={t('builder_common_reload_page')}
          />
        </div>
      </div>
    );
  }

  if (!moduleConfig) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">
              {t('builder_common_something_went_wrong')}
            </h3>
            <Button
              onClick={() => window.location.reload()}
              icon={<RefreshIcon />}
              text={t('builder_common_reload_page')}
            />
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen">
            <Spinner />
          </div>
        }
      >
        <RemoteComponent
          url={moduleConfig.url}
          scope={moduleConfig.scope}
          module={moduleConfig.module}
          {...componentProps}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
