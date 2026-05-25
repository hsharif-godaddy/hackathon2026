#!/usr/bin/env node

import { Command } from 'commander';
import { runEvaluation, printSummary } from './runner.js';
import { saveReport, saveHTMLReport } from './reporter.js';

// Import evaluators to register them
import './evaluators/index.js';

const program = new Command();

program
  .name('corpus-eval')
  .description('Corpus-based evaluation system for AI classification agents')
  .version('1.0.0');

program
  .command('run')
  .description('Run corpus evaluation')
  .argument('<corpus>', 'Path to corpus file or directory')
  .option('-m, --model <model>', 'Model to use (haiku, sonnet, gpt-4o-mini)')
  .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--timeout <ms>', 'Timeout per case in milliseconds', '5000')
  .option('-c, --concurrency <num>', 'Max concurrent requests (default: 5)', '5')
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('--threshold <percent>', 'Minimum accuracy threshold (0-100). Exit 1 if below.', '0')
  .option('--no-report', 'Skip saving reports')
  .option('--html', 'Also output HTML report')
  .action(async (corpusPath, options) => {
    try {
      const report = await runEvaluation({
        corpusPath,
        model: options.model,
        tags: options.tags?.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0),
        verbose: options.verbose,
        timeoutMs: parseInt(options.timeout, 10),
        concurrency: parseInt(options.concurrency, 10),
      });

      printSummary(report);

      // Save reports (JSON by default, HTML if requested)
      if (options.report !== false) {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(options.output, { recursive: true });

        // Always save JSON report
        const jsonPath = await saveReport(report, options.output);
        console.log(`\nJSON report saved: ${jsonPath}`);

        if (options.html) {
          const htmlPath = await saveHTMLReport(report, options.output);
          console.log(`HTML report saved: ${htmlPath}`);
        }
      }

      // Exit with error code if:
      // - If --threshold is set: only check accuracy against threshold
      // - If --threshold is not set (0): exit 1 on any failures (default CI behavior)
      const threshold = parseFloat(options.threshold) / 100;
      if (threshold > 0) {
        // Threshold mode: only check accuracy, ignore individual failures
        if (report.summary.accuracy < threshold) {
          console.log(`\n❌ Accuracy ${(report.summary.accuracy * 100).toFixed(1)}% is below threshold ${options.threshold}%`);
          process.exit(1);
        }
      } else if (report.summary.failed > 0) {
        // Default mode: exit 1 on any failures (CI-friendly)
        console.log(`\n❌ ${report.summary.failed} test case(s) failed`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('compare')
  .description('Compare evaluation across multiple models')
  .argument('<corpus>', 'Path to corpus file or directory')
  .option('-m, --models <models>', 'Models to compare (comma-separated)', 'haiku,sonnet')
  .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('--threshold <percent>', 'Minimum accuracy threshold (0-100). Exit 1 if any model below.', '0')
  .action(async (corpusPath, options) => {
    try {
      const models = options.models.split(',').map((m: string) => m.trim()).filter((m: string) => m.length > 0);
      const tags = options.tags?.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);

      console.log(`\nComparing models: ${models.join(', ')}`);
      console.log(`Corpus: ${corpusPath}\n`);

      const results: Array<{ model: string; accuracy: number; f1: number; avgLatency: number; failed: number }> = [];

      for (const model of models) {
        console.log(`\n--- Running with model: ${model} ---\n`);

        const report = await runEvaluation({
          corpusPath,
          model,
          tags,
          verbose: false,
        });

        results.push({
          model,
          accuracy: report.summary.accuracy,
          f1: report.metrics.overall.f1,
          avgLatency: report.summary.avgLatencyMs,
          failed: report.summary.failed,
        });

        printSummary(report);
      }

      // Print comparison
      console.log(`\n========================================`);
      console.log(`Model Comparison Summary`);
      console.log(`========================================`);
      console.log(`Model`.padEnd(15) + `Accuracy`.padEnd(12) + `F1`.padEnd(12) + `Avg Latency`);
      console.log(`-----`.padEnd(15) + `--------`.padEnd(12) + `--`.padEnd(12) + `-----------`);

      for (const r of results) {
        console.log(
          r.model.padEnd(15) +
          `${(r.accuracy * 100).toFixed(1)}%`.padEnd(12) +
          `${(r.f1 * 100).toFixed(1)}%`.padEnd(12) +
          `${r.avgLatency}ms`
        );
      }

      // Exit with error code if:
      // 1. Any model below explicit threshold (if set)
      // 2. Any model had failures (default behavior for CI)
      const threshold = parseFloat(options.threshold) / 100;
      if (threshold > 0) {
        const belowThreshold = results.filter(r => r.accuracy < threshold);
        if (belowThreshold.length > 0) {
          console.log(`\n❌ Models below ${options.threshold}% threshold: ${belowThreshold.map(r => r.model).join(', ')}`);
          process.exit(1);
        }
      } else {
        // Default: exit 1 on any failures (CI-friendly)
        const totalFailures = results.reduce((sum, r) => sum + r.failed, 0);
        if (totalFailures > 0) {
          console.log(`\n❌ ${totalFailures} test case(s) failed across all models`);
          process.exit(1);
        }
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
