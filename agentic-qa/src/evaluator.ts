import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EvalResult, Report } from './scenarios/types.js';

export function generateReport(results: EvalResult[]): Report {
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalTokens = results.reduce(
    (sum, r) => sum + r.usage.inputTokens + r.usage.outputTokens + r.usage.reasoningTokens,
    0
  );

  return {
    timestamp: new Date().toISOString(),
    totalScenarios: results.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    totalTokens,
    totalDuration,
    results,
  };
}

export function formatReportSummary(report: Report): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════',
    '                    AGENTIC QA REPORT                          ',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Timestamp: ${report.timestamp}`,
    '',
    '───────────────────────────────────────────────────────────────',
    '                        SUMMARY                                ',
    '───────────────────────────────────────────────────────────────',
    '',
    `Total Scenarios: ${report.totalScenarios}`,
    `Passed: ${report.passed} ✓`,
    `Failed: ${report.failed} ✗`,
    `Pass Rate: ${((report.passed / report.totalScenarios) * 100).toFixed(1)}%`,
    '',
    `Total Duration: ${(report.totalDuration / 1000).toFixed(1)}s`,
    `Total Tokens: ${report.totalTokens.toLocaleString()}`,
    '',
    '───────────────────────────────────────────────────────────────',
    '                      SCENARIO RESULTS                         ',
    '───────────────────────────────────────────────────────────────',
    '',
  ];

  for (const result of report.results) {
    const status = result.success ? '✓ PASSED' : '✗ FAILED';
    const duration = (result.duration / 1000).toFixed(1);

    lines.push(`[${status}] ${result.scenario}`);
    lines.push(`  Duration: ${duration}s | Steps: ${result.steps} | Tokens: ${result.usage.inputTokens + result.usage.outputTokens}`);

    if (result.message) {
      lines.push(`  Message: ${result.message.substring(0, 100)}${result.message.length > 100 ? '...' : ''}`);
    }

    if (result.error) {
      lines.push(`  Error: ${result.error}`);
    }

    if (result.previewUrl) {
      lines.push(`  Preview: ${result.previewUrl}`);
    }

    if (result.screenshots.length > 0) {
      const previewShots = result.screenshots.filter(s => s.type === 'preview').length;
      lines.push(`  Screenshots: ${result.screenshots.length} captured (${previewShots} preview)`);
    }

    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

export async function saveReport(
  report: Report,
  outputDir: string,
  format: 'json' | 'html' | 'both' = 'both'
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });

  const timestamp = report.timestamp.replace(/[:.]/g, '-');
  const savedFiles: string[] = [];

  if (format === 'json' || format === 'both') {
    const jsonPath = join(outputDir, `report-${timestamp}.json`);
    await writeFile(jsonPath, JSON.stringify(report, null, 2));
    savedFiles.push(jsonPath);
    console.log(`Report saved: ${jsonPath}`);
  }

  if (format === 'html' || format === 'both') {
    const htmlPath = join(outputDir, `report-${timestamp}.html`);
    await writeFile(htmlPath, generateHTMLReport(report));
    savedFiles.push(htmlPath);
    console.log(`Report saved: ${htmlPath}`);
  }

  return savedFiles;
}

function generateHTMLReport(report: Report): string {
  const passRate = ((report.passed / report.totalScenarios) * 100).toFixed(1);

  const scenarioRows = report.results.map(result => {
    const statusClass = result.success ? 'passed' : 'failed';
    const statusText = result.success ? 'PASSED' : 'FAILED';
    const duration = (result.duration / 1000).toFixed(1);
    const tokens = result.usage.inputTokens + result.usage.outputTokens;

    const actionsList = result.actions.slice(0, 10).map(a =>
      `<li>${escapeHtml(a.type)}${a.action ? `: ${escapeHtml(a.action)}` : ''}</li>`
    ).join('');

    const screenshotsList = result.screenshots.map(s => {
      const label = `${s.type}${s.scrollPosition ? ` (${s.scrollPosition})` : ''}`;
      const filename = s.path.split('/').pop() || s.path;
      return `<li>
        <strong>${escapeHtml(label)}</strong>:
        <a href="file://${escapeHtml(s.path)}" target="_blank">${escapeHtml(filename)}</a>
        ${s.url ? `<br><small>URL: ${escapeHtml(s.url)}</small>` : ''}
      </li>`;
    }).join('');

    const screenshotImages = result.screenshots.map(s => {
      const label = `${s.type}${s.scrollPosition ? ` (${s.scrollPosition})` : ''}`;
      return `<div class="screenshot-item">
        <div class="screenshot-label">${escapeHtml(label)}</div>
        <img src="file://${escapeHtml(s.path)}" alt="${escapeHtml(label)}" />
        ${s.url ? `<div class="screenshot-url">${escapeHtml(s.url)}</div>` : ''}
      </div>`;
    }).join('');

    return `
      <div class="scenario ${statusClass}">
        <div class="scenario-header">
          <span class="status ${statusClass}">${statusText}</span>
          <span class="name">${escapeHtml(result.scenario)}</span>
        </div>
        <div class="scenario-details">
          <div class="metrics">
            <span>Duration: ${duration}s</span>
            <span>Steps: ${result.steps}</span>
            <span>Tokens: ${tokens}</span>
          </div>
          ${result.previewUrl ? `<p class="preview-url"><strong>Preview URL:</strong> <a href="${escapeHtml(result.previewUrl)}" target="_blank">${escapeHtml(result.previewUrl)}</a></p>` : ''}
          ${result.message ? `<p class="message">${escapeHtml(result.message)}</p>` : ''}
          ${result.error ? `<p class="error">Error: ${escapeHtml(result.error)}</p>` : ''}
          ${result.actions.length > 0 ? `
            <details>
              <summary>Actions (${result.actions.length})</summary>
              <ul>${actionsList}${result.actions.length > 10 ? `<li>... and ${result.actions.length - 10} more</li>` : ''}</ul>
            </details>
          ` : ''}
          ${result.screenshots.length > 0 ? `
            <details open>
              <summary>Screenshots (${result.screenshots.length})</summary>
              <div class="screenshots-grid">${screenshotImages}</div>
              <ul class="screenshot-links">${screenshotsList}</ul>
            </details>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agentic QA Report - ${report.timestamp}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat {
      background: white;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-value { font-size: 2em; font-weight: bold; }
    .stat-label { color: #666; font-size: 0.9em; }
    .stat.passed .stat-value { color: #28a745; }
    .stat.failed .stat-value { color: #dc3545; }
    .scenario {
      background: white;
      margin: 15px 0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .scenario-header {
      padding: 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .scenario.passed .scenario-header { border-left: 4px solid #28a745; }
    .scenario.failed .scenario-header { border-left: 4px solid #dc3545; }
    .status {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      font-weight: bold;
    }
    .status.passed { background: #d4edda; color: #155724; }
    .status.failed { background: #f8d7da; color: #721c24; }
    .name { font-weight: 600; }
    .scenario-details { padding: 0 15px 15px; }
    .metrics { display: flex; gap: 20px; color: #666; font-size: 0.9em; }
    .message { color: #333; margin: 10px 0; }
    .error { color: #dc3545; margin: 10px 0; }
    details { margin: 10px 0; }
    summary { cursor: pointer; color: #007bff; }
    ul { margin: 10px 0; padding-left: 20px; }
    li { margin: 5px 0; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .preview-url { margin: 10px 0; padding: 10px; background: #e7f3ff; border-radius: 4px; }
    .screenshots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 15px;
      margin: 15px 0;
    }
    .screenshot-item {
      border: 1px solid #ddd;
      border-radius: 8px;
      overflow: hidden;
      background: #fafafa;
    }
    .screenshot-item img {
      width: 100%;
      height: auto;
      display: block;
    }
    .screenshot-label {
      padding: 8px 12px;
      background: #333;
      color: white;
      font-weight: 600;
      font-size: 0.85em;
    }
    .screenshot-url {
      padding: 6px 12px;
      font-size: 0.75em;
      color: #666;
      background: #f0f0f0;
      word-break: break-all;
    }
    .screenshot-links { font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>Agentic QA Report</h1>
  <p>Generated: ${report.timestamp}</p>

  <div class="summary">
    <div class="stat">
      <div class="stat-value">${report.totalScenarios}</div>
      <div class="stat-label">Total Scenarios</div>
    </div>
    <div class="stat passed">
      <div class="stat-value">${report.passed}</div>
      <div class="stat-label">Passed</div>
    </div>
    <div class="stat failed">
      <div class="stat-value">${report.failed}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat">
      <div class="stat-value">${passRate}%</div>
      <div class="stat-label">Pass Rate</div>
    </div>
    <div class="stat">
      <div class="stat-value">${(report.totalDuration / 1000).toFixed(0)}s</div>
      <div class="stat-label">Total Duration</div>
    </div>
    <div class="stat">
      <div class="stat-value">${report.totalTokens.toLocaleString()}</div>
      <div class="stat-label">Total Tokens</div>
    </div>
  </div>

  <h2>Scenario Results</h2>
  ${scenarioRows}
</body>
</html>
  `.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
