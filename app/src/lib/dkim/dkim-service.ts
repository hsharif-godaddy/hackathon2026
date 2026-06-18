import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag, type SwitchboardRequest } from '@/lib/switchboard/server';
import { DkimClient } from './dkim-client';
import type { DkimActivateOutcome, DkimDeactivateOutcome } from './types';
import { DomainOrigin, getNextRotationDate } from './utils';

export interface ActivateInput {
  appId: string;
  domain: string;
  shopperId: string;
  origin: DomainOrigin;
}

export interface DeactivateInput {
  appId: string;
  domain: string;
  shopperId: string;
}

export class DkimService {
  /**
   * Activate DKIM for a domain.
   *
   * `request` is plumbed through to switchboard so per-shopper /
   * per-customer rollout criteria fire correctly. An empty headers
   * object would strip the cookie-derived shopper context and force
   * switchboard to evaluate against defaults — meaning a "enable for
   * shopperId=X" rollout rule silently never matches.
   */
  async activate(input: ActivateInput, request: SwitchboardRequest): Promise<DkimActivateOutcome> {
    const { appId, domain, shopperId, origin } = input;

    const flagOn = await checkSwitchboardFlag('appbuilder-dkim-onboarding', request);
    if (!flagOn) {
      logger.info('dkim.activate.skipped', { appId, domain, reason: 'feature_flag_off' });
      return { result: 'skipped', reason: 'feature_flag_off' };
    }

    const nextRotation = getNextRotationDate();
    logger.info('dkim.activate.start', { appId, domain, origin, nextRotation });

    try {
      const client = new DkimClient(shopperId);
      const { executionArn } = await client.activateDkim(domain, origin, nextRotation);
      logger.info('dkim.activate.success', { appId, domain, origin, executionArn });
      shipAnalyticsLog('dkim.onboard.outcome', { result: 'accepted', origin });
      return { result: 'accepted', executionArn };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('dkim.activate.failed', { appId, domain, origin, error });
      shipAnalyticsLog('dkim.onboard.outcome', { result: 'failed', origin });
      return { result: 'failed', error };
    }
  }

  /** See activate() for why `request` is required. */
  async deactivate(input: DeactivateInput, request: SwitchboardRequest): Promise<DkimDeactivateOutcome> {
    const { appId, domain, shopperId } = input;

    const flagOn = await checkSwitchboardFlag('appbuilder-dkim-onboarding', request);
    if (!flagOn) {
      logger.info('dkim.deactivate.skipped', { appId, domain, reason: 'feature_flag_off' });
      return { result: 'skipped', reason: 'feature_flag_off' };
    }

    logger.info('dkim.deactivate.start', { appId, domain });
    try {
      const client = new DkimClient(shopperId);
      const { executionArn } = await client.deactivateDkim(domain);
      logger.info('dkim.deactivate.success', { appId, domain, executionArn });
      shipAnalyticsLog('dkim.offboard.outcome', { result: 'deactivated' });
      return { result: 'deactivated', executionArn };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('dkim.deactivate.failed', { appId, domain, error });
      shipAnalyticsLog('dkim.offboard.outcome', { result: 'failed' });
      return { result: 'failed', error };
    }
  }
}
