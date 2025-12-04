"use client";

import { Suspense, useState, useEffect } from "react";
import { RemoteComponent } from "react-dynamic-remote-component";
import {
  loadRemoteComponentConfig,
  ModuleConfig,
} from "@/utils/moduleFederation";
import { logger } from "@/lib/request-context";
import ErrorBoundary from "@/components/ErrorBoundary";
import RefreshIcon from "@ux/icon/refresh";
import Spinner from "@ux/spinner";
import Button from "@ux/button";

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
  const [moduleConfig, setModuleConfig] = useState<ModuleConfig | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(
    function loadConfig() {
      loadRemoteComponentConfig(moduleName, version)
        .then(function handleConfig(config) {
          setModuleConfig(config);
          logger.info("remote.module.config.load.success", {
            moduleName,
            version,
          });
        })
        .catch(function handleError(err) {
          logger.error("remote.module.config.load.failure", {
            moduleName,
            version,
            error: err.message,
          });
          setError(err);
        });
    },
    [moduleName, version],
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">
            Something went wrong. Please try again.
          </h3>
          <Button
            onClick={() => window.location.reload()}
            icon={<RefreshIcon />}
          >
            Reload Page
          </Button>
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
              Something went wrong. Please try again.
            </h3>
            <Button
              onClick={() => window.location.reload()}
              icon={<RefreshIcon />}
            >
              Reload Page
            </Button>
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
