/**
 * Shared client-side log shapes. Defined here (rather than alongside
 * LogsPanel) so non-component modules — the fetch hook, the grouping
 * helper, tests — can depend on them without an indirect import through
 * a component file.
 */

export interface LogSource {
  id: string;
  name: string;
  description: string;
  kibanaUrl?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  appId?: string;
  logger?: string;
  service?: string;
  hostname?: string;
  environment?: string;
  region?: string;
  version?: string;
  sourceId?: string;
  data?: {
    message?: string;
    [key: string]: unknown;
  };
  raw: Record<string, unknown>;
}
