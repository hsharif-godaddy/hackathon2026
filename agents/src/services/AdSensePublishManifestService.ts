import {
  ADSENSE_AUTHORING_CONFIG_PATH,
  ADSENSE_RUNTIME_MANIFEST_PATH,
  buildCanonicalAdSenseScript,
  normalizeAdSenseSettingsInput,
  type AdSensePublishManifest,
} from '@airo/shared/adsense';

import { Logger, type ILogger } from '../logging/index.js';
import type { WorkspaceClient } from '../workspace/client.js';
import { isDevSupervisorNotFound } from './DevSupervisorClient.js';

type AdSenseAuthoringConfigReadResult =
  | { status: 'missing' }
  | { status: 'invalid'; reason: string; details?: Record<string, unknown> }
  | { status: 'ok'; value: unknown };

export class AdSensePublishManifestInvalidConfigError extends Error {
  readonly code = 'adsense_authoring_config_invalid';

  constructor(
    public readonly appId: string,
    public readonly reason: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(formatInvalidConfigMessage(reason, details));
    this.name = 'AdSensePublishManifestInvalidConfigError';
  }
}

export class AdSensePublishManifestService {
  private readonly logger: ILogger;

  constructor(
    logger: ILogger = Logger.create({ component: 'adsense-publish-manifest-service' }),
  ) {
    this.logger = logger;
  }

  async writeForPublish(appId: string, workspace: Pick<WorkspaceClient, 'files'>): Promise<void> {
    const authoringConfig = await this.readAuthoringConfig(appId, workspace);
    const manifest = this.buildManifest(appId, authoringConfig);

    await workspace.files.write({
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    });

    this.logger.info('adsense.publish_manifest.write.success', {
      appId,
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
      hasPublisherId: manifest.publisherId !== null,
    });
  }

  private async readAuthoringConfig(
    appId: string,
    workspace: Pick<WorkspaceClient, 'files'>,
  ): Promise<AdSenseAuthoringConfigReadResult> {
    try {
      const content: string = await workspace.files.readText({ path: ADSENSE_AUTHORING_CONFIG_PATH });

      try {
        return { status: 'ok', value: JSON.parse(content) as unknown };
      } catch (error) {
        if (error instanceof SyntaxError) {
          return {
            status: 'invalid',
            reason: 'malformed_json',
            details: { error: error.message },
          };
        }

        throw error;
      }
    } catch (error) {
      if (isDevSupervisorNotFound(error)) {
        this.logger.debug('adsense.publish_manifest.settings.missing', {
          appId,
          path: ADSENSE_AUTHORING_CONFIG_PATH,
        });
        return { status: 'missing' };
      }

      this.logger.error('adsense.publish_manifest.settings.read.failed', {
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  private buildManifest(appId: string, authoringConfig: AdSenseAuthoringConfigReadResult): AdSensePublishManifest {
    if (authoringConfig.status === 'missing') {
      return createDisabledManifest();
    }

    if (authoringConfig.status === 'invalid') {
      this.throwInvalidConfig(appId, authoringConfig.reason, authoringConfig.details);
    }

    const settings = authoringConfig.value;
    if (!isRecord(settings)) {
      this.throwInvalidConfig(appId, 'settings_not_object');
    }

    const normalized = normalizeAdSenseSettingsInput(this.toNormalizedSettingsInput(appId, settings));

    if (!normalized.ok) {
      this.throwInvalidConfig(appId, 'settings_normalization_failed', {
        errors: normalized.errors,
        fields: Object.keys(normalized.errors),
      });
    }

    if (!normalized.value.enabled) {
      return createDisabledManifest();
    }

    return {
      version: 1,
      ...normalized.value,
    };
  }

  private toNormalizedSettingsInput(appId: string, settings: Record<string, unknown>): Record<string, unknown> {
    if (!('publisherId' in settings)) {
      return settings;
    }

    if (settings.publisherId === null) {
      if (settings.scriptSnippet !== undefined && typeof settings.scriptSnippet !== 'string') {
        this.throwInvalidConfig(appId, 'script_snippet_not_string', {
          fields: ['scriptSnippet'],
        });
      }

      if (typeof settings.scriptSnippet === 'string' && settings.scriptSnippet.trim().length > 0) {
        this.throwInvalidConfig(appId, 'publisher_id_script_mismatch', {
          fields: ['publisherId', 'scriptSnippet'],
        });
      }

      return {
        ...settings,
        scriptSnippet: '',
      };
    }

    if (typeof settings.publisherId !== 'string') {
      this.throwInvalidConfig(appId, 'publisher_id_not_string', {
        fields: ['publisherId'],
      });
    }

    try {
      return {
        ...settings,
        scriptSnippet: buildCanonicalAdSenseScript(settings.publisherId),
      };
    } catch (error) {
      this.throwInvalidConfig(appId, 'publisher_id_invalid', {
        error: getErrorMessage(error),
        fields: ['publisherId'],
      });
    }
  }

  private throwInvalidConfig(appId: string, reason: string, details: Record<string, unknown> = {}): never {
    this.logger.warn('adsense.publish_manifest.settings.invalid', {
      appId,
      path: ADSENSE_AUTHORING_CONFIG_PATH,
      reason,
      ...details,
    });
    throw new AdSensePublishManifestInvalidConfigError(appId, reason, details);
  }
}

function createDisabledManifest(): AdSensePublishManifest {
  return {
    version: 1,
    enabled: false,
    publisherId: null,
    scriptSnippet: '',
    adsTxt: { enabled: false, content: '' },
    appAdsTxt: { enabled: false, content: '' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatInvalidConfigMessage(reason: string, details: Record<string, unknown>): string {
  const fields = Array.isArray(details.fields) && details.fields.length > 0
    ? ` fields=${details.fields.join(',')}`
    : '';

  return `Invalid AdSense authoring config at ${ADSENSE_AUTHORING_CONFIG_PATH}: ${reason}${fields}`;
}
