import { describe, expect, it } from 'vitest';

import {
  ES_SOURCE_FIELD_MAPPINGS,
  buildElasticsearchRequestBody,
  isESSource,
  renderESQueryPreview,
} from '@/lib/es-query';

describe('es-query', () => {
  describe('isESSource', () => {
    it('recognizes the two ES log sources', () => {
      expect(isESSource('airo-app')).toBe(true);
      expect(isESSource('control_plane')).toBe(true);
    });

    it('rejects Loki sources', () => {
      expect(isESSource('airo-agents')).toBe(false);
      expect(isESSource('merged-loki')).toBe(false);
    });
  });

  describe('buildElasticsearchRequestBody', () => {
    it('emits match_all when no filters are active', () => {
      const body = buildElasticsearchRequestBody({
        fieldMapping: ES_SOURCE_FIELD_MAPPINGS['airo-app'],
        size: 50,
        from: 0,
      });

      expect(body).toMatchObject({
        size: 50,
        from: 0,
        sort: [{ '@timestamp': { order: 'desc' } }],
        query: { bool: { must: [{ match_all: {} }] } },
      });
    });

    it('builds level + appId clauses for control_plane', () => {
      const body = buildElasticsearchRequestBody({
        fieldMapping: ES_SOURCE_FIELD_MAPPINGS['control_plane'],
        size: 50,
        from: 0,
        levels: 'error',
        appId: 'abc123',
      });

      // Expect a `should` for the structured level keyword and an unstructured
      // fallback, plus an appId match clause.
      const must = (body.query as { bool: { must: unknown[] } }).bool.must;
      expect(Array.isArray(must)).toBe(true);
      const json = JSON.stringify(must);
      expect(json).toContain('log.level.keyword');
      expect(json).toContain('"ERROR"');
      expect(json).toContain('abc123');
    });
  });

  describe('renderESQueryPreview', () => {
    it('returns null for non-ES sources', () => {
      expect(
        renderESQueryPreview({ sourceId: 'airo-agents', appId: '', levels: { error: false, warn: false }, filterText: '' })
      ).toBeNull();
    });

    it('returns pretty-printed JSON for an ES source', () => {
      const out = renderESQueryPreview({
        sourceId: 'airo-app',
        appId: 'abc123',
        levels: { error: true, warn: true },
        filterText: 'database',
      });

      expect(out).not.toBeNull();
      // Multi-line JSON
      expect(out).toContain('\n  ');
      // Round-trip parse → object
      const parsed = JSON.parse(out!);
      expect(parsed.size).toBe(50);
      expect(parsed.from).toBe(0);
      expect(parsed.query.bool.must.length).toBeGreaterThan(0);
    });

    it('folds level keywords into multi_match query (matches what the panel actually sends)', () => {
      // The Logs panel concatenates levels into the `query` URL param, so the
      // server never builds the structured level boolean. The preview must
      // mirror that — emit a multi_match containing the level keywords, not
      // a `terms` clause on the level keyword field.
      const out = renderESQueryPreview({
        sourceId: 'airo-app',
        appId: '',
        levels: { error: true, warn: true },
        filterText: '',
      });

      const parsed = JSON.parse(out!);
      const must = parsed.query.bool.must as Array<Record<string, unknown>>;
      const json = JSON.stringify(must);
      expect(json).toContain('multi_match');
      expect(json).toContain('error warn');
      // No structured-level clause: no `terms` on the keyword field, no
      // match_phrase fallback.
      expect(json).not.toContain('"terms"');
      expect(json).not.toContain('match_phrase');
    });
  });
});
