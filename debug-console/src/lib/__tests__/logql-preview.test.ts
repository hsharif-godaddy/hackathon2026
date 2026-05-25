import { describe, expect, it } from 'vitest';

import { renderLogQLPreview } from '@/lib/logql-preview';
import { MERGED_LOKI_SOURCE_ID } from '@/lib/loki-source-ids';

describe('logql-preview', () => {
  describe('renderLogQLPreview', () => {
    it('renders single-source query with service_name label, substring app id, and cluster placeholder while loading', () => {
      // cluster=undefined → loading; preview emits a placeholder so the user
      // knows the actual server query will scope to a cluster once resolved.
      const out = renderLogQLPreview({
        sourceId: 'airo-preview',
        env: 'prod',
        appId: 'abc123',
        cluster: undefined,
        levels: { error: true, warn: false },
        filterText: '',
      });

      expect(out).toContain('service_name="airo-preview-application"');
      expect(out).toContain('env="prod"');
      expect(out).toContain('cluster="<resolved>"');
      // App id uses bare substring match (matches the actual server query),
      // not the structured `"app_id":"<id>"` form which misses early lifecycle logs.
      expect(out).toContain('|= "abc123"');
      expect(out).toContain('|~ `"level":"(?i)error"`');
    });

    it('renders the actual cluster when caller resolves it', () => {
      const out = renderLogQLPreview({
        sourceId: 'airo-preview',
        env: 'prod',
        appId: 'abc123',
        cluster: 'c38',
        levels: { error: false, warn: false },
        filterText: '',
      });

      expect(out).toContain('cluster="c38"');
      expect(out).not.toContain('<resolved>');
    });

    it('omits the cluster label when caller has resolved it as null (e.g. PaaS app)', () => {
      // null → resolution returned no cluster (agent URL didn't match the
      // expected pattern). The actual server query also has no cluster
      // label in this case, so the preview must not show one.
      const out = renderLogQLPreview({
        sourceId: 'airo-preview',
        env: 'prod',
        appId: 'abc123',
        cluster: null,
        levels: { error: false, warn: false },
        filterText: '',
      });

      expect(out).not.toContain('cluster=');
      expect(out).not.toContain('<resolved>');
    });

    it('ORs per-level filters when both error and warn are checked', () => {
      const out = renderLogQLPreview({
        sourceId: 'airo-agents',
        env: 'prod',
        appId: '',
        cluster: null,
        levels: { error: true, warn: true },
        filterText: '',
      });

      expect(out).toContain('|~ `"level":"(?i)error"` or `"level":"(?i)warn"`');
    });

    it('renders merged-Loki sentinel as a service_name regex matcher', () => {
      const out = renderLogQLPreview({
        sourceId: MERGED_LOKI_SOURCE_ID,
        env: 'prod',
        appId: '',
        cluster: null,
        levels: { error: false, warn: false },
        filterText: '',
      });

      expect(out).toContain('service_name=~"(airo-agents|airo-preview-application|airo-publish-application|airo-pre-start|airo-db-init|airo-secrets-worker)"');
      // No app id → no cluster placeholder
      expect(out).not.toContain('cluster=');
    });

    it('appends free-text terms as separate substring filters', () => {
      const out = renderLogQLPreview({
        sourceId: 'airo-agents',
        env: 'dev',
        appId: '',
        cluster: null,
        levels: { error: false, warn: false },
        filterText: 'foo bar',
      });

      expect(out).toContain('|= "foo"');
      expect(out).toContain('|= "bar"');
    });
  });
});
