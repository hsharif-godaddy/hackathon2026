/**
 * Post-Publish Go Live Modal
 *
 * Guides first-time publishers through:
 * 1. Confirmation - Are you ready to go live?
 * 2. QA - Quality assurance check
 * 3. Security Results - Show security scan results
 * 4. Video - Show generated launch video
 * 5. Marketing - Generate social posts and blog post
 *
 * Background tasks (video generation, security scan) start immediately when modal opens
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@ux/modal';

import { Confetti } from '@/components/icons/Confetti';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
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
import { MarketingStep } from './steps/MarketingStep';
import { QAStep } from './steps/QAStep';
import { SecurityResultsStep } from './steps/SecurityResultsStep';
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
  } = publishState;

  // Custom hooks
  const { isScanning, scanError, runScan } = useSecurityScan(appId);
  const { isGeneratingVideo, videoError, generateVideo } = useVideoGeneration(appId);
  const { isAnalyzing, analysisError, analysisResults, runAnalysis, updateFixedIssues } = useQAAnalysis(appId);

  // Local state for background task status
  const [videoStatus, setVideoStatus] = useState<TaskStatus>('pending');
  const [securityStatus, setSecurityStatus] = useState<TaskStatus>('pending');

  // Initialize modal step
  useEffect(() => {
    if (showGoLiveModal && !goLiveModalStep) {
      setGoLiveModalStep(appId, 'confirm');
      shipAnalyticsLog('go_live.modal.shown', { appId });
    }
  }, [showGoLiveModal, goLiveModalStep, appId, setGoLiveModalStep]);

  // Update video status based on generation state
  useEffect(() => {
    if (launchVideoUrl) {
      setVideoStatus('completed');
    } else if (videoError) {
      setVideoStatus('failed');
    } else if (isGeneratingVideo) {
      setVideoStatus('running');
    }
  }, [launchVideoUrl, videoError, isGeneratingVideo]);

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


  const handleClose = () => {
    setShowGoLiveModal(appId, false);
    shipAnalyticsLog('go_live.modal.dismissed', { appId, step: goLiveModalStep });
  };

  const handleConfirm = async () => {
    // Start background tasks when user confirms (idempotent operations)
    if (!launchVideoUrl) {
      void generateVideo();
    }

    if (!securityScanResults) {
      void runScan();
    }

    // Move to QA step and start QA analysis
    setGoLiveModalStep(appId, 'qa');
    void runAnalysis();
    shipAnalyticsLog('go_live.qa.shown', { appId });
  };

  const handleQAContinue = () => {
    // Always go to security results step
    setGoLiveModalStep(appId, 'security-results');
    shipAnalyticsLog('go_live.security_results.shown', { appId });
  };

  const handleQASkip = () => {
    setGoLiveModalStep(appId, 'video');
    shipAnalyticsLog('go_live.qa.skipped', { appId });
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
    handleClose();
  };

  const handleSecurityResultsSkip = () => {
    setGoLiveModalStep(appId, 'video');
    shipAnalyticsLog('go_live.security_results.skipped', { appId });
  };

  const handleContinueToMarketing = () => {
    setGoLiveModalStep(appId, 'marketing');
    shipAnalyticsLog('go_live.marketing.shown', { appId });
  };


  const handleStartMarketing = async () => {
    const site = getSite(appId);
    const siteName = site?.name || t('golive_default_site_name');

    // Clean user-facing message
    const message = t('golive_marketing_launch_prompt', { siteName });

    shipAnalyticsLog('go_live.marketing.started', { appId });
    shipAnalyticsLog('go_live.completed', { appId });

    // Send message with detailed marketing instructions in context
    await sendMessage(
      message,
      undefined, // aiEditContext
      undefined, // selectedAsset
      undefined, // todoListContext
      undefined, // isActionRequest
      {
        type: 'marketing_launch_package',
        data: {
          siteName,
          tasks: [
            {
              id: 'seo_optimization',
              title: 'Optimize SEO',
              description: 'Use your available SEO tools and skills to improve search engine optimization'
            },
            {
              id: 'social_media_posts',
              title: 'Generate and publish social media posts',
              description: 'Check if you have access to social skills (social-platform, social-posts, social-publish). If available, use them to connect platforms, generate 3-5 engaging launch announcement posts, and publish them. If social skills are not available, create 3-5 social media posts manually for different platforms with varied tone and style. Include the promotional video from /public/images/ (the file starting with go_live-) in at least one of the posts.'
            },
            {
              id: 'blog_post',
              title: 'Create launch announcement blog post',
              description: 'First check if the site has a blog. If yes, use the blog-writing skill to add a launch announcement post (800-1200 words). If no blog exists, first use the blog skill to add a blog feature to the site, then use the blog-writing skill to create the launch announcement post.'
            }
          ],
          instructions: 'Create a todo list to track all these tasks and complete each one. Make all content ready to copy-paste and use immediately. After completing tasks that modify the site code (blog, SEO), remind the user to publish their site again to deploy the changes.',
          videoPath: '/public/images/',
          videoPrefix: 'go_live-'
        },
        persistence: 'ephemeral',
        source: 'go-live-modal'
      }
    );
    handleClose();

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

  const renderStep = () => {
    switch (goLiveModalStep) {
      case 'confirm':
        return (
          <ModalErrorBoundary stepName="confirm" appId={appId}>
            <ConfirmStep
              onConfirm={handleConfirm}
              onCancel={handleClose}
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
              onClose={handleClose}
            />
          </ModalErrorBoundary>
        );

      case 'security-results':
        return (
          <ModalErrorBoundary stepName="security-results" appId={appId} onReset={runScan}>
            <SecurityResultsStep
              videoStatus={videoStatus}
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
              videoStatus={videoStatus}
              securityStatus={securityStatus}
              onContinue={handleContinueToMarketing}
              onSkip={handleContinueToMarketing}
            />
          </ModalErrorBoundary>
        );

      case 'marketing':
        return (
          <ModalErrorBoundary stepName="marketing" appId={appId}>
            <MarketingStep
              videoStatus={videoStatus}
              securityStatus={securityStatus}
              onSkip={handleClose}
              onGenerate={handleStartMarketing}
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
      case 'confirm': return t('golive_modal_title_confirm');
      case 'qa': return t('golive_modal_title_qa');
      case 'security-results': return t('golive_modal_title_security');
      case 'video': return t('golive_modal_title_video');
      case 'marketing': return t('golive_modal_title_marketing');
      default: return t('golive_modal_title_default');
    }
  })();

  return (
    <Modal
      show={showGoLiveModal}
      onClose={handleClose}
      title={modalTitle}
      id="go-live-modal"
      className="relative"
    >
      {/* Confetti decoration at top of modal (only on marketing step) */}
      {goLiveModalStep === 'marketing' && (
        <div className="absolute top-0 left-0 right-0 h-20 overflow-hidden pointer-events-none z-10">
          <Confetti />
        </div>
      )}

      <div style={{ width: '600px', maxWidth: '90vw', minWidth: 0, overflow: 'hidden' }}>
        {renderStep()}
      </div>
    </Modal>
  );
}
