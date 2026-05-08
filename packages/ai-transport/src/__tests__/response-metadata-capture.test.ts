import { describe, it, expect, vi } from 'vitest';
import { captureResponseMetadata, awaitResponseMetadata } from '../response-metadata-capture.js';

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('captureResponseMetadata', () => {
  it('invokes onResolved with metadata when the promise fulfills', async () => {
    const onResolved = vi.fn();
    captureResponseMetadata(
      Promise.resolve({ id: 'resp_1', modelId: 'claude', headers: { 'x-correlation-id': 'abc' } }),
      onResolved
    );
    await flush();
    expect(onResolved).toHaveBeenCalledWith({
      headers: { 'x-correlation-id': 'abc' },
      responseId: 'resp_1',
      modelId: 'claude',
    });
  });

  it('swallows rejection silently', async () => {
    const onResolved = vi.fn();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      captureResponseMetadata(Promise.reject(new Error('boom')), onResolved);
      await flush();
      await flush();
      expect(onResolved).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('is a no-op when responsePromise is undefined', () => {
    const onResolved = vi.fn();
    captureResponseMetadata(undefined, onResolved);
    expect(onResolved).not.toHaveBeenCalled();
  });
});

describe('awaitResponseMetadata', () => {
  it('returns metadata when the promise resolves', async () => {
    const meta = await awaitResponseMetadata(Promise.resolve({ id: 'r', modelId: 'm', headers: { a: 'b' } }));
    expect(meta).toEqual({ headers: { a: 'b' }, responseId: 'r', modelId: 'm' });
  });

  it('returns {} when the promise rejects', async () => {
    const meta = await awaitResponseMetadata(Promise.reject(new Error('x')));
    expect(meta).toEqual({});
  });

  it('returns {} on timeout', async () => {
    const neverResolves = new Promise<any>(() => {});
    const meta = await awaitResponseMetadata(neverResolves, 10);
    expect(meta).toEqual({});
  });

  it('returns {} when responsePromise is undefined', async () => {
    const meta = await awaitResponseMetadata(undefined);
    expect(meta).toEqual({});
  });
});
