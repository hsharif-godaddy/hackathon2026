import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QualityEvaluation } from './quality/types.js';
import type { EvalResult, Report } from './scenarios/types.js';

export function generateReport(results: EvalResult[]): Report {
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalTokens = results.reduce(
    (sum, r) => sum + r.usage.inputTokens + r.usage.outputTokens + r.usage.reasoningTokens,
    0
  );
  const totalAppCostUSD = results.reduce(
    (sum, r) => sum + (r.appCostUSD ?? 0),
    0
  );

  return {
    timestamp: new Date().toISOString(),
    totalScenarios: results.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    totalTokens,
    totalDuration,
    totalAppCostUSD,
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
    ...(report.totalAppCostUSD > 0 ? [`Total App Cost: $${report.totalAppCostUSD.toFixed(4)}`] : []),
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

    if (result.appCostUSD !== undefined) {
      const budgetStr = result.tokenBudgetUSD ? ` / $${result.tokenBudgetUSD}` : '';
      const msgsStr = result.chatMessagesCompleted !== undefined ? ` | Messages: ${result.chatMessagesCompleted}` : '';
      lines.push(`  App Cost: $${result.appCostUSD.toFixed(4)}${budgetStr}${msgsStr}`);
    }

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

    // Quality evaluation results
    if (result.qualityStatus === 'failed') {
      lines.push(`  Quality: FAILED - ${result.qualityError || 'Unknown error'}`);
    } else if (result.qualityStatus === 'skipped') {
      lines.push('  Quality: SKIPPED');
    } else if (result.quality) {
      lines.push(`  Quality: ${result.quality.overall.score}/100 (Grade: ${result.quality.overall.grade})`);
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

  // Calculate average quality score if any results have quality evaluation
  const qualityResults = report.results.filter(r => r.quality);
  const avgQualityScore = qualityResults.length > 0
    ? Math.round(qualityResults.reduce((sum, r) => sum + (r.quality?.overall.score || 0), 0) / qualityResults.length)
    : null;

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

    // Generate quality dashboard or status indicator
    const qualitySection = result.quality
      ? generateQualitySection(result.quality)
      : result.qualityStatus === 'failed'
        ? `<div class="quality-status quality-failed">Quality evaluation failed: ${escapeHtml(result.qualityError || 'Unknown error')}</div>`
        : result.qualityStatus === 'skipped'
          ? '<div class="quality-status quality-skipped">Quality evaluation skipped</div>'
          : '';

    const qualityBadge = result.quality
      ? `<span class="quality-badge grade-${result.quality.overall.grade}">${result.quality.overall.grade} (${result.quality.overall.score})</span>`
      : result.qualityStatus === 'failed'
        ? '<span class="quality-badge quality-status-failed">FAILED</span>'
        : result.qualityStatus === 'skipped'
          ? '<span class="quality-badge quality-status-skipped">SKIPPED</span>'
          : '';

    return `
      <div class="scenario ${statusClass}">
        <div class="scenario-header">
          <span class="status ${statusClass}">${statusText}</span>
          <span class="name">${escapeHtml(result.scenario)}</span>
          ${qualityBadge}
        </div>
        <div class="scenario-details">
          <div class="metrics">
            <span>Duration: ${duration}s</span>
            <span>Steps: ${result.steps}</span>
            <span>Tokens: ${tokens}</span>
            ${result.appCostUSD !== undefined ? `<span>App Cost: $${result.appCostUSD.toFixed(4)}${result.tokenBudgetUSD ? ` / $${result.tokenBudgetUSD}` : ''}</span>` : ''}
            ${result.chatMessagesCompleted !== undefined ? `<span>Messages: ${result.chatMessagesCompleted}</span>` : ''}
          </div>
          ${result.previewUrl ? `<p class="preview-url"><strong>Preview URL:</strong> <a href="${escapeHtml(result.previewUrl)}" target="_blank">${escapeHtml(result.previewUrl)}</a></p>` : ''}
          ${result.message ? `<p class="message">${escapeHtml(result.message)}</p>` : ''}
          ${result.error ? `<p class="error">Error: ${escapeHtml(result.error)}</p>` : ''}
          ${qualitySection}
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

    /* Quality evaluation styles */
    .quality-badge {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: bold;
      margin-left: auto;
    }
    .grade-A { background: #d4edda; color: #155724; }
    .grade-B { background: #cce5ff; color: #004085; }
    .grade-C { background: #fff3cd; color: #856404; }
    .grade-D { background: #f8d7da; color: #721c24; }
    .grade-F { background: #dc3545; color: white; }
    .quality-status-failed { background: #f8d7da; color: #721c24; }
    .quality-status-skipped { background: #e2e3e5; color: #383d41; }
    .quality-status {
      margin: 10px 0;
      padding: 10px 15px;
      border-radius: 6px;
      font-size: 0.9em;
    }
    .quality-failed { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    .quality-skipped { background: #e2e3e5; color: #383d41; border: 1px solid #d6d8db; }

    .quality-dashboard {
      margin: 15px 0;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      border: 1px solid #e9ecef;
    }
    .quality-header {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 15px;
    }
    .quality-grade {
      width: 60px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-size: 1.5em;
      font-weight: bold;
    }
    .quality-score-text {
      font-size: 1.2em;
      font-weight: 600;
    }
    .quality-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
      margin: 15px 0;
    }
    .quality-metric {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .quality-metric-label {
      font-size: 0.75em;
      color: #666;
      text-transform: uppercase;
    }
    .quality-metric-bar {
      height: 8px;
      background: #e9ecef;
      border-radius: 4px;
      overflow: hidden;
    }
    .quality-metric-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .quality-metric-fill.good { background: #28a745; }
    .quality-metric-fill.moderate { background: #ffc107; }
    .quality-metric-fill.poor { background: #dc3545; }
    .quality-metric-value {
      font-size: 0.85em;
      font-weight: 600;
    }
    .quality-issues {
      margin-top: 15px;
    }
    .quality-issues h4 {
      margin: 0 0 8px 0;
      font-size: 0.9em;
      color: #dc3545;
    }
    .quality-issues ul {
      margin: 0;
      padding-left: 20px;
      font-size: 0.85em;
    }
    .quality-recommendations {
      margin-top: 15px;
    }
    .quality-recommendations h4 {
      margin: 0 0 8px 0;
      font-size: 0.9em;
      color: #007bff;
    }
    .quality-recommendations ul {
      margin: 0;
      padding-left: 20px;
      font-size: 0.85em;
    }
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
    ${report.totalAppCostUSD > 0 ? `
    <div class="stat">
      <div class="stat-value">$${report.totalAppCostUSD.toFixed(4)}</div>
      <div class="stat-label">Total App Cost</div>
    </div>
    ` : ''}
    ${avgQualityScore !== null ? `
    <div class="stat">
      <div class="stat-value">${avgQualityScore}</div>
      <div class="stat-label">Avg Quality Score</div>
    </div>
    ` : ''}
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

/**
 * Generate quality dashboard HTML section
 */
function generateQualitySection(quality: QualityEvaluation): string {
  const gradeClass = `grade-${quality.overall.grade}`;

  const renderMetricBar = (label: string, score: number | undefined): string => {
    if (score === undefined) return '';
    const fillClass = score >= 80 ? 'good' : score >= 60 ? 'moderate' : 'poor';
    return `
      <div class="quality-metric">
        <span class="quality-metric-label">${escapeHtml(label)}</span>
        <div class="quality-metric-bar">
          <div class="quality-metric-fill ${fillClass}" style="width: ${score}%"></div>
        </div>
        <span class="quality-metric-value">${score}/100</span>
      </div>
    `;
  };

  const metrics = [
    { label: 'Performance', score: quality.performance?.score },
    { label: 'Accessibility', score: quality.accessibility?.score },
    { label: 'SEO', score: quality.seo?.score },
    { label: 'Functional', score: quality.functional?.score },
    { label: 'Visual', score: quality.visual?.score },
    { label: 'Content', score: quality.content?.score },
    { label: 'Security', score: quality.security?.score },
    { label: 'Usability', score: quality.usability?.score },
    { label: 'Business Fit', score: quality.businessFit?.score },
  ].filter(m => m.score !== undefined);

  const criticalIssues = quality.overall.criticalIssues.slice(0, 5);
  const recommendations = quality.overall.recommendations.slice(0, 5);

  return `
    <details open class="quality-section">
      <summary>Quality Evaluation</summary>
      <div class="quality-dashboard">
        <div class="quality-header">
          <div class="quality-grade ${gradeClass}">${quality.overall.grade}</div>
          <div class="quality-score-text">
            Overall Score: ${quality.overall.score}/100
          </div>
        </div>

        <div class="quality-metrics">
          ${metrics.map(m => renderMetricBar(m.label, m.score)).join('')}
        </div>

        ${criticalIssues.length > 0 ? `
          <div class="quality-issues">
            <h4>Critical Issues</h4>
            <ul>
              ${criticalIssues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${recommendations.length > 0 ? `
          <div class="quality-recommendations">
            <h4>Recommendations</h4>
            <ul>
              ${recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    </details>
  `;
}
