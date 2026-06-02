import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../database/connection.js', () => ({
  getDatabase: vi.fn(function () { return {
    prepare: vi.fn(function () { return {
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(function () { return []; }),
    }; }),
    exec: vi.fn(),
  }; }),
}));

describe('planning adapter singletons', function singletonTests() {
  it('should return the same instance on repeated calls', async function identity() {
    const { getTodoListStore } = await import('../../index.js');
    expect(getTodoListStore()).toBe(getTodoListStore());
  });
});
