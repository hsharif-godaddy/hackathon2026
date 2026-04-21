'use client';

import PostPublishPreLaunchSeoPrompt from '@/app/[market]/develop/components/chat/PostPublishPreLaunchSeoPrompt';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

interface PostPublishFeatureSelectionProps {
  appId: string;
}

export default function PostPublishFeatureSelection({ appId }: PostPublishFeatureSelectionProps) {
  const setPostPublishFeatureSelection = useDevelopPageStore((state) => state.setPostPublishFeatureSelection);

  function dismiss() {
    setPostPublishFeatureSelection(appId, false);
  }

  return (
    <div className="mb-2" data-testid="post-publish-feature-selection">
      <PostPublishPreLaunchSeoPrompt appId={appId} onDismiss={dismiss} />
    </div>
  );
}
