import { randomUUID } from 'node:crypto';
import type { AppRepository } from '../database/repositories/AppRepository.js';
import { discoverSeoRoutes } from './seo-audit.js';
import type { ILogger } from '../logging/types.js';

const INDEX_NOW_API = 'https://api.indexnow.org/indexnow';
const PING_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes per IndexNow FAQ

// In-memory throttle: resets on container restart (intentional — restart implies content change)
const lastPingAt = new Map<string, number>();

const SYSTEM_HOST_SUFFIXES = [
  '.airoapp.ai',
  '.test-airoapp.ai',
  '.dev-airoapp.ai',
  '.dev-godaddy.com',
];

export function isIndexNowEligibleHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1') return false;
  return !SYSTEM_HOST_SUFFIXES.some(
    (s) => h === s.replace(/^\./, '') || h.endsWith(s),
  );
}

export function buildIndexNowUrlList(appPath: string, host: string): string[] {
  return discoverSeoRoutes(appPath).map((p) => `https://${host}${p}`);
}

export function getOrCreateIndexNowKey(
  appId: string,
  appRepository: AppRepository,
): string {
  const app = appRepository.findById(appId);
  if (app?.indexnowKey) return app.indexnowKey;
  const key = randomUUID().replace(/-/g, '');
  appRepository.setIndexNowKey(appId, key);
  return key;
}

export async function pingIndexNow(
  appId: string,
  host: string,
  key: string,
  urlList: string[],
  logger: Pick<ILogger, 'info' | 'warn' | 'error'>,
): Promise<void> {
  if (urlList.length === 0) {
    logger.info('indexnow.ping.skipped', { appId, host, reason: 'empty url list' });
    return;
  }
  const throttleKey = `${appId}:${host}`;
  const last = lastPingAt.get(throttleKey);
  const now = Date.now();
  if (last !== undefined && now - last < PING_THROTTLE_MS) {
    logger.info('indexnow.ping.skipped', { appId, host, reason: 'throttled', nextEligibleMs: last + PING_THROTTLE_MS - now });
    return;
  }
  const body = JSON.stringify({
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList,
  });
  const response = await fetch(INDEX_NOW_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  // Set after fetch resolves so network errors don't lock the throttle window
  lastPingAt.set(throttleKey, now);
  const logData = { appId, host, urlCount: urlList.length, status: response.status };
  if (response.ok) {
    logger.info('indexnow.ping.result', logData);
  } else {
    logger.warn('indexnow.ping.rejected', logData);
  }
}
