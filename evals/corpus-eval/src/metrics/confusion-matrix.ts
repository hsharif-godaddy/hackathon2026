import type { CaseResult, ConfusionMatrix, TaskType } from '../corpus/types.js';

/**
 * Build a confusion matrix from case results
 */
export function buildConfusionMatrix(results: CaseResult[]): ConfusionMatrix {
  const labels: TaskType[] = ['publish', 'domain', 'fix', 'general'];
  const labelToIndex = new Map(labels.map((label, i) => [label, i]));

  // Initialize matrix with zeros
  const matrix: number[][] = labels.map(() => labels.map(() => 0));

  // Count actual vs predicted
  for (const result of results) {
    const actualIdx = labelToIndex.get(result.expected.taskType);
    const predictedIdx = labelToIndex.get(result.actual.taskType);

    if (actualIdx !== undefined && predictedIdx !== undefined) {
      matrix[actualIdx][predictedIdx]++;
    }
  }

  return { labels, matrix };
}

/**
 * Format confusion matrix as a string table
 */
export function formatConfusionMatrix(cm: ConfusionMatrix): string {
  const { labels, matrix } = cm;

  // Calculate column widths
  const headerWidth = Math.max(...labels.map(l => l.length), 8);
  const colWidth = Math.max(...matrix.flat().map(n => n.toString().length), headerWidth);

  const lines: string[] = [];

  // Header row
  const header = ['Actual\\Pred', ...labels.map(l => l.padStart(colWidth))].join(' | ');
  lines.push(header);
  lines.push('-'.repeat(header.length));

  // Data rows
  for (let i = 0; i < labels.length; i++) {
    const row = [
      labels[i].padEnd(headerWidth),
      ...matrix[i].map(n => n.toString().padStart(colWidth)),
    ].join(' | ');
    lines.push(row);
  }

  return lines.join('\n');
}

/**
 * Get misclassification pairs (actual -> predicted) with counts
 */
export function getMisclassifications(
  results: CaseResult[]
): Array<{ actual: TaskType; predicted: TaskType; count: number; examples: string[] }> {
  const misclassMap = new Map<string, { count: number; examples: string[] }>();

  for (const result of results) {
    if (result.actual.taskType !== result.expected.taskType) {
      const key = `${result.expected.taskType}->${result.actual.taskType}`;
      const entry = misclassMap.get(key) || { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) {
        entry.examples.push(result.prompt.substring(0, 50));
      }
      misclassMap.set(key, entry);
    }
  }

  const misclassifications: Array<{
    actual: TaskType;
    predicted: TaskType;
    count: number;
    examples: string[];
  }> = [];

  for (const [key, value] of misclassMap) {
    const [actual, predicted] = key.split('->') as [TaskType, TaskType];
    misclassifications.push({ actual, predicted, ...value });
  }

  // Sort by count descending
  return misclassifications.sort((a, b) => b.count - a.count);
}

/**
 * Calculate per-class accuracy from confusion matrix
 */
export function getPerClassAccuracy(cm: ConfusionMatrix): Record<TaskType, number> {
  const { labels, matrix } = cm;
  const accuracy: Record<string, number> = {};

  for (let i = 0; i < labels.length; i++) {
    const total = matrix[i].reduce((sum, n) => sum + n, 0);
    const correct = matrix[i][i];
    accuracy[labels[i]] = total > 0 ? correct / total : 0;
  }

  return accuracy as Record<TaskType, number>;
}
