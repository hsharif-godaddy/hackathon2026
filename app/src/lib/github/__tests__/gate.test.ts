import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: vi.fn(),
}));

import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { enforce, isEnabled } from '../gate';

const fakeRequest = { headers: new Headers() } as any;

describe('github-gate', function gateTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
  });

  describe('#isEnabled', function enabledTests() {
    it('returns true when switchboard flag is on', async function on() {
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);
      expect(await isEnabled(fakeRequest)).toBe(true);
    });

    it('returns false when switchboard flag is off', async function off() {
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);
      expect(await isEnabled(fakeRequest)).toBe(false);
    });

    it('returns false when switchboard throws', async function error() {
      vi.mocked(checkSwitchboardFlag).mockRejectedValue(new Error('boom'));
      expect(await isEnabled(fakeRequest)).toBe(false);
    });
  });

  describe('#enforce', function enforceTests() {
    it('returns null when enabled', async function allowed() {
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(true);
      expect(await enforce(fakeRequest)).toBeNull();
    });

    it('returns 403 response when disabled', async function forbidden() {
      vi.mocked(checkSwitchboardFlag).mockResolvedValue(false);
      const response = await enforce(fakeRequest);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(403);
      expect(await response!.json()).toEqual({
        error: 'GitHub sync is not currently enabled',
      });
    });
  });
});
