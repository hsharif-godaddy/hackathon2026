/**
 * Conversations Skill Tools
 *
 * Tools for connecting a Conversations (Reamaze) chat widget to the site.
 * The account ID is persisted in memory under `integrations.conversations.brandId`.
 *
 *   discover_account       — find or auto-create the account for this app
 *   select_account         — manually link/activate an account (override)
 *   setup_widget           — find/create the default embeddable, return brandId
 *                            for the agent to write into conversations.config.ts
 *   update_widget_config   — sync widget color/position to backend
 *
 * The agent is the sole writer of src/lib/conversations.config.ts — it sets
 * account, color, and position. Tools only handle backend sync.
 * See skill.md for the full flow.
 */

import { z } from 'zod';
import { access } from 'fs/promises';
import { join } from 'path';
import type { SkillToolDefinition, SkillHooks } from '@airo/ai-skills';
import { Logger } from '../../../logging/index.js';
import { appRepository } from '../../../database/repositories/index.js';
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js';
import { SkillLoaderTool } from '../../../tools/skill-loader-tool.js';
import { getActionService } from '../../../server/agent-runtime.js';
import type { IClientActionService } from '../../../services/ClientActionService.js';
import {
  listAccounts,
  activateAccount,
  listEmbeddables,
  createEmbeddable,
  updateEmbeddable,
  type UpdateEmbeddableInput,
} from './reamaze.js';

const logger = Logger.create({ component: 'conversations.skill' });
const memoryRepo = new MemoryRepository();

// Memory keys — per-app pointers to Reamaze resources.
const MEM_BRAND_ID = 'integrations.conversations.brandId';
const MEM_EMBEDDABLE_ID = 'integrations.conversations.embeddableId';

// Tools receive socketId on context (ai-lib sets it at execution time, not on the
// declared type — matches the pattern in agents/src/tools/ai-lib-tools/qr-code.ts:51).
type ToolContext = { metadata?: { appId?: string }; socketId?: string };

function getAppId(ctx?: ToolContext): string | undefined {
  return ctx?.metadata?.appId;
}

function getClient(ctx?: ToolContext): IClientActionService | null {
  const socketId = ctx?.socketId;
  if (!socketId || typeof socketId !== 'string') return null;
  return getActionService(socketId);
}

// ============================================================================
// Hooks
// ============================================================================

export const hooks: SkillHooks = {
  onInstall: async (ctx) => {
    logger.info('conversations.skill.installed', { appPath: ctx.appPath });
  },
};

// ============================================================================
// discover_account — find or auto-create the Conversations account for this app
// ============================================================================

export const discoverAccountTool: SkillToolDefinition = {
  name: 'discover_account',
  description:
    'Discover or provision the Conversations account for this app. ' +
    'If an account is already saved in memory, returns it immediately (idempotent). ' +
    'If listAccounts returns an account already linked to this app (matching aabAppId), ' +
    'saves it to memory and returns it. Otherwise, auto-creates a new account from the ' +
    'first available entitlement. Returns alreadyConfigured or accountCreated on success, ' +
    'noAccounts if no entitlements are available. ' +
    'After this succeeds, proceed directly to conversations__setup_widget.',
  parameters: z.object({}),
  execute: async (_input: Record<string, never>, context?: ToolContext) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const existingBrand = await memoryRepo.get(appId, MEM_BRAND_ID);
    if (existingBrand.exists) {
      return { alreadyConfigured: true, accountId: existingBrand.value as string };
    }

    const client = getClient(context);
    if (!client) {
      return { error: 'ClientActionService not available — tool requires an authenticated websocket session.' };
    }

    const result = await listAccounts(client, appId);
    if (!result.success) {
      return { error: `Failed to list accounts: ${result.error}` };
    }

    const { accounts, unlinkedEntitlements } = result.data;

    // If an account is already linked to THIS app, use it directly.
    const linkedToThisApp = accounts.find((a) => a.aabAppId === appId);
    if (linkedToThisApp) {
      await memoryRepo.set(appId, MEM_BRAND_ID, linkedToThisApp.brandUrl);
      logger.info('conversations.skill.discover_account.found_linked', { appId, brandUrl: linkedToThisApp.brandUrl });
      return { alreadyConfigured: true, accountId: linkedToThisApp.brandUrl };
    }

    // No account linked to this app — auto-create from first available entitlement.
    if (unlinkedEntitlements.length > 0) {
      const entitlement = unlinkedEntitlements[0]!;
      const app = await appRepository.findById(appId);
      const activateResult = await activateAccount(client, appId, entitlement.entitlementId, app?.name);
      if (!activateResult.success) {
        return { error: `Failed to create account: ${activateResult.error}` };
      }

      const brandUrl = activateResult.data.brandUrl;
      await memoryRepo.set(appId, MEM_BRAND_ID, brandUrl);
      logger.info('conversations.skill.discover_account.auto_created', { appId, brandUrl });
      return { accountCreated: true, accountId: brandUrl };
    }

    return {
      noAccounts: true,
      message:
        'No Conversations accounts found for this app and no entitlements available for creating a new one.',
    };
  },
  config: { requiresApp: true, timeout: 30_000 },
};

// ============================================================================
// select_account — persist the user's account choice to memory
// ============================================================================

export const selectAccountTool: SkillToolDefinition = {
  name: 'select_account',
  description:
    'Manually select an existing Conversations account or activate a new one from an entitlement. ' +
    'Normally discover_account handles this automatically. Use select_account only if you need to ' +
    'override — e.g. pick a specific existing account instead of creating a new one. ' +
    'Pass accountUrl: "create_new" with an entitlementId to activate, or a brandUrl to select.',
  parameters: z.object({
    accountUrl: z.string().describe('The account URL slug (from discover_account results), or "create_new" to activate a new account'),
    entitlementId: z.string().optional().describe('Required when accountUrl is "create_new". The entitlementId from the createOption in discover_account results.'),
  }),
  execute: async (input: { accountUrl: string; entitlementId?: string }, context?: ToolContext) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    if (input.accountUrl === 'create_new') {
      const client = getClient(context);
      if (!client) {
        return { error: 'ClientActionService not available — tool requires an authenticated websocket session.' };
      }

      const app = await appRepository.findById(appId);
      const result = await activateAccount(client, appId, input.entitlementId, app?.name);
      if (!result.success) {
        return { error: `Failed to activate account: ${result.error}` };
      }

      const brandUrl = result.data.brandUrl;
      await memoryRepo.set(appId, MEM_BRAND_ID, brandUrl);
      logger.info('conversations.skill.select_account.activated', { appId, accountId: brandUrl });
      return { success: true, accountId: brandUrl, activated: true };
    }

    await memoryRepo.set(appId, MEM_BRAND_ID, input.accountUrl);
    logger.info('conversations.skill.select_account.linked', { appId, accountId: input.accountUrl });

    return { success: true, accountId: input.accountUrl };
  },
  config: { requiresApp: true, timeout: 30_000 },
};

// ============================================================================
// setup_widget — find embeddable, return brandId. Idempotent.
// ============================================================================

export const setupWidgetTool: SkillToolDefinition = {
  name: 'setup_widget',
  description:
    'Wire the Conversations chat widget into this site. Looks up the Conversations account ' +
    '(must already be configured via discover_account/select_account), ensures a default embeddable exists, ' +
    'and syncs color/position/icon to the backend. After this tool succeeds, you MUST edit ' +
    'src/lib/conversations.config.ts to set account (brandId) and color/position in config.support.ui.widget. ' +
    'Idempotent. If the account is not configured, returns brandNotProvisioned: true.',
  parameters: z.object({
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional()
      .describe('Hex color for chat button / header background (e.g. "#1e40af")'),
    position: z
      .enum(['bottom-right', 'bottom-left'])
      .optional()
      .describe('Widget corner position (defaults to bottom-right)'),
  }),
  execute: async (
    input: {
      color?: string;
      position?: 'bottom-right' | 'bottom-left';
    },
    context?: ToolContext,
  ) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const app = await appRepository.findById(appId);
    if (!app?.path) return { error: `Could not resolve app path for appId: ${appId}` };

    // 0. Auto-install templates if either file doesn't exist yet
    const widgetPath = join(app.path, 'src', 'components', 'ConversationsWidget.tsx');
    const configPath = join(app.path, 'src', 'lib', 'conversations.config.ts');
    const fileExists = async (p: string): Promise<boolean> => {
      try {
        await access(p);
        return true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
    };
    const [widgetExists, configExists] = await Promise.all([
      fileExists(widgetPath),
      fileExists(configPath),
    ]);
    if (!widgetExists || !configExists) {
      const skillLoader = new SkillLoaderTool();
      const installResult = await skillLoader.installTemplates({ skill: 'conversations', appPath: app.path, appId });
      if (!installResult.success) {
        return { error: `Failed to auto-install conversations template: ${installResult.error}` };
      }
    }

    // 1. Account must already exist (set via discover_account + select_account)
    const brandRead = await memoryRepo.get(appId, MEM_BRAND_ID);
    if (!brandRead.exists) {
      logger.warn('conversations.skill.setup.brand_not_provisioned', { appId });
      return {
        brandNotProvisioned: true,
        message:
          'No Conversations account is configured for this site. ' +
          'Run conversations__discover_account first to let the user choose their account.',
      };
    }
    const brandId = brandRead.value as string;

    const client = getClient(context);
    if (!client) {
      return { error: 'ClientActionService not available — tool requires an authenticated websocket session.' };
    }

    // 2. Ensure an embeddable exists and cache its ID
    const embeddableRead = await memoryRepo.get(appId, MEM_EMBEDDABLE_ID);
    let embeddableId: number;

    let needsUpdate = false;
    if (embeddableRead.exists) {
      embeddableId = Number(embeddableRead.value);
      if (!Number.isFinite(embeddableId)) {
        return { error: 'Corrupted embeddableId in memory; re-run conversations__setup_widget.' };
      }
      needsUpdate = true;
      logger.info('conversations.skill.setup.embeddable.reuse', { appId, brandId, embeddableId });
    } else {
      const list = await listEmbeddables(client, appId, brandId);
      if (!list.success) {
        return { error: `Failed to list embeddables for brand ${brandId}: ${list.error}` };
      }

      const existing = list.data[0];
      if (existing) {
        embeddableId = existing.id;
        needsUpdate = true;
        logger.info('conversations.skill.setup.embeddable.found', { appId, brandId, embeddableId });
      } else {
        const created = await createEmbeddable(client, appId, brandId, {
          title: app.name ?? 'Chat Widget',
          shoutbox_position: input.position ?? 'bottom-right',
          shoutbox_icon: 'webChat',
          ...(input.color && {
            shoutbox_bg: input.color,
            styles: { button_bg_color: input.color, header_bg_color: input.color },
          }),
        });
        if (!created.success) {
          return { error: `Failed to create embeddable for brand ${brandId}: ${created.error}` };
        }
        embeddableId = created.data.id;
        logger.info('conversations.skill.setup.embeddable.created', { appId, brandId, embeddableId });
      }

      await memoryRepo.set(appId, MEM_EMBEDDABLE_ID, embeddableId);
    }

    // 3. Sync icon/color/position to the backend (skip on fresh create — already set)
    if (needsUpdate) {
      const embeddablePatch: UpdateEmbeddableInput = { shoutbox_icon: 'webChat' };
      if (input.color) {
        embeddablePatch.styles = { button_bg_color: input.color, header_bg_color: input.color };
        embeddablePatch.shoutbox_bg = input.color;
      }
      if (input.position) embeddablePatch.shoutbox_position = input.position;

      const updateResult = await updateEmbeddable(client, appId, brandId, embeddableId, embeddablePatch);
      if (!updateResult.success) {
        return { error: `Failed to update embeddable for brand ${brandId}: ${updateResult.error}` };
      }
    }

    return {
      brandId,
      embeddableId,
      CRITICAL_NEXT_STEP:
        `You MUST now edit src/lib/conversations.config.ts: set account to '${brandId}' ` +
        'and apply any user-requested preferences. Read the config file to see available fields. ' +
        'Then import and mount <ConversationsWidget /> in src/App.tsx — ' +
        'add `import ConversationsWidget from \'./components/ConversationsWidget\';` at the top, ' +
        'then render `<ConversationsWidget />` inside the root JSX (outside <Routes>, at the top level). ' +
        'The widget will NOT appear until this is done. Do NOT skip this step.',
    };
  },
  config: { requiresApp: true, timeout: 30_000 },
};

// ============================================================================
// update_widget_config — route fields between embeddable and account
// ============================================================================

export const updateWidgetConfigTool: SkillToolDefinition = {
  name: 'update_widget_config',
  description:
    'Sync widget color/position changes to the Conversations backend. Requires conversations__setup_widget ' +
    'to have run first. After this tool succeeds, you MUST also edit src/lib/conversations.config.ts ' +
    'to set the same color/position in config.support.ui.widget. Omit a field to leave it unchanged.',
  parameters: z.object({
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional()
      .describe('Hex color for chat button / header background (e.g. "#1e40af")'),
    position: z
      .enum(['bottom-right', 'bottom-left'])
      .optional()
      .describe('Widget corner position'),
  }),
  execute: async (
    input: {
      color?: string;
      position?: 'bottom-right' | 'bottom-left';
    },
    context?: ToolContext,
  ) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const brandRead = await memoryRepo.get(appId, MEM_BRAND_ID);
    const embeddableRead = await memoryRepo.get(appId, MEM_EMBEDDABLE_ID);
    if (!brandRead.exists || !embeddableRead.exists) {
      return {
        error: 'Run conversations__setup_widget first — account or embeddable ID missing from memory.',
      };
    }
    const brandId = brandRead.value as string;
    const embeddableId = Number(embeddableRead.value);
    if (!Number.isFinite(embeddableId)) {
      return { error: 'Corrupted embeddableId in memory; re-run conversations__setup_widget.' };
    }

    const client = getClient(context);
    if (!client) {
      return { error: 'ClientActionService not available — tool requires an authenticated websocket session.' };
    }

    const embeddablePatch: UpdateEmbeddableInput = {};
    if (input.color) {
      embeddablePatch.styles = {
        button_bg_color: input.color,
        header_bg_color: input.color,
      };
      embeddablePatch.shoutbox_bg = input.color;
    }
    if (input.position) embeddablePatch.shoutbox_position = input.position;

    if (Object.keys(embeddablePatch).length === 0) {
      return { message: 'No fields provided; nothing updated.' };
    }

    const result = await updateEmbeddable(client, appId, brandId, embeddableId, embeddablePatch);
    if (!result.success) return { error: `Failed to update embeddable: ${result.error}` };

    logger.info('conversations.skill.update.success', { appId, brandId, embeddableId, updated: Object.keys(embeddablePatch) });
    return { brandId, embeddableId, updated: Object.keys(embeddablePatch) };
  },
  config: { requiresApp: true, timeout: 15_000 },
};
