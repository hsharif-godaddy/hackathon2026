import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SwitchboardRequest } from '@/lib/switchboard/server';
import type { ActivateInput, DeactivateInput } from '../dkim-service';
import { DkimService } from '../dkim-service';
import { DomainOrigin } from '../utils';

const {
  mockActivateDkim,
  mockDeactivateDkim,
  mockCheckSwitchboardFlag,
  mockLogger,
  mockShipAnalyticsLog,
} = vi.hoisted(() => ({
  mockActivateDkim: vi.fn(),
  mockDeactivateDkim: vi.fn(),
  mockCheckSwitchboardFlag: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockShipAnalyticsLog: vi.fn(),
}));

vi.mock('../dkim-client', () => ({
  DkimClient: vi.fn(function () { return {
    activateDkim: mockActivateDkim,
    deactivateDkim: mockDeactivateDkim,
  }; }),
}));
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));
vi.mock('@/lib/logging', () => ({ shipAnalyticsLog: mockShipAnalyticsLog }));

// Stand-in for the NextRequest threaded through to switchboard. The real
// switchboard client only reads `.headers`, so providing a minimal shape
// is sufficient and avoids pulling next/server into the test.
const fakeRequest: SwitchboardRequest = {
  headers: { cookie: 'auth_idp=test', 'x-shopper-id': 'shopper-1' },
};

describe('DkimService', () => {
  const baseInput: ActivateInput = {
    appId: 'app-123',
    domain: 'example.com',
    shopperId: 'shopper-1',
    origin: DomainOrigin.INTERNAL,
  };

  beforeEach(() => {
    mockActivateDkim.mockReset();
    mockDeactivateDkim.mockReset();
    mockCheckSwitchboardFlag.mockReset();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockShipAnalyticsLog.mockClear();
  });

  describe('activate', () => {
    it('returns skipped when feature flag is off', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(false);
      const service = new DkimService();
      const result = await service.activate(baseInput, fakeRequest);
      expect(result).toEqual({ result: 'skipped', reason: 'feature_flag_off' });
      expect(mockActivateDkim).not.toHaveBeenCalled();
    });

    it('passes the request through to switchboard so per-shopper rules fire', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockActivateDkim.mockResolvedValue({ executionArn: 'arn:123' });
      const service = new DkimService();
      await service.activate(baseInput, fakeRequest);
      // Critical: switchboard must receive the actual request (not { headers: {} })
      // so per-shopperId / per-cookie rollout criteria evaluate against real values.
      expect(mockCheckSwitchboardFlag).toHaveBeenCalledWith('appbuilder-dkim-onboarding', fakeRequest);
    });

    it('returns skipped with unsupported_origin for EXTERNAL', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      const service = new DkimService();
      const result = await service.activate({ ...baseInput, origin: DomainOrigin.EXTERNAL }, fakeRequest);
      expect(result).toEqual({ result: 'skipped', reason: 'unsupported_origin' });
      expect(mockActivateDkim).not.toHaveBeenCalled();
      // EXTERNAL skip ships an analytics outcome — verify the payload reaches
      // the billing/funnel pipeline (not just that it was called).
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'dkim.onboard.outcome',
        { result: 'skipped', origin: DomainOrigin.EXTERNAL },
      );
    });

    it('calls activateDkim with INTERNAL origin and returns accepted', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockActivateDkim.mockResolvedValue({ executionArn: 'arn:123' });
      const service = new DkimService();
      const result = await service.activate(baseInput, fakeRequest);
      expect(result).toEqual({ result: 'accepted', executionArn: 'arn:123' });
      expect(mockActivateDkim).toHaveBeenCalledWith(
        'example.com',
        DomainOrigin.INTERNAL,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      );
      // Successful onboarding ships its own analytics — verify the payload.
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'dkim.onboard.outcome',
        { result: 'accepted', origin: DomainOrigin.INTERNAL },
      );
    });

    it('returns failed (no throw) when DkimClient throws', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockActivateDkim.mockRejectedValue(new Error('network error'));
      const service = new DkimService();
      const result = await service.activate(baseInput, fakeRequest);
      expect(result).toMatchObject({ result: 'failed', error: expect.stringContaining('network error') });
      expect(mockLogger.error).toHaveBeenCalled();
      // Failure also ships analytics; the dashboard tracks failure rate.
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'dkim.onboard.outcome',
        { result: 'failed', origin: DomainOrigin.INTERNAL },
      );
    });

    it('logs dkim.activate.start and .success at info level (not warn)', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockActivateDkim.mockResolvedValue({ executionArn: 'arn:123' });
      const service = new DkimService();
      await service.activate(baseInput, fakeRequest);
      // Per LOGGING-GUIDE.md, normal-flow operational events are info, not warn.
      expect(mockLogger.info).toHaveBeenCalledWith('dkim.activate.start', expect.objectContaining({ domain: 'example.com' }));
      expect(mockLogger.info).toHaveBeenCalledWith('dkim.activate.success', expect.objectContaining({ executionArn: 'arn:123' }));
      expect(mockLogger.warn).not.toHaveBeenCalledWith('dkim.activate.start', expect.anything());
    });
  });

  describe('deactivate', () => {
    const deactivateInput: DeactivateInput = {
      appId: 'app-123',
      domain: 'example.com',
      shopperId: 'shopper-1',
    };

    it('returns skipped when feature flag is off', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(false);
      const service = new DkimService();
      const result = await service.deactivate(deactivateInput, fakeRequest);
      expect(result).toEqual({ result: 'skipped', reason: 'feature_flag_off' });
    });

    it('passes the request through to switchboard', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockDeactivateDkim.mockResolvedValue({ executionArn: 'arn:456' });
      const service = new DkimService();
      await service.deactivate(deactivateInput, fakeRequest);
      expect(mockCheckSwitchboardFlag).toHaveBeenCalledWith('appbuilder-dkim-onboarding', fakeRequest);
    });

    it('calls deactivateDkim and returns deactivated', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockDeactivateDkim.mockResolvedValue({ executionArn: 'arn:456' });
      const service = new DkimService();
      const result = await service.deactivate(deactivateInput, fakeRequest);
      expect(result).toEqual({ result: 'deactivated', executionArn: 'arn:456' });
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('dkim.offboard.outcome', { result: 'deactivated' });
    });

    it('returns failed (no throw) when DkimClient throws', async () => {
      mockCheckSwitchboardFlag.mockResolvedValue(true);
      mockDeactivateDkim.mockRejectedValue(new Error('timeout'));
      const service = new DkimService();
      const result = await service.deactivate(deactivateInput, fakeRequest);
      expect(result).toMatchObject({ result: 'failed' });
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('dkim.offboard.outcome', { result: 'failed' });
    });
  });
});
