import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above the imports - declare the bulk mock with
// vi.hoisted so the factory closure can reference it.
const { bulkMock } = vi.hoisted(() => ({ bulkMock: vi.fn() }));

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function () { return {
    bulk: bulkMock,
    indices: { exists: vi.fn(), create: vi.fn(), putMapping: vi.fn() },
  }; }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { bulkIndex } from '../es-client';

describe('es-client', () => {
  describe('bulkIndex', () => {
    beforeEach(() => {
      bulkMock.mockReset();
    });

    it('returns the result when ES reports no errors', async () => {
      bulkMock.mockResolvedValue({ errors: false, items: [] });

      const result = await bulkIndex([
        { index: 'idx', id: 'a', doc: { x: 1 } },
      ]);

      expect(result).toEqual({ errors: false, items: [] });
    });

    it('throws when ES reports partial bulk errors so the re-queue path in flushPendingDocs actually fires', async () => {
      // Without this throw, a partial-failure response (mapping conflict on
      // some docs, success on others) clears `pendingDocs` without re-queuing
      // the un-attempted sub-batches — silently dropping docs near the
      // watermark boundary. flushPendingDocs's catch block only fires on
      // throw, so this contract MUST stay in place.
      bulkMock.mockResolvedValue({
        errors: true,
        items: [
          { index: { _index: 'idx', _id: 'a', status: 201 } },
          {
            index: {
              _index: 'idx',
              _id: 'b',
              status: 400,
              error: {
                type: 'mapper_parsing_exception',
                reason: 'failed to parse field [foo]',
              },
            },
          },
        ],
      });

      await expect(
        bulkIndex([
          { index: 'idx', id: 'a', doc: { x: 1 } },
          { index: 'idx', id: 'b', doc: { foo: 'bad' } },
        ]),
      ).rejects.toThrow(/Bulk index reported 1 error.*failed to parse field/);
    });

    it('is a no-op when given an empty doc list', async () => {
      const result = await bulkIndex([]);
      expect(result).toBeUndefined();
      expect(bulkMock).not.toHaveBeenCalled();
    });
  });
});
