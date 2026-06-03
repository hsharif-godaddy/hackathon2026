import { logger } from '../logger.js';

export interface ExtractedEvent {
  eid: string;
  customerId: string;
  appId: string;
}

/**
 * Extracts eid, customerId, and appId from a raw Kinesis event payload.
 * Returns null if any required field is missing — callers should skip such events.
 */
export function extract(raw: unknown): ExtractedEvent | null {
  if (!raw || typeof raw !== 'object') {
    logger.warn('extractor.extract.invalid_payload', { type: typeof raw });
    return null;
  }

  const event = raw as Record<string, unknown>;
  const detail = event['detail'] as Record<string, unknown> | undefined;
  if (!detail) {
    logger.warn('extractor.extract.missing_detail');
    return null;
  }

  const global_ = detail['global'] as Record<string, unknown> | undefined;
  const context = global_?.['context'] as Record<string, unknown> | undefined;
  const customerId = context?.['customerId'];

  const eventSection = detail['event'] as Record<string, unknown> | undefined;
  const eventData = eventSection?.['data'] as Record<string, unknown> | undefined;
  const traffic = eventData?.['traffic'] as Record<string, unknown> | undefined;
  const eid = traffic?.['eid'];
  const customProperties = traffic?.['customProperties'] as Record<string, unknown> | undefined;
  const appId = customProperties?.['appId'];

  if (!eid || typeof eid !== 'string') {
    logger.warn('extractor.extract.missing_eid', { hasTraffic: Boolean(traffic), eidValue: eid });
    return null;
  }
  if (!customerId || typeof customerId !== 'string') {
    logger.warn('extractor.extract.missing_customerId', { eid, customerIdValue: customerId });
    return null;
  }
  if (!appId || typeof appId !== 'string') {
    logger.warn('extractor.extract.missing_appId', { eid, appIdValue: appId });
    return null;
  }

  logger.info('extractor.extract.success', { eid, customerId, appId });
  return { eid, customerId, appId };
}
