import { describe, expect, it, vi } from 'vitest';

import {
  isRunNumberFieldError,
  mapRunSummaryBuckets,
  searchRunSummaries,
} from '@/app/api/qa-results/run-summaries';

describe('qa-results run-summaries', function packageTests() {
  describe('#mapRunSummaryBuckets', function mapTests() {
    it('maps buckets and sorts newest run first', function sortNewest() {
      const rows = mapRunSummaryBuckets([
        {
          key: 100,
          max_ts: { value_as_string: '2026-05-10T12:00:00.000Z' },
          passed: { doc_count: 1 },
          failed: { doc_count: 0 },
          sample: {
            hits: {
              hits: [
                {
                  _source: {
                    environment: 'prod',
                    eventName: 'schedule',
                    triggerActor: 'ci-bot',
                    timestamp: '2026-05-10T12:00:00.000Z',
                  },
                },
              ],
            },
          },
        },
        {
          key: '99',
          passed: { doc_count: 0 },
          failed: { doc_count: 2 },
          sample: {
            hits: {
              hits: [
                {
                  _source: {
                    environment: 'test',
                    eventName: 'workflow_dispatch',
                    actor: 'mjain2',
                    timestamp: '2026-05-12T08:30:00.000Z',
                  },
                },
              ],
            },
          },
        },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows[0]?.runNumber).toBe('99');
      expect(rows[0]?.environment).toBe('test');
      expect(rows[0]?.triggerActor).toBe('mjain2');
      expect(rows[1]?.runNumber).toBe('100');
    });
  });

  describe('#isRunNumberFieldError', function fieldErrorTests() {
    it('detects elasticsearch field mapping failures', function mapping() {
      expect(
        isRunNumberFieldError({
          meta: {
            body: {
              error: {
                reason: 'Fielddata is disabled on text fields. Use runNumber.keyword',
              },
            },
          },
        }),
      ).toBe(true);
      expect(isRunNumberFieldError(new Error('connection reset'))).toBe(false);
    });
  });

  describe('#searchRunSummaries', function searchTests() {
    it('retries with runNumber when keyword field is missing', async function retryKeyword() {
      const search = vi
        .fn()
        .mockRejectedValueOnce({
          meta: { body: { error: { reason: 'No mapping found for [runNumber.keyword]' } } },
        })
        .mockResolvedValueOnce({
          aggregations: {
            runs: {
              buckets: [
                {
                  key: 42,
                  passed: { doc_count: 3 },
                  failed: { doc_count: 1 },
                  sample: {
                    hits: {
                      hits: [
                        {
                          _source: {
                            environment: 'prod',
                            timestamp: '2026-05-12T10:00:00.000Z',
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        });

      const rows = await searchRunSummaries({ search } as never, '2026-05-06T00:00:00.000Z', '2026-05-12T23:59:59.999Z');

      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[0]?.[0]?.body?.aggs?.runs?.terms?.field).toBe('runNumber.keyword');
      expect(search.mock.calls[0]?.[0]?.body?.aggs?.runs?.terms?.order).toEqual({ max_ts: 'desc' });
      expect(search.mock.calls[1]?.[0]?.body?.aggs?.runs?.terms?.field).toBe('runNumber');
      expect(search.mock.calls[1]?.[0]?.body?.aggs?.runs?.terms?.order).toEqual({ max_ts: 'desc' });
      expect(rows[0]?.runNumber).toBe('42');
    });
  });
});
