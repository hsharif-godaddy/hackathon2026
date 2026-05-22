import { describe, it, expect } from 'vitest';
import { buildAppContext } from '../types.js';

describe('buildAppContext', () => {
  const base = { appId: 'a', target: 'preview' as const };

  it('requires snapshotPath when contextSource is snapshot', () => {
    const ctx = buildAppContext(
      { ...base, snapshotPath: '/snap/job-1' },
      {
        contextSource: 'snapshot',
        projectContextText: 'files',
        filesIncluded: 2,
      }
    );
    if (ctx.contextSource === 'snapshot') {
      expect(ctx.snapshotPath).toBe('/snap/job-1');
    }
  });

  it('downgrades snapshot gather to none when snapshotPath is missing', () => {
    const ctx = buildAppContext(base, {
      contextSource: 'snapshot',
      projectContextText: 'files',
      filesIncluded: 1,
    });
    expect(ctx.contextSource).toBe('none');
    expect('snapshotPath' in ctx).toBe(false);
  });
});
