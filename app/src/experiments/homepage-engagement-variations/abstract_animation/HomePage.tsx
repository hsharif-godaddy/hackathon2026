'use client'

import clsx from 'clsx'

import HelpSection from '@/app/[market]/components/HelpSection'
import { UpgradeContainer } from '@/app/[market]/develop/components/paywall'
import { MockLoginDialog } from '@/components/auth/MockLogin'
import FAQSection from '@/components/layout/FAQSection'
import FeaturesSection from '@/components/layout/Features'
import Header from '@/components/layout/Header'
import PricingSection from '@/components/layout/PricingSection'
import HeroSection from '@/experiments/homepage-engagement-variations/abstract_animation/HeroSection'
import InfraSection from '@/experiments/homepage-engagement-variations/abstract_animation/InfraSection'
import StartSection from '@/experiments/homepage-engagement-variations/abstract_animation/StartSection'
import { useHomepageSubmission } from '@/hooks/useHomepageSubmission'
import { useTranslations } from '@/hooks/useTranslations'
import { isFeatureEnabled } from '@/lib/features'
import { shipAnalyticsLog } from '@/lib/logging'
import type { ServerFeatureFlags } from '@/lib/server-features'

interface HomeContentProps {
  serverFeatures: ServerFeatureFlags
}

export function AbstractAnimationHomePage({ serverFeatures }: HomeContentProps) {
  const t = useTranslations()
  const hp = useHomepageSubmission()

  return (
    <>
      <div
        className={clsx(
          'isolate relative w-full overflow-hidden',
          'bg-gradient bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor',
        )}
        data-homepage-variation="abstract_animation"
      >
        <div className="w-full h-full relative">
          <Header
            className="absolute top-0 left-0 w-full border-0!"
            onShowMockLogin={() => hp.setShowMockLogin(true)}
            location='homepage'
          />

          <HeroSection
            ref={hp.heroSectionRef}
            promptText={hp.promptText}
            setPromptText={hp.setPromptText}
            onStartBuilding={hp.handleStartBuilding}
            isLoading={hp.isLoading}
            error={hp.error}
            setError={hp.setHeroError}
            onExampleClick={hp.handleExampleClick}
            uploadedFile={hp.uploadedFile}
            onFileChange={hp.setUploadedFile}
            onTemplateChange={hp.setSelectedTemplate}
            {...(hp.isTemplateSelectorEnabled && {
              selectedTemplate: hp.selectedTemplate,
            })}
            {...(hp.isLogoMode && {
              headingText: t('builder_homepage_experiment_logo_header', undefined, 'Design a logo that defines your brand'),
              subheadingText: t('builder_homepage_experiment_logo_subheader', undefined, 'Describe your style and our AI will craft a unique logo in minutes'),
            })}
          />

          <StartSection />

          <FeaturesSection
            features={[
              {
                title: t('builder_homepage_feature_idea_title'),
                description: t('builder_homepage_feature_idea_description'),
              },
              {
                title: t('builder_homepage_feature_editing_title'),
                description: t('builder_homepage_feature_editing_description'),
              },
              {
                title: t('builder_homepage_feature_publish_title'),
                description: t('builder_homepage_feature_publish_description'),
              }
            ]}
          />

          <InfraSection />

          <FeaturesSection
            features={[
              {
                title: t('builder_homepage_feature_prograde_title'),
                description: t('builder_homepage_feature_prograde_description'),
              },
              {
                title: t('builder_homepage_feature_security_title'),
                description: t('builder_homepage_feature_security_description'),
              },
              {
                title: t('builder_homepage_feature_future_title'),
                description: t('builder_homepage_feature_future_description'),
              }
            ]}
          />

          {serverFeatures.showPricingSection && <PricingSection onPricingViewEnd={hp.logHomepagePricingView} />}

          <FAQSection />

          <HelpSection />

          {isFeatureEnabled.mockLogin() && (
            <MockLoginDialog
              isOpen={hp.showMockLogin}
              onClose={() => hp.setShowMockLogin(false)}
            />
          )}

        </div>
      </div>

      {hp.showUpgradeModal && (
        <UpgradeContainer
          source={hp.upgradeModalSource ?? 'unknown'}
          itc={hp.upgradeModalItc ?? undefined}
          onSuccessClick={() => hp.closeUpgradeModal()}
          onClose={() => {
            const source = hp.upgradeModalSource ?? 'unknown'
            hp.closeUpgradeModal()
            shipAnalyticsLog(`${source}.dismissed`, {})
          }}
          onErrorClick={() => {
            const source = hp.upgradeModalSource ?? 'unknown'
            hp.closeUpgradeModal()
            shipAnalyticsLog(`${source}.error`, {})
          }}
        />
      )}
    </>
  )
}
