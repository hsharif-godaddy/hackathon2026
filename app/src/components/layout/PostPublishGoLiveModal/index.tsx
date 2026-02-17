/**
 * Post-Publish Go Live Modal
 *
 * Guides first-time publishers through:
 * 1. Confirmation - Do you want to go live?
 * 2. Feature Selection - Choose which go-live features to run (token-aware)
 * 3. QA - Quality assurance check (if selected)
 * 4. Security Results - Show security scan results (if selected)
 * 5. Video - Show generated launch video (if selected)
 * 6. Marketing Selection - Choose which marketing actions to run (if selected)
 * 7. Marketing - Generate social posts and blog post (based on selections)
 *
 * Background tasks (video generation, security scan) start after user confirms selections
 */
'use client';

import { useEffect, useState } from 'react';
import Modal from '@ux/modal';

import { Confetti } from '@/components/icons/Confetti';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { ModalErrorBoundaryWithTranslations as ModalErrorBoundary } from './components/ModalErrorBoundary';
import { useQAAnalysis } from './hooks/useQAAnalysis';
import { useSecurityScan } from './hooks/useSecurityScan';
import { useVideoGeneration } from './hooks/useVideoGeneration';
import { ConfirmStep } from './steps/ConfirmStep';
import { QAStep } from './steps/QAStep';
import { SecurityResultsStep } from './steps/SecurityResultsStep';
import { type FeatureSelections, SelectFeaturesStep } from './steps/SelectFeaturesStep';
import { type MarketingSelections, SelectMarketingStep } from './steps/SelectMarketingStep';
import { VideoStep } from './steps/VideoStep';
import type { TaskStatus } from './types';

interface PostPublishGoLiveModalProps {
  appId: string;
}

export default function PostPublishGoLiveModal({ appId }: PostPublishGoLiveModalProps) {
  const t = useTranslations();
  const {
    getPublishState,
    setShowGoLiveModal,
    setGoLiveModalStep,
    setFeatureSelections,
    setMarketingSelections,
    markAsGoneLive
  } = useDevelopPageStore();

  const { sendMessage } = useWebSocketContext();
  const getSite = useSiteStore((state) => state.getSite);

  const publishState = getPublishState(appId);
  const {
    showGoLiveModal,
    goLiveModalStep,
    securityScanResults,
    launchVideoUrl,
    featureSelections,
  } = publishState;

  const { isLgBreakpoint } = useBreakpoints();

  // Custom hooks
  const { isScanning, scanError, runScan } = useSecurityScan(appId);
  const { isGeneratingVideo, videoError, generateVideo } = useVideoGeneration(appId);
  const { isAnalyzing, analysisError, analysisResults, runAnalysis, updateFixedIssues } = useQAAnalysis(appId);

  // Local state for background task status
  const [securityStatus, setSecurityStatus] = useState<TaskStatus>('pending');

  // Initialize modal step
  useEffect(() => {
    if (showGoLiveModal && !goLiveModalStep) {
      setGoLiveModalStep(appId, 'confirm');
      shipAnalyticsLog('go_live.modal.shown', { appId });
    }
  }, [showGoLiveModal, goLiveModalStep, appId, setGoLiveModalStep]);

  // Update security status based on scan state
  useEffect(() => {
    if (securityScanResults) {
      setSecurityStatus('completed');
    } else if (scanError) {
      setSecurityStatus('failed');
    } else if (isScanning) {
      setSecurityStatus('running');
    }
  }, [securityScanResults, scanError, isScanning]);


  const handleClose = (reason: 'dismiss' | 'complete' | 'action-taken' = 'dismiss') => {
    setShowGoLiveModal(appId, false);
    // Only log dismissal for user-initiated closes without taking action
    // 'complete' = full flow completed successfully
    // 'action-taken' = user took action (e.g., requested fixes) but didn't complete full flow
    if (reason === 'dismiss') {
      shipAnalyticsLog('go_live.modal.dismissed', { appId, step: goLiveModalStep });
    }
  };

  const handleConfirm = () => {
    shipAnalyticsLog('go_live.confirmed', { appId });
    setGoLiveModalStep(appId, 'select-features');
    shipAnalyticsLog('go_live.select_features.shown', { appId });
  };

  // Helper to get the next step based on current step and feature selections
  const getNextStepAfter = (currentStep: string): 'qa' | 'security-results' | 'video' | 'select-marketing' | null => {
    if (!featureSelections) return null;

    switch (currentStep) {
      case 'qa':
        if (featureSelections.security) return 'security-results';
        if (featureSelections.video) return 'video';
        if (featureSelections.marketing) return 'select-marketing';
        return null;

      case 'security-results':
        if (featureSelections.video) return 'video';
        if (featureSelections.marketing) return 'select-marketing';
        return null;

      case 'video':
        if (featureSelections.marketing) return 'select-marketing';
        return null;

      case 'select-marketing':
        return null; // Marketing is always last

      default:
        return null;
    }
  };

  // Helper to navigate to next step or complete flow
  const navigateOrComplete = (currentStep: string) => {
    const nextStep = getNextStepAfter(currentStep);

    if (nextStep) {
      setGoLiveModalStep(appId, nextStep);
      const stepNameMap: Record<string, string> = {
        'security-results': 'security_results',
        'video': 'video',
        'select-marketing': 'marketing_select'
      };
      const analyticsStep = stepNameMap[nextStep] || nextStep;
      shipAnalyticsLog(`go_live.${analyticsStep}.shown`, { appId });
    } else {
      // This was the last step, complete the flow
      void handleCompleteFlow();
    }
  };

  const handleCompleteFlow = async () => {
    shipAnalyticsLog('go_live.completed', { appId });
    handleClose('complete');

    // Mark as gone live in background (don't block UI)
    void (async () => {
      try {
        await markAsGoneLive(appId);
        shipAnalyticsLog('go_live.mark_success', { appId });
      } catch (err) {
        logger.error('go-live.mark-failed.first-attempt', { appId, error: String(err) });

        // Retry once after brief delay
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await markAsGoneLive(appId);
          shipAnalyticsLog('go_live.mark_success.retry', { appId });
        } catch (retryErr) {
          logger.error('go-live.mark-failed.retry-attempt', { appId, error: String(retryErr) });
          shipAnalyticsLog('go_live.mark_failed', { appId, error: String(retryErr) });
        }
      }
    })();
  };

  const handleFeatureSelection = async (selections: FeatureSelections) => {
    setFeatureSelections(appId, selections);
    shipAnalyticsLog('go_live.features_selected', { appId, selections });

    // If no features selected (shouldn't happen, button disabled), just close
    const hasAnySelection = Object.values(selections).some((v: boolean) => v);
    if (!hasAnySelection) {
      handleClose();
      return;
    }

    // Start background tasks for selected features
    if (selections.video && !launchVideoUrl) {
      void generateVideo();
    }
    if (selections.security && !securityScanResults) {
      void runScan();
    }

    // Navigate to first selected feature
    if (selections.qa) {
      setGoLiveModalStep(appId, 'qa');
      void runAnalysis();
      shipAnalyticsLog('go_live.qa.shown', { appId });
    } else if (selections.security) {
      setGoLiveModalStep(appId, 'security-results');
      shipAnalyticsLog('go_live.security_results.shown', { appId });
    } else if (selections.video) {
      setGoLiveModalStep(appId, 'video');
      shipAnalyticsLog('go_live.video.shown', { appId });
    } else if (selections.marketing) {
      setGoLiveModalStep(appId, 'select-marketing');
      shipAnalyticsLog('go_live.marketing_select.shown', { appId });
    }
  };

  const handleMarketingSelection = async (selections: MarketingSelections) => {
    setMarketingSelections(appId, selections);
    shipAnalyticsLog('go_live.marketing_actions_selected', { appId, selections });

    const site = getSite(appId);
    if (!site) {
      logger.error('go-live.marketing.no-site', { appId });
      return;
    }

    const siteName = site.name || t('golive_default_site_name');
    const message = t('golive_marketing_launch_prompt', { siteName });

    // Build task list based on selections
    const tasks = [];
    if (selections.seo) {
      tasks.push({
        id: 'seo_optimization',
        title: 'Optimize SEO',
        description: 'Use your available SEO tools and skills to improve search engine optimization'
      });
    }
    if (selections.blogPost) {
      tasks.push({
        id: 'blog_post',
        title: 'Create launch announcement blog post',
        description: 'First check if the site has a blog. If yes, use the blog-writing skill to add a launch announcement post (800-1200 words). If no blog exists, first use the blog skill to add a blog feature to the site, then use the blog-writing skill to create the launch announcement post.'
      });
    }
    if (selections.socialPosts) {
      tasks.push({
        id: 'social_media_posts',
        title: 'Generate and publish social media posts',
        description: 'Check if you have access to social skills (social-platform, social-posts, social-publish). If available, use them to connect platforms, generate 3-5 engaging launch announcement posts, and publish them. If social skills are not available, create 3-5 social media posts manually for different platforms with varied tone and style. Include the promotional video from /public/images/ (the file starting with go_live-) in at least one of the posts.'
      });
    }

    shipAnalyticsLog('go_live.marketing.started', { appId });

    // Build explicit instructions based on what was selected
    const taskCount = tasks.length;
    const taskNames = tasks.map(t => t.title).join(', ');
    const restrictiveInstructions = `IMPORTANT: The user has specifically selected ${taskCount} marketing task${taskCount === 1 ? '' : 's'}: ${taskNames}.

ONLY complete these ${taskCount} task${taskCount === 1 ? '' : 's'}. DO NOT do any additional marketing tasks beyond what is listed below. The user wants to conserve tokens, so do not create emails, press releases, newsletters, or any other marketing content unless explicitly listed in the tasks.

Create a todo list to track these ${taskCount} specific task${taskCount === 1 ? '' : 's'} and complete each one. After completing tasks that modify the site code (blog, SEO), remind the user to publish their site again to deploy the changes.`;

    await sendMessage(
      message,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        type: 'marketing_launch_package',
        data: {
          siteName,
          tasks,
          instructions: restrictiveInstructions,
          videoPath: '/public/images/',
          videoPrefix: 'go_live-'
        },
        persistence: 'ephemeral',
        source: 'go-live-modal'
      }
    );

    await handleCompleteFlow();
  };


  const handleQAContinue = () => {
    navigateOrComplete('qa');
  };

  const handleQASkip = () => {
    shipAnalyticsLog('go_live.qa.skipped', { appId });
    navigateOrComplete('qa');
  };

  const handlePublishSecurityFixes = async () => {
    const vulnerabilities = securityScanResults?.vulnerabilities || [];
    const totalIssues = vulnerabilities.length;
    const issueText = totalIssues === 1
      ? t('golive_security_vulnerability_singular')
      : t('golive_security_vulnerability_plural', { count: totalIssues });

    const message = t('golive_security_fix_prompt', { issueText });

    shipAnalyticsLog('go_live.security_fixes.requested', { appId, issueCount: totalIssues });

    // Send message with vulnerability details in context (similar to QA)
    await sendMessage(
      message,
      undefined, // aiEditContext
      undefined, // selectedAsset
      undefined, // todoListContext
      undefined, // isActionRequest
      {
        type: 'security_issues_fix_request',
        data: {
          issueCount: totalIssues,
          vulnerabilities: vulnerabilities.map(v => ({
            severity: v.severity,
            title: v.title,
            description: v.description
          })),
          instructions: 'Fix these security vulnerabilities one by one. For each vulnerability, make the necessary code changes to address the security issue and explain what you did. After fixing all vulnerabilities, remind the user to publish their site again to deploy the security fixes.'
        },
        persistence: 'ephemeral',
        source: 'security-modal'
      }
    );
    handleClose('action-taken');
  };

  const handleSecurityResultsSkip = () => {
    shipAnalyticsLog('go_live.security_results.skipped', { appId });
    navigateOrComplete('security-results');
  };

  const handleVideoSkip = () => {
    shipAnalyticsLog('go_live.video.skipped', { appId });
    navigateOrComplete('video');
  };

  const handleContinueToMarketing = () => {
    navigateOrComplete('video');
  };



  const renderStep = () => {
    switch (goLiveModalStep) {
      case 'confirm':
        return (
          <ModalErrorBoundary stepName="confirm" appId={appId}>
            <ConfirmStep
              onConfirm={handleConfirm}
              onCancel={() => handleClose()}
            />
          </ModalErrorBoundary>
        );

      case 'select-features':
        return (
          <ModalErrorBoundary stepName="select-features" appId={appId}>
            <SelectFeaturesStep
              appId={appId}
              onConfirm={handleFeatureSelection}
              onCancel={() => handleClose()}
            />
          </ModalErrorBoundary>
        );

      case 'qa':
        return (
          <ModalErrorBoundary stepName="qa" appId={appId} onReset={runAnalysis}>
            <QAStep
              appId={appId}
              isAnalyzing={isAnalyzing}
              analysisError={analysisError}
              analysisResults={analysisResults}
              updateFixedIssues={updateFixedIssues}
              onContinue={handleQAContinue}
              onSkip={handleQASkip}
              onClose={() => handleClose()}
            />
          </ModalErrorBoundary>
        );

      case 'security-results':
        return (
          <ModalErrorBoundary stepName="security-results" appId={appId} onReset={runScan}>
            <SecurityResultsStep
              securityStatus={securityStatus}
              securityScanResults={securityScanResults}
              securityError={scanError}
              onPublishFixes={handlePublishSecurityFixes}
              onSkip={handleSecurityResultsSkip}
            />
          </ModalErrorBoundary>
        );

      case 'video':
        return (
          <ModalErrorBoundary stepName="video" appId={appId} onReset={generateVideo}>
            <VideoStep
              appId={appId}
              isGeneratingVideo={isGeneratingVideo}
              videoError={videoError}
              launchVideoUrl={launchVideoUrl}
              onContinue={handleContinueToMarketing}
              onSkip={handleVideoSkip}
            />
          </ModalErrorBoundary>
        );

      case 'select-marketing':
        return (
          <ModalErrorBoundary stepName="select-marketing" appId={appId}>
            <SelectMarketingStep
              onConfirm={handleMarketingSelection}
              onSkip={() => navigateOrComplete('select-marketing')}
            />
          </ModalErrorBoundary>
        );

      default:
        return null;
    }
  };

  if (!showGoLiveModal) {
    return null;
  }

  const modalTitle = (() => {
    switch (goLiveModalStep) {
      case 'confirm': return null;
      case 'select-features': return t('builder_golive_modal_title_select_features');
      case 'qa': return t('golive_modal_title_qa');
      case 'security-results': return t('golive_modal_title_security');
      case 'video': return t('golive_modal_title_video');
      case 'select-marketing': return t('builder_golive_modal_title_select_marketing');
      default: return t('golive_modal_title_default');
    }
  })();

  return (
    <Modal
      show={showGoLiveModal}
      onClose={() => handleClose()}
      title={modalTitle}
      id="go-live-modal"
      className="relative"
      stretch={!isLgBreakpoint}
    >
      {/* Confetti decoration at top of modal (on confirm step only) */}
      {goLiveModalStep === 'confirm' && (
        <div className="absolute top-0 left-0 right-0 h-20 overflow-hidden pointer-events-none z-10">
          <Confetti />
        </div>
      )}

      <div className="w-full sm:min-w-[600px]">
        {renderStep()}
      </div>
    </Modal>
  );
}
