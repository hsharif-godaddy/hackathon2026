import { createTool, type Tool } from '@airo/ai-lib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { scaffoldContent, ensureContentPluginRegistered, type ScaffoldKind } from '../content-scaffold.js';
import { atomicWrite } from '../../utils/fs-utils.js';
import { logger } from '../../logging/index.js';

const appRepo = new AppRepository();

/**
 * content_scaffold: the canonical path for creating a new content root.
 *
 * Why a dedicated tool (vs str_replace_based_edit_tool): content has a
 * specific layout contract (file path + virtual module + Zod schema) that
 * the agent has repeatedly gotten wrong when left to freehand it. This
 * tool's input types constrain what the agent can emit at all.
 */
export const contentScaffoldAITool: Tool = createTool(
  `Scaffold a new content root under src/content/ atomically. This is the
REQUIRED entry point for creating page or collection content — do not write
JSON files under src/content/ directly, and do not use a JSON import
(\`import home from '@/content/home.json'\`). Both are blocked at build time.

What this tool does in a single call:
- Writes the JSON content file to the correct location based on 'kind':
  - kind: "page"       → src/content/pages/<name>.json
  - kind: "collection" → src/content/data/<name>.json
  - kind: "site"       → src/content/site.json (singleton; name ignored)
- Infers a Zod schema from the content shape and patches src/content/schemas.ts
  to register it. Creates schemas.ts if absent.
- Returns the exact import line you should use in JSX pages.

After calling this tool:
1. In your page JSX, use the returned importLine literally.
2. Reference fields via direct member access: {home.hero.title} — never
   destructure (\`const { hero } = home\`) because that hides content
   attribution from the source-mapper and breaks inline editing.
3. For lists, wrap .map() in <ContentListContext field="..."> from
   '@airo/content' so each item is editable.

Re-running this tool on a key that already exists is SAFE: by default it
preserves any fields the user has inline-edited and only adds or updates the
rest, so you can freely re-scaffold to add new fields. Pass mode: "replace"
ONLY when you deliberately want to rebuild the content file from scratch —
that discards the user's inline edits.

For subsequent edits to an existing content file, use
str_replace_based_edit_tool on the JSON file, or let the user edit inline
through the canvas.`,
  z.object({
    kind: z
      .enum(['page', 'collection', 'site'])
      .describe('Content root kind. "page" for a whole page; "collection" for a list/array; "site" for the site singleton (brand, nav, etc.).'),
    name: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, 'name must be lowercase letters/digits/underscores, starting with letter or underscore')
      .optional()
      .describe('Content name (the file stem, e.g. "home" or "products"). Required for page/collection; ignored for site.'),
    content: z
      .unknown()
      .describe('Initial content as a JSON-compatible value. The Zod schema is inferred from this shape — provide realistic, non-null initial values. For arrays, the first item\'s shape defines the item schema.'),
    mode: z
      .enum(['merge', 'replace'])
      .optional()
      .describe('Reconciliation policy for an existing content file. "merge" (default) keeps user-inline-edited fields and updates the rest. "replace" overwrites verbatim, discarding user edits — use only to rebuild from scratch.'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined;
    if (!appId) {
      throw new Error('content_scaffold requires an appId in tool metadata');
    }
    const app = appRepo.findById(appId);
    if (!app) {
      throw new Error(`App '${appId}' not found`);
    }

    const contentDir = path.join(app.path, 'src', 'content');
    if (typeof input.content === 'string') {
      // Agent passed stringified JSON; scaffoldContent normalizes it, but log so
      // we can spot this behavior across agents.
      logger.info('content_scaffold.content_stringified', { appId, kind: input.kind, name: input.name });
    }
    const result = await scaffoldContent(contentDir, {
      kind: input.kind as ScaffoldKind,
      name: input.name,
      content: input.content,
      mode: input.mode,
    });

    if (!result.ok) {
      logger.warn('content_scaffold.rejected', {
        appId,
        kind: input.kind,
        name: input.name,
        errorCode: result.error.code,
      });
      throw new Error(`[${result.error.code}] ${result.error.message}`);
    }

    logger.info('content_scaffold.success', {
      appId,
      kind: input.kind,
      key: result.key,
      file: result.relFile,
      schemasCreated: result.schemasCreated,
    });

    // Auto-patch vite.config.ts to register contentPlugin() if missing.
    // Non-fatal: the write already succeeded and the plugin may already be there.
    try {
      const viteConfigPath = path.join(app.path, 'vite.config.ts');
      const viteSource = await fs.readFile(viteConfigPath, 'utf8');
      const patched = ensureContentPluginRegistered(viteSource);
      if (patched.modified) {
        await atomicWrite(viteConfigPath, patched.code);
        logger.info('content_scaffold.vite_plugin_registered', { appId });
      }
    } catch (err) {
      logger.warn('content_scaffold.vite_plugin_patch_failed', { appId, error: String(err) });
    }

    // Remove rogue barrel file that bypasses virtual:content.
    const barrelPath = path.join(app.path, 'src', 'content', 'index.ts');
    try {
      await fs.unlink(barrelPath);
      logger.info('content_scaffold.barrel_file_removed', { appId });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('content_scaffold.barrel_file_remove_failed', { appId, error: String(err) });
      }
    }

    return {
      success: true,
      file: result.relFile,
      importLine: result.importLine,
      key: result.key,
      schemasCreated: result.schemasCreated,
      message: `Scaffolded ${input.kind} "${result.key}" at ${result.relFile}. Import in JSX: ${result.importLine}`,
    };
  },
);
