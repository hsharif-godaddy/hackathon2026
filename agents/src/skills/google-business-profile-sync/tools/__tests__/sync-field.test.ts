import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFindByAppAndPlatform = vi.fn();
const mockSearch = vi.fn();
const mockEdit = vi.fn();
const mockCreateForWorkspace = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => instance };
  return { logger: instance, Logger: { create: () => instance } };
});

vi.mock('../../../../database/repositories/SocialAssociationRepository.js', () => ({
  SocialAssociationRepository: class {
    findByAppAndPlatform(...args: unknown[]) {
      return mockFindByAppAndPlatform(...args);
    }
  },
}));

vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => mockCreateForWorkspace(...args),
}));

import { syncFieldTool } from '../sync-field.js';
import { GBP_UPDATE_DONE } from '../../../../types/social.js';
import { createStubWorkspaceFiles } from '../../../../workspace/__tests__/test-workspace-files.js';

const CTX = { metadata: { appId: 'app1' } };

function run(input: Record<string, unknown>, context: Record<string, unknown> = CTX) {
  return syncFieldTool.execute(input, context);
}

describe('google-business-profile-sync syncField tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);
    mockSearch.mockResolvedValue([]);
    mockEdit.mockResolvedValue({ applied: 1 });
    mockCreateForWorkspace.mockReturnValue({ files: createStubWorkspaceFiles({ search: mockSearch, edit: mockEdit }) });
  });

  describe('execute — site-to-gbp', () => {
    it('returns error when appId is missing', async () => {
      const result = await run({ field: 'phone', direction: 'site-to-gbp', value: '(555) 1' }, { metadata: {} });
      expect(result).toMatchObject({ success: false, error: 'App ID is required' });
    });

    it('emits an updateGbp signal with mapped updates (pass 1)', async () => {
      const result = await run({ field: 'phone', direction: 'site-to-gbp', value: '(555) 123-9999' });
      expect(result).toMatchObject({
        action: 'updateGbp',
        success: true,
        socialId: 'gbp-123',
        field: 'phone',
        updates: { primaryPhone: '(555) 123-9999' },
      });
    });

    it('maps each field to its GoogleBusinessProfile key', async () => {
      expect(await run({ field: 'name', direction: 'site-to-gbp', value: 'Acme' })).toMatchObject({ updates: { name: 'Acme' } });
      expect(await run({ field: 'website', direction: 'site-to-gbp', value: 'https://x.com' })).toMatchObject({ updates: { websiteUri: 'https://x.com' } });
      expect(await run({ field: 'address', direction: 'site-to-gbp', value: { addressLines: ['1 A St'] } })).toMatchObject({
        updates: { storefrontAddress: { addressLines: ['1 A St'] } },
      });
      expect(await run({ field: 'hours', direction: 'site-to-gbp', value: { periods: [] } })).toMatchObject({
        updates: { regularHours: { periods: [] } },
      });
    });

    it('rejects a structured field given a non-JSON string value', async () => {
      const result = await run({ field: 'address', direction: 'site-to-gbp', value: '123 Main St' });
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('storefrontAddress object');
      expect(mockFindByAppAndPlatform).not.toHaveBeenCalled();
    });

    it('accepts a structured field passed as a JSON string (models often stringify objects)', async () => {
      const address = { addressLines: ['1 A St'], locality: 'SF', regionCode: 'US' };
      const result = await run({ field: 'address', direction: 'site-to-gbp', value: JSON.stringify(address) });
      expect(result).toMatchObject({ action: 'updateGbp', success: true, updates: { storefrontAddress: address } });

      const hours = { periods: [{ openDay: 'MONDAY' }] };
      const hoursResult = await run({ field: 'hours', direction: 'site-to-gbp', value: JSON.stringify(hours) });
      expect(hoursResult).toMatchObject({ action: 'updateGbp', success: true, updates: { regularHours: hours } });
    });

    it('returns needsReconnect when GBP is not connected', async () => {
      mockFindByAppAndPlatform.mockReturnValue([]);
      const result = await run({ field: 'phone', direction: 'site-to-gbp', value: '(555) 123-9999' });
      expect(result).toMatchObject({ success: false, needsReconnect: true });
      expect(result.error).toContain('No Google Business Profile connection');
    });

    it('reads GBP_UPDATE_DONE for the matching field on pass 2 (success)', async () => {
      const result = await run(
        { field: 'phone', direction: 'site-to-gbp', value: '(555) 123-9999' },
        { metadata: { appId: 'app1' }, contextAttachments: [{ type: GBP_UPDATE_DONE, data: { field: 'phone', updated: ['primaryPhone'] } }] }
      );
      expect(result).toMatchObject({ success: true, field: 'phone', updated: ['primaryPhone'] });
      // pass 2 should not re-query the connection
      expect(mockFindByAppAndPlatform).not.toHaveBeenCalled();
    });

    it('surfaces an error from the GBP_UPDATE_DONE attachment', async () => {
      const result = await run(
        { field: 'hours', direction: 'site-to-gbp', value: { periods: [] } },
        { metadata: { appId: 'app1' }, contextAttachments: [{ type: GBP_UPDATE_DONE, data: { field: 'hours', updated: [], error: '401 unauthorized' } }] }
      );
      expect(result).toMatchObject({ success: false, error: '401 unauthorized', needsReconnect: true });
    });

    it('ignores a GBP_UPDATE_DONE attachment for a different field (emits signal)', async () => {
      const result = await run(
        { field: 'phone', direction: 'site-to-gbp', value: '(555) 123-9999' },
        { metadata: { appId: 'app1' }, contextAttachments: [{ type: GBP_UPDATE_DONE, data: { field: 'name', updated: ['name'] } }] }
      );
      expect(result).toMatchObject({ action: 'updateGbp', field: 'phone' });
    });
  });

  describe('execute — gbp-to-site (source edit)', () => {
    it('searches for the previous value and edits each matching file', async () => {
      mockSearch.mockResolvedValue([
        { path: 'src/components/Footer.tsx', line: 10, column: 1, preview: '' },
        { path: 'src/components/Footer.tsx', line: 20, column: 1, preview: '' },
        { path: 'src/pages/contact.tsx', line: 5, column: 1, preview: '' },
      ]);
      mockEdit.mockResolvedValue({ applied: 1 });

      const result = await run({ field: 'phone', direction: 'gbp-to-site', value: '(555) 123-9999', previousValue: '(555) 123-4567' });

      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ pattern: '\\(555\\) 123-4567' }));
      // two unique files (Footer deduped)
      expect(mockEdit).toHaveBeenCalledTimes(2);
      expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({ oldString: '(555) 123-4567', newString: '(555) 123-9999', replaceAll: true }));
      expect(result).toMatchObject({
        success: true,
        field: 'phone',
        direction: 'gbp-to-site',
        editedFiles: ['src/components/Footer.tsx', 'src/pages/contact.tsx'],
        occurrences: 2,
        widespread: false,
      });
    });

    it('previews a wide replace without editing, then commits on apply (#2/#3)', async () => {
      const many = Array.from({ length: 12 }, (_, i) => ({ path: `src/f${i}.tsx`, line: 1, column: 1, preview: '' }));
      mockSearch.mockResolvedValue(many); // 12 files > HIGH_FILE_THRESHOLD (5) → widespread

      // First call: preview only, no mutation.
      const preview = await run({ field: 'name', direction: 'gbp-to-site', value: 'New Co', previousValue: 'Co' });
      expect(preview).toMatchObject({ success: true, direction: 'gbp-to-site', needsConfirmation: true });
      expect((preview as { matchedFiles: string[] }).matchedFiles).toHaveLength(12);
      expect(mockEdit).not.toHaveBeenCalled();

      // apply:true commits the wide edit after user approval.
      mockEdit.mockResolvedValue({ applied: 1 });
      const applied = await run({ field: 'name', direction: 'gbp-to-site', value: 'New Co', previousValue: 'Co', apply: true });
      expect(applied).toMatchObject({ success: true, direction: 'gbp-to-site', widespread: true });
      expect(mockEdit).toHaveBeenCalled();
    });

    it('previews a short value even when it matches just one file (#2 short-value guard)', async () => {
      mockSearch.mockResolvedValue([{ path: 'src/footer.tsx', line: 1, column: 1, preview: '' }]); // 1 file, not widespread by count

      const preview = await run({ field: 'address', direction: 'gbp-to-site', value: 'AZ', previousValue: 'CA' });
      expect(preview).toMatchObject({ success: true, direction: 'gbp-to-site', needsConfirmation: true });
      expect(mockEdit).not.toHaveBeenCalled();

      // apply:true commits after the user approves the short-value replace.
      const applied = await run({ field: 'address', direction: 'gbp-to-site', value: 'AZ', previousValue: 'CA', apply: true });
      expect(applied).toMatchObject({ success: true, direction: 'gbp-to-site' });
      expect(mockEdit).toHaveBeenCalled();
    });

    it('requires previousValue for gbp-to-site', async () => {
      const result = await run({ field: 'phone', direction: 'gbp-to-site', value: '(555) 123-9999' });
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('previousValue');
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('rejects a non-string value for gbp-to-site', async () => {
      const result = await run({ field: 'address', direction: 'gbp-to-site', value: { addressLines: ['x'] }, previousValue: 'old' });
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('string value');
    });

    it('reports noChange when previousValue equals value (already matches)', async () => {
      const result = await run({ field: 'name', direction: 'gbp-to-site', value: 'Acme', previousValue: 'Acme' });
      expect(result).toMatchObject({ success: true, direction: 'gbp-to-site', noChange: true });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('errors when the workspace is unavailable', async () => {
      mockCreateForWorkspace.mockReturnValue(null);
      const result = await run({ field: 'phone', direction: 'gbp-to-site', value: 'b', previousValue: 'a' });
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('Workspace');
    });

    it('reports failure when matches were found but nothing could be edited (#7)', async () => {
      mockSearch.mockResolvedValue([
        { path: 'a.tsx', line: 1, column: 1, preview: '' },
        { path: 'b.tsx', line: 1, column: 1, preview: '' },
      ]);
      mockEdit.mockImplementation(({ path }: { path: string }) => {
        if (path === 'a.tsx') return Promise.resolve({ applied: 0 });
        return Promise.reject(new Error('locked'));
      });

      const result = await run({ field: 'phone', direction: 'gbp-to-site', value: '(555) 123-9999', previousValue: '(555) 123-4567' });
      // Search matched 2 files but 0 edits applied → hollow success would be misleading.
      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toContain('none could be edited');
    });

    it('refuses a value with source-breaking characters (#2)', async () => {
      const result = await run({ field: 'name', direction: 'gbp-to-site', value: 'Tom <Jerry> {Co}', previousValue: 'Old Name' });
      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toMatch(/corrupt the site source|< > \{ \}/);
      expect(mockSearch).not.toHaveBeenCalled();
      expect(mockEdit).not.toHaveBeenCalled();
    });
  });

  describe('computeState', () => {
    it('returns updating-gbp on the pass-1 signal', () => {
      const state = syncFieldTool.computeState?.({}, { action: 'updateGbp', success: true, socialId: 'g', field: 'phone', updates: {} });
      expect(state).toMatchObject({ workflowState: 'updating-gbp', nextStep: 'wait-for-update-attachment', syncField: 'phone', lastError: null });
    });

    it('returns gbp-updated on success', () => {
      const state = syncFieldTool.computeState?.({}, { success: true, field: 'phone', updated: ['primaryPhone'] });
      expect(state).toMatchObject({ workflowState: 'gbp-updated', syncedField: 'phone', nextStep: 'sync-next-field' });
    });

    it('returns site-edited for a gbp-to-site result', () => {
      const state = syncFieldTool.computeState?.(
        {},
        { success: true, field: 'phone', direction: 'gbp-to-site', editedFiles: ['a.tsx', 'b.tsx'], occurrences: 3 }
      );
      expect(state).toMatchObject({ workflowState: 'site-edited', syncedField: 'phone', editedCount: 2, nextStep: 'verify-site-sync' });
    });

    it('returns reconnect next step when needsReconnect', () => {
      const state = syncFieldTool.computeState?.({}, { success: false, error: 'token expired', needsReconnect: true });
      expect(state).toMatchObject({ workflowState: 'gbp-update-failed', nextStep: 'reconnect-gbp' });
    });

    it('returns retry next step otherwise', () => {
      const state = syncFieldTool.computeState?.({}, { success: false, error: 'oops' });
      expect(state?.nextStep).toBe('retry-sync-field');
    });
  });
});
