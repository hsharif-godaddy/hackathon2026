import type { IClientActionService } from './ClientActionService.js';
import { mediaManifestService } from './MediaManifestService.js';
import { getStaff, updateBrand, updateStaff, type InboxResult } from './inbox-client.js';
import { Logger } from '../logging/index.js';
import { LOGO_SLOT_PATHS } from './logo/logo-slots.js';

const logger = Logger.create({ component: 'inbox.avatar-sync' });

const LOGO_SLOTS_BY_PRIORITY: string[] = [LOGO_SLOT_PATHS.square, LOGO_SLOT_PATHS.horizontal, LOGO_SLOT_PATHS.vertical];

async function resolveLogoUrl(appId: string): Promise<string | null> {
  for (const slot of LOGO_SLOTS_BY_PRIORITY) {
    const result = await mediaManifestService.getSlot(appId, slot);
    if (result.success && result.slot?.currentUrl) {
      return result.slot.currentUrl;
    }
    if (!result.success && !result.error?.startsWith('Slot not found')) {
      logger.warn('inbox.avatar_sync.resolve_logo.slot_error', { appId, slot, error: result.error });
    }
  }
  return null;
}

export async function updateInboxAvatar(
  client: IClientActionService,
  appId: string,
  brandId: string,
  avatarUrl: string | null,
): Promise<InboxResult<void>> {
  const staffResult = await getStaff(client, appId, brandId);
  if (!staffResult.success) return staffResult;

  const [staffUpdate, brandUpdate] = await Promise.all([
    updateStaff(client, appId, brandId, staffResult.data.id, { avatar_url: avatarUrl }),
    updateBrand(client, appId, brandId, { avatar_url: avatarUrl }),
  ]);

  if (!staffUpdate.success || !brandUpdate.success) {
    const errors: string[] = [];
    if (!staffUpdate.success) errors.push(`staff: ${staffUpdate.error}`);
    if (!brandUpdate.success) errors.push(`brand: ${brandUpdate.error}`);
    return { success: false, error: errors.join(', ') };
  }
  return { success: true, data: undefined };
}

export async function syncAppLogoToInboxAvatar(
  client: IClientActionService,
  appId: string,
  brandId: string,
): Promise<void> {
  const logoUrl: string | null = await resolveLogoUrl(appId);
  if (!logoUrl) {
    logger.info('inbox.avatar_sync.discover.no_logo', { appId });
    return;
  }

  logger.info('inbox.avatar_sync.discover.sending', { appId, brandId, avatarUrl: logoUrl });
  const result: InboxResult<void> = await updateInboxAvatar(client, appId, brandId, logoUrl);

  if (!result.success) {
    logger.warn('inbox.avatar_sync.discover.update_failed', { appId, brandId, error: result.error });
  } else {
    logger.info('inbox.avatar_sync.discover.success', { appId, brandId });
  }
}
