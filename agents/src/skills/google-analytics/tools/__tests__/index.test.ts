import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockListSecretNames = vi.fn();
const mockFindById = vi.fn();
const mockInstallTemplates = vi.fn();
const mockView = vi.fn();
const mockReadText = vi.fn();
const mockInsert = vi.fn();

vi.mock('../../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

vi.mock('../../../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: class DevSupervisorError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('../../../../tools/secrets-management-tool.js', () => ({
  SecretsManagementTool: class MockSecretsManagementTool {
    listSecretNames = mockListSecretNames;
  },
}));

vi.mock('../../../../tools/skill-loader-tool.js', () => ({
  SkillLoaderTool: class MockSkillLoaderTool {
    installTemplates = mockInstallTemplates;
  },
}));

vi.mock('../../../../database/repositories/AppRepository.js', () => ({
  AppRepository: class MockAppRepository {
    findById = mockFindById;
  },
}));

import { createForWorkspace } from '../../../../workspace/index.js';
import { DevSupervisorError } from '../../../../services/DevSupervisorClient.js';
import { checkConfigurationTool, installAnalyticsTool } from '../index.js';
import { createStubWorkspaceFiles } from '../../../../workspace/__tests__/test-workspace-files.js';

const mockCreateForWorkspace = vi.mocked(createForWorkspace);

function makeContext(appId?: string): unknown {
  return { metadata: { appId } };
}

function makeWorkspace() {
  return {
    tasks: {},
    files: createStubWorkspaceFiles({
      view: mockView,
      readText: mockReadText,
      insert: mockInsert,
    }),
  };
}

describe('google-analytics tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkConfiguration', () => {
    it('returns error when appId is missing', async () => {
      const result = await checkConfigurationTool.execute({}, makeContext(undefined));

      expect(result).toEqual({ success: false, error: 'App ID is required', recoverable: false });
    });

    it('returns recoverable error when workspace is unavailable', async () => {
      mockCreateForWorkspace.mockReturnValue(null);

      const result = await checkConfigurationTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        success: false,
        error: 'Workspace not available. The app container may not be running.',
        recoverable: true,
      });
    });

    it('returns configured=true when GA_MEASUREMENT_ID secret exists', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockListSecretNames.mockResolvedValue({
        success: true,
        secretNames: ['GA_MEASUREMENT_ID', 'OTHER_SECRET'],
        count: 2,
      });

      const result = await checkConfigurationTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({ configured: true, success: true });
    });

    it('returns requiresSecret when GA_MEASUREMENT_ID is not found', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockListSecretNames.mockResolvedValue({
        success: true,
        secretNames: ['OTHER_SECRET'],
        count: 1,
      });

      const result = await checkConfigurationTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        configured: false,
        action: 'requiresSecret',
        message: expect.stringContaining('GA_MEASUREMENT_ID is not configured'),
      });
    });

    it('returns requiresSecret when secret listing fails', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockListSecretNames.mockResolvedValue({
        success: false,
        secretNames: [],
        count: 0,
        error: 'Container not ready',
      });

      const result = await checkConfigurationTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        configured: false,
        action: 'requiresSecret',
        message: expect.stringContaining('Could not verify secret configuration'),
      });
    });

    it('returns recoverable error on unexpected exception', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockListSecretNames.mockRejectedValue(new Error('Network timeout'));

      const result = await checkConfigurationTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({ success: false, error: 'Network timeout', recoverable: true });
    });

    describe('computeState', () => {
      it('returns check-failed state on error', () => {
        const output = { success: false as const, error: 'failed', recoverable: true };
        const state = checkConfigurationTool.computeState!({}, output);

        expect(state).toMatchObject({ workflowState: 'check-failed', nextStep: 'retry-check' });
      });

      it('returns unconfigured state when not configured', () => {
        const output = { configured: false as const, action: 'requiresSecret' as const, message: '' };
        const state = checkConfigurationTool.computeState!({}, output);

        expect(state).toMatchObject({ workflowState: 'unconfigured', nextStep: 'request-secret' });
      });

      it('returns configured state when configured', () => {
        const output = { configured: true as const, success: true as const };
        const state = checkConfigurationTool.computeState!({}, output);

        expect(state).toMatchObject({ workflowState: 'configured', nextStep: 'install-analytics' });
      });
    });
  });

  describe('installAnalytics', () => {
    const ROOTLAYOUT_CONTENT = [
      "import { Helmet } from '@dr.pogodin/react-helmet';",
      "import Website from '@/layouts/Website';",
      '',
      'export default function RootLayout({ children }) {',
      '  return (',
      '    <Website>',
      '      <Helmet><title>App</title></Helmet>',
      '      {children}',
      '    </Website>',
      '  );',
      '}',
    ].join('\n');

    it('returns error when appId is missing', async () => {
      const result = await installAnalyticsTool.execute({}, makeContext(undefined));

      expect(result).toEqual({ success: false, error: 'App ID is required', recoverable: false });
    });

    it('returns error when workspace is unavailable', async () => {
      mockCreateForWorkspace.mockReturnValue(null);

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        success: false,
        error: 'Workspace not available. The app container may not be running.',
        recoverable: true,
      });
    });

    it('returns error when app is not found in database', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockFindById.mockReturnValue(null);

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({ success: false, error: 'App not found: app-123', recoverable: false });
    });

    it('returns error when template installation fails', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockFindById.mockReturnValue({ path: '/fake/path' });
      mockInstallTemplates.mockResolvedValue({ success: false, skill: 'google-analytics', error: 'Disk full' });

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({ success: false, error: 'Disk full', recoverable: true });
    });

    it('installs templates and patches RootLayout on happy path', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockFindById.mockReturnValue({ path: '/fake/path' });
      mockInstallTemplates.mockResolvedValue({
        success: true,
        skill: 'google-analytics',
        filesInstalled: 2,
        installedFiles: ['src/components/GoogleAnalytics.tsx', 'src/server/api/analytics/config/GET.ts'],
      });
      mockView.mockResolvedValue({ content: ROOTLAYOUT_CONTENT });
      mockReadText.mockResolvedValue(ROOTLAYOUT_CONTENT);
      mockInsert.mockResolvedValue({ lines: 1 });

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        success: true,
        filesInstalled: ['src/components/GoogleAnalytics.tsx', 'src/server/api/analytics/config/GET.ts'],
        rootLayoutPatched: true,
      });
      expect(mockInsert).toHaveBeenCalledTimes(2);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('import GoogleAnalytics') }),
      );
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('<GoogleAnalytics />') }),
      );
    });

    it('skips patching when RootLayout already has GoogleAnalytics', async () => {
      const alreadyPatched = ROOTLAYOUT_CONTENT
        .replace("import Website", "import GoogleAnalytics from '@/components/GoogleAnalytics';\nimport Website")
        .replace('<Website>', '<Website>\n      <GoogleAnalytics />');

      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockFindById.mockReturnValue({ path: '/fake/path' });
      mockInstallTemplates.mockResolvedValue({
        success: true,
        skill: 'google-analytics',
        filesInstalled: 0,
        installedFiles: [],
      });
      mockView.mockResolvedValue({ content: alreadyPatched });
      mockReadText.mockResolvedValue(alreadyPatched);

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({ success: true, filesInstalled: [], rootLayoutPatched: false });
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('returns error when RootLayout is missing', async () => {
      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockFindById.mockReturnValue({ path: '/fake/path' });
      mockInstallTemplates.mockResolvedValue({
        success: true,
        skill: 'google-analytics',
        filesInstalled: 2,
        installedFiles: ['src/components/GoogleAnalytics.tsx', 'src/server/api/analytics/config/GET.ts'],
      });
      mockView.mockRejectedValue(new DevSupervisorError('not found', 'not_found'));
      mockReadText.mockRejectedValue(new DevSupervisorError('not found', 'not_found'));

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        success: false,
        error: 'RootLayout.tsx not found at src/layouts/RootLayout.tsx',
        recoverable: false,
      });
    });

    it('returns error when <Website> element is missing from RootLayout', async () => {
      const noWebsite = 'import Foo from "foo";\nexport default function RootLayout() { return <div/>; }';

      mockCreateForWorkspace.mockReturnValue(makeWorkspace() as any);
      mockFindById.mockReturnValue({ path: '/fake/path' });
      mockInstallTemplates.mockResolvedValue({
        success: true,
        skill: 'google-analytics',
        filesInstalled: 2,
        installedFiles: ['src/components/GoogleAnalytics.tsx'],
      });
      // First readText: no import, no component — triggers import insert
      mockReadText.mockResolvedValueOnce(noWebsite);
      mockInsert.mockResolvedValue({ lines: 1 });
      // Second readText (after import insert): still no <Website>
      mockReadText.mockResolvedValueOnce(`import GoogleAnalytics from '@/components/GoogleAnalytics';\n${noWebsite}`);

      const result = await installAnalyticsTool.execute({}, makeContext('app-123'));

      expect(result).toEqual({
        success: false,
        error: 'Could not find <Website> element in RootLayout.tsx to insert GoogleAnalytics component',
        recoverable: false,
      });
    });

    describe('computeState', () => {
      it('returns install-failed state on error', () => {
        const output = { success: false as const, error: 'failed', recoverable: true };
        const state = installAnalyticsTool.computeState!({}, output);

        expect(state).toMatchObject({ workflowState: 'install-failed', nextStep: 'retry-install' });
      });

      it('returns installed state on success', () => {
        const output = { success: true as const, filesInstalled: ['a.ts'], rootLayoutPatched: true };
        const state = installAnalyticsTool.computeState!({}, output);

        expect(state).toMatchObject({
          workflowState: 'installed',
          filesInstalled: ['a.ts'],
          rootLayoutPatched: true,
          nextStep: 'confirm-to-user',
        });
      });
    });
  });
});
