"use client";

import { Suspense, useEffect, useState } from "react";
import { RemoteComponent } from "react-dynamic-remote-component";
import Button from "@ux/button";
import RefreshIcon from "@ux/icon/refresh";
import Spinner from "@ux/spinner";

import ErrorBoundary from "@/components/ErrorBoundary";
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from "@/lib/request-context";
import {
  loadRemoteComponentConfig,
  ModuleConfig,
} from "@/utils/moduleFederation";

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
}: RemoteModulePageProps) {
  const t = useTranslations();
  const [moduleConfig, setModuleConfig] = useState<ModuleConfig | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(
    function loadConfig() {
      // Reset state when moduleName or version changes to prevent stale data
      setModuleConfig(null);
      setError(null);

      let cancelled = false;

      loadRemoteComponentConfig(moduleName, version)
        .then(function handleConfig(config) {
          // Only update if not cancelled (component still mounted or same effect)
          if (!cancelled) {
            setModuleConfig(config);
            logger.info("remote.module.config.load.success", {
              moduleName,
              version,
            });
          }
        })
        .catch(function handleError(err) {
          // Only update if not cancelled
          if (!cancelled) {
            logger.error("remote.module.config.load.failure", {
              moduleName,
              version,
              error: err.message,
            });
            setError(err);
          }
        });

      // Cleanup function to prevent state updates after unmount or prop change
      return () => {
        cancelled = true;
      };
    },
    [moduleName, version],
  );

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
