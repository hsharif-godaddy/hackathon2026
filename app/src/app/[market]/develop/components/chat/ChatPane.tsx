'use client';

import { clsx } from 'clsx';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isEmployeeAuthType } from '@airo/shared/auth';
import Growl from '@ux/growl';

import CommanderChatRow from '@/app/[market]/commander/components/chat/CommanderChatRow';
import CommanderComposerLeft from '@/app/[market]/commander/components/chat/CommanderComposerLeft';
import CommanderTabBackButton from '@/app/[market]/commander/components/chat/CommanderTabBackButton';
import { useCommanderLayout } from '@/app/[market]/commander/components/CommanderLayoutContext';
import { BuilderLayout } from '@/app/[market]/commander/types';
import { AssetManagerItem, MediaType } from '@/app/[market]/develop/components/chat/AssetTypes';
import ChatBanners from '@/app/[market]/develop/components/chat/banners/ChatBanners';
import ChatAttachmentMenu from '@/app/[market]/develop/components/chat/ChatAttachmentMenu';
import ChatComposerSlot from '@/app/[market]/develop/components/chat/ChatComposerSlot';
import {
  ChatContext,
  type SendMessageOptions as SendChatMessageOptions,
} from '@/app/[market]/develop/components/chat/ChatContext';
import { type StagedChatFile } from '@/app/[market]/develop/components/chat/ChatInput';
import ChatToolbar from '@/app/[market]/develop/components/chat/ChatToolbar';
import {
  DebugStatsProvider,
} from '@/app/[market]/develop/components/chat/DebugStatsContext';
import { DebugStatsPanel } from '@/app/[market]/develop/components/chat/DebugStatsDrawer';
import { UploadedFile } from '@/app/[market]/develop/components/chat/FileUploadButton';
import QueuedMessagesStrip from '@/app/[market]/develop/components/chat/QueuedMessagesStrip';
import { useSecretsComposerTakeover } from '@/app/[market]/develop/components/chat/secrets';
import {
  getStagedFilePreviewUrl,
  revokeStagedFilePreviewIfCached,
} from '@/app/[market]/develop/components/chat/stagedFilePreviewUrl';
import { uploadChatFiles } from '@/app/[market]/develop/components/chat/uploadChatFiles';
import { useDebugStatsBridge } from '@/app/[market]/develop/components/chat/useDebugStatsBridge';
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton';
import PersistentTodoList from '@/app/[market]/develop/components/PersistentTodoList';
import PlanTracker from '@/app/[market]/develop/components/PlanTracker';
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState';
import GitHubSyncSettingsSavedSnackbar from '@/app/[market]/develop/components/settings/GitHubPanel/GitHubSyncSettingsSavedSnackbar';
import StreamingMessageList from '@/app/[market]/develop/components/StreamingMessageList';
import { ChatTab } from '@/app/[market]/develop/components/types';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { isColorSuggestPanelVisible } from '@/app/[market]/develop/components/utils/colorSuggestPanelVisibility';
import { isDesignKitSuggestPanelVisible } from '@/app/[market]/develop/components/utils/designKitSuggestPanelVisibility';
import { findLatestColorSchemeSuggest } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest';
import { findLatestDesignKitSuggest } from '@/app/[market]/develop/components/utils/findLatestDesignKitSuggest';
import { findLatestFontThemeSuggest } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest';
import { isFontSuggestPanelVisible } from '@/app/[market]/develop/components/utils/fontSuggestPanelVisibility';
import { useUpfrontRebuildBuildQueue } from '@/app/[market]/develop/hooks/useUpfrontRebuildBuildQueue';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE, SWITCHBOARD_APPBUILDER_MEDIA_CANVAS, SWITCHBOARD_APPBUILDER_PURCHASE_INTENT_CLASSIFIER } from '@/config/switchboard-flags';
import { getConversationIdFromCookie } from '@/hooks/chat/useChatHelpers';
import { trackPostInteraction } from '@/hooks/shared/initialBuildFunnel';
import { useAotPreload } from '@/hooks/useAotPreload';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useConversionEvent } from '@/hooks/useConversionEvent';
import { useCreditGrants } from '@/hooks/useCreditGrants';
import { useQueueProcessor } from '@/hooks/useQueueProcessor';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTodoListLoader } from '@/hooks/useTodoListLoader';
import { useTranslations } from '@/hooks/useTranslations';
import { useVenture } from '@/hooks/useVenture';
import { useVisitedTabs } from '@/hooks/useVisitedTabs';
import ChatBanner from '@/lib/ChatBanner';
import { getFileUploadAgent } from '@/lib/file-agent';
import { shipAnalyticsLog } from '@/lib/logging';
import { cloneQueueablePayload } from '@/lib/messageQueue';
import { createPostPublishPreLaunchAssistantMessage } from '@/lib/post-publish-prelaunch-ask-question';
import { logger } from '@/lib/request-context';
import { appService } from '@/services/AppService';
import { hasComposerSendPayload } from '@/services/transport/composerAttachments';
import type { SendMessageOptions } from '@/services/transport/messageTypes';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useGitStore } from '@/stores/useGitStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore';
import { useSiteStore } from '@/stores/useSiteStore';
import {
  QUEUE_MAX,
  useActiveStream,
  useAiEditContext,
  useAiEditContexts,
  useBudgetExceeded,
  useBuildErrorContext,
  useClearAiEditContexts,
  useCurrentAppId,
  useDevelopmentPlan,
  useInputValue,
  useIsActivelyStreaming,
  useIsLoading,
  useMessages,
  useQueueLength,
  useRemoveAiEditContext,
  useSetAiEditContext,
  useSetBuildErrorContext,
  useSetCurrentAppId,
  useSetInputValue,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore';
import { getActiveGrant } from '@/utils/credits';
import {
  MAX_TOTAL_ASSETS,
  UPLOAD_TIMEOUT_MS,
  UPLOAD_TIMEOUT_SECONDS,
  validateForStaging,
} from '@/utils/file-upload-validation';
import { getInstrumentationIntentCategory, logAiroHQEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { postMessageToIframe } from '@/utils/postMessage';

// Lazy-load features that are conditionally rendered or behind user interaction
const AnalyticsPanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel'),
  { loading: () => <SettingsLoadingState fullPage /> }
);
const MediaPanel = dynamic(() => import('@/app/[market]/develop/components/media/MediaPanel'), {
  loading: () => <PanelSkeleton panelType={ChatTab.MEDIAS} />,
});
const MediaReplacePanel = dynamic(() => import('@/app/[market]/develop/components/media/MediaReplacePanel').then(m => ({ default: m.MediaReplacePanel })), {
  loading: () => <PanelSkeleton panelType={ChatTab.MEDIAS} />,
});
const VersionHistory = dynamic(() => import('@/app/[market]/develop/components/VersionHistory'), {
  loading: () => <PanelSkeleton panelType={ChatTab.HISTORY} className="p-2 sm:p-0" />,
});

// SettingsView is AOT-preloaded by page.tsx; loading fallback is still needed
// so React.lazy gets a local Suspense boundary if the preload hasn't finished.
const SettingsView = dynamic(
  () => import('@/app/[market]/develop/components/settings/SettingsView'),
  { loading: () => <SettingsLoadingState fullPage /> }
);

// Lazy-loaded but preloaded on idle after mount
// We do them AOT to avoid skeleton/loader flashes - purely UX and non-blocking.
const importBudgetExceededBanner = () =>
  import('@/app/[market]/develop/components/chat/BudgetExceededBanner');
const BudgetExceededBanner = dynamic(importBudgetExceededBanner);

const aotImports = [importBudgetExceededBanner];

interface ChatPaneProps {
  sendMessage: (options: SendMessageOptions) => Promise<void>;
  stopGeneration: () => Promise<void>;
  isCreateFlowSession?: boolean;
  hasInitialPrompt?: boolean;
  /**
   * Show the stop button (disabled) while a generation has been requested but
   * the WebSocket stream has not yet started — typically the post-creation
   * window between job→app transition and the first stream chunk.
   */
  isAwaitingStream?: boolean;
  loadingMessage?: string | null;
  initialPromptText?: string | null;
  layout?: BuilderLayout;
  onPreviewRefresh?: () => void;
  /**
   * Suppress the bottom toolbar (Chat/Media/History/Settings tabs). Used by the
   * immersive design-kit chat mode, which renders a standalone centered chat with
   * no tab switching. Desktop only — the mobile layout has no in-pane toolbar.
   */
  hideToolbar?: boolean;
}

function mapUploadedFilesToAssetItems(files: UploadedFile[], agentUrl: string): AssetManagerItem[] {
  return files.map((file) => {
    let mediaType: MediaType;
    if (file.mimeType?.startsWith('image/')) {
      mediaType = MediaType.IMAGE;
    } else if (file.mimeType?.startsWith('video/')) {
      mediaType = MediaType.VIDEO;
    } else if (file.mimeType === 'application/pdf') {
      mediaType = MediaType.PDF;
    } else {
      mediaType = MediaType.FILE;
    }

    const fileUrl = file.signedUrl ? `${agentUrl}${file.signedUrl}` : undefined;

    const baseAsset = {
      mediaType,
      sourceType: 'upload' as const,
      imageUrl: fileUrl,
      filename: file.originalName,
      contentType: file.mimeType || 'application/octet-stream',
      size: file.size,
      thumbnailUrl: fileUrl,
    };

    if (mediaType === MediaType.IMAGE) {
      return {
        ...baseAsset,
        mediaType: MediaType.IMAGE,
        dimensions: { width: 0, height: 0 },
      } as AssetManagerItem;
    }
    if (mediaType === MediaType.VIDEO) {
      return {
        ...baseAsset,
        mediaType: MediaType.VIDEO,
        videoUrl: fileUrl,
        id: file.id,
        urlHash: file.id,
        width: 0,
        height: 0,
      } as AssetManagerItem;
    }
    if (mediaType === MediaType.PDF) {
      return {
        ...baseAsset,
        mediaType: MediaType.PDF,
      } as AssetManagerItem;
    }
    return {
      ...baseAsset,
      mediaType: MediaType.FILE,
    } as AssetManagerItem;
  });
}

/** Map server-reported uploads back to staged rows (order: first unused match per originalName). */
function stagedIdsForSuccessfulUploads(
  staged: StagedChatFile[],
  uploaded: UploadedFile[]
): string[] {
  const pool = [...staged];
  const used = new Set<string>();
  const ids: string[] = [];
  for (const u of uploaded) {
    const idx = pool.findIndex((s) => s.file.name === u.originalName && !used.has(s.id));
    if (idx >= 0) {
      used.add(pool[idx].id);
      ids.push(pool[idx].id);
    }
  }
  return ids;
}

export default function ChatPane(props: ChatPaneProps) {
  return (
    <DebugStatsProvider>
      <ChatPaneInner {...props} />
    </DebugStatsProvider>
  );
}

function ChatPaneInner({
  sendMessage,
  stopGeneration,
  isCreateFlowSession = false,
  hasInitialPrompt = false,
  isAwaitingStream = false,
  loadingMessage = null,
  initialPromptText = null,
  layout = BuilderLayout.Develop,
  onPreviewRefresh,
  hideToolbar = false,
}: ChatPaneProps) {
  const t = useTranslations();
  useDebugStatsBridge();
  const messages = useMessages();
  const userMessages = useMemo(
    () => messages.filter((m) => m.role === 'user' && m.content.trim()).map((m) => m.content),
    [messages]
  );
  const activeStream = useActiveStream();
  const inputValue = useInputValue();
  const isLoading = useIsLoading();
  const currentAppId = useCurrentAppId();
  const isStreaming = useIsActivelyStreaming();
  const developmentPlan = useDevelopmentPlan();
  const aiEditContext = useAiEditContext();
  const buildErrorContext = useBuildErrorContext();
  const budgetExceededFlag = useBudgetExceeded();
  const setInputValue = useSetInputValue();
  const setAiEditContext = useSetAiEditContext();
  const aiEditContexts = useAiEditContexts();
  const removeAiEditContext = useRemoveAiEditContext();
  const clearAiEditContexts = useClearAiEditContexts();
  const isMultiElementSelect = useDevelopPageStore((state) => state.isMultiSelectEnabled);
  const isAnnotationModeEnabled = useDevelopPageStore((state) => state.isAnnotationModeEnabled);
  const toggleAnnotationMode = useDevelopPageStore((state) => state.toggleAnnotationMode);
  const setBuildErrorContext = useSetBuildErrorContext();
  const setCurrentAppId = useSetCurrentAppId();

  // Flag: appbuilder-queue
  const isQueueEnabled = Boolean(useSwitchboard('appbuilder-queue'));
  const queueLength = useQueueLength();
  const isQueueFull = queueLength >= QUEUE_MAX;
  const enqueueMessage = useStreamingConversationStore((s) => s.enqueueMessage);

  useQueueProcessor({ enabled: isQueueEnabled, sendMessage, isAwaitingStream });

  useEffect(
    function warnOnTabCloseWithQueuedMessages() {
      if (!isQueueEnabled) return
      if (queueLength === 0) return
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault()
        e.returnValue = '' // required to trigger the native confirm dialog
        return ''
      }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    },
    [isQueueEnabled, queueLength],
  );

  const { data: subscription } = useSubscription();
  useConversionEvent();
  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans');
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat');
  const isGoLiveFeatureEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE) === true;
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat');
  const isPurchaseIntentClassifierEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_PURCHASE_INTENT_CLASSIFIER) === true;
  const isCommanderChatFlagEnabled = useSwitchboard('appbuilder-commander-chat') === true;
  const isCommanderChatEnabled = layout === BuilderLayout.Commander && isCommanderChatFlagEnabled;
  const isMediaCanvasEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_MEDIA_CANVAS) === true;
  const mediaCurrentSlotName = useMediaSlotDialogStore((state) => state.currentSlotName);
  const mediaPanelSlotName = useMediaSlotDialogStore((state) => state.panelSlotName);
  const mediaReturnTab = useMediaSlotDialogStore((state) => state.mediaReturnTab);
  const clearPanelSlot = useMediaSlotDialogStore((state) => state.clearPanelSlot);
  const navigateToSlot = useMediaSlotDialogStore((state) => state.navigateToSlot);

  // Unified grants fetch - works for both BMS and legacy paths
  const { data: grants, isFetching: isGrantsFetching } = useCreditGrants({
    subscriptionId: subscription?.id,
  });

  const { tokenAuthType } = useAuthContext();
  // CRM skip sessions use e2s tokens. isEmployeeAuthType covers e2s/e2s2s — same check
  // used for feedback impersonation detection in Feedback.tsx.
  const isImpersonating = isEmployeeAuthType(tokenAuthType);

  // Credit availability check using unified grants
  const hasAvailableCredits = grants !== undefined && getActiveGrant(grants) !== undefined;

  // Data loaded gate: prevents false "budget exceeded" during fetches
  const dataLoaded = grants !== undefined && !isGrantsFetching

  // Empty grants array (grants !== undefined && grants.length === 0) means the
  // subscription is still provisioning — not budget exceeded.
  const grantsStillProvisioning = grants !== undefined && grants.length === 0

  const budgetExceeded = !isImpersonating && !hasAvailableCredits && !grantsStillProvisioning && (dataLoaded || budgetExceededFlag)
  const isInputBudgetGated = budgetExceeded && !isPurchaseIntentClassifierEnabled
  const [isProactiveBannerDismissed, setIsProactiveBannerDismissed] = useState(false)

  useAotPreload(aotImports);

  // Reset dismissal only when credit data is stable and credits are no longer exhausted.
  // Excluding fetching state prevents a background refetch from briefly flipping
  // budgetExceeded=false (via dataLoaded) and resetting a dismissal the user just made.
  useEffect(() => {
    if (!budgetExceeded && !isGrantsFetching) setIsProactiveBannerDismissed(false);
  }, [budgetExceeded, isGrantsFetching]);

  // Only show the proactive banner when budgetExceededFlag is false — the mid-stream
  // case already shows an identical banner inline in the message list.
  const showProactiveBudgetBanner =
    budgetExceeded && !budgetExceededFlag && !isProactiveBannerDismissed;

  const hasLoggedFirstUserMessageRef = useRef(false);
  const lastInjectedPreLaunchNonceRef = useRef<number | null>(null);
  const loadingMessageRef = useRef(loadingMessage);
  loadingMessageRef.current = loadingMessage;

  const expandedPlan = useDevelopPageStore((state) => state.expandedPlan);
  const toggleExpandedPlan = useDevelopPageStore((state) => state.toggleExpandedPlan);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const showResponseFeedbackThanksBanner = useDevelopPageStore(
    (state) => state.showResponseFeedbackThanksBanner
  );
  const dismissResponseFeedbackThanksBanner = useDevelopPageStore(
    (state) => state.dismissResponseFeedbackThanksBanner
  );
  const setIsVersionHistoryOpen = useDevelopPageStore((state) => state.setIsVersionHistoryOpen);
  const { activeChatTab, setActiveChatTab } = useChatTabs();
  const visitedTabs = useVisitedTabs(activeChatTab);

  // When media canvas FF is on, redirect away from the hidden MEDIAS tab
  useEffect(() => {
    if (isMediaCanvasEnabled && activeChatTab === ChatTab.MEDIAS && !mediaPanelSlotName) {
      setActiveChatTab(ChatTab.CHAT)
    }
  }, [isMediaCanvasEnabled, activeChatTab, mediaPanelSlotName, setActiveChatTab])

  // Restore replace panel from ?slot= URL param on initial mount only.
  // Intentionally excludes mediaPanelSlotName and navigateToSlot from deps —
  // this must run once on mount to restore deep-linked state, not re-run when
  // the panel state changes (which would create an infinite loop).
  useEffect(() => {
    if (!isMediaCanvasEnabled || mediaPanelSlotName) return
    const params = new URLSearchParams(window.location.search)
    const slotParam = params.get('slot')
    if (slotParam) {
      navigateToSlot(slotParam)
    }
  }, [isMediaCanvasEnabled])  

  // Sync ?slot= URL param when replace panel opens/closes
  useEffect(() => {
    if (!isMediaCanvasEnabled) return
    const params = new URLSearchParams(window.location.search)
    if (mediaPanelSlotName && mediaPanelSlotName !== '__GRID__') {
      params.set('slot', mediaPanelSlotName)
    } else {
      params.delete('slot')
    }
    const query = params.toString()
    const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [isMediaCanvasEnabled, mediaPanelSlotName])

  const appId = useAppIdFromParams();

  const activeSecretsRequest = useSecretsComposerTakeover()
  const showSecretsComposer = activeSecretsRequest != null
  const secretsComposerConversationId =
    showSecretsComposer && currentAppId ? getConversationIdFromCookie(currentAppId) : undefined

  const showPostPublishFeatureSelection = useDevelopPageStore((state) =>
    appId && state.publishStates?.[appId]
      ? state.publishStates[appId].showPostPublishFeatureSelection
      : false
  );

  const postPublishFeatureSelectionNonce = useDevelopPageStore((state) =>
    appId && state.publishStates?.[appId]
      ? state.publishStates[appId].postPublishFeatureSelectionNonce
      : 0
  );

  useEffect(
    function resetPreLaunchInjectNonceOnAppChange() {
      lastInjectedPreLaunchNonceRef.current = null;
    },
    [appId]
  );

  useEffect(
    function injectPreLaunchAskQuestionWhenOpened() {
      if (!appId || !showPostPublishFeatureSelection || !isGoLiveFeatureEnabled) return;
      if (lastInjectedPreLaunchNonceRef.current === postPublishFeatureSelectionNonce) return;

      const streamState = useStreamingConversationStore.getState();
      if (streamState.currentAppId !== appId) {
        logger.warn('publish.prelaunch.inject.skip_wrong_app', {
          streamAppId: streamState.currentAppId,
          targetAppId: appId,
        });
        return;
      }

      const assistantMessage = createPostPublishPreLaunchAssistantMessage({
        appId,
        nonce: postPublishFeatureSelectionNonce,
      });

      try {
        useStreamingConversationStore.getState().persistHistory({
          appId,
          messages: [assistantMessage],
          mode: 'append',
        });

        lastInjectedPreLaunchNonceRef.current = postPublishFeatureSelectionNonce;

        useDevelopPageStore.getState().setPostPublishFeatureSelection(appId, false);

        logger.info('publish.prelaunch.ask_question_injected', {
          appId,
          nonce: postPublishFeatureSelectionNonce,
        });
      } catch (error) {
        logger.error('publish.prelaunch.ask_question_inject.failed', {
          appId,
          nonce: postPublishFeatureSelectionNonce,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      appId,
      isGoLiveFeatureEnabled,
      showPostPublishFeatureSelection,
      postPublishFeatureSelectionNonce,
    ]
  );

  // Load current todo list into store so InputActionsPanel has data when the flag is on
  useTodoListLoader(areChatPlansEnabled ? appId : null);

  // Get site data to access agent_url for file URLs
  const getSite = useSiteStore((state) => state.getSite);
  const site = appId ? getSite(appId) : null;
  const agentUrl = site?.agent_url;

  // On desktop, if Preview tab is selected, fall back to Chat
  useEffect(() => {
    if (!isMobile && activeChatTab === ChatTab.PREVIEW) {
      setActiveChatTab(ChatTab.CHAT);
    }
  }, [isMobile, activeChatTab, setActiveChatTab]);

  // Sync isVersionHistoryOpen with activeChatTab
  useEffect(() => {
    setIsVersionHistoryOpen(activeChatTab === ChatTab.HISTORY);
  }, [activeChatTab, setIsVersionHistoryOpen]);

  // While browsing history the user can land the iframe on a page that no
  // longer exists at HEAD (or that exists at HEAD but not at the commit they
  // last selected). On the way out of the history tab, steer the iframe back
  // to `/` so the chat view starts from a known-good route. PreviewPane's
  // existing `preview-navigate-after-checkout` listener handles dispatch via
  // dev-tools' route registry — if `/` isn't registered the resolver returns
  // null and the iframe stays put.
  const previousChatTabRef = useRef<ChatTab>(activeChatTab)
  useEffect(() => {
    const previous = previousChatTabRef.current
    previousChatTabRef.current = activeChatTab
    if (previous !== ChatTab.HISTORY || activeChatTab === ChatTab.HISTORY) return
    if (!appId || typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent<{ appId: string; path: string | null; modulePath: string | null }>(
        'preview-navigate-after-checkout',
        { detail: { appId, path: '/', modulePath: null } }
      )
    )
  }, [activeChatTab, appId])

  // Reset funnel tracking when app changes
  useEffect(() => {
    hasLoggedFirstUserMessageRef.current = false;
  }, [appId]);

  // State for selected assets from AssetManager
  const [selectedAssets, setSelectedAssets] = useState<AssetManagerItem[]>([]);

  /** Local files staged for the next send (preview only until upload on send) */
  const [stagedFiles, setStagedFiles] = useState<StagedChatFile[]>([]);

  /** Staged attachment ids currently uploading — ChatInput shows overlay spinners on those thumbnails */
  const [uploadingStagedFileIds, setUploadingStagedFileIds] = useState<string[]>([]);

  const [uploadError, setUploadError] = useState<string | null>(null);

  // State for referenced files (file paths with content from file tree)
  const [referencedFiles, setReferencedFiles] = useState<Array<{ path: string; content: string }>>(
    []
  );

  // Pre-fetch ventureId for AssetManager (and warm the shared react-query
  // cache for other consumers like UserMenu's Dashboard link).
  useVenture();

  // Combine messages and activeStream, guarding against duplicate IDs
  // (can happen when persistHistory and set({ activeStream }) are separate store updates)
  const allMessages = useMemo(() => {
    if (!activeStream) return messages;
    if (messages.some((m) => m.id === activeStream.id)) return messages;
    return [...messages, activeStream];
  }, [messages, activeStream]);

  // Switchboard flag reserved for future support-message UI treatment
  // const { data: showSupportMessages } = useSwitchboard('airo-builder-support-chat-ui')

  // Only show messages and state if they belong to the current app context
  const visibleMessages = currentAppId === appId ? allMessages : [];
  const activeColorSchemeSuggestRaw = useMemo(
    () =>
      isThemeSelectionChatEnabled && currentAppId === appId
        ? findLatestColorSchemeSuggest(visibleMessages)
        : null,
    [appId, currentAppId, isThemeSelectionChatEnabled, visibleMessages]
  );
  const activeColorSchemeSuggestCandidate = useMemo(() => {
    if (!isThemeSelectionChatEnabled) return null;
    if (!activeColorSchemeSuggestRaw) return null;
    if (!isColorSuggestPanelVisible(visibleMessages, activeColorSchemeSuggestRaw, t)) return null;
    return activeColorSchemeSuggestRaw;
  }, [activeColorSchemeSuggestRaw, isThemeSelectionChatEnabled, t, visibleMessages]);

  const activeFontThemeSuggestRaw = useMemo(
    () =>
      isFontSelectionChatEnabled && currentAppId === appId
        ? findLatestFontThemeSuggest(visibleMessages)
        : null,
    [appId, currentAppId, isFontSelectionChatEnabled, visibleMessages]
  );
  const activeFontThemeSuggestCandidate = useMemo(() => {
    if (!isFontSelectionChatEnabled) return null;
    if (!activeFontThemeSuggestRaw) return null;
    if (!isFontSuggestPanelVisible(visibleMessages, activeFontThemeSuggestRaw)) return null;
    return activeFontThemeSuggestRaw;
  }, [activeFontThemeSuggestRaw, isFontSelectionChatEnabled, visibleMessages]);

  const { activeColorSchemeSuggest, activeFontThemeSuggest } = useMemo(() => {
    const color = activeColorSchemeSuggestCandidate;
    const font = activeFontThemeSuggestCandidate;
    if (!color && !font) return { activeColorSchemeSuggest: null, activeFontThemeSuggest: null };
    if (color && !font) return { activeColorSchemeSuggest: color, activeFontThemeSuggest: null };
    if (!color && font) return { activeColorSchemeSuggest: null, activeFontThemeSuggest: font };
    // Both color and font are non-null here due to prior conditional returns
    const colorNonNull = color;
    const fontNonNull = font;
    const ic = visibleMessages.findIndex((m) => m.id === colorNonNull.messageId);
    const ifont = visibleMessages.findIndex((m) => m.id === fontNonNull.messageId);
    if (ifont > ic) return { activeColorSchemeSuggest: null, activeFontThemeSuggest: fontNonNull };
    return { activeColorSchemeSuggest: colorNonNull, activeFontThemeSuggest: null };
  }, [activeColorSchemeSuggestCandidate, activeFontThemeSuggestCandidate, visibleMessages]);

  // Design-kit vibe picker (AIROBUILD-2854): the latest completed `suggestDesignKits`
  // result, shown until the user picks/skips/types. Only the design-kit agent emits
  // this tool, so no extra profile gate is needed.
  const activeDesignKitSuggest = useMemo(() => {
    const raw = findLatestDesignKitSuggest(visibleMessages);
    if (!raw) return null;
    if (!isDesignKitSuggestPanelVisible(visibleMessages, raw)) return null;
    return raw;
  }, [visibleMessages]);
  const safeInputValue = currentAppId === appId ? inputValue || '' : '';
  const safeAiEditContext = currentAppId === appId ? aiEditContext : null;
  const safeAiEditContexts = currentAppId === appId ? aiEditContexts : [];
  const safeBuildErrorContext = currentAppId === appId ? buildErrorContext : null;

  // Calculate maxAssets based on image replacement mode
  const maxAssets = safeAiEditContext?.isImageReplacement ? 1 : MAX_TOTAL_ASSETS;

  // Clear selected assets and staged files when entering image replacement mode
  useEffect(() => {
    if (safeAiEditContext?.isImageReplacement) {
      setSelectedAssets([]);
      setStagedFiles((prev) => {
        prev.forEach((s) => {
          if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
        });
        return [];
      });
      setUploadError(null);
    }
  }, [safeAiEditContext?.isImageReplacement]);

  // Drop staged files when switching apps (revoke object URLs)
  useEffect(() => {
    setStagedFiles((prev) => {
      prev.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
      return [];
    });
    setUploadError(null);
  }, [appId]);

  // Clear stale attachment errors when the user removes all composer attachments.
  // Only on >0 → 0 transitions so rejected adds (validation failures with no staged files) keep their alert.
  const prevAttachmentCountRef = useRef(0);
  useEffect(() => {
    const attachmentCount = selectedAssets.length + stagedFiles.length;
    if (prevAttachmentCountRef.current > 0 && attachmentCount === 0) {
      setUploadError(null);
    }
    prevAttachmentCountRef.current = attachmentCount;
  }, [selectedAssets.length, stagedFiles.length]);

  // Debug current state (only log when there's a significant change)
  const prevDebugRef = useRef<string>('');
  const currentDebugState = `${appId}-${currentAppId}-${visibleMessages?.length}`;

  // Only log if app changed or messages changed (ignore loading/input changes)
  if (prevDebugRef.current !== currentDebugState) {
    logger.debug('chat-pane.state-change', {
      message: 'ChatPane state changed',
      appIdFromProps: appId,
      currentAppIdFromStore: currentAppId,
      messagesCount: visibleMessages?.length,
      isLoading,
    });
    prevDebugRef.current = currentDebugState;
  }

  // Track processing state - use isLoading OR isStreaming to match original behavior
  // History now loads asynchronously in the background (decoupled from connection setup),
  // so we no longer gate on historyLoadingComplete — the spinner in StreamingMessageList
  // already signals the in-flight load and the user should be free to type at any time.
  const isProcessing = isLoading || isStreaming || !!loadingMessage;

  // Handle clearing AI edit context
  const handleClearAiEditContext = useCallback(() => {
    // Send message to iframe to clear selection and highlight
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
    if (iframe) {
      postMessageToIframe(iframe, {
        type: 'CLEAR_SELECTION',
      });
    }
    // Clear the context in the store
    setAiEditContext(null);
  }, [setAiEditContext]);

  // Handle clearing all AI edit contexts (multi-select)
  const handleClearAllAiEditContexts = useCallback(() => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
    if (iframe) {
      postMessageToIframe(iframe, { type: 'CLEAR_ALL_SELECTIONS' });
    }
    clearAiEditContexts();
  }, [clearAiEditContexts]);

  // Handle removing a single AI edit context by number (multi-select)
  const handleRemoveAiEditContext = useCallback(
    (number: number) => {
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
      if (iframe) {
        postMessageToIframe(iframe, { type: 'REMOVE_SELECTION', data: { number } });
      }
      removeAiEditContext(number);
    },
    [removeAiEditContext]
  );

  // Scroll preview to the element for a clicked mention chip
  useEffect(() => {
    const handler = (e: Event) => {
      const { number } = (e as CustomEvent).detail;
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
      if (iframe) {
        postMessageToIframe(iframe, { type: 'SCROLL_TO_SELECTION', data: { number } });
      }
    };
    document.addEventListener('scroll-to-mention', handler);
    return () => document.removeEventListener('scroll-to-mention', handler);
  }, []);

  // Handle clearing selected assets
  const handleClearSelectedAsset = useCallback(() => {
    setSelectedAssets([]);
  }, []);

  // Handle clearing a single asset by index
  const handleClearSingleAsset = useCallback((index: number) => {
    setSelectedAssets((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Handle file references selected - fetch file contents
  const handleFileReferencesSelected = useCallback(
    async (filePaths: string[]) => {
      logger.info('chat-pane.file-references-selected', {
        appId,
        fileCount: filePaths.length,
        totalReferences: referencedFiles.length + filePaths.length,
      });

      // Fetch contents for all selected files
      const filesWithContent = await Promise.all(
        filePaths.map(async (path) => {
          try {
            const result = await appService.readFile(appId, path);
            return {
              path,
              content: result.content,
            };
          } catch (error) {
            logger.error('chat-pane.file-reference-read-failed', {
              appId,
              path,
              error: error instanceof Error ? error.message : String(error),
            });
            return {
              path,
              content: `[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]`,
            };
          }
        })
      );

      setReferencedFiles((prev) => [...prev, ...filesWithContent]);
    },
    [appId, referencedFiles.length]
  );

  // Handle clearing all referenced files
  const handleClearReferencedFiles = useCallback(() => {
    setReferencedFiles([]);
  }, []);

  // Handle clearing a single referenced file by index
  const handleClearSingleReferencedFile = useCallback((index: number) => {
    setReferencedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Handle large paste: convert to a referenced-file context attachment
  const handleLargePasteDetected = useCallback(
    (content: string) => {
      if (!content?.trim()) {
        return;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      setReferencedFiles((prev) => [...prev, { path: `pasted-content-${timestamp}.txt`, content }]);
      logger.info('chat-pane.large-paste-converted', {
        appId,
        contentLength: content.length,
      });
      Growl.addGrowlMessage({
        id: 'chat-large-paste-attachment',
        title: t(
          'builder_chat_large_paste_growl_title',
          undefined,
          'Large content added as attachment'
        ),
        children: t(
          'builder_chat_large_paste_growl_description',
          undefined,
          'Your paste was attached as a file below. Send now or add a short message first.'
        ),
        emphasis: 'info',
        lifetime: 5000,
      });
    },
    [appId, t]
  );

  // Handle clearing build error context
  const handleClearBuildErrorContext = useCallback(() => {
    setBuildErrorContext(null);
  }, [setBuildErrorContext]);

  /** Inline composer attachment error (staging limits, validation); cleared on user send */
  const showTransientAttachmentBanner = useCallback((errorMessage: string) => {
    setUploadError(errorMessage);
  }, []);

  const handleUploadError = useCallback(
    (errorMessage?: string) => {
      logger.error('chat-pane.upload-error', { errorMessage });
      setUploadingStagedFileIds([]);
      if (errorMessage) {
        showTransientAttachmentBanner(errorMessage);
      }
    },
    [showTransientAttachmentBanner]
  );

  /** ChatAttachmentMenu: file validation / screenshot — not multipart upload; no upload-error log or clearing in-flight IDs */
  const handleAttachmentMenuError = useCallback(
    (errorMessage?: string) => {
      if (errorMessage) {
        showTransientAttachmentBanner(errorMessage);
      }
    },
    [showTransientAttachmentBanner]
  );

  const handleStageFiles = useCallback(
    (files: File[]) => {
      if (!appId || isInputBudgetGated) return;
      if (files.length === 0) return;

      let errorAfter: string | undefined;
      let partialAfter = false;

      flushSync(() => {
        setStagedFiles((prev) => {
          const usedSlots = selectedAssets.length + prev.length;
          const room = maxAssets - usedSlots;
          if (room <= 0) {
            errorAfter = t('builder_chatfiles_error_max_attachments', { count: maxAssets });
            return prev;
          }

          const slice = files.slice(0, room);
          const validationError = validateForStaging(slice, t);
          if (validationError) {
            errorAfter = validationError;
            return prev;
          }

          if (slice.length < files.length) {
            partialAfter = true;
          }

          return [
            ...prev,
            ...slice.map((file) => ({
              id: `staged-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              file,
              previewUrl: getStagedFilePreviewUrl(file),
            })),
          ];
        });
      });

      if (errorAfter) {
        showTransientAttachmentBanner(errorAfter);
      } else if (partialAfter) {
        showTransientAttachmentBanner(
          t('builder_chatfiles_error_max_attachments', { count: maxAssets })
        );
      } else {
        setUploadError(null);
      }
    },
    [appId, isInputBudgetGated, selectedAssets.length, maxAssets, t, showTransientAttachmentBanner]
  );

  const handleRemoveStagedFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const found = prev.find((s) => s.id === id);
      if (found) {
        revokeStagedFilePreviewIfCached(found.file);
      }
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  // Handle sending a message - accepts optional content for programmatic sends
  const handleSendMessage = useCallback(
    async (content?: string, options?: SendChatMessageOptions) => {
      const messageToSend = content ?? inputValue;
      const userInitiated = content === undefined;
      const composerAttachments = { stagedFiles, selectedAssets, referencedFiles };

      logger.debug('chat-pane.send-message', {
        message: 'ChatPane handleSendMessage called',
        inputValuePreview: inputValue?.slice(0, 50) + '...',
        hasSendMessageFunction: !!sendMessage,
      });

      if (!hasComposerSendPayload(messageToSend, composerAttachments)) {
        logger.error('chat-pane.send-message.empty-content', {
          appId,
          userInitiated,
          stagedFileCount: stagedFiles.length,
          selectedAssetCount: selectedAssets.length,
          referencedFileCount: referencedFiles.length,
        });
        return;
      }

      if (userInitiated) {
        setUploadError(null);
      }

      const outboundContent = messageToSend?.trim() ?? '';

      let mergedAssets: AssetManagerItem[] | undefined =
        selectedAssets.length > 0 ? [...selectedAssets] : undefined;

      if (userInitiated && stagedFiles.length > 0) {
        if (!agentUrl) {
          logger.error('chat-pane.send-with-staged.no-agent-url', { appId });
          handleUploadError(t('builder_chatfiles_error_upload_failed'));
          return;
        }

        const toUpload = [...stagedFiles];
        setUploadingStagedFileIds(toUpload.map((s) => s.id));

        try {
          const {
            files: uploadedList,
            failedFiles,
            batchLevelError,
          } = await uploadChatFiles(
            appId!,
            toUpload.map((s) => s.file),
            t
          );

          if (batchLevelError) {
            setUploadingStagedFileIds([]);
            if (uploadedList.length > 0) {
              const partialItems = mapUploadedFilesToAssetItems(uploadedList, agentUrl);
              setSelectedAssets((prev) => [...prev, ...partialItems].slice(0, MAX_TOTAL_ASSETS));
              const succeededIds = stagedIdsForSuccessfulUploads(toUpload, uploadedList);
              setStagedFiles((prev) =>
                prev.filter((s) => {
                  if (succeededIds.includes(s.id)) {
                    revokeStagedFilePreviewIfCached(s.file);
                    return false;
                  }
                  return true;
                })
              );
            }
            handleUploadError(batchLevelError);
            return;
          }

          if (uploadedList.length === 0) {
            setUploadingStagedFileIds([]);
            handleUploadError(t('builder_chatfiles_error_upload_failed'));
            return;
          }

          const newItems = mapUploadedFilesToAssetItems(uploadedList, agentUrl);
          mergedAssets = [...(mergedAssets ?? []), ...newItems];

          toUpload.forEach((s) => {
            revokeStagedFilePreviewIfCached(s.file);
          });
          setStagedFiles([]);
          setUploadingStagedFileIds([]);

          if (failedFiles && failedFiles.length > 0) {
            const names = failedFiles.map((f) => f.originalName).join(', ');
            showTransientAttachmentBanner(
              t('builder_chatfiles_error_partial_failure', {
                success: uploadedList.length,
                total: uploadedList.length + failedFiles.length,
                names,
              })
            );
          }
        } catch (error) {
          setUploadingStagedFileIds([]);
          handleUploadError(error instanceof Error ? error.message : undefined);
          return;
        }
      }

      logAiroHQEvent({
        category: 'click',
        recommendation_task: 'builder_develop_prompt_submit',
        recommendation_type: 'user_prompt',
      })();

      shipAnalyticsLog('chat.prompt.sent', {
        appId,
        promptLength: outboundContent.length,
        source: content ? 'suggestion' : 'user-input',
        hasEditContext: !!safeAiEditContext,
        hasSelectedAsset: Boolean(mergedAssets?.length),
        hasBuildErrorContext: !!safeBuildErrorContext,
        hasReferencedFiles: referencedFiles.length > 0,
      });

      trackPostInteraction();

      if (!hasLoggedFirstUserMessageRef.current && appId && isCreateFlowSession && userInitiated) {
        let userCount = 0;
        for (const msg of messages) {
          if (msg.role === 'user' && ++userCount > 1) break;
        }
        if (userCount <= 1) {
          shipAnalyticsLog('funnel.user_first_message.sent', {
            appId,
            promptLength: outboundContent.length,
          });
          hasLoggedFirstUserMessageRef.current = true;
        }
      }

      if (currentAppId !== appId) {
        setCurrentAppId(appId);
      }

      const annotationAttachment = isAnnotationModeEnabled
        ? [{
            type: 'annotation_context',
            data: { instruction: t('builder_annotation_message_prefix') },
            persistence: 'ephemeral' as const,
            renderStrategy: 'before_prompt' as const,
            metadata: { source: 'commander-annotation' },
          }]
        : [];

      // Merge referenced files with any custom context from the caller (e.g. plan item instructions)
      const mergedCustomContext =
        options?.customContext || referencedFiles.length > 0 || annotationAttachment.length > 0
          ? {
              ...options?.customContext,
              ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
              ...(annotationAttachment.length > 0
                ? {
                    customAttachments: [
                      ...(options?.customContext?.customAttachments ?? []),
                      ...annotationAttachment,
                    ],
                  }
                : {}),
            }
          : undefined;

      if (content) {
        void sendMessage({
          content: outboundContent,
          aiEditContext: { screenshot: null },
          isActionRequest: options?.isActionRequest,
          askQuestionSkipped: options?.askQuestionSkipped,
          customContext: mergedCustomContext,
          rebuildBuildPageSlug: options?.rebuildBuildPageSlug,
        });
        handleClearAllAiEditContexts();
      } else {
        const sendOptions: SendMessageOptions = {
          content: outboundContent,
          aiEditContext: isMultiElementSelect
            ? undefined
            : safeAiEditContext
              ? { ...safeAiEditContext, screenshot: null }
              : undefined,
          aiEditContexts:
            isMultiElementSelect && safeAiEditContexts.length > 0
              ? safeAiEditContexts.map((c) => ({ ...c, screenshot: null }))
              : undefined,
          selectedAssets: mergedAssets,
          customContext: mergedCustomContext,
          rebuildBuildPageSlug: options?.rebuildBuildPageSlug,
          isActionRequest: options?.isActionRequest,
          askQuestionSkipped: options?.askQuestionSkipped,
        };

        if (isQueueEnabled && (isStreaming || isAwaitingStream)) {
          const enqueued = enqueueMessage(cloneQueueablePayload(sendOptions));
          if (!enqueued) {
            logger.warn('chat-pane.queue.cap-hit', { appId, queueLength });
            return;
          }
          const newQueueLength = queueLength + 1;
          logger.info('queue.message.submitted', {
            queueLength: newQueueLength,
            contentLength: sendOptions.content.length,
          });
          logClickEvent('chat.queue.submit', { queueLength: newQueueLength })();
          setInputValue('');
          if (isMultiElementSelect && safeAiEditContexts.length > 0) {
            handleClearAllAiEditContexts();
          } else if (safeAiEditContext) {
            handleClearAiEditContext();
          }
          if (selectedAssets.length > 0) handleClearSelectedAsset();
          if (referencedFiles.length > 0) handleClearReferencedFiles();
          if (safeBuildErrorContext) handleClearBuildErrorContext();
          if (isAnnotationModeEnabled) {
            toggleAnnotationMode();
          }
          return;
        }

        void sendMessage(sendOptions);

        // Clear contexts only for user input sends
        if (isMultiElementSelect && safeAiEditContexts.length > 0) {
          handleClearAllAiEditContexts();
        } else if (safeAiEditContext) {
          handleClearAiEditContext();
        }
        if (selectedAssets.length > 0) {
          handleClearSelectedAsset();
        }
        if (referencedFiles.length > 0) {
          handleClearReferencedFiles();
        }
        if (safeBuildErrorContext) {
          handleClearBuildErrorContext();
        }
        if (isAnnotationModeEnabled) {
          toggleAnnotationMode();
        }
      }

      if (getInstrumentationIntentCategory() === 'edit') {
        try {
          const currentArtifactHash = appId ? useGitStore.getState().getSelectedCommitHash(appId) : null
          const editPayload = {
            appId: appId ?? '',
            promptLength: outboundContent.length,
            ...(currentArtifactHash && { artifactHash: currentArtifactHash }),
          }
          logImpressionEvent('develop.edit.triggered', editPayload)()
          shipAnalyticsLog('funnel.edit.triggered', editPayload)
        } catch (analyticsError) {
          logger.warn('chat-pane.edit-triggered.analytics-failed', { appId, error: analyticsError })
        }
      }
    },
    [
      inputValue,
      sendMessage,
      currentAppId,
      appId,
      setCurrentAppId,
      safeAiEditContext,
      selectedAssets,
      stagedFiles,
      referencedFiles,
      safeBuildErrorContext,
      handleClearAiEditContext,
      handleClearSelectedAsset,
      handleClearReferencedFiles,
      handleClearBuildErrorContext,
      isCreateFlowSession,
      messages,
      agentUrl,
      t,
      handleUploadError,
      showTransientAttachmentBanner,
      isQueueEnabled,
      isStreaming,
      isAwaitingStream,
      queueLength,
      enqueueMessage,
      setInputValue,
      isAnnotationModeEnabled,
      toggleAnnotationMode,
    ]
  );

  // Create stable context value - reuses handleSendMessage
  const chatContextValue = useMemo(
    () => ({
      sendMessage: handleSendMessage,
    }),
    [handleSendMessage]
  );

  useUpfrontRebuildBuildQueue(appId, isStreaming || isLoading, handleSendMessage);

  const commanderLayout = useCommanderLayout();
  const chatPaneRootRef = useRef<HTMLDivElement | null>(null);
  const planTrackerWrapperRef = useRef<HTMLDivElement | null>(null);
  const belowMessagesWrapperRef = useRef<HTMLDivElement | null>(null);
  const commanderChatRowWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!commanderLayout) return;
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;

    const targets = [
      planTrackerWrapperRef.current,
      belowMessagesWrapperRef.current,
      commanderChatRowWrapperRef.current,
    ].filter((el): el is HTMLDivElement => el !== null);
    if (targets.length === 0) return;

    // Padding/gap/visible-child-count are constant for a given config and only
    // change when this effect re-attaches (className flip via deps).
    const root = chatPaneRootRef.current;
    let extras = 0;
    if (root) {
      const computed = window.getComputedStyle(root);
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const rowGap = parseFloat(computed.rowGap) || 0;
      const visibleChildCount = Array.from(root.children).filter(
        (c): c is HTMLElement =>
          c instanceof HTMLElement && window.getComputedStyle(c).display !== 'none'
      ).length;
      extras = paddingTop + paddingBottom + rowGap * Math.max(0, visibleChildCount - 1);
    }

    const report = () => {
      const sum = targets.reduce((acc, el) => acc + el.offsetHeight, 0);
      commanderLayout.reportNonMessagesHeight(sum + extras);
    };

    const observer = new ResizeObserver(report);
    targets.forEach((el) => observer.observe(el));
    report();

    return () => {
      observer.disconnect();
      commanderLayout.reportNonMessagesHeight(0);
    };
  }, [commanderLayout, isCommanderChatEnabled, activeChatTab]);

  // Handle asset selection from AssetManager
  const handleAssetSelect = useCallback(
    (items: AssetManagerItem[]) => {
      logger.debug('chat-pane.asset-select', { itemCount: items?.length });

      if (items && items.length > 0) {
        // Get current state directly from store to avoid stale closure issues
        const currentAiEditContext = useStreamingConversationStore.getState().aiEditContext;

        logger.debug('chat-pane.asset-select.context', {
          isImageReplacement: currentAiEditContext?.isImageReplacement,
          hasAiEditContext: !!currentAiEditContext,
        });

        if (currentAiEditContext?.isImageReplacement) {
          // Image replacement mode: try AST first, then fall back to AI agent
          logger.debug('chat-pane.image-replace.auto-send', { appId });
          const selectedItem = items[0];
          const newImageUrl = selectedItem.imageUrl;

          // Try AST replacement first
          const tryAstReplacement = async () => {
            try {
              logger.debug('chat-pane.image-replace.ast-attempt', { appId });
              // Combine elementInfo with devContext for the API
              const elementInfoWithDevContext = {
                tagName: currentAiEditContext.elementInfo?.tagName || '',
                className: currentAiEditContext.elementInfo?.className || '',
                id: currentAiEditContext.elementInfo?.id || '',
                selector: currentAiEditContext.selector || '',
                devContext: currentAiEditContext.devContext || {
                  fileName: '',
                  componentName: '',
                  lineNumber: 0,
                },
              };
              const astResult = await appService.replaceImage(appId, {
                elementInfo: elementInfoWithDevContext,
                imageInfo: currentAiEditContext.imageInfo || { type: 'img', currentUrl: null },
                newImageUrl,
              });

              if (astResult.success) {
                logger.info('chat-pane.image-replace.ast-success', { appId });
                // No manual refresh needed - Vite HMR will auto-update the preview
                handleClearAiEditContext();
                return;
              }

              if (astResult.fallbackRequired) {
                // AST failed, fall back to AI agent
                logger.info('chat-pane.image-replace.ast-fallback', {
                  appId,
                  error: astResult.error,
                });
                sendFallbackMessage();
              } else {
                // AST failed but fallback not required - just clear context
                logger.debug('chat-pane.image-replace.ast-failed-no-fallback', {
                  appId,
                  error: astResult.error,
                });
                handleClearAiEditContext();
              }
            } catch (error) {
              logger.error('chat-pane.image-replace.ast-error', { appId, error: String(error) });
              // On exception, fall back to AI agent
              sendFallbackMessage();
            }

            function sendFallbackMessage() {
              const message = 'Replace this image with the new one I selected';
              shipAnalyticsLog('chat.prompt.sent', {
                appId,
                promptLength: message.length,
                source: 'image-replacement',
                hasEditContext: true,
                hasSelectedAsset: true,
                hasBuildErrorContext: false,
              });
              sendMessage({
                content: message,
                aiEditContext: { ...currentAiEditContext, screenshot: null },
                selectedAssets: [selectedItem],
              });
              handleClearAiEditContext();
            }
          };

          void tryAstReplacement();
        } else {
          // Normal mode: allow multiple images (append with duplicate checking, capped at MAX_TOTAL_ASSETS)
          logger.debug('chat-pane.asset-select.manual', { appId });

          // Check before updating — functional updater runs async so we can't rely on it for side effects
          const existingUrls = new Set(selectedAssets.map((asset) => asset.imageUrl));
          const newUniqueItems = items.filter((item) => !existingUrls.has(item.imageUrl));
          if (selectedAssets.length + newUniqueItems.length > MAX_TOTAL_ASSETS) {
            // Not handleUploadError — that clears uploadingStagedFileIds and logs upload failure
            showTransientAttachmentBanner(
              t('builder_chatfiles_error_max_attachments', { count: MAX_TOTAL_ASSETS })
            );
          }

          // Intentional partial-accept: assets that fit within the limit are still added
          // even when the total would exceed MAX_TOTAL_ASSETS. The error banner above informs
          // the user, and setSelectedAssets slices to the limit below.
          setSelectedAssets((prevAssets) => {
            // Create a Set of existing asset URLs to check for duplicates
            const prevUrls = new Set(prevAssets.map((asset) => asset.imageUrl));

            // Filter out duplicates from new items, then cap at limit
            const newItems = items.filter((item) => !prevUrls.has(item.imageUrl));
            return [...prevAssets, ...newItems].slice(0, MAX_TOTAL_ASSETS);
          });
        }
      } else {
        logger.debug('chat-pane.asset-select.empty', { appId });
      }
    },
    [appId, sendMessage, handleClearAiEditContext, t, selectedAssets, showTransientAttachmentBanner]
  );

  // Refs mirror local state so handleScreenshotCaptured can read fresh values
  // after its network awaits, without re-creating the callback on every change
  // to selectedAssets / stagedFiles. The async cap calculation depends on this.
  const selectedAssetsRef = useRef(selectedAssets);
  const stagedFilesRef = useRef(stagedFiles);
  const annotationAssetUrlsRef = useRef<Set<string>>(new Set());
  // Mirror annotation-mode flag so the async post-upload guard reads the live
  // value, not a closed-over snapshot from when the upload started.
  const isAnnotationModeEnabledRef = useRef(isAnnotationModeEnabled);
  // Sequence guard against out-of-order screenshot uploads. annotationSeqRef
  // increments each time the iframe sends a new screenshot; latestApplied
  // tracks the highest seq committed to selectedAssets. A late-arriving older
  // upload bails instead of clobbering a newer set of boxes.
  const annotationSeqRef = useRef(0);
  const latestAppliedAnnotationSeqRef = useRef(0);
  useEffect(() => {
    selectedAssetsRef.current = selectedAssets;
  }, [selectedAssets]);
  useEffect(() => {
    stagedFilesRef.current = stagedFiles;
  }, [stagedFiles]);
  useEffect(() => {
    isAnnotationModeEnabledRef.current = isAnnotationModeEnabled;
  }, [isAnnotationModeEnabled]);

  const handleAnnotationScreenshotResponse = useCallback(async (dataUrl: string, seq: number) => {
    if (!appId || !agentUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    let assetItems: AssetManagerItem[] | null = null;

    try {
      const blob = await fetch(dataUrl, { signal: controller.signal }).then((r) => r.blob());
      const mimeType = blob.type || 'image/png';
      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const file = new File([blob], `annotation-${timestamp}.${ext}`, { type: mimeType });

      const { token, uploadUrl } = await Promise.race([
        getFileUploadAgent(appId),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          controller.signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true }
          );
        }),
      ]);

      const formData = new FormData();
      formData.append('appId', appId);
      formData.append('files', file);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Upload failed (${response.status})`);

      const result = (await response.json()) as { uploadId?: string; files?: unknown };
      if (!Array.isArray(result.files) || result.files.length === 0) {
        throw new Error(t('builder_chatfiles_error_upload_failed'));
      }

      assetItems = mapUploadedFilesToAssetItems(result.files, agentUrl);
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError';
      const message = isTimeout
        ? t('builder_chatfiles_error_timeout_duration', { seconds: UPLOAD_TIMEOUT_SECONDS })
        : error instanceof Error
          ? error.message
          : t('builder_chatfiles_error_upload_failed');
      logger.error('chat-pane.annotation-screenshot.upload-failed', { appId, error: message });
      showTransientAttachmentBanner(message);
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!assetItems || assetItems.length === 0) return;
    if (!isAnnotationModeEnabledRef.current) return;
    if (seq < latestAppliedAnnotationSeqRef.current) return;

    const newItems = assetItems;
    const newUrls = new Set(
      newItems.map((a) => a.imageUrl).filter((u): u is string => typeof u === 'string')
    );
    const previousUrls = annotationAssetUrlsRef.current;

    setSelectedAssets((prev) => {
      const filtered = previousUrls.size > 0
        ? prev.filter((a) => !(a.imageUrl && previousUrls.has(a.imageUrl)))
        : prev;
      return [...filtered, ...newItems];
    });
    annotationAssetUrlsRef.current = newUrls;
    latestAppliedAnnotationSeqRef.current = seq;
  }, [appId, agentUrl, t, showTransientAttachmentBanner]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null;
      if (!iframe || event.source !== iframe.contentWindow) return;
      if (event.data?.type !== 'ANNOTATION_SCREENSHOT_RESPONSE') return;
      const screenshot = event.data.screenshot;
      if (typeof screenshot !== 'string') return;
      const seq = ++annotationSeqRef.current;
      void handleAnnotationScreenshotResponse(screenshot, seq);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleAnnotationScreenshotResponse]);

  useEffect(() => {
    if (isAnnotationModeEnabled) return;
    annotationSeqRef.current = 0;
    latestAppliedAnnotationSeqRef.current = 0;
    if (annotationAssetUrlsRef.current.size === 0) return;
    const urlsToRemove = annotationAssetUrlsRef.current;
    setSelectedAssets((prev) => prev.filter((a) => !(a.imageUrl && urlsToRemove.has(a.imageUrl))));
    annotationAssetUrlsRef.current = new Set();
  }, [isAnnotationModeEnabled]);

  // Handle screenshot/paste capture from chat input.
  // Uploads to the server so the WebSocket message carries a short URL reference
  // instead of the raw base64 data URL (which would exceed the 100k char limit).
  //
  // Bypasses handleAssetSelect intentionally: handleAssetSelect treats the
  // currentAiEditContext.isImageReplacement branch as an "auto-send" trigger
  // (AST swap or "Replace this image…" chat message). A user pasting/capturing
  // a screenshot has not opted into auto-send — they have only attached an asset.
  const handleScreenshotCaptured = useCallback(
    async (dataUrl: string) => {
      if (!appId) return;
      // Guard agentUrl up-front to avoid wasting a multipart upload that would
      // orphan the file on the server with no UI reference. Site may not be
      // hydrated yet when the user pastes/captures very early in page load.
      if (!agentUrl) {
        logger.warn('chat-pane.screenshot.no-agent-url', { appId });
        showTransientAttachmentBanner(t('builder_chatfiles_error_upload_failed'));
        return;
      }
      logger.debug('chat-pane.screenshot-captured', { appId });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      // crypto.randomUUID — collision-safe across rapid captures (paste-twice or
      // paste + camera shortcut within the same millisecond). Date.now alone collides.
      const placeholderId = `screenshot-${crypto.randomUUID()}`;
      setUploadingStagedFileIds((prev) => [...prev, placeholderId]);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

      let assetItems: AssetManagerItem[] | null = null;

      try {
        const blob = await fetch(dataUrl, { signal: controller.signal }).then((r) => r.blob());
        // Today canvas.toDataURL emits image/jpeg, but trust the blob so a future
        // PNG/WebP capture path produces a File whose MIME matches its bytes.
        const mimeType = blob.type || 'image/jpeg';
        const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
        const filename = `screenshot-${timestamp}.${ext}`;
        const file = new File([blob], filename, { type: mimeType });

        // getFileUploadAgent uses appFetch internally with no abort signal, so race it
        // against the controller to honour UPLOAD_TIMEOUT_MS during the token fetch too.
        const { token, uploadUrl } = await Promise.race([
          getFileUploadAgent(appId),
          new Promise<never>((_, reject) => {
            if (controller.signal.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }
            controller.signal.addEventListener(
              'abort',
              () => reject(new DOMException('The operation was aborted.', 'AbortError')),
              { once: true }
            );
          }),
        ]);

        const formData = new FormData();
        formData.append('appId', appId);
        formData.append('files', file);

        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          let errorMessage = `Upload failed (${response.status})`;
          try {
            const body = await response.json();
            if (body.error) {
              errorMessage =
                typeof body.error === 'string' ? body.error : body.error.message || errorMessage;
            }
          } catch {
            // Server returned a non-JSON error body (e.g. HTML gateway page).
            // The upload has definitively failed — log at warn so gateway/proxy
            // misbehaviour surfaces in Grafana/Loki at the default log level.
            // The raw SyntaxError is suppressed; the default errorMessage above is shown.
            logger.warn('chat-pane.screenshot-upload-failed.non-json-error-body', {
              appId,
              status: response.status,
            });
          }
          throw new Error(errorMessage);
        }

        let result: { uploadId?: string; files?: unknown };
        try {
          result = await response.json();
        } catch {
          // 200 OK with a non-JSON body (e.g. an HTML page from a misbehaving proxy).
          // The raw SyntaxError message would leak to the banner, so use the localized fallback.
          logger.error('chat-pane.screenshot-upload-failed.non-json-success-body', { appId });
          throw new Error(t('builder_chatfiles_error_upload_failed'));
        }
        logger.info('chat-pane.screenshot-uploaded', { appId, uploadId: result.uploadId });

        if (!Array.isArray(result.files) || result.files.length === 0) {
          throw new Error(t('builder_chatfiles_error_upload_failed'));
        }

        assetItems = mapUploadedFilesToAssetItems(result.files, agentUrl);
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        const message = isTimeout
          ? t('builder_chatfiles_error_timeout_duration', { seconds: UPLOAD_TIMEOUT_SECONDS })
          : error instanceof Error
            ? error.message
            : t('builder_chatfiles_error_upload_failed');
        logger.error('chat-pane.screenshot-upload-failed', { appId, error: message });
        // Not handleUploadError — that clears the entire uploadingStagedFileIds array,
        // which would wipe spinners for unrelated in-flight uploads. The finally block
        // surgically removes only this screenshot's placeholder id.
        showTransientAttachmentBanner(message);
      } finally {
        clearTimeout(timeout);
        setUploadingStagedFileIds((prev) => prev.filter((id) => id !== placeholderId));
      }

      // Asset attachment runs outside the try block so a programming error in
      // setSelectedAssets is not mis-logged as chat-pane.screenshot-upload-failed.
      if (!assetItems) return;

      // Read current state via refs (the network awaits above can outlive the
      // useCallback closure). Cap accounts for stagedFiles since they will be
      // appended to selectedAssets at Send time. With refs supplying fresh values,
      // the setSelectedAssets updater stays a true pure prev → next mapping.
      const currentSelected = selectedAssetsRef.current;
      const currentStaged = stagedFilesRef.current;
      const room = MAX_TOTAL_ASSETS - currentSelected.length - currentStaged.length;
      const prevUrls = new Set(currentSelected.map((a) => a.imageUrl));
      const dedup = assetItems.filter((item) => !prevUrls.has(item.imageUrl));
      const itemsToAdd = dedup.slice(0, Math.max(0, room));

      if (dedup.length > room) {
        showTransientAttachmentBanner(
          t('builder_chatfiles_error_max_attachments', { count: MAX_TOTAL_ASSETS })
        );
      }
      if (itemsToAdd.length > 0) {
        setSelectedAssets((prev) => [...prev, ...itemsToAdd]);
      }
    },
    [appId, t, agentUrl, showTransientAttachmentBanner]
  );

  const commanderComposerSlots = useMemo(() => {
    if (!isCommanderChatEnabled) return undefined;
    return {
      toolbarStart: (
        <div className="flex items-center gap-0.5">
          <CommanderComposerLeft appId={appId} />
          {appId && handleStageFiles && (
            <ChatAttachmentMenu
              appId={appId}
              onStageFiles={handleStageFiles}
              onScreenshotCaptured={handleScreenshotCaptured}
              onFileReferencesSelected={handleFileReferencesSelected}
              onUploadError={handleAttachmentMenuError}
              disabled={isProcessing || budgetExceeded}
            />
          )}
        </div>
      ),
      toolbarEnd: null,
    };
  }, [
    isCommanderChatEnabled,
    appId,
    handleStageFiles,
    handleScreenshotCaptured,
    handleFileReferencesSelected,
    handleAttachmentMenuError,
    isProcessing,
    budgetExceeded,
  ]);

  // Listen for error fix requests from PreviewPaneSimple
  useEffect(() => {
    const handleErrorFixEvent = (event: CustomEvent) => {
      if (!isProcessing && event.detail.appId === appId && inputValue?.trim()) {
        // Use the actual sendMessage function from WebSocket hook
        void sendMessage({
          content: inputValue,
          aiEditContext: { ...safeAiEditContext, screenshot: null },
          selectedAssets: selectedAssets.length > 0 ? selectedAssets : undefined,
        });

        // Clear the AI edit context after sending
        if (safeAiEditContext) {
          handleClearAiEditContext();
        }

        // Clear the selected assets after sending
        if (selectedAssets.length > 0) {
          handleClearSelectedAsset();
        }

        // Clear the build error context after sending
        if (safeBuildErrorContext) {
          handleClearBuildErrorContext();
        }
      }
    };

    window.addEventListener('airo-error-fix', handleErrorFixEvent as EventListener);

    return () => {
      window.removeEventListener('airo-error-fix', handleErrorFixEvent as EventListener);
    };
  }, [
    appId,
    inputValue,
    isProcessing,
    sendMessage,
    safeAiEditContext,
    selectedAssets,
    safeBuildErrorContext,
    handleClearAiEditContext,
    handleClearSelectedAsset,
    handleClearBuildErrorContext,
  ]);

  // Listen for automation run requests from AutomationsPanel
  useEffect(() => {
    const handleAutomationRun = (event: CustomEvent<{ appId: string; prompt: string; automationId?: string }>) => {
      if (event.detail.appId !== appId) return
      // Read live store state at dispatch time to avoid stale-closure double-send.
      const { isLoading, streamingState, activeStream } = useStreamingConversationStore.getState()
      const liveIsProcessing = isLoading || (streamingState === 'streaming' && !!activeStream) || !!loadingMessageRef.current
      if (liveIsProcessing) return
      sendMessage({
        content: event.detail.prompt,
        aiEditContext: null,
        ...(event.detail.automationId && { automationId: event.detail.automationId }),
      }).catch(function onSendError(err: unknown) {
        logger.error('chat.automation-run.send-failed', {
          appId,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    };

    window.addEventListener('airo-automation-run', handleAutomationRun as EventListener);
    return () => {
      window.removeEventListener('airo-automation-run', handleAutomationRun as EventListener);
    };
  }, [appId, sendMessage]);

  if (isMobile) {
    return (
      <ChatContext.Provider value={chatContextValue}>
        <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden relative">
          <PlanTracker
            developmentPlan={developmentPlan}
            expandedPlan={expandedPlan}
            onToggleExpandedPlan={toggleExpandedPlan}
          />

          <StreamingMessageList
            allMessages={visibleMessages}
            isCreateFlowSession={isCreateFlowSession}
            hasInitialPrompt={hasInitialPrompt}
            initialPromptText={initialPromptText}
            transcriptContainerVisible
          />

          {showProactiveBudgetBanner && (
            <div className="mx-2 sm:mx-3 mb-2">
              <BudgetExceededBanner onClose={() => setIsProactiveBannerDismissed(true)} />
            </div>
          )}
          <ChatBanners appId={appId} />
          {showResponseFeedbackThanksBanner && (
            <div className="mb-1">
              <ChatBanner
                variant="info"
                onClose={dismissResponseFeedbackThanksBanner}
                className="!mx-2 sm:!mx-3 md:!mx-0 !rounded-lg !shadow-none"
              >
                <span className="text-sm">
                  {t(
                    'builder_widgets_feedback_thank_you',
                    undefined,
                    'Thank you for your feedback'
                  )}
                </span>
              </ChatBanner>
            </div>
          )}
          {isQueueEnabled && <QueuedMessagesStrip />}
          <ChatComposerSlot
            activeColorSchemeSuggest={activeColorSchemeSuggest}
            activeFontThemeSuggest={activeFontThemeSuggest}
            appId={appId}
            inputValue={safeInputValue}
            isDisabled={isProcessing}
            isStreaming={isStreaming}
            isAwaitingStream={isAwaitingStream}
            isBudgetExceeded={isInputBudgetGated}
            loadingMessage={loadingMessage}
            onInputChange={setInputValue}
            onSendMessage={handleSendMessage}
            onStopGeneration={stopGeneration}
            selectedAssets={selectedAssets}
            maxAssets={maxAssets}
            onClearSelectedAsset={handleClearSingleAsset}
            stagedFiles={stagedFiles}
            onStageFiles={handleStageFiles}
            onRemoveStagedFile={handleRemoveStagedFile}
            onScreenshotCaptured={handleScreenshotCaptured}
            onFileReferencesSelected={handleFileReferencesSelected}
            onUploadError={handleAttachmentMenuError}
            uploadingStagedFileIds={uploadingStagedFileIds}
            referencedFiles={referencedFiles}
            onClearReferencedFile={handleClearSingleReferencedFile}
            aiEditContext={safeAiEditContext}
            onClearAiEditContext={handleClearAiEditContext}
            onLargePasteDetected={handleLargePasteDetected}
            mediaLimitError={uploadError}
            userMessages={userMessages}
            isQueueEnabled={isQueueEnabled}
            isQueueFull={isQueueFull}
            secretsComposer={showSecretsComposer ? activeSecretsRequest : null}
            secretsComposerConversationId={secretsComposerConversationId ?? undefined}
            composerSlots={commanderComposerSlots}
            designKitSuggest={activeDesignKitSuggest}
          />
          {isCommanderChatEnabled && (
            <CommanderChatRow appId={appId} onPreviewRefresh={onPreviewRefresh} />
          )}
          <DebugStatsPanel />
        </div>
      </ChatContext.Provider>
    );
  }

  return (
    <ChatContext.Provider value={chatContextValue}>
      <div
        ref={chatPaneRootRef}
        data-media-delete-overlay-boundary
        className={clsx("flex-1 flex flex-col h-full p-0", !hideToolbar && "md:ps-2", {
          'gap-1 md:pb-2': !isCommanderChatEnabled,
          'md:pb-1': isCommanderChatEnabled,
        })}
      >
        <GitHubSyncSettingsSavedSnackbar placement="chat-pane" />
        <div ref={planTrackerWrapperRef} className="shrink-0">
          <PlanTracker
            developmentPlan={developmentPlan}
            expandedPlan={expandedPlan}
            onToggleExpandedPlan={toggleExpandedPlan}
          />
        </div>

        {/* Chat Tab - Keep mounted, hide with CSS */}
        <div
          className="flex flex-col flex-1 min-h-0 relative"
          style={{ display: activeChatTab === ChatTab.CHAT ? 'flex' : 'none' }}
        >
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {!areChatPlansEnabled && <PersistentTodoList />}

            <StreamingMessageList
              allMessages={visibleMessages}
              isCreateFlowSession={isCreateFlowSession}
              hasInitialPrompt={hasInitialPrompt}
              initialPromptText={initialPromptText}
              transcriptContainerVisible={activeChatTab === ChatTab.CHAT}
            />
          </div>

          <div ref={belowMessagesWrapperRef} className="flex flex-col shrink-0">
          {safeBuildErrorContext && (
            <div className="mx-2 rounded-md overflow-hidden border">
              <div className="p-1.5">
                <div className="flex items-start justify-between gap-1">
                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-0.5">
                      <svg
                        className="w-2 h-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span className="font-semibold text-sm">
                        {t('builder_chatpane_build_error')}
                      </span>
                    </div>
                    <div className="text-xs break-words">{safeBuildErrorContext.error}</div>
                    {safeBuildErrorContext.exitCode && (
                      <div className="text-xs mt-0.5">
                        {t('builder_chatpane_exit_code')}: {safeBuildErrorContext.exitCode}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleClearBuildErrorContext}
                    className="flex-shrink-0 w-3 h-3 flex items-center justify-center bg-white rounded-full shadow-sm hover:shadow-md font-bold text-lg text-red-600"
                    title={t('builder_chatpane_build_exit_code')}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )}

          {showProactiveBudgetBanner && (
            <div className="px-2 sm:px-3 md:px-1 mb-2">
              <BudgetExceededBanner onClose={() => setIsProactiveBannerDismissed(true)} />
            </div>
          )}
          <div className="px-2 sm:px-3 md:px-0">
            <ChatBanners appId={appId} />
            {showResponseFeedbackThanksBanner && (
              <div className="mb-1">
                <ChatBanner
                  variant="info"
                  onClose={dismissResponseFeedbackThanksBanner}
                  className="!mx-0 !rounded-lg !shadow-none"
                >
                  <span className="text-sm">
                    {t(
                      'builder_widgets_feedback_thank_you',
                      undefined,
                      'Thank you for your feedback'
                    )}
                  </span>
                </ChatBanner>
              </div>
            )}
            {isQueueEnabled && <QueuedMessagesStrip />}
            <ChatComposerSlot
              activeColorSchemeSuggest={activeColorSchemeSuggest}
              activeFontThemeSuggest={activeFontThemeSuggest}
              appId={appId}
              inputValue={safeInputValue}
              isDisabled={isProcessing}
              isStreaming={isStreaming}
              isAwaitingStream={isAwaitingStream}
              isBudgetExceeded={isInputBudgetGated}
              loadingMessage={loadingMessage}
              onInputChange={setInputValue}
              onSendMessage={handleSendMessage}
              onStopGeneration={stopGeneration}
              selectedAssets={selectedAssets}
              maxAssets={maxAssets}
              onClearSelectedAsset={handleClearSingleAsset}
              stagedFiles={stagedFiles}
              onStageFiles={handleStageFiles}
              onRemoveStagedFile={handleRemoveStagedFile}
              onScreenshotCaptured={handleScreenshotCaptured}
              onFileReferencesSelected={handleFileReferencesSelected}
              onUploadError={handleAttachmentMenuError}
              uploadingStagedFileIds={uploadingStagedFileIds}
              referencedFiles={referencedFiles}
              onClearReferencedFile={handleClearSingleReferencedFile}
              aiEditContext={safeAiEditContext}
              onClearAiEditContext={handleClearAiEditContext}
              aiEditContexts={safeAiEditContexts}
              onRemoveAiEditContext={handleRemoveAiEditContext}
              isMultiElementSelect={Boolean(isMultiElementSelect)}
              onLargePasteDetected={handleLargePasteDetected}
              mediaLimitError={uploadError}
              userMessages={userMessages}
              isQueueEnabled={isQueueEnabled}
              isQueueFull={isQueueFull}
              secretsComposer={showSecretsComposer ? activeSecretsRequest : null}
              secretsComposerConversationId={secretsComposerConversationId ?? undefined}
              composerSlots={commanderComposerSlots}
              designKitSuggest={activeDesignKitSuggest}
            />
          </div>
          <DebugStatsPanel />
          </div>
        </div>

        {/* History Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.HISTORY || visitedTabs.has(ChatTab.HISTORY)) && (
          <div
            className="flex flex-col flex-1 min-h-0"
            style={{ display: activeChatTab === ChatTab.HISTORY ? 'flex' : 'none' }}
          >
            {isCommanderChatEnabled && (
              <CommanderTabBackButton appId={appId} fromTab={ChatTab.HISTORY} />
            )}
            <VersionHistory />
          </div>
        )}

        {/* Media Tab - Mount on first visit, then CSS-hide to preserve state */}
        {/* Media Tab - Mount on first visit, then CSS-hide to preserve state (hidden when media canvas FF is on) */}
        {!isMediaCanvasEnabled && (activeChatTab === ChatTab.MEDIAS || visitedTabs.has(ChatTab.MEDIAS)) && (
          <div
            className="flex flex-col flex-1 min-h-0"
            style={{ display: activeChatTab === ChatTab.MEDIAS ? 'flex' : 'none' }}
          >
            {isCommanderChatEnabled && !mediaCurrentSlotName && (
              <CommanderTabBackButton appId={appId} fromTab={ChatTab.MEDIAS} />
            )}
            <MediaPanel />
          </div>
        )}

        {/* Media Replace Panel — full takeover when FF is on and a slot replace is requested */}
        {isMediaCanvasEnabled && mediaPanelSlotName && mediaPanelSlotName !== '__GRID__' && (
          <div className="absolute inset-0 z-20 flex flex-col bg-intents-ux-box-backgroundColor">
            <MediaReplacePanel slotName={mediaPanelSlotName} onClose={() => {
              clearPanelSlot()
              const returnTab = mediaReturnTab === ChatTab.MEDIAS ? ChatTab.CHAT : (mediaReturnTab ?? ChatTab.CHAT)
              setActiveChatTab(returnTab)
            }} />
          </div>
        )}

        {/* Analytics Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.ANALYTICS || visitedTabs.has(ChatTab.ANALYTICS)) && (
          <div
            className="flex flex-col flex-1 min-h-0 overflow-y-auto"
            style={{ display: activeChatTab === ChatTab.ANALYTICS ? 'flex' : 'none' }}
          >
            <AnalyticsPanel />
          </div>
        )}

        {/* Settings Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.SETTINGS || visitedTabs.has(ChatTab.SETTINGS)) && (
          <div
            className="flex flex-col flex-1 min-h-0"
            style={{ display: activeChatTab === ChatTab.SETTINGS ? 'flex' : 'none' }}
          >
            <SettingsView />
          </div>
        )}

        {!hideToolbar &&
          (isCommanderChatEnabled ? (
            <div ref={commanderChatRowWrapperRef} className="shrink-0">
              <CommanderChatRow appId={appId} onPreviewRefresh={onPreviewRefresh} />
            </div>
          ) : (
            <ChatToolbar />
          ))}
      </div>
    </ChatContext.Provider>
  );
}
