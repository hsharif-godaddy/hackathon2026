'use client'

import { useParams } from 'next/navigation'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'
import { FBConnectFlow, GBPConnectFlow, IGConnectFlow, type onCompletePayload } from '@social/social-flows'
import Button from '@ux/button'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'

import { createModalAlignedUxText } from '@/app/[market]/develop/components/social/connect-flow/createModalAlignedUxText'
import { useLinkConnection } from '@/hooks/social/mutations/useLinkConnection'
import { useUnlinkConnection } from '@/hooks/social/mutations/useUnlinkConnection'
import { useSiteAssociations } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import { getRootDomain } from '@/utils/getRootDomain'

/** Minimal Redux store required by @wsb/modal-loader's dep injection */
const minimalStore = createStore(() => ({}))

/**
 * Shim window.ux with the UXCore components the social-flows CDN
 * bundle resolves via webpack externals. Our app loads UXCore as ES
 * modules (externals: false), so window.ux doesn't exist by default.
 *
 * Only these four are externalized by @ux/webpack-config. Other @ux/*
 * packages (icon, menu, radio, sibling-set, intents) are bundled into
 * the CDN artifact directly.
 */
function ensureUxGlobals(): void {
  if (typeof window === 'undefined') return
  const win = window as unknown as Record<string, unknown>
  if (!win.ux) win.ux = {}
  const ux = win.ux as Record<string, unknown>
  ux.Button = ux.Button || Button
  ux.Modal = ux.Modal || Modal
  ux.Text = createModalAlignedUxText()
  ux.Spinner = ux.Spinner || Spinner
}

const SOURCE_APP = 'airo-app-builder'

const FLOW_COMPONENTS: Record<string, React.ComponentType<any>> = {
  facebook: FBConnectFlow,
  instagram: IGConnectFlow,
  google: GBPConnectFlow,
}

type WidgetStatus = 'idle' | 'connecting' | 'linking' | 'error' | 'incomplete'

export interface SocialFlowsConnectWidgetProps {
  appId: string
  platform: string
  onSuccess: () => void
  onClose?: () => void
  /** When false, render inline inside a parent container instead of opening a modal. */
  modal?: boolean
}

/**
 * Adapter between the chat tool renderer and @social/social-flows
 * connect components. Renders the CDN-loaded connect modal and
 * links the resulting social connection to the agents-side site
 * association on completion.
 */
const SocialFlowsConnectWidget = memo(
  function SocialFlowsConnectWidget({
    appId,
    platform,
    onSuccess,
    onClose,
    modal = true,
  }: SocialFlowsConnectWidgetProps) {
    const params = useParams<{ market: string }>()
    const market = params.market || 'en-US'
    const rootDomain = getRootDomain() || 'godaddy.com'

    const t = useTranslations()
    const [status, setStatus] = useState<WidgetStatus>('connecting')
    const [uxReady, setUxReady] = useState(false)
    const shimApplied = useRef(false)

    useEffect(() => {
      if (!shimApplied.current) {
        shimApplied.current = true
        ensureUxGlobals()
      }
      setUxReady(true)
    }, [])

    const linkConnection = useLinkConnection()
    const unlinkConnection = useUnlinkConnection()
    const { data: associationsData } = useSiteAssociations(appId)

    const logDomain = `social-flows.${platform}-connect`

    const handleComplete = useCallback(
      async (result: onCompletePayload | undefined) => {
        if (!result) {
          logger.warn(`${logDomain}.no-result`, { appId })
          setStatus('error')
          return
        }

        logger.info(`${logDomain}.complete`, {
          appId,
          status: result.status
        })

        if (result.status === 'SUCCESS') {
          const payload = result.payload as
            | { socialObject?: { socialId?: string } }
            | undefined
          const socialId = payload?.socialObject?.socialId

          if (!socialId) {
            logger.error(`${logDomain}.missing-social-id`, {
              appId,
              payload: JSON.stringify(result.payload)
            })
            setStatus('error')
            return
          }

          setStatus('linking')
          try {
            // Unlink existing associations for this platform before linking new one
            const apiPlatform = PLATFORM_TRANSFORMS.toApiEnum(platform)
            const existingAssociations = (associationsData?.associations ?? [])
              .filter(a => a.platform === apiPlatform)

            for (const assoc of existingAssociations) {
              await unlinkConnection.mutateAsync({
                siteId: appId,
                associationId: assoc.id
              })
            }

            await linkConnection.mutateAsync({
              siteId: appId,
              socialId,
              platform
            })
            onSuccess()
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Link failed'
            logger.error(`${logDomain}.link-failed`, {
              appId,
              socialId,
              error: message
            })
            setStatus('error')
          }
        } else if (result.status === 'INCOMPLETE_EXIT') {
          logger.info(`${logDomain}.incomplete-exit`, { appId })
          setStatus('incomplete')
          onClose?.()
        } else {
          logger.error(`${logDomain}.error`, { appId, status: result.status })
          setStatus('error')
        }
      },
      [appId, platform, logDomain, linkConnection, unlinkConnection, associationsData, onSuccess, onClose]
    )

    const handleConnection = useCallback(
      (event: { status: string; payload?: object } | undefined) => {
        logger.debug(`${logDomain}.event`, {
          appId,
          status: event?.status
        })
      },
      [appId, logDomain]
    )

    if (!uxReady) {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-secondary">
          Loading...
        </div>
      )
    }

    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1)

    if (status === 'error') {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-error">
          {t('builder_social_failed_to_connect_platform', { platformName })}
        </div>
      )
    }

    if (status === 'incomplete') {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-secondary">
          {t('builder_social_connection_incomplete_platform', { platformName })}
        </div>
      )
    }

    if (status === 'linking') {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-secondary">
          {t('builder_social_linking')}
        </div>
      )
    }

    const FlowComponent = FLOW_COMPONENTS[platform]
    if (!FlowComponent) {
      logger.error('social-flows.unsupported-platform', { appId, platform })
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-error">
          {t('builder_social_failed_to_connect_platform', { platformName })}
        </div>
      )
    }

    return (
      <Provider store={minimalStore}>
        <FlowComponent
          market={market}
          rootDomain={rootDomain}
          sourceApp={SOURCE_APP}
          modal={modal}
          onComplete={handleComplete}
          onConnection={handleConnection}
        />
      </Provider>
    )
  }
)

export default SocialFlowsConnectWidget
