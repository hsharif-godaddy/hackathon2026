import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADSENSE_AUTHORING_CONFIG_PATH,
  type AdSenseSettings,
} from '@airo/shared/adsense';

const {
  mockCreateForWorkspace,
  mockFiles,
  mockLogger,
  fixedNow,
} = vi.hoisted(() => ({
  mockCreateForWorkspace: vi.fn(),
  mockFiles: {
    view: vi.fn(),
    readText: vi.fn().mockResolvedValue('{}'),
    write: vi.fn(),
  },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  fixedNow: new Date('2026-06-04T12:00:00.000Z'),
}));

const { MockDevSupervisorError } = vi.hoisted(() => {
  class DevSupervisorError extends Error {
    constructor(public readonly code: string, public readonly statusCode: number, message: string) {
      super(message);
      this.name = 'DevSupervisorError';
    }
  }

  return { MockDevSupervisorError: DevSupervisorError };
});

vi.mock('../../workspace/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../workspace/index.js')>(),
  createForWorkspace: mockCreateForWorkspace,
}));

vi.mock('../DevSupervisorClient.js', () => ({
  DevSupervisorError: MockDevSupervisorError,
}));

import { WorkspaceUnavailableError } from '../../workspace/errors.js';
import {
  AdSenseSettingsFileService,
  AdSenseSettingsValidationError,
} from '../AdSenseSettingsFileService.js';

const appId = 'app1234567';
const publisherId = 'ca-pub-1234567890123456';
const canonicalScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}" crossorigin="anonymous"></script>`;
const disabledDefaults: AdSenseSettings = {
  enabled: false,
  publisherId: null,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
  updatedAt: null,
};

function createService() {
  return new AdSenseSettingsFileService({
    workspaceFactory: mockCreateForWorkspace,
    logger: mockLogger,
    now: () => fixedNow,
  });
}

describe('AdSenseSettingsFileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateForWorkspace.mockReturnValue({
      files: mockFiles,
    });
  });

  it('returns disabled defaults when the settings file is missing', async () => {
    mockFiles.readText.mockRejectedValue(
      new MockDevSupervisorError('not_found', 404, `${ADSENSE_AUTHORING_CONFIG_PATH}: no such file`),
    );

    await expect(createService().readSettings(appId)).resolves.toEqual(disabledDefaults);

    expect(mockCreateForWorkspace).toHaveBeenCalledWith(appId, 'preview');
    expect(mockFiles.readText).toHaveBeenCalledWith({ path: ADSENSE_AUTHORING_CONFIG_PATH });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns disabled defaults and logs a warning for malformed JSON', async () => {
    mockFiles.readText.mockResolvedValue('{not-json');

    await expect(createService().readSettings(appId)).resolves.toEqual(disabledDefaults);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'adsense.settings.read.malformed',
      expect.objectContaining({ appId, path: ADSENSE_AUTHORING_CONFIG_PATH }),
    );
  });

  it('normalizes a valid stored file and preserves updatedAt', async () => {
    mockFiles.readText.mockResolvedValue(JSON.stringify({
      enabled: true,
      scriptSnippet: canonicalScript.replace(' async ', ' '),
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: 'draft app ads' },
      updatedAt: '2026-06-03T10:00:00.000Z',
      ignored: 'field',
    }));

    await expect(createService().readSettings(appId)).resolves.toEqual({
      enabled: true,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: 'draft app ads' },
      updatedAt: '2026-06-03T10:00:00.000Z',
    });
  });

  it('returns disabled defaults and logs a warning for invalid stored payloads', async () => {
    mockFiles.readText.mockResolvedValue(JSON.stringify({
      enabled: true,
      scriptSnippet: '<script src="https://example.com/ads.js?client=ca-pub-1234567890123456"></script>',
      adsTxt: { enabled: true, content: '' },
    }));

    await expect(createService().readSettings(appId)).resolves.toEqual(disabledDefaults);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'adsense.settings.read.invalid',
      expect.objectContaining({
        appId,
        path: ADSENSE_AUTHORING_CONFIG_PATH,
        fields: expect.arrayContaining(['scriptSnippet', 'adsTxt']),
      }),
    );
  });

  it('writes canonical JSON to the authoring file and returns saved settings', async () => {
    mockFiles.write.mockResolvedValue({ bytesWritten: 400 });

    const saved = await createService().saveSettings(appId, {
      enabled: true,
      scriptSnippet: canonicalScript.replace(' crossorigin="anonymous"', ''),
      adsTxt: { enabled: false, content: 'draft ads.txt' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    });

    expect(saved).toEqual({
      enabled: true,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: false, content: 'draft ads.txt' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      updatedAt: fixedNow.toISOString(),
    });

    expect(mockFiles.write).toHaveBeenCalledWith({
      path: ADSENSE_AUTHORING_CONFIG_PATH,
      content: `${JSON.stringify(saved, null, 2)}\n`,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      'adsense.settings.save.success',
      expect.objectContaining({ appId, path: ADSENSE_AUTHORING_CONFIG_PATH }),
    );
  });

  it('preserves configured values when saving with Display Ads disabled', async () => {
    mockFiles.write.mockResolvedValue({ bytesWritten: 400 });

    const saved = await createService().saveSettings(appId, {
      enabled: false,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
    });

    expect(saved).toEqual({
      enabled: false,
      publisherId,
      scriptSnippet: canonicalScript,
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      updatedAt: fixedNow.toISOString(),
    });

    expect(mockFiles.write).toHaveBeenCalledWith({
      path: ADSENSE_AUTHORING_CONFIG_PATH,
      content: `${JSON.stringify(saved, null, 2)}\n`,
    });
  });

  it('throws validation errors for invalid save input', async () => {
    await expect(
      createService().saveSettings(appId, {
        enabled: true,
        scriptSnippet: '<script src="https://example.com/ads.js?client=ca-pub-1234567890123456"></script>',
      }),
    ).rejects.toMatchObject({
      errors: {
        scriptSnippet: 'AdSense script must load from pagead2.googlesyndication.com.',
      },
    });

    expect(mockFiles.write).not.toHaveBeenCalled();
    expect(AdSenseSettingsValidationError).toBeDefined();
  });

  it('surfaces workspace unavailable instead of returning disabled defaults', async () => {
    mockCreateForWorkspace.mockReturnValue(null);

    await expect(createService().readSettings(appId)).rejects.toBeInstanceOf(WorkspaceUnavailableError);
    await expect(createService().saveSettings(appId, { enabled: false })).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });

  it('surfaces workspace transport failures instead of returning disabled defaults', async () => {
    mockFiles.readText.mockRejectedValue(
      new MockDevSupervisorError('permission_denied', 403, `${ADSENSE_AUTHORING_CONFIG_PATH}: permission denied`),
    );

    await expect(createService().readSettings(appId)).rejects.toThrow('permission denied');
  });
});
