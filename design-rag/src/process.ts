/**
 * Process CLI for Design RAG
 *
 * Transform and process data files for RAG pipelines.
 *
 * Usage:
 *   pnpm --filter @airo/design-rag process <input> [options]
 *   pnpm --filter @airo/design-rag process --help
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, basename, extname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { Command } from 'commander';
import { getNestedValue, slugify, validatePath } from './utils.js';

// Load .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../.env') });

const program = new Command();

program
  .name('process')
  .description('Process and transform data files for RAG')
  .argument('<input>', 'Input file (JSON)')
  .option('-o, --output <file>', 'Output file (default: input-processed.json)')
  .option('-f, --format <type>', 'Output format: json, markdown, knowb', 'json')
  .option('--extract <fields>', 'Comma-separated fields to extract')
  .option('--flatten', 'Flatten nested objects', false)
  .option('--add-metadata', 'Add processing metadata', false)
  .action(async (input, options) => {
    // Validate input path
    const inputPathResult = validatePath(input);
    if (!inputPathResult.valid) {
      console.error(`Invalid input path: ${inputPathResult.error}`);
      process.exit(1);
    }
    const inputPath = inputPathResult.resolvedPath;

    if (!existsSync(inputPath)) {
      console.error(`File not found: ${inputPath}`);
      process.exit(1);
    }

    try {
      console.log(`Processing: ${basename(inputPath)}`);

      const rawContent = readFileSync(inputPath, 'utf-8');
      const data = JSON.parse(rawContent);
      const items = Array.isArray(data) ? data : [data];

      console.log(`  Input items: ${items.length}`);

      let processed: unknown[];

      // Extract specific fields if requested
      if (options.extract) {
        const fields = options.extract.split(',').map((f: string) => f.trim());
        processed = items.map((item) => {
          const result: Record<string, unknown> = {};
          for (const field of fields) {
            result[field] = getNestedValue(item, field);
          }
          return result;
        });
        console.log(`  Extracted fields: ${fields.join(', ')}`);
      } else {
        processed = items;
      }

      // Flatten if requested
      if (options.flatten) {
        processed = processed.map((item) => flattenObject(item as Record<string, unknown>));
        console.log('  Flattened nested objects');
      }

      // Add metadata if requested
      if (options.addMetadata) {
        const timestamp = new Date().toISOString();
        processed = processed.map((item, index) => ({
          ...(item as Record<string, unknown>),
          _metadata: {
            processedAt: timestamp,
            sourceFile: basename(inputPath),
            index
          }
        }));
        console.log('  Added processing metadata');
      }

      // Determine output path
      const ext = extname(inputPath);
      const baseName = basename(inputPath, ext);
      const defaultOutput = resolve(dirname(inputPath), `${baseName}-processed.json`);

      // Validate output path if provided
      let outputPath: string;
      if (options.output) {
        const outputPathResult = validatePath(options.output);
        if (!outputPathResult.valid) {
          console.error(`Invalid output path: ${outputPathResult.error}`);
          process.exit(1);
        }
        outputPath = outputPathResult.resolvedPath;
      } else {
        outputPath = defaultOutput;
      }

      // Ensure output directory exists
      mkdirSync(dirname(outputPath), { recursive: true });

      // Write output based on format
      switch (options.format) {
        case 'markdown': {
          const mdContent = processed
            .map((item) => {
              const obj = item as Record<string, unknown>;
              const name = obj.name || obj.id || 'Item';
              return `# ${name}\n\n${JSON.stringify(item, null, 2)}`;
            })
            .join('\n\n---\n\n');
          const mdPath = outputPath.replace(/\.json$/, '.md');
          writeFileSync(mdPath, mdContent);
          console.log(`\n  Output: ${mdPath}`);
          break;
        }
        case 'knowb': {
          // Format for KnowB upload - each item as a separate markdown document
          const knowbItems = processed.map((item) => {
            const obj = item as Record<string, unknown>;
            const name = String(obj.name || obj.id || 'unknown');
            const resourceId = slugify(name);
            return {
              resourceId,
              content: `# ${name}\n\n${formatForKnowb(obj)}`
            };
          });
          writeFileSync(outputPath, JSON.stringify(knowbItems, null, 2));
          console.log(`\n  Output: ${outputPath}`);
          console.log(`  Ready for KnowB upload with: pnpm --filter @airo/design-rag upload ${outputPath}`);
          break;
        }
        case 'json':
        default: {
          writeFileSync(outputPath, JSON.stringify(processed, null, 2));
          console.log(`\n  Output: ${outputPath}`);
          break;
        }
      }

      console.log(`  Output items: ${processed.length}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Flatten a nested object
 */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/**
 * Format an object for KnowB as readable markdown
 */
function formatForKnowb(item: Record<string, unknown>): string {
  const sections: string[] = [];

  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('_')) continue; // Skip metadata fields

    const title = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');

    if (Array.isArray(value)) {
      sections.push(`## ${title}\n\n${value.map((v) => `- ${v}`).join('\n')}`);
    } else if (typeof value === 'object' && value !== null) {
      sections.push(`## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
    } else if (typeof value === 'string' && value.length > 100) {
      sections.push(`## ${title}\n\n${value}`);
    } else {
      sections.push(`**${title}:** ${value}`);
    }
  }

  return sections.join('\n\n');
}

program.parseAsync(process.argv).catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
