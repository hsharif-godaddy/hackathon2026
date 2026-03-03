'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import CloudUploadIcon from '@ux/icon/cloud-upload'
import DatabaseIcon from '@ux/icon/database'
import DesktopIcon from '@ux/icon/desktop'
import DomainIcon from '@ux/icon/domain'
import DownloadIcon from '@ux/icon/download'
import InformationIcon from '@ux/icon/information'
import ServerIcon from '@ux/icon/server'
import Skeleton from '@ux/skeleton'
import text from '@ux/text'
import Tooltip from '@ux/tooltip'

import PageSection from '@/components/layout/PageSection'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useSubscription } from '@/hooks/useSubscription'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { formatOfferPrice } from '@/lib/pricing'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

// Session-scoped storage key for pending upgrade action
const PENDING_UPGRADE_KEY = 'airo-pending-pricing-upgrade'

function InfoTooltip({ content }: { content: string }) {
  const [show, setShow] = useState(false)
  const anchorRef = useRef(null)

  const tooltip = (
    <Tooltip anchorRef={anchorRef}>
      <div style={{ maxWidth: '30ch' }}>{content}</div>
    </Tooltip>
  )

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        aria-haspopup={show}
        className="cursor-help inline-flex items-center"
      >
        <InformationIcon className="size-2" />
      </span>
      {show && tooltip}
    </>
  )
}

export default function PricingSection() {
  const t = useTranslations();
  const [pricingData, setPricingData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal)

  const { isAuthenticated, isAuthDisabled, isLoading: authIsLoading } = useAuthContext()
  const { signIn } = useSsoSignIn()
  // Disabled by default - only refetch when restoring pending upgrade to avoid unnecessary API calls
  const { refetch: refetchSubscription } = useSubscription({ enabled: false })

  useEffect(() => {
    async function fetchPricing() {
      try {
        setIsLoading(true)
        const response = await fetch('/api/pricing/offers')

        if (!response.ok) {
          shipAnalyticsLog('pricing_section.fetch.http_error', {
            status: response.status,
            statusText: response.statusText
          })
          return
        }

        const result = await response.json()

        if (!result.success) {
          shipAnalyticsLog('pricing_section.fetch.api_error', {
            error: result.error,
            message: result.message
          })
          return
        }

        if (result.data?.newOffers?.offers?.[0]) {
          const offer = result.data.newOffers.offers[0]
          setPricingData(offer)
        }
      } catch (error) {
        shipAnalyticsLog('pricing_section.fetch.exception', {
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setIsLoading(false)
      }
    }

    fetchPricing()
  }, [])

  useEffect(() => {
    if (authIsLoading || !isAuthenticated) return

    const pendingUpgrade = sessionStorage.getItem(PENDING_UPGRADE_KEY)
    if (!pendingUpgrade) return

    sessionStorage.removeItem(PENDING_UPGRADE_KEY)

    // fetch subscription to get latest data
    refetchSubscription()

    // Scroll to pricing section in background while opening modal
    const pricingSection = document.getElementById('pricing-section')
    if (pricingSection) {
      pricingSection.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    openUpgradeModal('pricing_section.upgrade', 'slp_airo_ai_builder')
    shipAnalyticsLog('pricing_section.upgrade_modal.opened_after_login', {})
  }, [authIsLoading, isAuthenticated, refetchSubscription, openUpgradeModal])

  const handleUpgradeClick = useCallback(() => {
    shipAnalyticsLog('pricing_section.upgrade_button.clicked', {})

    if (!isAuthDisabled && !isAuthenticated) {
      try {
        sessionStorage.setItem(PENDING_UPGRADE_KEY, 'true')
      } catch (error) {
        logger.warn('pricing_section.pending_upgrade.save_error', {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      signIn()
      return
    }

    openUpgradeModal('pricing_section.upgrade', 'slp_airo_ai_builder')
  }, [isAuthDisabled, isAuthenticated, signIn, openUpgradeModal])

  const handleStartBuildingClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    shipAnalyticsLog('pricing_section.start_building_button.clicked', {})
  }

  const PricingItem = ({ icon, title, tooltip }: { icon: React.ReactNode, title: string, tooltip?: string }) => {
    return (
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        {icon}
        <text.p size={0}>{title}</text.p>
        {tooltip && <InfoTooltip content={tooltip} />}
      </Box>
    )
  }

  return (
    <PageSection data-testid="pricing-section" id="pricing-section">
      <div className="flex flex-row flex-wrap justify-center items-center gap-4 md:gap-0 w-full max-w-screen-lg mx-auto">
        <div className="flex flex-col shrink-0 w-full md:max-w-1/2 p-4 lg:p-6 md:pr-12 md:mr-1 lg:pr-24 lg:mr-2 border border-intents-ux-box-borderColor rounded-2xl" data-partial="inverted">
          <text.h3 as="heading" size={0} className="mb-1">{t('builder_pricing_free_title')}</text.h3>
          <text.p size={1}>{t('builder_pricing_free_desc')}</text.p>
          <Button
            design="primary"
            text={t('builder_pricing_free_cta')}
            onClick={handleStartBuildingClick}
            className="!my-3"
          />
          <PricingItem icon={<DesktopIcon className="size-2" />} title={t('builder_pricing_free_item_creation')} />
          <hr className="border-intents-ux-box-borderColor my-1.5" />
          <PricingItem icon={<DatabaseIcon className="size-2" />} title={t('builder_pricing_item_credits', { count: 50 })} />
        </div>

        <div className="flex flex-col shrink-0 w-full md:max-w-1/2 md:-ml-10 lg:-ml-20 p-4 md:p-66 bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor rounded-2xl text-intents-ux-box-foregroundColor shadow-md">
          <text.h3 as="heading" size={2} className="mb-1">{t('builder_pricing_starter_title')}</text.h3>
          <text.p size={1}>{t('builder_pricing_starter_desc')}</text.p>
          {isLoading ? (
            <div className="my-3">
              <Skeleton size="md" width="150px" height="28px" />
            </div>
          ) : pricingData?.price?.numeric?.listing?.perTerm?.discounted != null &&
             pricingData?.currency &&
             pricingData?.marketId ? (
            <text.p size={3} className="mt-3">
              {t('builder_pricing_yearly', {
                price: formatOfferPrice(
                  pricingData.price.numeric.listing.perTerm.discounted,
                  pricingData.currency,
                  pricingData.marketId
                )
              })}
            </text.p>
          ) : null}
          <Button
            design="primary"
            text={t('builder_pricing_starter_cta')}
            onClick={handleUpgradeClick}
            disabled={authIsLoading}
            className="!my-4"
          />
          <PricingItem icon={<DesktopIcon className="size-2" />} title={t('builder_pricing_starter_item_creation')} />
          <hr className="border-intents-ux-box-borderColor my-1.5" />
          <PricingItem icon={<DatabaseIcon className="size-2" />} title={t('builder_pricing_item_credits', { count: 150 })} />
          <hr className="border-intents-ux-box-borderColor my-1.5" />
          <PricingItem icon={<ServerIcon className="size-2" />} title={t('builder_pricing_starter_item_hosting')} tooltip={t('builder_pricing_starter_item_hosting_tooltip')} />
          <hr className="border-intents-ux-box-borderColor my-1.5" />
          <PricingItem icon={<CloudUploadIcon className="size-2" />} title={t('builder_pricing_starter_item_published')} />
          <hr className="border-intents-ux-box-borderColor my-1.5" />
          <PricingItem icon={<DomainIcon className="size-2" />} title={t('builder_pricing_starter_item_domain')} />
          <hr className="border-intents-ux-box-borderColor my-1.5" />
          <PricingItem icon={<DownloadIcon className="size-2" />} title={t('builder_pricing_starter_item_download')} />
        </div>
      </div>
    </PageSection>
  )
}
