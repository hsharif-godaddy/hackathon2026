import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADSENSE_AUTHORING_CONFIG_PATH,
  ADSENSE_RUNTIME_MANIFEST_PATH,
  type AdSenseSettings,
} from '@airo/shared/adsense';

import { DevSupervisorError } from '../DevSupervisorClient.js';
import {
  AdSensePublishManifestInvalidConfigError,
  AdSensePublishManifestService,
} from '../AdSensePublishManifestService.js';

const appId = 'app1234567';
const publisherId = 'ca-pub-1234567890123456';
const canonicalScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}" crossorigin="anonymous"></script>`;

const enabledSettings: AdSenseSettings = {
  enabled: true,
  publisherId,
  scriptSnippet: canonicalScript,
  adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
  appAdsTxt: { enabled: false, content: 'draft app ads' },
  updatedAt: '2026-06-04T12:00:00.000Z',
};

const disabledSettings: AdSenseSettings = {
  enabled: false,
  publisherId: null,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
  updatedAt: null,
};

describe('AdSensePublishManifestService', () => {
  const readText = vi.fn();
  const write = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    write.mockResolvedValue({ bytesWritten: 400 });
  });

  function createService() {
    return new AdSensePublishManifestService(logger as any);
  }

  function createWorkspace() {
    return {
      files: {
        readText,
        write,
      },
    };
  }

  function expectRuntimeManifest(value: unknown) {
    expect(write).toHaveBeenCalledWith({
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
      content: `${JSON.stringify(value, null, 2)}\n`,
    });
  }

  it('writes the generated runtime manifest into dist for the next publish', async () => {
    readText.mockResolvedValue(JSON.stringify(enabledSettings));

    await createService().writeForPublish(appId, createWorkspace() as any);

    expect(readText).toHaveBeenCalledWith({ path: ADSENSE_AUTHORING_CONFIG_PATH });
    expectRuntimeManifest({
      version: 1,
      enabled: true,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: 'draft app ads' },
    });
  });

  it('converts an authoring .airo/adsense.json fixture into the generated dist manifest', async () => {
    readText.mockResolvedValue(`${JSON.stringify({
      enabled: true,
      scriptSnippet: canonicalScript.replace(' crossorigin="anonymous"', ''),
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      updatedAt: '2026-06-04T12:00:00.000Z',
    }, null, 2)}\n`);

    await createService().writeForPublish(appId, createWorkspace() as any);

    expect(readText).toHaveBeenCalledWith({ path: ADSENSE_AUTHORING_CONFIG_PATH });
    expectRuntimeManifest({
      version: 1,
      enabled: true,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    });
  });

  it('writes a disabled runtime manifest when settings are disabled so stale output cannot survive', async () => {
    readText.mockResolvedValue(JSON.stringify(disabledSettings));

    await createService().writeForPublish(appId, createWorkspace() as any);

    expectRuntimeManifest({
      version: 1,
      enabled: false,
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: false, content: '' },
      appAdsTxt: { enabled: false, content: '' },
    });
  });

  it('writes a disabled runtime manifest when the authoring file is missing', async () => {
    readText.mockRejectedValue(
      new DevSupervisorError('not_found', 404, `${ADSENSE_AUTHORING_CONFIG_PATH}: no such file`),
    );

    await createService().writeForPublish(appId, createWorkspace() as any);

    expectRuntimeManifest({
      version: 1,
      enabled: false,
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: false, content: '' },
      appAdsTxt: { enabled: false, content: '' },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('regenerates the script from publisher ID instead of trusting stale stored script text', async () => {
    readText.mockResolvedValue(JSON.stringify({
      ...enabledSettings,
      scriptSnippet:
        '<script async src="https://evil.example/ads.js?client=ca-pub-0000000000000000"></script>',
    }));

    await createService().writeForPublish(appId, createWorkspace() as any);

    expectRuntimeManifest({
      version: 1,
      enabled: true,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: 'draft app ads' },
    });
  });

  it('writes an empty disabled runtime manifest when Display Ads are globally disabled', async () => {
    readText.mockResolvedValue(JSON.stringify({
      ...enabledSettings,
      enabled: false,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    }));

    await createService().writeForPublish(appId, createWorkspace() as any);

    expectRuntimeManifest({
      version: 1,
      enabled: false,
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: false, content: '' },
      appAdsTxt: { enabled: false, content: '' },
    });
  });

  it('rejects malformed authoring JSON instead of publishing a disabled manifest', async () => {
    readText.mockResolvedValue('{not-json');

    await expect(createService().writeForPublish(appId, createWorkspace() as any)).rejects.toBeInstanceOf(
      AdSensePublishManifestInvalidConfigError,
    );

    expect(write).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'adsense.publish_manifest.settings.invalid',
      expect.objectContaining({
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        reason: 'malformed_json',
      }),
    );
  });

  it('rejects invalid stored payloads instead of publishing a disabled manifest', async () => {
    readText.mockResolvedValue(JSON.stringify({
      enabled: true,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: null },
      appAdsTxt: { enabled: 'yes', content: 'draft app ads' },
      updatedAt: '2026-06-04T12:00:00.000Z',
    }));

    await expect(createService().writeForPublish(appId, createWorkspace() as any)).rejects.toMatchObject({
      reason: 'settings_normalization_failed',
      details: {
        fields: expect.arrayContaining(['adsTxt', 'appAdsTxt']),
      },
    });

    expect(write).not.toHaveBeenCalled();
  });

  it('rejects inconsistent disabled payloads instead of publishing a disabled manifest', async () => {
    readText.mockResolvedValue(JSON.stringify({
      ...disabledSettings,
      scriptSnippet: canonicalScript,
    }));

    await expect(createService().writeForPublish(appId, createWorkspace() as any)).rejects.toMatchObject({
      reason: 'publisher_id_script_mismatch',
      details: {
        fields: ['publisherId', 'scriptSnippet'],
      },
    });

    expect(write).not.toHaveBeenCalled();
  });

  it('rejects disabled payloads with non-string script snippets', async () => {
    readText.mockResolvedValue(JSON.stringify({
      ...disabledSettings,
      scriptSnippet: null,
    }));

    await expect(createService().writeForPublish(appId, createWorkspace() as any)).rejects.toMatchObject({
      reason: 'script_snippet_not_string',
      details: {
        fields: ['scriptSnippet'],
      },
    });

    expect(write).not.toHaveBeenCalled();
  });

  it('propagates settings transport errors', async () => {
    readText.mockRejectedValue(
      new DevSupervisorError('permission_denied', 403, `${ADSENSE_AUTHORING_CONFIG_PATH}: permission denied`),
    );

    await expect(createService().writeForPublish(appId, createWorkspace() as any)).rejects.toThrow(
      'permission denied',
    );

    expect(write).not.toHaveBeenCalled();
  });

  it('propagates manifest write errors', async () => {
    readText.mockResolvedValue(JSON.stringify(enabledSettings));
    write.mockRejectedValue(new Error('write failed'));

    await expect(createService().writeForPublish(appId, createWorkspace() as any)).rejects.toThrow(
      'write failed',
    );
  });
});
