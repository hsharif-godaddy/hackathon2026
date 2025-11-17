/**
 * Module Federation helper utilities
 */

import { getRootDomain } from './getRootDomain';

/**
 * Module configuration for remote component loading
 */
export interface ModuleConfig {
  /** URL to the remote entry file */
  url: string;
  /** Scope name for the module federation container */
  scope: string;
  /** Module path within the scope */
  module: string;
}

/**
 * BFF API response structure for module federation config
 */
interface BFFModuleResponse {
  /** Full URL to the module */
  moduleUrl: string;
  /** Metadata containing scope and expose information */
  metaData: {
    /** Module federation scope name */
    scope: string;
    /** Default exposed module path */
    defaultExpose: string;
  };
}

/**
 * Local storage override data structure
 */
interface LocalOverrideData {
  /** URL to the remote entry file */
  url: string;
  /** Scope name for the module federation container */
  scope: string;
  /** Module path within the scope */
  module: string;
}

/**
 * Fetch module federation configuration from BFF API
 *
 * Makes a request to the BFF API to retrieve module federation configuration
 * for the specified module and version. Supports local branch overrides via
 * localStorage for development purposes.
 *
 * @param moduleName - The name of the module (e.g., '@partners/ssl-repository-ui')
 * @param version - The version of the module
 * @returns Promise resolving to the fetch response
 *
 * @example
 * ```typescript
 * const response = await fetchComponentInfo('@partners/ssl-repository-ui', '1.0.0');
 * const data = await response.json();
 * ```
 */
export function fetchComponentInfo(moduleName: string, version: number | string): Promise<Response> {
  const topDomain = getRootDomain() || 'godaddy.com';
  const localBranchOverride = localStorage.getItem(`partners-mf-branch-config-${moduleName}`);

  const params = new URLSearchParams({
    moduleName,
    ...(version && { version: String(version) }),
    ...(localBranchOverride && { branch: localBranchOverride }),
  });

  return fetch(
    `https://bff.pcx.${topDomain}/api/module-federation/config?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        "accept": 'application/json',
      },
      credentials: 'include',
    }
  );
}

/**
 * Load remote component configuration
 *
 * Retrieves module federation configuration for a remote component. First checks
 * localStorage for a local override (useful for development), then falls back to
 * fetching from the BFF API if no override exists.
 *
 * @param moduleName - The name of the module (e.g., '@partners/ssl-repository-ui')
 * @param version - The version of the module
 * @returns Promise resolving to module configuration with URL, scope, and module path
 *
 * @example
 * ```typescript
 * const config = await loadRemoteComponentConfig('@partners/ssl-repository-ui', '1.0.0');
 * console.log(config.url, config.scope, config.module);
 * ```
 */
export async function loadRemoteComponentConfig(
  moduleName: string,
  version: number | string
): Promise<ModuleConfig> {
  const localOverride = localStorage.getItem(`partners-mf-config-${moduleName}`);

  if (localOverride) {
    const overrideData: LocalOverrideData = JSON.parse(localOverride);
    return {
      url: overrideData.url,
      scope: overrideData.scope,
      module: overrideData.module,
    };
  }

  const response = await fetchComponentInfo(moduleName, version);
  const data: BFFModuleResponse = await response.json();

  return {
    url: data.moduleUrl,
    scope: data.metaData.scope,
    module: data.metaData.defaultExpose,
  };
}

/**
 * Set local override for a module (for development/testing)
 *
 * Stores a local override configuration in localStorage that will be used
 * instead of fetching from the BFF API. Useful for local development and testing.
 *
 * @param moduleName - The name of the module to override
 * @param url - The URL to the remote entry file
 * @param scope - The scope name for the module federation container
 * @param module - The module path within the scope
 *
 * @example
 * ```typescript
 * setLocalOverride(
 *   '@partners/ssl-repository-ui',
 *   'http://localhost:3000/remoteEntry.js',
 *   'sslRepositoryUI',
 *   './Module'
 * );
 * ```
 */
export function setLocalOverride(
  moduleName: string,
  url: string,
  scope: string,
  module: string
): void {
  const override: LocalOverrideData = { url, scope, module };
  localStorage.setItem(`partners-mf-config-${moduleName}`, JSON.stringify(override));
}

/**
 * Clear local override for a module
 *
 * Removes the local override configuration from localStorage, causing the
 * module to fall back to fetching from the BFF API.
 *
 * @param moduleName - The name of the module to clear the override for
 *
 * @example
 * ```typescript
 * clearLocalOverride('@partners/ssl-repository-ui');
 * ```
 */
export function clearLocalOverride(moduleName: string): void {
  localStorage.removeItem(`partners-mf-config-${moduleName}`);
}

