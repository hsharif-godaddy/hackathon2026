/**
 * Search CLI for Design RAG
 *
 * Search KnowB knowledge base for content.
 *
 * Usage:
 *   pnpm --filter @airo/design-rag search <query> [options]
 *   pnpm --filter @airo/design-rag search --help
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Command } from 'commander';
import { KnowBClient } from './knowb-client.js';
import { validateNumericOption } from './utils.js';

// Load .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../.env') });

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

const program = new Command();

program
  .name('search')
  .description('Search KnowB knowledge base')
  .argument('<query>', 'Search query')
  .option('-n, --node <kbNodeId>', 'Knowledge base node to search', '/airo_info')
  .option('-m, --max <number>', 'Maximum results', '5')
  .option('-t, --threshold <number>', 'Score threshold (0-1)', '0.35')
  .option('--json', 'Output as JSON', false)
  .action(async (query, options) => {
    const client = new KnowBClient();

    console.log(`${colors.cyan}Searching for:${colors.reset} "${query}"`);
    console.log(
      `${colors.dim}Node: ${options.node}, Max: ${options.max}, Threshold: ${options.threshold}${colors.reset}`
    );
    console.log('');

    // Validate numeric options
    const maxResult = validateNumericOption(options.max, {
      type: 'int',
      min: 1,
      name: '--max'
    });
    if (!maxResult.valid) {
      console.error(`${colors.red}${maxResult.error}${colors.reset}`);
      process.exit(1);
    }

    const thresholdResult = validateNumericOption(options.threshold, {
      type: 'float',
      min: 0,
      max: 1,
      name: '--threshold'
    });
    if (!thresholdResult.valid) {
      console.error(`${colors.red}${thresholdResult.error}${colors.reset}`);
      process.exit(1);
    }

    try {
      const result = await client.search({
        query,
        kbNodeIds: [options.node],
        maxResults: maxResult.value,
        scoreThreshold: thresholdResult.value
      });

      if (!result.success) {
        console.error(`${colors.red}Search failed:${colors.reset} ${result.error}`);
        process.exit(1);
      }

      if (!result.results || result.results.length === 0) {
        console.log(`${colors.yellow}No results found.${colors.reset}`);
        console.log('');
        console.log('Tips:');
        console.log('  - Try broader search terms');
        console.log('  - Lower the threshold with -t 0.2');
        console.log('  - Check if the node has content');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result.results, null, 2));
        return;
      }

      console.log(`${colors.green}Found ${result.results.length} result(s)${colors.reset}`);
      console.log('');

      for (const item of result.results) {
        console.log(
          `${colors.bright}════════════════════════════════════════════════════════════${colors.reset}`
        );
        console.log(
          `${colors.cyan}Score:${colors.reset} ${item.score.toFixed(4)}  ${colors.cyan}Node:${colors.reset} ${item.kbNodeId}`
        );
        console.log(
          `${colors.bright}════════════════════════════════════════════════════════════${colors.reset}`
        );

        // Truncate long text
        const displayText =
          item.text.length > 1500 ? item.text.substring(0, 1500) + '\n... (truncated)' : item.text;
        console.log(displayText);
        console.log('');
      }
    } catch (error) {
      console.error(
        `${colors.red}Error:${colors.reset}`,
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(
    `${colors.red}Error during CLI execution:${colors.reset}`,
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
