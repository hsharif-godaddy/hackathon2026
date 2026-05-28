'use client'

import { useParams } from 'next/navigation'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'
import { FBConnectFlow, type onCompletePayload } from '@social/social-flows'
import Button from '@ux/button'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'
import UxText from '@ux/text'

import { useLinkConnection } from '@/hooks/social/mutations/useLinkConnection'
import { logger } from '@/lib/request-context'
import { getRootDomain } from '@/utils/getRootDomain'

/** Minimal Redux store required by @wsb/modal-loader's dep injection */
const minimalStore = createStore(() => ({}))

/**
 * Shim window.ux with the UXCore components the facebook-connect CDN
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
  ux.Text = ux.Text || UxText
  ux.Spinner = ux.Spinner || Spinner
}

const SOURCE_APP = 'airo-app-builder'

type WidgetStatus = 'idle' | 'connecting' | 'linking' | 'error'

interface SocialFlowsConnectWidgetProps {
  appId: string
  businessName?: string
  onSuccess: () => void
  /**
   * When true, the widget skips the internal link-to-site step and
   * calls onSuccess immediately after the OAuth flow completes.
   * Use when the parent component handles linking separately.
   */
  skipLink?: boolean
}

/**
 * Adapter between the chat tool renderer and @social/social-flows
 * FBConnectFlow. Renders the CDN-loaded Facebook connect modal and
 * links the resulting social connection to the agents-side site
 * association on completion.
 */
const SocialFlowsConnectWidget = memo(
  function SocialFlowsConnectWidget({
    appId,
    businessName = '',
    onSuccess,
    skipLink = false
  }: SocialFlowsConnectWidgetProps) {
    const params = useParams<{ market: string }>()
    const market = params.market || 'en-US'
    const rootDomain = getRootDomain() || 'godaddy.com'

    const [status, setStatus] = useState<WidgetStatus>('connecting')
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
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

    const handleComplete = useCallback(
      async (result: onCompletePayload | undefined) => {
        if (!result) {
          logger.warn('social-flows.connect.no-result', { appId })
          setStatus('error')
          setErrorMsg('Connection flow returned no result.')
          return
        }

        logger.info('social-flows.connect.complete', {
          appId,
          status: result.status
        })

        if (result.status === 'SUCCESS') {
          const payload = result.payload as
            | { socialObject?: { socialId?: string } }
            | undefined
          const socialId = payload?.socialObject?.socialId

          if (!socialId) {
            logger.error('social-flows.connect.missing-social-id', {
              appId,
              payload: JSON.stringify(result.payload)
            })
            setStatus('error')
            setErrorMsg(
              'Connection succeeded but no account ID was returned.'
            )
            return
          }

          if (skipLink) {
            onSuccess()
            return
          }

          setStatus('linking')
          try {
            await linkConnection.mutateAsync({
              siteId: appId,
              socialId,
              platform: 'facebook'
            })
            onSuccess()
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Link failed'
            logger.error('social-flows.connect.link-failed', {
              appId,
              socialId,
              error: message
            })
            setStatus('error')
            setErrorMsg(
              'Connected to Facebook but failed to link account. ' +
                'Please try again.'
            )
          }
        } else {
          // ERROR or INCOMPLETE_EXIT
          setStatus('error')
          setErrorMsg(
            result.status === 'ERROR'
              ? 'Facebook connection failed. Please try again.'
              : 'Connection was not completed.'
          )
        }
      },
      [appId, linkConnection, onSuccess]
    )

    const handleConnection = useCallback(
      (event: { status: string; payload?: object } | undefined) => {
        logger.debug('social-flows.connect.event', {
          appId,
          status: event?.status
        })
      },
      [appId]
    )

    if (!uxReady) {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-secondary">
          Loading...
        </div>
      )
    }

    if (status === 'error') {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-error">
          {errorMsg}
        </div>
      )
    }

    if (status === 'linking') {
      return (
        <div className="px-3 py-2 text-sm intents-ux-text-secondary">
          Linking Facebook account...
        </div>
      )
    }

    return (
      <Provider store={minimalStore}>
        <FBConnectFlow
          market={market}
          rootDomain={rootDomain}
          sourceApp={SOURCE_APP}
          businessName={businessName}
          modal={true}
          onComplete={handleComplete}
          onConnection={handleConnection}
        />
      </Provider>
    )
  }
)

export default SocialFlowsConnectWidget
