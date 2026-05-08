import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalReport, TaskType } from './corpus/types.js';
import { formatConfusionMatrix } from './metrics/index.js';

/**
 * Save JSON report to file
 */
export async function saveReport(report: EvalReport, outputDir: string): Promise<string> {
  const timestamp = report.metadata.timestamp.replace(/[:.]/g, '-');
  const filename = `eval-report-${timestamp}.json`;
  const filepath = join(outputDir, filename);

  await writeFile(filepath, JSON.stringify(report, null, 2));
  return filepath;
}

/**
 * Save HTML report to file
 */
export async function saveHTMLReport(report: EvalReport, outputDir: string): Promise<string> {
  const timestamp = report.metadata.timestamp.replace(/[:.]/g, '-');
  const filename = `eval-report-${timestamp}.html`;
  const filepath = join(outputDir, filename);

  const html = generateHTMLReport(report);
  await writeFile(filepath, html);
  return filepath;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate HTML report
 */
function generateHTMLReport(report: EvalReport): string {
  const { summary, metrics, latency, confusionMatrix } = report;

  // Generate confusion matrix HTML
  const cmHtml = generateConfusionMatrixHTML(confusionMatrix);

  // Generate per-category metrics
  const categoryRows = Object.entries(metrics.byTaskType)
    .map(([taskType, m]) => `
      <tr>
        <td>${escapeHtml(taskType)}</td>
        <td>${(m.accuracy * 100).toFixed(1)}%</td>
        <td>${(m.precision * 100).toFixed(1)}%</td>
        <td>${(m.recall * 100).toFixed(1)}%</td>
        <td>${(m.f1 * 100).toFixed(1)}%</td>
        <td>${m.correct}/${m.total}</td>
      </tr>
    `)
    .join('');

  // Generate failures list
  const failuresHtml = report.failures.slice(0, 20).map(f => `
    <div class="failure">
      <div class="failure-header">
        <span class="case-id">${escapeHtml(f.caseId)}</span>
        <span class="expected">Expected: ${escapeHtml(f.expected)}</span>
        <span class="actual">Got: ${escapeHtml(f.actual)}</span>
      </div>
      <div class="prompt">${escapeHtml(f.prompt)}</div>
      <ul class="failure-reasons">
        ${f.failures.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}
      </ul>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Corpus Evaluation Report - ${escapeHtml(report.metadata.corpusName)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    h1 { color: #1a1a1a; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    h2 { color: #333; margin-top: 30px; }
    .metadata {
      background: #fff;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .metadata p { margin: 5px 0; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat {
      background: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-value {
      font-size: 2.5em;
      font-weight: bold;
      color: #007bff;
    }
    .stat-value.success { color: #28a745; }
    .stat-value.failure { color: #dc3545; }
    .stat-label { color: #666; font-size: 0.9em; margin-top: 5px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    th, td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f8f9fa; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    .confusion-matrix {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow-x: auto;
    }
    .confusion-matrix table { margin: 0; }
    .confusion-matrix th { background: #e9ecef; }
    .confusion-matrix td { text-align: center; }
    .cm-diagonal { background: #d4edda !important; font-weight: bold; }
    .cm-error { background: #f8d7da !important; }
    .failures-section {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .failure {
      border: 1px solid #f5c6cb;
      border-radius: 6px;
      padding: 15px;
      margin-bottom: 15px;
      background: #fff5f5;
    }
    .failure-header {
      display: flex;
      gap: 15px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .case-id { font-weight: bold; }
    .expected { color: #28a745; }
    .actual { color: #dc3545; }
    .prompt {
      font-family: monospace;
      background: #f8f9fa;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 10px;
      word-break: break-word;
    }
    .failure-reasons {
      margin: 0;
      padding-left: 20px;
      color: #721c24;
    }
    .path-distribution {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .path-bar {
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      border-radius: 4px;
    }
    .path-embedding { background: #28a745; }
    .path-embedding-timeout-fallback { background: #fd7e14; }
    .path-haiku { background: #007bff; }
    .path-timeout { background: #ffc107; color: #333; }
    .path-error { background: #dc3545; }
    .path-warnings-note {
      color: #856404;
      background: #fff3cd;
      padding: 10px 15px;
      border-radius: 6px;
      margin-bottom: 15px;
    }
    .path-warnings-section {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .path-warning {
      border: 1px solid #ffeeba;
      border-radius: 6px;
      padding: 15px;
      margin-bottom: 15px;
      background: #fffef5;
    }
    .warning-header {
      display: flex;
      gap: 15px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .expected-path { color: #28a745; }
    .actual-path { color: #856404; }
  </style>
</head>
<body>
  <h1>Corpus Evaluation Report</h1>

  <div class="metadata">
    <p><strong>Corpus:</strong> ${escapeHtml(report.metadata.corpusName)}</p>
    <p><strong>Model:</strong> ${escapeHtml(report.metadata.modelUsed)}</p>
    <p><strong>Timestamp:</strong> ${escapeHtml(report.metadata.timestamp)}</p>
    <p><strong>Duration:</strong> ${(report.metadata.duration / 1000).toFixed(1)}s</p>
  </div>

  <h2>Summary</h2>
  <div class="summary-grid">
    <div class="stat">
      <div class="stat-value">${summary.total}</div>
      <div class="stat-label">Total Cases</div>
    </div>
    <div class="stat">
      <div class="stat-value success">${summary.passed}</div>
      <div class="stat-label">Passed</div>
    </div>
    <div class="stat">
      <div class="stat-value failure">${summary.failed}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat">
      <div class="stat-value">${(summary.accuracy * 100).toFixed(1)}%</div>
      <div class="stat-label">Accuracy</div>
    </div>
    <div class="stat">
      <div class="stat-value">${(metrics.overall.f1 * 100).toFixed(1)}%</div>
      <div class="stat-label">F1 Score</div>
    </div>
    <div class="stat">
      <div class="stat-value">${latency.avg}ms</div>
      <div class="stat-label">Avg Latency</div>
    </div>
  </div>

  <h2>Path Efficiency</h2>
  <div class="path-distribution">
    ${summary.embeddingPathRatio > 0 ? `<div class="path-bar path-embedding" style="flex: ${summary.embeddingPathRatio}">Embedding ${(summary.embeddingPathRatio * 100).toFixed(0)}%</div>` : ''}
    ${summary.embeddingTimeoutFallbackPathRatio > 0 ? `<div class="path-bar path-embedding-timeout-fallback" style="flex: ${summary.embeddingTimeoutFallbackPathRatio}">Embed Timeout Fallback ${(summary.embeddingTimeoutFallbackPathRatio * 100).toFixed(0)}%</div>` : ''}
    ${summary.haikuPathRatio > 0 ? `<div class="path-bar path-haiku" style="flex: ${summary.haikuPathRatio}">Haiku ${(summary.haikuPathRatio * 100).toFixed(0)}%</div>` : ''}
  </div>
  ${summary.pathMismatches > 0 ? `<p style="margin-top: 10px; color: #856404;"><strong>${summary.pathMismatches}</strong> cases took an unexpected path (see Path Warnings below)</p>` : ''}

  ${report.classifierAb && report.classifierAb.casesWithShadow > 0 ? `
  <h2>LR vs embedding (NN) shadow</h2>
  <table>
    <thead>
      <tr><th>Metric</th><th>Value</th></tr>
    </thead>
    <tbody>
      <tr><td>Cases with shadow</td><td>${report.classifierAb.casesWithShadow}</td></tr>
      <tr><td>LR / NN agree</td><td>${(report.classifierAb.agreeRatio * 100).toFixed(1)}% (${report.classifierAb.agreeCount})</td></tr>
      <tr><td>LR / NN disagree</td><td>${(report.classifierAb.disagreeRatio * 100).toFixed(1)}% (${report.classifierAb.disagreeCount})</td></tr>
      <tr><td>LR matches gold, NN does not</td><td>${(report.classifierAb.lrMatchesGoldNnWrongRatio * 100).toFixed(1)}% (${report.classifierAb.lrMatchesGoldNnWrongCount})</td></tr>
      <tr><td>NN wanted Haiku, LR confident → fast path + LR gold</td><td>${report.classifierAb.nnHaikuLrConfidentSetupCount > 0 ? `${(report.classifierAb.nnHaikuLrConfidentFastPathGoldRatio * 100).toFixed(1)}% (${report.classifierAb.nnHaikuLrConfidentFastPathGoldCount} / ${report.classifierAb.nnHaikuLrConfidentSetupCount})` : 'n/a (0 setups)'}</td></tr>
    </tbody>
  </table>
  ` : ''}

  <h2>Per-Category Metrics</h2>
  <table>
    <thead>
      <tr>
        <th>Category</th>
        <th>Accuracy</th>
        <th>Precision</th>
        <th>Recall</th>
        <th>F1</th>
        <th>Correct/Total</th>
      </tr>
    </thead>
    <tbody>
      ${categoryRows}
    </tbody>
  </table>

  <h2>Confusion Matrix</h2>
  <div class="confusion-matrix">
    ${cmHtml}
  </div>

  <h2>Latency Statistics</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Value</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Average</td><td>${latency.avg}ms</td></tr>
      <tr><td>Median (P50)</td><td>${latency.p50}ms</td></tr>
      <tr><td>P95</td><td>${latency.p95}ms</td></tr>
      <tr><td>Min</td><td>${latency.min}ms</td></tr>
      <tr><td>Max</td><td>${latency.max}ms</td></tr>
    </tbody>
  </table>

  ${report.failures.length > 0 ? `
  <h2>Classification Failures (${report.failures.length})</h2>
  <div class="failures-section">
    ${failuresHtml}
    ${report.failures.length > 20 ? `<p>... and ${report.failures.length - 20} more failures</p>` : ''}
  </div>
  ` : ''}

  ${report.pathWarnings.length > 0 ? `
  <h2>Path Warnings (${report.pathWarnings.length})</h2>
  <p class="path-warnings-note">These cases classified correctly but took a different path than expected. Not counted as failures.</p>
  <div class="path-warnings-section">
    ${report.pathWarnings.slice(0, 20).map(w => `
      <div class="path-warning">
        <div class="warning-header">
          <span class="case-id">${escapeHtml(w.caseId)}</span>
          <span class="expected-path">Expected: ${escapeHtml(w.expectedPath)}</span>
          <span class="actual-path">Got: ${escapeHtml(w.actualPath)}</span>
        </div>
        <div class="prompt">${escapeHtml(w.prompt)}</div>
      </div>
    `).join('')}
    ${report.pathWarnings.length > 20 ? `<p>... and ${report.pathWarnings.length - 20} more path warnings</p>` : ''}
  </div>
  ` : ''}
</body>
</html>`;
}

/**
 * Generate confusion matrix HTML table
 */
function generateConfusionMatrixHTML(cm: { labels: TaskType[]; matrix: number[][] }): string {
  const { labels, matrix } = cm;

  const headerCells = labels.map(l => `<th>${escapeHtml(l)}</th>`).join('');

  const rows = labels.map((label, i) => {
    const cells = matrix[i].map((count, j) => {
      const isDiagonal = i === j;
      const isError = !isDiagonal && count > 0;
      const className = isDiagonal ? 'cm-diagonal' : isError ? 'cm-error' : '';
      return `<td class="${className}">${count}</td>`;
    }).join('');
    return `<tr><th>${escapeHtml(label)}</th>${cells}</tr>`;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>Actual \\ Predicted</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}
