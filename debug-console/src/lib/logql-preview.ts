import { MERGED_LOKI_SOURCE_ID } from '@/lib/loki-source-ids';

/**
 * Render a preview of the LogQL the server would build from the current
 * Logs-tab filters. Pure (no fetches, no env reads) so the viewer can
 * show the query live as the user changes filters.
 *
 * Cluster is resolved server-side from the app id via the mgmt control
 * plane (see `resolveAppCluster`). When the caller has the resolved value
 * (e.g. via `useAppCluster`) it's emitted as `cluster="<id>"`; when it's
 * still loading or unresolved, a `<resolved>` placeholder is shown.
 */

export interface LogQLPreviewInput {
  /** Loki source id ('airo-agents' | 'airo-preview' | 'airo-publish' | merged sentinel). */
  sourceId: string;
  /** Configured environment, e.g. 'prod' or 'dev'. */
  env: string;
  /** App id to filter on, or empty for no app filter. */
  appId: string;
  /**
   * Resolved cluster id, or one of:
   *   - `undefined` → still resolving; preview emits `<resolved>` placeholder
   *   - `null` → resolved as no-cluster (e.g. agent URL didn't match the
   *     expected pattern); preview omits the cluster label entirely so it
   *     reflects the actual server query, which also has no cluster scope.
   *   - string → resolved cluster id; preview emits `cluster="<id>"`.
   */
  cluster: string | null | undefined;
  /** `error`/`warn` checkbox state. */
  levels: { error: boolean; warn: boolean };
  /** Free-text filter (whitespace-separated terms). */
  filterText: string;
}

const SOURCE_TO_SERVICE: Record<string, string> = {
  'airo-agents': 'airo-agents',
  'airo-preview': 'airo-preview-application',
  'airo-publish': 'airo-publish-application',
  'airo-pre-start': 'airo-pre-start',
  'airo-db-init': 'airo-db-init',
  'airo-secrets-worker': 'airo-secrets-worker',
};

const MERGED_SERVICES = [
  'airo-agents',
  'airo-preview-application',
  'airo-publish-application',
  'airo-pre-start',
  'airo-db-init',
  'airo-secrets-worker',
];

/** Mirror of loki-client.escapeLogQLString — duplicated to keep this client-safe. */
function escapeLogQLString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function renderLogQLPreview(input: LogQLPreviewInput): string {
  const labels: string[] = [];

  if (input.sourceId === MERGED_LOKI_SOURCE_ID) {
    labels.push(`service_name=~"(${MERGED_SERVICES.join('|')})"`);
  } else if (SOURCE_TO_SERVICE[input.sourceId]) {
    labels.push(`service_name="${SOURCE_TO_SERVICE[input.sourceId]}"`);
  }

  if (input.env) {
    labels.push(`env="${input.env}"`);
  }

  // Cluster is resolved server-side per app. The caller's tri-state lets us
  // mirror exactly what the server query will look like:
  //   - resolved id → emit `cluster="<id>"` (matches server)
  //   - resolved null → omit (server also drops the label when the URL
  //     pattern doesn't match — common for PaaS apps and custom domains)
  //   - undefined / no appId → emit `<resolved>` placeholder while loading
  //     (or no cluster at all without an appId)
  let clusterMarker = '';
  if (input.appId) {
    if (typeof input.cluster === 'string') {
      clusterMarker = `,cluster="${input.cluster}"`;
    } else if (input.cluster === undefined) {
      clusterMarker = `,cluster="<resolved>"`;
    }
    // input.cluster === null → resolved as no-cluster, omit the label.
  }

  const lineFilters: string[] = [];

  // App id: bare-substring match. The structured `"app_id":"<id>"` form misses
  // early-lifecycle lines that mention the id by subdomain/path before the
  // structured field is populated.
  //
  // App ids are alphanumeric in practice, but we escape into a double-quoted
  // string filter rather than a backtick raw-string so a stray backtick or
  // backslash in user input can't produce unparseable preview text.
  if (input.appId) {
    lineFilters.push(`|= "${escapeLogQLString(input.appId)}"`);
  }

  // Level: one regex per checked level, OR'd together using LogQL's `or`
  // line-filter syntax (matches Grafana's display format).
  const levelFilters: string[] = [];
  if (input.levels.error) levelFilters.push('`"level":"(?i)error"`');
  if (input.levels.warn) levelFilters.push('`"level":"(?i)warn"`');
  if (levelFilters.length > 0) {
    lineFilters.push(`|~ ${levelFilters.join(' or ')}`);
  }

  const terms = input.filterText.trim().split(/\s+/).filter(Boolean);
  for (const term of terms) {
    lineFilters.push(`|= "${escapeLogQLString(term)}"`);
  }

  const labelSelector = labels.length > 0 ? `{${labels.join(',')}${clusterMarker}}` : '{}';
  return [labelSelector, ...lineFilters].join(' ');
}
