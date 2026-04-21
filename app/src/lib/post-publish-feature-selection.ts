import { ChatTab } from '@/app/[market]/develop/components/types';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

export function openPostPublishFeatureSelectionInChat(appId: string): void {
  const store = useDevelopPageStore.getState();
  store.setActiveChatTab(ChatTab.CHAT);
  store.setPostPublishFeatureSelection(appId, true);
  logger.info('publish.post-publish-feature-selection-opened', { appId, source: 'publish-popover' });
}
