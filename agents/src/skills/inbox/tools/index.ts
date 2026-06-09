/**
 * Inbox Skill Tools
 *
 * Tools for connecting an Inbox chat widget to the site.
 * The account ID is persisted in memory under `integrations.inbox.brandId`.
 *
 *   discover_account       — find or auto-create the account for this app
 *   setup_widget           — find/create the default embeddable, write config
 *   update_widget_config   — sync widget settings to backend + config file
 *
 * Tools own the config file (src/lib/inboxChat.config.json). They read it,
 * merge changes, and write it back. The agent never edits the config directly.
 * See skill.md for the full flow.
 */

import { z } from 'zod';
import { access, writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SkillToolDefinition, SkillHooks } from '@airo/ai-skills';
import { Logger } from '../../../logging/index.js';
import { appRepository } from '../../../database/repositories/index.js';
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js';
import { getActionService } from '../../../server/agent-runtime.js';
import type { IClientActionService } from '../../../services/ClientActionService.js';
import {
  listAccounts,
  activateAccount,
  listEmbeddables,
  createEmbeddable,
  updateEmbeddable,
  listCategories,
  createCategory,
  type UpdateEmbeddableInput,
} from '../../../services/inbox-client.js';
import { readWidgetConfig, writeWidgetConfig } from './widget-config.js';
import { createForWorkspace } from '../../../workspace/index.js';
import { regenerateEntryApiRegistrations } from '../../../utils/entry-api-sync.js';

const logger = Logger.create({ component: 'inbox.skill' });
const memoryRepo = new MemoryRepository();

// Memory keys — per-app pointers to backend resources.
const MEM_ACCOUNT_ID = 'integrations.inbox.accountId';
const MEM_BRAND_ID = 'integrations.inbox.brandId';
const MEM_EMBEDDABLE_ID = 'integrations.inbox.embeddableId';
const MEM_CATEGORY_ID = 'integrations.inbox.contactFormCategoryId';

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

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
    logger.info('inbox.skill.installed', { appPath: ctx.appPath });
  },
};

// ============================================================================
// discover_account — find or auto-create the Inbox account for this app
// ============================================================================

export const discoverAccountTool: SkillToolDefinition = {
  name: 'discover_account',
  description:
    'Discover or provision the Inbox account for this app. ' +
    'If an account is already saved in memory, returns it immediately (idempotent). ' +
    'If listAccounts returns an account already linked to this app (matching aabAppId), ' +
    'saves it to memory and returns it. Otherwise, auto-creates a new account from the ' +
    'first available entitlement. Returns alreadyConfigured or accountCreated on success, ' +
    'noAccounts if no entitlements are available. ' +
    'After this succeeds, proceed to inbox__setup_widget (for chat) or inbox__ensure_email_channel (for contact form).',

  parameters: z.object({}),
  execute: async (_input: Record<string, never>, context?: ToolContext) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const existingAccount = await memoryRepo.get(appId, MEM_ACCOUNT_ID);
    const existingBrand = await memoryRepo.get(appId, MEM_BRAND_ID);
    if (existingBrand.exists && existingAccount.exists) {
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
      if (!linkedToThisApp.accountUrl || !linkedToThisApp.brandUrl) {
        return { error: 'Account response missing required fields (accountUrl or brandUrl)' };
      }
      await memoryRepo.set(appId, MEM_ACCOUNT_ID, linkedToThisApp.accountUrl);
      await memoryRepo.set(appId, MEM_BRAND_ID, linkedToThisApp.brandUrl);
      logger.info('inbox.skill.discover_account.found_linked', { appId, accountUrl: linkedToThisApp.accountUrl, brandUrl: linkedToThisApp.brandUrl });
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

      const accountUrl = activateResult.data.accountUrl;
      const brandUrl = activateResult.data.brandUrl;
      if (!accountUrl || !brandUrl) {
        return { error: 'Account activation response missing required fields (accountUrl or brandUrl)' };
      }
      await memoryRepo.set(appId, MEM_ACCOUNT_ID, accountUrl);
      await memoryRepo.set(appId, MEM_BRAND_ID, brandUrl);
      logger.info('inbox.skill.discover_account.auto_created', { appId, accountUrl, brandUrl });
      return { accountCreated: true, accountId: brandUrl };
    }

    return {
      noAccounts: true,
      message:
        'No Inbox accounts found for this app and no entitlements available for creating a new one.',
    };
  },
  config: { requiresApp: true, timeout: 30_000 },
};

// ============================================================================
// setup_widget — find embeddable, return brandId. Idempotent.
// ============================================================================

export const setupWidgetTool: SkillToolDefinition = {
  name: 'setup_widget',
  description:
    'Wire the Inbox chat widget into this site. Looks up the Inbox account ' +
    '(must already be configured via discover_account), ensures a default embeddable exists, ' +
    'syncs color/icon to the backend, and writes the config file. ' +
    'After this tool succeeds, you MUST import and mount <InboxChatWidget /> in src/App.tsx. ' +
    'Idempotent. If the account is not configured, returns brandNotProvisioned: true.',
  parameters: z.object({
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional()
      .describe('Hex color for chat button / header background (e.g. "#1e40af")'),
  }),
  execute: async (
    input: {
      color?: string;
    },
    context?: ToolContext,
  ) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const app = await appRepository.findById(appId);
    if (!app?.path) return { error: `Could not resolve app path for appId: ${appId}` };

    // 0. Auto-install templates if either file doesn't exist yet
    const widgetPath = join(app.path, 'src', 'components', 'InboxChatWidget.tsx');
    const configPath = join(app.path, 'src', 'lib', 'inboxChat.config.json');
    const [widgetExists, configExists] = await Promise.all([
      fileExists(widgetPath),
      fileExists(configPath),
    ]);
    if (!widgetExists || !configExists) {
      try {
        const chatTemplateDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'chat-templates');
        const [widgetTemplate, configTemplate] = await Promise.all([
          readFile(join(chatTemplateDir, 'components', 'InboxChatWidget.tsx'), 'utf-8'),
          readFile(join(chatTemplateDir, 'lib', 'inboxChat.config.json'), 'utf-8'),
        ]);
        await Promise.all([
          !widgetExists && mkdir(dirname(widgetPath), { recursive: true }).then(() => writeFile(widgetPath, widgetTemplate)),
          !configExists && mkdir(dirname(configPath), { recursive: true }).then(() => writeFile(configPath, configTemplate)),
        ]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to auto-install inbox template: ${message}` };
      }
    }

    // 1. Account must already exist (set via discover_account + select_account)
    const brandRead = await memoryRepo.get(appId, MEM_BRAND_ID);
    if (!brandRead.exists) {
      logger.warn('inbox.skill.setup.brand_not_provisioned', { appId });
      return {
        brandNotProvisioned: true,
        message:
          'No Inbox account is configured for this site. ' +
          'Run inbox__discover_account first to let the user choose their account.',
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
        return { error: 'Corrupted embeddableId in memory; re-run inbox__setup_widget.' };
      }
      needsUpdate = true;
      logger.info('inbox.skill.setup.embeddable.reuse', { appId, brandId, embeddableId });
    } else {
      const list = await listEmbeddables(client, appId, brandId);
      if (!list.success) {
        return { error: `Failed to list embeddables for brand ${brandId}: ${list.error}` };
      }

      const existing = list.data[0];
      if (existing) {
        embeddableId = existing.id;
        needsUpdate = true;
        logger.info('inbox.skill.setup.embeddable.found', { appId, brandId, embeddableId });
      } else {
        const created = await createEmbeddable(client, appId, brandId, {
          title: app.name ?? 'Chat Widget',
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
        logger.info('inbox.skill.setup.embeddable.created', { appId, brandId, embeddableId });
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
      const updateResult = await updateEmbeddable(client, appId, brandId, embeddableId, embeddablePatch);
      if (!updateResult.success) {
        return { error: `Failed to update embeddable for brand ${brandId}: ${updateResult.error}` };
      }
    }

    // 4. Write the config file
    const config = await readWidgetConfig(configPath);
    config._support.account = brandId;
    config._support.ui.widget.icon = 'webChat';
    if (input.color) config._support.ui.widget.color = input.color;
    await writeWidgetConfig(configPath, config);

    return {
      brandId,
      embeddableId,
      configWritten: configPath,
      NEXT_STEP:
        'Import and mount <InboxChatWidget /> in src/App.tsx — ' +
        "add `import InboxChatWidget from './components/InboxChatWidget';` at the top, " +
        'then render `<InboxChatWidget />` inside the root JSX (outside <Routes>, at the top level). ' +
        'The widget will NOT appear until this is done.',
    };
  },
  computeState(input: any, output: any) {
    if (!output?.brandId) return null;
    return {
      accountId: output.brandId,
      embeddableId: output.embeddableId,
      ...(input.color && { color: input.color }),
      configuredAt: new Date().toISOString(),
    };
  },
  config: { requiresApp: true, timeout: 30_000 },
};

// ============================================================================
// update_widget_config — sync settings to backend + write config file
// ============================================================================

export const updateWidgetConfigTool: SkillToolDefinition = {
  name: 'update_widget_config',
  description:
    'Update widget settings: syncs to the backend and writes the config file. ' +
    'Requires inbox__setup_widget to have run first. Omit a field to leave it unchanged.',
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
    labelText: z
      .string()
      .optional()
      .describe('Greeting text shown in the chat bubble (e.g. "Chat with us!")'),
  }),
  execute: async (
    input: {
      color?: string;
      position?: 'bottom-right' | 'bottom-left';
      labelText?: string;
    },
    context?: ToolContext,
  ) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const app = await appRepository.findById(appId);
    if (!app?.path) return { error: `Could not resolve app path for appId: ${appId}` };

    const brandRead = await memoryRepo.get(appId, MEM_BRAND_ID);
    const embeddableRead = await memoryRepo.get(appId, MEM_EMBEDDABLE_ID);
    if (!brandRead.exists || !embeddableRead.exists) {
      return {
        error: 'Run inbox__setup_widget first — account or embeddable ID missing from memory.',
      };
    }
    const brandId = brandRead.value as string;
    const embeddableId = Number(embeddableRead.value);
    if (!Number.isFinite(embeddableId)) {
      return { error: 'Corrupted embeddableId in memory; re-run inbox__setup_widget.' };
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
    if (input.labelText) embeddablePatch.shoutbox_label = input.labelText;

    if (Object.keys(embeddablePatch).length === 0) {
      return { message: 'No fields provided; nothing updated.' };
    }

    const result = await updateEmbeddable(client, appId, brandId, embeddableId, embeddablePatch);
    if (!result.success) return { error: `Failed to update embeddable: ${result.error}` };

    // Write the config file — always restore account from memory in case the file was deleted
    const configPath = join(app.path, 'src', 'lib', 'inboxChat.config.json');
    const config = await readWidgetConfig(configPath);
    config._support.account = brandId;
    if (input.color) config._support.ui.widget.color = input.color;
    if (input.position) config._support.ui.widget.position = input.position;
    if (input.labelText) config._support.ui.widget.label = { text: input.labelText };
    await writeWidgetConfig(configPath, config);

    logger.info('inbox.skill.update.success', { appId, brandId, embeddableId, updated: Object.keys(embeddablePatch) });
    return { brandId, embeddableId, updated: Object.keys(embeddablePatch), configWritten: configPath };
  },
  computeState(input: any, output: any) {
    if (!output?.brandId) return null;
    return {
      ...(input.color && { color: input.color }),
      ...(input.position && { position: input.position }),
    };
  },
  config: { requiresApp: true, timeout: 15_000 },
};

// ============================================================================
// ensure_email_channel — ensure an email category exists for the brand
// ============================================================================

export const ensureEmailChannelTool: SkillToolDefinition = {
  name: 'ensure_email_channel',
  description:
    'Ensure the brand has an active email channel (category) for receiving contact form submissions. ' +
    'Creates one named "Contact Form" if none exists. ' +
    'Requires discover_account to have run first. ' +
    'After this succeeds, proceed to inbox__setup_form.',

  parameters: z.object({}),
  execute: async (_input: Record<string, never>, context?: ToolContext) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const brandRead = await memoryRepo.get(appId, MEM_BRAND_ID);
    if (!brandRead.exists) {
      return { error: 'No account configured. Run inbox__discover_account first.' };
    }
    const brandId = brandRead.value as string;

    const client = getClient(context);
    if (!client) {
      return { error: 'ClientActionService not available — tool requires an authenticated websocket session.' };
    }

    const listResult = await listCategories(client, appId, brandId);
    if (!listResult.success) {
      return { error: `Failed to list categories: ${listResult.error}` };
    }

    // email channels always have status 'enabled' or 'disabled'.
    const emailChannel = listResult.data.find(
      (cat) => cat.channel_type === 1 && cat.status === 'enabled',
    );

    if (emailChannel) {
      await memoryRepo.set(appId, MEM_CATEGORY_ID, emailChannel.id);
      logger.info('inbox.skill.ensure_email_channel.found', { appId, brandId, categoryId: emailChannel.id });
      return { alreadyExists: true, categoryId: emailChannel.id, name: emailChannel.name };
    }

    const createResult = await createCategory(client, appId, brandId, {
      name: 'Contact Form',
      channel_type: 1,
    });
    if (!createResult.success) {
      return { error: `Failed to create email channel: ${createResult.error}` };
    }

    await memoryRepo.set(appId, MEM_CATEGORY_ID, createResult.data.id);
    logger.info('inbox.skill.ensure_email_channel.created', { appId, brandId, categoryId: createResult.data.id });
    return { created: true, categoryId: createResult.data.id, name: createResult.data.name };
  },
  config: { requiresApp: true, timeout: 30_000 },
};

// ============================================================================
// setup_form — install contact form templates and write config
// ============================================================================

interface ContactFormEntry {
  brandId: string;
  categoryId: number | string;
  overrideEmail?: string;
}

interface ContactFormConfig {
  forms: Record<string, ContactFormEntry>;
}

async function readExistingConfig(configPath: string): Promise<ContactFormConfig> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw) as ContactFormConfig;
  } catch {
    return { forms: {} };
  }
}

export const setupFormTool: SkillToolDefinition = {
  name: 'setup_form',
  description:
    'Install the contact form server route and write config for a named form. ' +
    'Requires discover_account and ensure_email_channel to have run first. ' +
    'Can be called multiple times with different names to create multiple forms. ' +
    'Each form name must be unique (calling again with the same name updates the entry). ' +
    'After this succeeds, build the form component that POSTs to /api/contact/{name}.',

  parameters: z.object({
    name: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase alphanumeric with hyphens (e.g. "contact-us", "support")')
      .describe('Unique slug name for this contact form (e.g. "contact-us", "support-request").'),
    overrideEmail: z
      .string()
      .email()
      .optional()
      .describe('If set, submissions from this form will be sent to this email address instead of the default inbox.'),
  }),
  execute: async (input: { name: string; overrideEmail?: string }, context?: ToolContext) => {
    const appId = getAppId(context);
    if (!appId) return { error: 'App ID required. Pass context.metadata.appId.' };

    const app = await appRepository.findById(appId);
    if (!app?.path) return { error: `Could not resolve app path for appId: ${appId}` };

    const brandRead = await memoryRepo.get(appId, MEM_BRAND_ID);
    if (!brandRead.exists) {
      return { error: 'No account configured. Run inbox__discover_account first.' };
    }
    const brandId = brandRead.value as string;

    const categoryRead = await memoryRepo.get(appId, MEM_CATEGORY_ID);
    if (!categoryRead.exists) {
      return { error: 'No email channel configured. Run inbox__ensure_email_channel first.' };
    }
    const categoryId = categoryRead.value as number | string;

    const routePath = join(app.path, 'src', 'server', 'api', 'contact', '[formName]', 'POST.ts');
    const configPath = join(app.path, 'src', 'lib', 'contact-form.config.json');

    const routeExists = await fileExists(routePath);

    if (!routeExists) {
      try {
        const templateDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'contact-templates');
        const routeTemplate = await readFile(join(templateDir, 'server', 'api', 'contact', '[formName]', 'POST.ts'), 'utf-8');
        await mkdir(dirname(routePath), { recursive: true });
        await writeFile(routePath, routeTemplate);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to install contact form route: ${message}` };
      }
    }

    const config = await readExistingConfig(configPath);
    const entry: ContactFormEntry = { brandId, categoryId };
    if (input.overrideEmail) {
      entry.overrideEmail = input.overrideEmail;
    }
    config.forms[input.name] = entry;

    const configJson = JSON.stringify(config, null, 2) + '\n';
    try {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, configJson);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to write contact form config: ${message}` };
    }

    // Also write to dist/ so the published bundle (which runs from dist/) can find it.
    // The SSR build uses emptyOutDir:false so this file survives the build.
    const distConfigPath = join(app.path, 'dist', 'contact-form.config.json');
    try {
      await mkdir(dirname(distConfigPath), { recursive: true });
      await writeFile(distConfigPath, configJson);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('inbox.skill.setup_form.dist_config_write_failed', { appId, error: msg });
    }

    // Auto-register the route in entry.ts via the workspace API.
    const workspace = createForWorkspace(appId, 'preview');
    let routeRegistration: { registered: boolean; reason?: string } = { registered: false, reason: 'no-workspace' };
    if (workspace) {
      try {
        const result = await regenerateEntryApiRegistrations(workspace.files);
        if (result.changed) {
          routeRegistration = { registered: true };
          logger.info('inbox.skill.setup_form.entry_regenerated', {
            appId,
            routeCount: result.routeCount,
          });
        } else {
          routeRegistration = { registered: false, reason: result.reason };
          logger.warn('inbox.skill.setup_form.entry_not_registered', {
            appId,
            reason: result.reason,
            routeCount: result.routeCount,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        routeRegistration = { registered: false, reason: message };
        logger.warn('inbox.skill.setup_form.entry_regenerate_failed', {
          appId,
          error: message,
        });
      }
    }

    logger.info('inbox.skill.setup_form.success', { appId, brandId, categoryId, formName: input.name });

    return {
      success: true,
      formName: input.name,
      postUrl: `/api/contact/${input.name}`,
      configWritten: configPath,
      routeInstalled: routePath,
      routeRegistration,
      nextSteps: [
        `Build a form component that POSTs to /api/contact/${input.name} with: { conversation: { messages_attributes: [{ body }], data: { __gd_contact_form_title, ... } }, user: { email, name } }`,
        'The server route returns { success: true } or { success: false, error: "message" }',
      ],
    };
  },
  config: { requiresApp: true, timeout: 30_000 },
};
