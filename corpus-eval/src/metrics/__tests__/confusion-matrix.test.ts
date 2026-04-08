import { describe, it, expect } from 'vitest';
import {
  buildConfusionMatrix,
  getMisclassifications,
  getPerClassAccuracy,
} from '../confusion-matrix.js';
import type { CaseResult, TaskType } from '../../corpus/types.js';

function createMockResult(expected: TaskType, actual: TaskType, prompt = 'test'): CaseResult {
  return {
    caseId: 'test-001',
    prompt,
    expected: {
      taskType: expected,
      path: 'any',
      minConfidence: 0,
    },
    actual: {
      taskType: actual,
      confidence: 80,
      path: 'embedding',
    },
    passed: expected === actual,
    failures: expected !== actual ? ['mismatch'] : [],
    pathWarnings: [],
    latencyMs: 100,
    tags: [],
  };
}

describe('buildConfusionMatrix', () => {
  it('returns matrix with all labels', () => {
    const cm = buildConfusionMatrix([]);
    expect(cm.labels).toEqual(['publish', 'domain', 'fix', 'general']);
    expect(cm.matrix.length).toBe(4);
    expect(cm.matrix[0].length).toBe(4);
  });

  it('counts correct classifications on diagonal', () => {
    const results = [
      createMockResult('publish', 'publish'),
      createMockResult('publish', 'publish'),
      createMockResult('domain', 'domain'),
    ];
    const cm = buildConfusionMatrix(results);
    // publish is index 0, domain is index 1
    expect(cm.matrix[0][0]).toBe(2); // publish -> publish
    expect(cm.matrix[1][1]).toBe(1); // domain -> domain
  });

  it('counts misclassifications off diagonal', () => {
    const results = [
      createMockResult('publish', 'domain'), // publish misclassified as domain
      createMockResult('fix', 'general'),    // fix misclassified as general
    ];
    const cm = buildConfusionMatrix(results);
    // publish=0, domain=1, fix=2, general=3
    expect(cm.matrix[0][1]).toBe(1); // publish -> domain
    expect(cm.matrix[2][3]).toBe(1); // fix -> general
  });
});

describe('getMisclassifications', () => {
  it('returns empty array when no misclassifications', () => {
    const results = [
      createMockResult('publish', 'publish'),
      createMockResult('domain', 'domain'),
    ];
    const misclass = getMisclassifications(results);
    expect(misclass).toEqual([]);
  });

  it('groups misclassifications by actual->predicted', () => {
    const results = [
      createMockResult('publish', 'domain', 'prompt 1'),
      createMockResult('publish', 'domain', 'prompt 2'),
      createMockResult('fix', 'general', 'prompt 3'),
    ];
    const misclass = getMisclassifications(results);
    expect(misclass.length).toBe(2);

    const publishToDomain = misclass.find(m => m.actual === 'publish' && m.predicted === 'domain');
    expect(publishToDomain?.count).toBe(2);
    expect(publishToDomain?.examples.length).toBe(2);
  });

  it('limits examples to 3', () => {
    const results = Array(5).fill(null).map((_, i) =>
      createMockResult('publish', 'domain', `prompt ${i}`)
    );
    const misclass = getMisclassifications(results);
    expect(misclass[0].count).toBe(5);
    expect(misclass[0].examples.length).toBe(3); // Only first 3
  });

  it('sorts by count descending', () => {
    const results = [
      createMockResult('publish', 'domain'),
      createMockResult('fix', 'general'),
      createMockResult('fix', 'general'),
      createMockResult('fix', 'general'),
    ];
    const misclass = getMisclassifications(results);
    expect(misclass[0].actual).toBe('fix'); // 3 misclassifications
    expect(misclass[1].actual).toBe('publish'); // 1 misclassification
  });
});

describe('getPerClassAccuracy', () => {
  it('calculates per-class accuracy from confusion matrix', () => {
    const results = [
      createMockResult('publish', 'publish'),
      createMockResult('publish', 'publish'),
      createMockResult('publish', 'domain'), // 2/3 = 66.7% for publish
      createMockResult('domain', 'domain'),  // 1/1 = 100% for domain
    ];
    const cm = buildConfusionMatrix(results);
    const accuracy = getPerClassAccuracy(cm);

    expect(accuracy.publish).toBeCloseTo(2/3);
    expect(accuracy.domain).toBe(1);
    expect(accuracy.fix).toBe(0); // No samples
    expect(accuracy.general).toBe(0); // No samples
  });
});
