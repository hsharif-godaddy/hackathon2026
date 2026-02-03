#!/usr/bin/env npx tsx
/**
 * KnowB CLI Tool
 *
 * A command-line interface for interacting with the KnowB knowledge base.
 *
 * Usage:
 *   pnpm --filter @airo/agents tsx scripts/knowb-cli.ts <command> [options]
 *
 * Commands:
 *   search <query>              Search the knowledge base
 *   upload <file> [resourceId]  Upload a file to the knowledge base
 *   delete <resourceId>         Delete a resource from the knowledge base
 *   sync                        Trigger sync/indexing on a knowledge base node
 *   init-media-node             Initialize /airo_media_v2 node with public ACL
 *
 * Environment:
 *   SSO_JWT                     SSO JWT token for local authentication
 *   KNOWB_URL                   KnowB API URL (optional, defaults to test)
 *   GOCODE_USE_S2S_AUTH         Set to 'true' for S2S authentication
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env file from agents directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentsDir = path.resolve(__dirname, '..');
config({ path: path.join(agentsDir, '.env') });

import { KnowBDriver } from '../src/tools/ai-lib-tools/drivers/knowb-driver.js';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logError(message: string): void {
  console.error(`${colors.red}Error: ${message}${colors.reset}`);
}

function logSuccess(message: string): void {
  log(`✓ ${message}`, colors.green);
}

function logInfo(message: string): void {
  log(`ℹ ${message}`, colors.cyan);
}

function printUsage(): void {
  console.log(`
${colors.bright}KnowB CLI Tool${colors.reset}

${colors.yellow}Usage:${colors.reset}
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts <command> [options]

${colors.yellow}Commands:${colors.reset}
  ${colors.green}search${colors.reset} <query> [--node <kbNodeId>] [--max <n>] [--threshold <n>]
    Search the knowledge base for relevant content.

    Options:
      --node <kbNodeId>    Knowledge base node to search (default: /airo_info)
      --max <n>            Maximum results to return (default: 5)
      --threshold <n>      Minimum relevance score 0-1 (default: 0.35)

  ${colors.green}upload${colors.reset} <file> [--node <kbNodeId>] [--id <resourceId>] [--strategy <strategy>]
    Upload a file to the knowledge base.

    Options:
      --node <kbNodeId>    Target knowledge base node (default: /airo_info)
      --id <resourceId>    Resource ID (default: filename without extension)
      --strategy <s>       Chunking strategy: KNOWB001, KNOWB002, KNOWBAOSSSEMANTIC300

  ${colors.green}delete${colors.reset} <resourceId> [--node <kbNodeId>]
    Delete a resource from the knowledge base.

    Options:
      --node <kbNodeId>    Knowledge base node (default: /airo_info)

  ${colors.green}sync${colors.reset} [--node <kbNodeId>]
    Trigger sync/indexing on a knowledge base node.

    Options:
      --node <kbNodeId>    Knowledge base node to sync (default: /airo_info)

  ${colors.green}init-media-node${colors.reset} [--url <knowbUrl>] [--node <kbNodeId>]
    Initialize the media cache node with public read/write ACL.
    Use this to set up /airo_media_v2 for image analysis caching.

    Options:
      --url <knowbUrl>     KnowB API URL (default: test environment)
                           Use https://knowb.api.int.godaddy.com for production
      --node <kbNodeId>    Node to create (default: /airo_media_v2)

${colors.yellow}Environment Variables:${colors.reset}
  SSO_JWT                  SSO JWT token for local authentication
  KNOWB_URL                KnowB API URL (defaults to test environment)
  GOCODE_USE_S2S_AUTH      Set to 'true' for S2S authentication

${colors.yellow}Examples:${colors.reset}
  # Search for design styles
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts search "professional law firm"

  # Upload a markdown file
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts upload ./docs/guide.md --id my-guide

  # Upload with no chunking (keeps document as single unit)
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts upload ./docs/guide.md --strategy KNOWB002

  # Delete a resource
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts delete my-guide

  # Sync the knowledge base
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts sync

  # Initialize media node for TEST environment
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts init-media-node

  # Initialize media node for PRODUCTION environment
  pnpm --filter @airo/agents tsx scripts/knowb-cli.ts init-media-node --url https://knowb.api.int.godaddy.com
`);
}

interface ParsedArgs {
  command: string;
  args: string[];
  options: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  const options: Record<string, string> = {};
  let command = '';

  let i = 2; // Skip node and script path

  // First non-option arg is the command
  if (argv[i] && !argv[i].startsWith('--')) {
    command = argv[i];
    i++;
  }

  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      options[key] = value;
      i += value === 'true' ? 1 : 2;
    } else {
      args.push(arg);
      i++;
    }
  }

  return { command, args, options };
}

async function searchCommand(args: string[], options: Record<string, string>): Promise<void> {
  const query = args.join(' ');
  if (!query) {
    logError('Search query is required');
    console.log('\nUsage: knowb-cli.ts search <query> [--node <kbNodeId>] [--max <n>]');
    process.exit(1);
  }

  const kbNodeId = options.node || '/airo_info';
  const maxResults = parseInt(options.max || '5', 10);
  const scoreThreshold = parseFloat(options.threshold || '0.35');

  logInfo(`Searching for: "${query}"`);
  logInfo(`Node: ${kbNodeId}, Max results: ${maxResults}, Threshold: ${scoreThreshold}`);
  console.log('');

  const driver = new KnowBDriver();
  const result = await driver.search({
    query,
    kbNodeIds: [kbNodeId],
    maxResults,
    scoreThreshold,
  });

  if (!result.success) {
    logError(result.error || 'Search failed');
    process.exit(1);
  }

  if (!result.results || result.results.length === 0) {
    log('No results found.', colors.yellow);
    return;
  }

  logSuccess(`Found ${result.results.length} result(s)\n`);

  for (const item of result.results) {
    console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.cyan}Score:${colors.reset} ${item.score.toFixed(4)}  ${colors.cyan}Node:${colors.reset} ${item.kbNodeId}`);
    console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

    // Truncate long text for display
    const displayText = item.text.length > 1000
      ? item.text.substring(0, 1000) + '\n... (truncated)'
      : item.text;
    console.log(displayText);
    console.log('');
  }
}

async function uploadCommand(args: string[], options: Record<string, string>): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    logError('File path is required');
    console.log('\nUsage: knowb-cli.ts upload <file> [--node <kbNodeId>] [--id <resourceId>]');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    logError(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const defaultResourceId = path.basename(filePath, path.extname(filePath));

  const kbNodeId = options.node || '/airo_info';
  const resourceId = options.id || defaultResourceId;
  const kbStrategy = options.strategy;

  logInfo(`Uploading: ${resolvedPath}`);
  logInfo(`Node: ${kbNodeId}, Resource ID: ${resourceId}`);
  if (kbStrategy) {
    logInfo(`Strategy: ${kbStrategy}`);
  }
  logInfo(`Content size: ${content.length} bytes`);
  console.log('');

  const driver = new KnowBDriver();
  const result = await driver.upload({
    kbNodeId,
    resourceId,
    content,
    kbStrategy,
  });

  if (!result.success) {
    logError(result.error || 'Upload failed');
    process.exit(1);
  }

  logSuccess(`Successfully uploaded "${resourceId}" to ${kbNodeId}`);
}

async function deleteCommand(args: string[], options: Record<string, string>): Promise<void> {
  const resourceId = args[0];
  if (!resourceId) {
    logError('Resource ID is required');
    console.log('\nUsage: knowb-cli.ts delete <resourceId> [--node <kbNodeId>]');
    process.exit(1);
  }

  const kbNodeId = options.node || '/airo_info';

  logInfo(`Deleting resource: ${resourceId}`);
  logInfo(`Node: ${kbNodeId}`);
  console.log('');

  const driver = new KnowBDriver();
  const result = await driver.delete({
    kbNodeId,
    resourceId,
  });

  if (!result.success) {
    logError(result.error || 'Delete failed');
    process.exit(1);
  }

  logSuccess(`Successfully deleted "${resourceId}" from ${kbNodeId}`);
}

async function syncCommand(_args: string[], options: Record<string, string>): Promise<void> {
  const kbNodeId = options.node || '/airo_info';

  logInfo(`Syncing knowledge base node: ${kbNodeId}`);
  console.log('');

  const driver = new KnowBDriver();
  const result = await driver.sync(kbNodeId);

  if (!result.success) {
    logError(result.error || 'Sync failed');
    process.exit(1);
  }

  logSuccess(`Successfully triggered sync for ${kbNodeId}`);
}

async function initMediaNodeCommand(_args: string[], options: Record<string, string>): Promise<void> {
  const knowbUrl = options.url || 'https://knowb.api.int.test-godaddy.com';
  const kbNodeId = options.node || '/airo_media_v2';
  const ssoJwt = process.env.SSO_JWT;

  if (!ssoJwt) {
    logError('SSO_JWT environment variable is required for this command');
    process.exit(1);
  }

  logInfo(`Initializing media node: ${kbNodeId}`);
  logInfo(`KnowB URL: ${knowbUrl}`);
  console.log('');

  // Create README content for the node
  const readmeContent = `# Airo Media Cache

This knowledge base node stores cached image analysis results from the ImageAnalysisService.

## Purpose

When AI-powered image search analysis is enabled (\`IMAGE_ANALYSIS_ENABLED=true\`), the service:
1. Analyzes Getty Images using Claude Haiku vision
2. Caches the analysis results here for faster subsequent lookups
3. Scores image relevance using semantic search

## Data Format

Each cached entry contains:
- \`gettyId\`: The Getty Images asset ID
- \`analysis\`: AI-generated description, composition, and usage context
- \`getty\`: Original metadata (title, keywords, dimensions)
- \`urls\`: Image URLs (thumbnail, preview, highRes)
- \`analyzedAt\`: Timestamp of analysis

## Management

This node is automatically populated by the ImageAnalysisService.
Manual management is not typically required.
`;

  // Create a temporary file
  const tempFile = '/tmp/airo_media_readme.md';
  fs.writeFileSync(tempFile, readmeContent);

  // ACL to allow any authenticated user to read/write
  const acl = JSON.stringify({
    allowedPrincipals: [
      { type: '*', id: '*', scope: 'read' },
      { type: '*', id: '*', scope: 'write' },
    ],
  });

  logInfo('Creating node with public read/write ACL...');

  try {
    // We need to call knowb directly (not through the driver) to pass ACL
    // Use native FormData (Node.js 18+)
    const formData = new FormData();

    // Create a Blob from the file content
    const fileContent = fs.readFileSync(tempFile);
    const blob = new Blob([fileContent], { type: 'text/markdown' });
    formData.append('files', blob, 'README.md');
    formData.append('kbNodeId', kbNodeId);
    formData.append('resourceType', 'document');
    formData.append('acl', acl);

    const response = await fetch(`${knowbUrl}/v1/kbnodes`, {
      method: 'POST',
      headers: {
        Authorization: `sso-jwt ${ssoJwt}`,
        Accept: 'application/json',
      },
      body: formData,
    });

    const responseText = await response.text();

    if (response.ok) {
      logSuccess(`Successfully created ${kbNodeId}`);
      log(`Response: ${responseText}`, colors.dim);
      console.log('');
      logInfo('Next steps:');
      log(`  1. Run sync: npx tsx scripts/knowb-cli.ts sync --node ${kbNodeId}`, colors.yellow);
      log(`  2. Test search: npx tsx scripts/knowb-cli.ts search "test" --node ${kbNodeId}`, colors.yellow);
    } else {
      logError(`Failed to create node (HTTP ${response.status})`);
      log(`Response: ${responseText}`, colors.red);
      process.exit(1);
    }
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

async function main(): Promise<void> {
  const { command, args, options } = parseArgs(process.argv);

  if (!command || command === 'help' || options.help) {
    printUsage();
    process.exit(0);
  }

  // Check for authentication
  if (!process.env.SSO_JWT && process.env.GOCODE_USE_S2S_AUTH !== 'true') {
    logError('No authentication configured.');
    log('Set SSO_JWT environment variable for local auth, or GOCODE_USE_S2S_AUTH=true for S2S.', colors.yellow);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'search':
        await searchCommand(args, options);
        break;
      case 'upload':
        await uploadCommand(args, options);
        break;
      case 'delete':
        await deleteCommand(args, options);
        break;
      case 'sync':
        await syncCommand(args, options);
        break;
      case 'init-media-node':
        await initMediaNodeCommand(args, options);
        break;
      default:
        logError(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
