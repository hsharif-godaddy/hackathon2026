/**
 * Upload CLI for Design RAG
 *
 * Upload files or processed data to KnowB knowledge base.
 *
 * Usage:
 *   pnpm --filter @airo/design-rag upload <file> [options]
 *   pnpm --filter @airo/design-rag upload --help
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, basename, extname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Command } from 'commander';
import { KnowBClient } from './knowb-client.js';
import { getNestedValue, slugify, toSafeResourceId, validatePath } from './utils.js';

// Load .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../.env') });

const program = new Command();

program
  .name('upload')
  .description('Upload files to KnowB knowledge base')
  .argument('<file>', 'File to upload (markdown or JSON)')
  .option('-n, --node <kbNodeId>', 'Target knowledge base node', '/airo_info')
  .option('-i, --id <resourceId>', 'Resource ID (default: filename without extension)')
  .option(
    '-s, --strategy <strategy>',
    'Chunking strategy: KNOWB001, KNOWB002, KNOWBAOSSSEMANTIC300'
  )
  .option('--json-transform <field>', 'For JSON files: field path to extract as content')
  .option('--json-id-field <field>', 'For JSON files: field to use as resource ID')
  .option('--sync', 'Trigger sync after upload', false)
  .action(async (file, options) => {
    // Validate and resolve file path
    const pathResult = validatePath(file);
    if (!pathResult.valid) {
      console.error(`Invalid file path: ${pathResult.error}`);
      process.exit(1);
    }
    const filePath = pathResult.resolvedPath;

    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const ext = extname(filePath).toLowerCase();
    const defaultResourceId = basename(filePath, ext);
    const client = new KnowBClient();

    try {
      if (ext === '.json') {
        // Handle JSON file - can upload individual items or the whole file
        const rawContent = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(rawContent);
        const items = Array.isArray(data) ? data : [data];

        console.log(`Uploading ${items.length} item(s) from JSON file...`);
        console.log(`Target node: ${options.node}`);

        let successCount = 0;
        let failCount = 0;

        for (const item of items) {
          // Determine resource ID with proper validation
          let resourceId: string | undefined;

          if (options.jsonIdField) {
            const rawId = getNestedValue(item, options.jsonIdField);
            resourceId = toSafeResourceId(rawId);
          }

          if (!resourceId && item.name) {
            resourceId = slugify(String(item.name));
          }

          if (!resourceId && item.id) {
            resourceId = toSafeResourceId(item.id);
          }

          if (!resourceId) {
            resourceId = `${defaultResourceId}-${successCount + failCount}`;
          }

          // Determine content
          let content: string;
          if (options.jsonTransform) {
            const value = getNestedValue(item, options.jsonTransform);
            content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
          } else {
            content = JSON.stringify(item, null, 2);
          }

          // Create markdown with header
          const markdown = `# ${resourceId}\n\n${content}`;

          const result = await client.upload({
            kbNodeId: options.node,
            resourceId,
            content: markdown,
            kbStrategy: options.strategy,
            metadata: { source: basename(filePath), type: 'json' }
          });

          if (result.success) {
            console.log(`  OK: ${resourceId}`);
            successCount++;
          } else {
            console.error(`  FAIL: ${resourceId} - ${result.error}`);
            failCount++;
          }
        }

        console.log(`\nUpload complete: ${successCount} succeeded, ${failCount} failed`);
      } else {
        // Handle markdown or text file
        const content = readFileSync(filePath, 'utf-8');
        const resourceId = options.id ? toSafeResourceId(options.id) || defaultResourceId : defaultResourceId;

        console.log(`Uploading: ${basename(filePath)}`);
        console.log(`  Node: ${options.node}`);
        console.log(`  Resource ID: ${resourceId}`);
        console.log(`  Content size: ${content.length} bytes`);

        const result = await client.upload({
          kbNodeId: options.node,
          resourceId,
          content,
          kbStrategy: options.strategy,
          metadata: { source: basename(filePath) }
        });

        if (result.success) {
          console.log(`  OK: Uploaded to ${result.kbNodeIds?.join(', ')}`);
        } else {
          console.error(`  FAIL: ${result.error}`);
          process.exit(1);
        }
      }

      // Trigger sync if requested
      if (options.sync) {
        console.log(`\nTriggering sync for ${options.node}...`);
        const syncResult = await client.sync(options.node);
        if (syncResult.success) {
          console.log('  Sync triggered successfully');
        } else {
          console.error(`  Sync failed: ${syncResult.error}`);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
