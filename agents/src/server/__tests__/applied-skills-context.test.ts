import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockFindById = vi.fn();

vi.mock('../../database/repositories/index.js', () => ({
  appRepository: { findById: mockFindById },
}));

const mockHydrate = vi.fn().mockResolvedValue(undefined);
const mockGetInstalledSkills = vi.fn();
const mockReadSkillState = vi.fn();

vi.mock('../../tools/applied-skills-registry.js', () => ({
  appliedSkillsRegistry: {
    hydrateFromAppPath: mockHydrate,
    getInstalledSkills: mockGetInstalledSkills,
    readSkillState: mockReadSkillState,
  },
}));

const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../logging/index.js', () => ({
  logger: { warn: mockLoggerWarn, error: mockLoggerError },
}));

const { buildAppliedSkillsContextMessage } = await import('../applied-skills-context.js');

const APP_PATH = '/apps/myapp';

describe('applied-skills-context', () => {
  describe('#buildAppliedSkillsContextMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockHydrate.mockResolvedValue(undefined);
      mockFindById.mockReturnValue({ path: APP_PATH });
    });

    it('returns null when appId is undefined', async function noId() {
      const result = await buildAppliedSkillsContextMessage(undefined);
      expect(result).toBeNull();
      expect(mockHydrate).not.toHaveBeenCalled();
    });

    it('returns null when appId is not found in the repository', async function notFound() {
      mockFindById.mockReturnValue(null);

      const result = await buildAppliedSkillsContextMessage('app-unknown');
      expect(result).toBeNull();
      expect(mockHydrate).not.toHaveBeenCalled();
    });

    it('returns null when no skills are installed', async function empty() {
      mockGetInstalledSkills.mockReturnValue(new Map());

      const result = await buildAppliedSkillsContextMessage('app-1');
      expect(result).toBeNull();
    });

    it('resolves appPath from the repository and hydrates the registry', async function hydrates() {
      mockGetInstalledSkills.mockReturnValue(new Map());

      await buildAppliedSkillsContextMessage('app-1');

      expect(mockFindById).toHaveBeenCalledWith('app-1');
      expect(mockHydrate).toHaveBeenCalledWith(APP_PATH);
    });

    it('returns a user message with role and after_history insertionOrder', async function structure() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([['stripe-v2', { installedAt: '2024-01-01T00:00:00.000Z' }]])
      );
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result).not.toBeNull();
      expect(result?.role).toBe('user');
      expect(result?.insertionOrder).toBe('after_history');
    });

    it('includes skill name and installed_at in the XML', async function skillAttrs() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([['stripe-v2', { installedAt: '2024-01-01T00:00:00.000Z' }]])
      );
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result?.content).toContain('name="stripe-v2"');
      expect(result?.content).toContain('installed_at="2024-01-01T00:00:00.000Z"');
    });

    it('wraps all skills in <applied_skills> XML element', async function xmlWrapper() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([['auth', { installedAt: '2024-02-01T00:00:00.000Z' }]])
      );
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result?.content).toContain('<applied_skills>');
      expect(result?.content).toContain('</applied_skills>');
    });

    it('includes <current_state> JSON when the skill has state', async function withState() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([['stripe-v2', { installedAt: '2024-01-01T00:00:00.000Z' }]])
      );
      mockReadSkillState.mockResolvedValue({
        provisioned: true,
        sandboxId: 'cbsbx_test',
        claimStatus: 'provisioned',
      });

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result?.content).toContain('<current_state>');
      expect(result?.content).toContain('"provisioned": true');
      expect(result?.content).toContain('"sandboxId": "cbsbx_test"');
    });

    it('omits <current_state> data inside skill element when the skill has no state file', async function noState() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([['conversations', { installedAt: '2024-02-01T00:00:00.000Z' }]])
      );
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result?.content).toContain('<skill name="conversations"');
      expect(result?.content).toMatch(/<skill name="conversations"[^>]*><\/skill>/);
    });

    it('renders multiple skills in a single message', async function multipleSkills() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([
          ['stripe-v2', { installedAt: '2024-01-01T00:00:00.000Z' }],
          ['conversations', { installedAt: '2024-02-01T00:00:00.000Z' }],
          ['commerce', { installedAt: '2024-03-01T00:00:00.000Z' }],
        ])
      );
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result?.content).toContain('name="stripe-v2"');
      expect(result?.content).toContain('name="conversations"');
      expect(result?.content).toContain('name="commerce"');
    });

    it('reads state for each skill independently', async function perSkillState() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([
          ['stripe-v2', { installedAt: '2024-01-01T00:00:00.000Z' }],
          ['conversations', { installedAt: '2024-02-01T00:00:00.000Z' }],
        ])
      );
      mockReadSkillState
        .mockResolvedValueOnce({ provisioned: true, sandboxId: 'cbsbx_test' })
        .mockResolvedValueOnce({ accountId: 'acc-123' });

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(mockReadSkillState).toHaveBeenCalledWith('stripe-v2', APP_PATH);
      expect(mockReadSkillState).toHaveBeenCalledWith('conversations', APP_PATH);
      expect(result?.content).toContain('"sandboxId": "cbsbx_test"');
      expect(result?.content).toContain('"accountId": "acc-123"');
    });

    it('includes continuation rules in the message content', async function rules() {
      mockGetInstalledSkills.mockReturnValue(
        new Map([['auth', { installedAt: '2024-01-01T00:00:00.000Z' }]])
      );
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result?.content).toContain('Do NOT re-scaffold');
      expect(result?.content).toContain('Load a skill only if the user asks to extend it');
    });

    it('renders a skill element without installed_at when it is missing from the entry', async function noTimestamp() {
      mockGetInstalledSkills.mockReturnValue(new Map([['auth', {}]]));
      mockReadSkillState.mockResolvedValue(null);

      const result = await buildAppliedSkillsContextMessage('app-1');

      expect(result).not.toBeNull();
      expect(result?.content).toContain('name="auth"');
      expect(result?.content).not.toContain('installed_at=');
    });

    describe('error handling', () => {
      afterEach(() => {
        mockLoggerWarn.mockReset();
        mockLoggerError.mockReset();
      });

      it('skips a failing skill and includes the rest when readSkillState throws', async function skipBrokenSkill() {
        mockGetInstalledSkills.mockReturnValue(
          new Map([
            ['broken', { installedAt: '2024-01-01T00:00:00.000Z' }],
            ['healthy', { installedAt: '2024-02-01T00:00:00.000Z' }],
          ])
        );
        mockReadSkillState
          .mockRejectedValueOnce(new Error('unexpected fs error'))
          .mockResolvedValueOnce({ configured: true });

        const result = await buildAppliedSkillsContextMessage('app-1');

        expect(result).not.toBeNull();
        expect(result?.content).not.toContain('name="broken"');
        expect(result?.content).toContain('name="healthy"');
      });

      it('logs applied_skills.context.skill_failed with skill name when a per-skill error occurs', async function logSkillFail() {
        const err = new Error('unexpected fs error');
        mockGetInstalledSkills.mockReturnValue(
          new Map([['broken', { installedAt: '2024-01-01T00:00:00.000Z' }]])
        );
        mockReadSkillState.mockRejectedValue(err);

        await buildAppliedSkillsContextMessage('app-1');

        expect(mockLoggerWarn).toHaveBeenCalledWith(
          'applied_skills.context.skill_failed',
          expect.objectContaining({ appId: 'app-1', skill: 'broken', error: err.message })
        );
      });

      it('returns null when all skills fail', async function allFail() {
        mockGetInstalledSkills.mockReturnValue(
          new Map([['broken', { installedAt: '2024-01-01T00:00:00.000Z' }]])
        );
        mockReadSkillState.mockRejectedValue(new Error('boom'));

        const result = await buildAppliedSkillsContextMessage('app-1');

        expect(result).toBeNull();
      });

      it('returns null and logs applied_skills.context.build_failed when an outer error occurs', async function outerFail() {
        const err = new Error('hydrate exploded');
        mockHydrate.mockRejectedValue(err);
        mockGetInstalledSkills.mockReturnValue(
          new Map([['auth', { installedAt: '2024-01-01T00:00:00.000Z' }]])
        );

        const result = await buildAppliedSkillsContextMessage('app-1');

        expect(result).toBeNull();
        expect(mockLoggerError).toHaveBeenCalledWith(
          'applied_skills.context.build_failed',
          expect.objectContaining({ appId: 'app-1', error: err.message })
        );
      });
    });
  });
});
