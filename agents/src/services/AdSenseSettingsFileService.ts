import {
  ADSENSE_AUTHORING_CONFIG_PATH,
  normalizeAdSenseSettingsInput,
  type AdSenseSettings,
  type AdSenseSettingsInput,
  type AdSenseSettingsWrite,
  type AdSenseValidationErrors,
} from '@airo/shared/adsense';

import { Logger, type ILogger } from '../logging/index.js';
import { DevSupervisorError } from './DevSupervisorClient.js';
import type { CreateForWorkspace } from '../workspace/client.js';
import { createForWorkspace, resolveWorkspaceFiles } from '../workspace/index.js';

const DEFAULT_ADSENSE_SETTINGS: AdSenseSettings = {
  enabled: false,
  publisherId: null,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
  updatedAt: null,
};

interface AdSenseSettingsFileServiceDeps {
  workspaceFactory?: CreateForWorkspace;
  logger?: ILogger;
  now?: () => Date;
}

export class AdSenseSettingsValidationError extends Error {
  constructor(public readonly errors: AdSenseValidationErrors) {
    super('Invalid AdSense settings');
    this.name = 'AdSenseSettingsValidationError';
  }
}

export class AdSenseSettingsFileService {
  private readonly workspaceFactory: CreateForWorkspace;
  private readonly logger: ILogger;
  private readonly now: () => Date;

  constructor(deps: AdSenseSettingsFileServiceDeps = {}) {
    this.workspaceFactory = deps.workspaceFactory ?? createForWorkspace;
    this.logger = deps.logger ?? Logger.create({ component: 'adsense-settings-file-service' });
    this.now = deps.now ?? (() => new Date());
  }

  async readSettings(appId: string): Promise<AdSenseSettings> {
    const files = resolveWorkspaceFiles(appId, 'preview', this.workspaceFactory);

    try {
      const result = await files.view({ path: ADSENSE_AUTHORING_CONFIG_PATH });
      const parsed = JSON.parse(result.content) as unknown;
      const settings: AdSenseSettings | null = this.normalizeStoredSettings(parsed);

      if (!settings) {
        return this.disabledDefaultsWithWarning(appId, 'adsense.settings.read.invalid', {
          fields: this.getValidationFields(parsed),
        });
      }

      this.logger.info('adsense.settings.read.success', {
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        hasPublisherId: settings.publisherId !== null,
      });

      return settings;
    } catch (error) {
      if (error instanceof DevSupervisorError && error.code === 'not_found') {
        this.logger.debug('adsense.settings.read.missing', {
          appId,
          path: ADSENSE_AUTHORING_CONFIG_PATH,
        });
        return this.getDisabledDefaults();
      }

      if (error instanceof SyntaxError) {
        return this.disabledDefaultsWithWarning(appId, 'adsense.settings.read.malformed', {
          error: error.message,
        });
      }

      this.logger.error('adsense.settings.read.failed', {
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async saveSettings(appId: string, input: AdSenseSettingsInput): Promise<AdSenseSettings> {
    const files = resolveWorkspaceFiles(appId, 'preview', this.workspaceFactory);

    const normalized = normalizeAdSenseSettingsInput(input);
    if (!normalized.ok) {
      throw new AdSenseSettingsValidationError(normalized.errors);
    }

    const settings: AdSenseSettings = {
      ...normalized.value,
      updatedAt: this.now().toISOString(),
    };

    try {
      await files.write({
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        content: `${JSON.stringify(settings, null, 2)}\n`,
      });

      this.logger.info('adsense.settings.save.success', {
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        hasPublisherId: settings.publisherId !== null,
      });

      return settings;
    } catch (error) {
      this.logger.error('adsense.settings.save.failed', {
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  private normalizeStoredSettings(value: unknown): AdSenseSettings | null {
    const normalized = normalizeAdSenseSettingsInput(value);
    if (!normalized.ok) {
      return null;
    }

    return {
      ...normalized.value,
      updatedAt: getStoredUpdatedAt(value),
    };
  }

  private disabledDefaultsWithWarning(
    appId: string,
    event: string,
    data: Record<string, unknown>,
  ): AdSenseSettings {
    this.logger.warn(event, {
      appId,
      path: ADSENSE_AUTHORING_CONFIG_PATH,
      ...data,
    });

    return this.getDisabledDefaults();
  }

  private getDisabledDefaults(): AdSenseSettings {
    return {
      ...DEFAULT_ADSENSE_SETTINGS,
      adsTxt: { ...DEFAULT_ADSENSE_SETTINGS.adsTxt },
      appAdsTxt: { ...DEFAULT_ADSENSE_SETTINGS.appAdsTxt },
    };
  }

  private getValidationFields(value: unknown): string[] {
    const normalized = normalizeAdSenseSettingsInput(value);
    return normalized.ok ? [] : Object.keys(normalized.errors);
  }
}

function getStoredUpdatedAt(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return typeof value.updatedAt === 'string' ? value.updatedAt : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { AdSenseSettingsWrite };
