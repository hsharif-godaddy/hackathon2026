import { describe, it, expect } from 'vitest';
import {
  mergeCorpora,
  filterByTags,
  filterSkipped,
  groupByTagPrefix,
} from '../loader.js';
import type { Corpus, TestCase } from '../types.js';

function createMockCorpus(name: string, cases: Partial<TestCase>[]): Corpus {
  return {
    metadata: {
      name,
      version: '1.0.0',
      agent: 'assessment-agent',
    },
    config: {
      defaultModel: 'haiku',
      timeoutMs: 5000,
      reuseAgent: true,
    },
    cases: cases.map((c, i) => ({
      id: c.id || `test-${i}`,
      prompt: c.prompt || `test prompt ${i}`,
      expectedTaskType: c.expectedTaskType || 'general',
      expectedPath: c.expectedPath || 'any',
      minConfidence: c.minConfidence || 0,
      tags: c.tags || [],
      skip: c.skip || false,
    })),
  };
}

describe('mergeCorpora', () => {
  it('throws error when no corpora provided', () => {
    expect(() => mergeCorpora([])).toThrow('No corpora to merge');
  });

  it('returns single corpus unchanged', () => {
    const corpus = createMockCorpus('Test', [{ id: 'case-1' }]);
    const merged = mergeCorpora([corpus]);
    expect(merged).toBe(corpus);
  });

  it('merges multiple corpora cases', () => {
    const corpus1 = createMockCorpus('Corpus1', [{ id: 'a-1' }, { id: 'a-2' }]);
    const corpus2 = createMockCorpus('Corpus2', [{ id: 'b-1' }]);
    const merged = mergeCorpora([corpus1, corpus2]);

    expect(merged.cases.length).toBe(3);
    expect(merged.cases.map(c => c.id)).toEqual(['a-1', 'a-2', 'b-1']);
  });

  it('creates merged name from all corpora', () => {
    const corpus1 = createMockCorpus('First', [{ id: 'a-1' }]);
    const corpus2 = createMockCorpus('Second', [{ id: 'b-1' }]);
    const merged = mergeCorpora([corpus1, corpus2]);

    expect(merged.metadata.name).toBe('Merged: First, Second');
  });

  it('throws error on duplicate IDs', () => {
    const corpus1 = createMockCorpus('Corpus1', [{ id: 'dup-id' }]);
    const corpus2 = createMockCorpus('Corpus2', [{ id: 'dup-id' }]);

    expect(() => mergeCorpora([corpus1, corpus2])).toThrow('Duplicate test case ID: dup-id');
  });

  it('throws error when corpora have different agents', () => {
    const corpus1 = createMockCorpus('Corpus1', [{ id: 'a-1' }]);
    const corpus2: Corpus = {
      ...createMockCorpus('Corpus2', [{ id: 'b-1' }]),
      metadata: { name: 'Corpus2', version: '1.0.0', agent: 'different-agent' },
    };

    expect(() => mergeCorpora([corpus1, corpus2])).toThrow(
      'Cannot merge corpora targeting different agents'
    );
  });
});

describe('filterByTags', () => {
  it('returns all cases when no tags specified', () => {
    const corpus = createMockCorpus('Test', [
      { id: 'a', tags: ['tag1'] },
      { id: 'b', tags: ['tag2'] },
    ]);
    const filtered = filterByTags(corpus, []);
    expect(filtered.cases.length).toBe(2);
  });

  it('filters to cases with matching tags', () => {
    const corpus = createMockCorpus('Test', [
      { id: 'a', tags: ['publish', 'en-us'] },
      { id: 'b', tags: ['domain', 'en-us'] },
      { id: 'c', tags: ['fix', 'es-es'] },
    ]);
    const filtered = filterByTags(corpus, ['publish']);
    expect(filtered.cases.length).toBe(1);
    expect(filtered.cases[0].id).toBe('a');
  });

  it('includes cases matching any of the tags', () => {
    const corpus = createMockCorpus('Test', [
      { id: 'a', tags: ['publish'] },
      { id: 'b', tags: ['domain'] },
      { id: 'c', tags: ['fix'] },
    ]);
    const filtered = filterByTags(corpus, ['publish', 'fix']);
    expect(filtered.cases.length).toBe(2);
    expect(filtered.cases.map(c => c.id)).toEqual(['a', 'c']);
  });
});

describe('filterSkipped', () => {
  it('filters out skipped cases', () => {
    const corpus = createMockCorpus('Test', [
      { id: 'a', skip: false },
      { id: 'b', skip: true },
      { id: 'c', skip: false },
    ]);
    const { corpus: filtered, skippedCount } = filterSkipped(corpus);
    expect(filtered.cases.length).toBe(2);
    expect(filtered.cases.map(c => c.id)).toEqual(['a', 'c']);
    expect(skippedCount).toBe(1);
  });

  it('returns correct count when no cases skipped', () => {
    const corpus = createMockCorpus('Test', [
      { id: 'a', skip: false },
      { id: 'b', skip: false },
    ]);
    const { corpus: filtered, skippedCount } = filterSkipped(corpus);
    expect(filtered.cases.length).toBe(2);
    expect(skippedCount).toBe(0);
  });
});

describe('groupByTagPrefix', () => {
  const cases: TestCase[] = [
    { id: 'a', prompt: 'test', expectedTaskType: 'general', expectedPath: 'any', minConfidence: 0, tags: ['lang:en', 'publish'], skip: false },
    { id: 'b', prompt: 'test', expectedTaskType: 'general', expectedPath: 'any', minConfidence: 0, tags: ['lang:en', 'domain'], skip: false },
    { id: 'c', prompt: 'test', expectedTaskType: 'general', expectedPath: 'any', minConfidence: 0, tags: ['lang:es', 'publish'], skip: false },
    { id: 'd', prompt: 'test', expectedTaskType: 'general', expectedPath: 'any', minConfidence: 0, tags: ['publish'], skip: false },
  ];

  it('groups cases by tag prefix', () => {
    const groups = groupByTagPrefix(cases, 'lang:');
    expect(Object.keys(groups)).toEqual(['lang:en', 'lang:es']);
    expect(groups['lang:en'].length).toBe(2);
    expect(groups['lang:es'].length).toBe(1);
  });

  it('returns empty object when no matching prefix', () => {
    const groups = groupByTagPrefix(cases, 'nonexistent:');
    expect(Object.keys(groups).length).toBe(0);
  });
});
