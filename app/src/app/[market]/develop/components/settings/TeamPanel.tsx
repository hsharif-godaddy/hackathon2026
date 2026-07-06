'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Users3Icon from '@ux/icon/users3'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { ComponentLoader } from '@/app/[market]/develop/components/paywall/cdsLoader'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { ChatTab, SettingsSection as SettingsSectionEnum } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations'
import { startReconcilePolling } from '@/lib/mgmt-airo/trigger-collaborator-reconcile'
import { isProfessionalOrAbove, PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import { usePaywallStore } from '@/stores/usePaywallStore'
import { useSiteStore } from '@/stores/useSiteStore'
import RidingArrow from '@/svgs/riding-arrow'
import { SubscriptionPlan } from '@/types/credits'
import { getPlanFromSubscription } from '@/utils/credits'
import { getRootDomain } from '@/utils/getRootDomain'
import { generateClickEID } from '@/utils/instrumentation'

// CDS ComponentLoader treats LoadingComponent as a component type and renders
// it as <LoadingComponent />. Passing a JSX element (<Spinner />) makes React
// throw "Element type is invalid", which the CDS loader catches and silently
// falls back — manifesting as the mock UI rendering instead of the real
// component. Pass a function component instead.
function SpinnerLoader() {
  // The CDS loader renders this INSIDE the .cds-team-portal container, which is
  // already position:fixed and inset to the Share access content area. So center
  // within that container with absolute inset-0 — a viewport-fixed wrapper with
  // --sa-* vars raced first paint (vars unset) and pushed the spinner off to the
  // right. Sized to match the bundle's own in-panel spinner that shows in the
  // next load phase, so the two phases look like one steady, centered spinner.
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Spinner size="md" />
    </div>
  )
}

// The multiusersEsm permission selector and role definitions are keyed by the
// venture FGA *relation* names (e.g. `airo_app_build`), NOT an AAB-specific
// namespace. The bundle validates `permissionsToInclude` against the venture's
// real FGA relations and silently drops unknown strings — so the old
// `aab:app:*` values left the permission selector empty and saved roles with
// `permissions[].relations: []` (confirmed via GET /v2/roles). Sourced from
// AUTHZ_FGA_RELATIONS so this stays in lockstep with BFF gating.
//
// Passed via `permissionsToInclude` below, gated by the
// `aab-multiuser-default-permissions` Switchboard flag (flag true → omit, so the
// bundle uses the venture's default relation set; flag false/unset → pass these).
// Kept in lockstep with AUTHZ_FGA_RELATIONS / BFF gating. Do not remove.
const AAB_TEAM_PERMISSION_KEYS = [
  AUTHZ_FGA_RELATIONS.canBuild,         // airo_app_build
  AUTHZ_FGA_RELATIONS.canPublish,       // airo_app_publish
  AUTHZ_FGA_RELATIONS.canDownload,      // airo_app_download
  AUTHZ_FGA_RELATIONS.canManageSecrets, // airo_app_manage_secrets
  AUTHZ_FGA_RELATIONS.canManageDomains, // airo_app_manage_domains
  AUTHZ_FGA_RELATIONS.canManageMembers, // user_invite
  AUTHZ_FGA_RELATIONS.canDelete,        // admin
  AUTHZ_FGA_RELATIONS.canTransfer,      // owner
  AUTHZ_FGA_RELATIONS.canViewDb,        // airo_app_view_db
  AUTHZ_FGA_RELATIONS.canEditDb,        // airo_app_edit_db
] as const

export default function TeamPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const params = useParams<{ market?: string; id?: string }>()
  const market = typeof params.market === 'string' ? params.market : 'en-US'
  const routeAppId = typeof params.id === 'string' ? params.id : appId
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const multiUser = useSwitchboard('aab-multi-user')
  const teamLegacy = useSwitchboard('appbuilder-settings-team')
  // Kill switch for the AAB-curated permission filter. When true, we DON'T pass
  // `permissionsToInclude`, so the multiusersEsm bundle falls back to the
  // venture's default relation set (use this if a bundle version drops our keys
  // and the selector renders empty). When false/unset, we pass the curated set.
  const useDefaultPermissions = useSwitchboard('aab-multiuser-default-permissions')
  const rootDomain = getRootDomain() || 'godaddy.com'
  const delegationUrl = `https://sso.${rootDomain}/access`

  const site = useSiteStore((state) => {
    if (!appId) {
      return null
    }
    return state.getSite(appId)
  })
  const isSiteLoading = useSiteStore((state) => {
    if (!appId) {
      return false
    }
    return state.loading[appId] ?? false
  })

  const fetchSite = useSiteStore((state) => state.fetchSite)

  const ventureId = site?.team_venture_id
  const rawCustomerId = getUserInfo().customerId || site?.owner_customer_id
  const customerId = typeof rawCustomerId === 'string' ? rawCustomerId : undefined

  // Inviting teammates is a Professional/Ultimate feature. Owners on lower tiers
  // (Free, AiroPlus, Starter) see the upgrade paywall instead of the invite UI.
  // Owner-pays bypass: an invited collaborator on a paid owner's app (sharedWithMe)
  // gets showPaywall=false, so collaborators keep the full panel regardless of
  // their own subscription.
  const { data: subscription, isLoading: isSubscriptionLoading } = useSubscription()
  const isSharedWithMe: boolean = site?.sharedWithMe === true
  const resolvedPlan: SubscriptionPlan = subscription ? getPlanFromSubscription(subscription) : SubscriptionPlan.None
  const showPaywall: boolean = !isSharedWithMe && !isProfessionalOrAbove(resolvedPlan)
  // Collaborators bypass the paywall regardless — skip subscription wait for them.
  const isPaywallLoading: boolean = isSharedWithMe
    ? false
    : isSubscriptionLoading || (!!appId && (isSiteLoading || !site))
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal)

  // When the flag is on but venture isn't provisioned yet, refetch the site to
  // pick up the team_venture_id that ensureAppTeamVenture wrote (via agent-token).
  // Polls up to 5 times at 3s intervals to handle the race where provisioning
  // just completed but the store has a stale site object from page load.
  // Skipped for paywalled (sub-Professional) owners — they can't invite, so
  // there's nothing to provision a venture for here.
  useEffect(function refetchUntilVenture() {
    if (multiUser !== true || ventureId || !appId || showPaywall) {
      return undefined
    }
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 5
    const INTERVAL_MS = 3000

    const poll = async () => {
      if (cancelled || attempts >= MAX_ATTEMPTS) return
      attempts += 1
      const refreshed = await fetchSite(appId, true, true)
      if (cancelled) return
      if (refreshed?.team_venture_id) return
      if (attempts < MAX_ATTEMPTS) {
        timer = window.setTimeout(poll, INTERVAL_MS)
      }
    }

    let timer = window.setTimeout(poll, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [multiUser, ventureId, appId, fetchSite, showPaywall])

  // Remount counter — bump to force a fresh MemoryRouter (resets bundle's
  // internal route state to the seeded `/users` entry). Used by the
  // ErrorBoundary's "Try again" path and the auto-reset observer below.
  const [resetKey, setResetKey] = useState(0)
  // Auto-reset usage counter capped to prevent infinite loops if the bundle
  // is permanently broken. Reset back to 0 after a successful render.
  const autoResetCountRef = useRef(0)
  const MAX_AUTO_RESETS = 3
  const resetPanel = useCallback(() => setResetKey((k) => k + 1), [])

  // Anchor-click guard. The multiusersEsm bundle renders some links as
  // raw <a href="…"> with an onClick handler that should preventDefault and
  // do SPA navigation. If onClick fails or isn't reached for any reason
  // (e.g., target is _blank, an inner span swallows the event), the browser
  // performs the default action — which here means leaving /develop/<appId>
  // and landing on a non-existent Next.js page (white screen until refresh).
  // Intercept clicks in our wrapper and call preventDefault for any anchor
  // whose href looks like an internal multi-users path (`/users`,
  // `/invite-user`, `/user-roles`, `/add-new-user-role`, `/edit-custom-role`)
  // so the bundle's MemoryRouter handles them via JS navigation only.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(function installAnchorGuard() {
    const node = containerRef.current
    if (!node) return
    const internalPaths = /^\/(users|invite-user|user-roles|add-new-user-role|edit-custom-role)(\/|$|\?)/
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const anchor = target.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      if (anchor.target && anchor.target !== '_self') return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!internalPaths.test(href)) return
      event.preventDefault()
    }
    node.addEventListener('click', handler, true)
    return () => node.removeEventListener('click', handler, true)
  }, [resetKey])

  // Auto-reset on white-screen. The multiusersEsm bundle has its own
  // ErrorBoundary that suppresses some failure paths to an empty fragment
  // (observed: invite submit → /users navigation → bundle renders empty).
  // No exception bubbles up so our outer ErrorBoundary never sees it. Watch
  // the container for the "had real content → went empty" transition and
  // bump the resetKey to remount the bundle. Capped at MAX_AUTO_RESETS to
  // avoid infinite loops if the bundle is permanently broken; manual
  // "Refresh team panel" button below the bundle is the final fallback.
  useEffect(function autoResetOnEmpty() {
    const node = containerRef.current
    if (!node) return undefined
    let pendingResetTimer: ReturnType<typeof setTimeout> | null = null
    let everHadContent = false

    const isEmpty = (): boolean => {
      const text = node.textContent?.trim() ?? ''
      // Empty wrapper is roughly `<div><div class="..."></div></div>` with no
      // text and no testid'd descendants.
      return text.length === 0 && node.querySelectorAll('[data-testid]').length === 0
    }

    const observer = new MutationObserver(() => {
      if (!everHadContent && !isEmpty()) {
        everHadContent = true
        autoResetCountRef.current = 0 // successful render — reset the counter
        return
      }
      if (everHadContent && isEmpty()) {
        if (pendingResetTimer) return
        if (autoResetCountRef.current >= MAX_AUTO_RESETS) {
          logger.warn('team-panel.auto-reset.max-reached', { appId: routeAppId })
          return
        }
        // Debounce — give the bundle a moment to finish a transient empty
        // state (e.g., during navigation) before remounting.
        pendingResetTimer = setTimeout(() => {
          pendingResetTimer = null
          if (!isEmpty()) return
          autoResetCountRef.current += 1
          logger.info('team-panel.auto-reset.fired', {
            appId: routeAppId,
            attempt: autoResetCountRef.current,
          })
          setResetKey((k) => k + 1)
        }, 250)
      } else if (pendingResetTimer && !isEmpty()) {
        clearTimeout(pendingResetTimer)
        pendingResetTimer = null
      }
    })

    observer.observe(node, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (pendingResetTimer) clearTimeout(pendingResetTimer)
    }
  }, [resetKey, routeAppId])

  // Reconcile the collaborator table when the team UI changes. The multiusersEsm
  // bundle writes invites/role changes/revokes straight to FGA and gives us no
  // callback, so we watch its DOM for changes (an invite landing, a role edit, a
  // removal, the user list updating) and, debounced, (re)start the reconcile poll.
  // The debounce coalesces the bundle's render churn into a single trigger;
  // startReconcilePolling then reconciles every 30s for up to 5 minutes so the
  // member rows converge as FGA propagates — without waiting for a panel close.
  // It dedups per appId (a single loop, deadline reset on each change), so rapid
  // invite/resend/revoke never stacks parallel loops. Idempotent server-side.
  useEffect(function reconcileOnTeamChange() {
    if (!routeAppId) return undefined
    const RECONCILE_DEBOUNCE_MS = 2500
    let timer: ReturnType<typeof setTimeout> | null = null
    let observer: MutationObserver | null = null
    let findTimer: ReturnType<typeof setInterval> | null = null

    const onMutation = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        startReconcilePolling(routeAppId)
      }, RECONCILE_DEBOUNCE_MS)
    }

    // CRITICAL: the multiusersEsm bundle does NOT render inside containerRef —
    // the CDS ComponentLoader renders it into a body-level portal (createPortal
    // → document.body) under the `.cds-team-portal` class. So the invite / role
    // / revoke DOM changes happen in the portal, not in our Box. Watch the
    // portal. It can mount a beat after this effect runs, so retry briefly
    // (capped) until it appears.
    const attach = (): boolean => {
      const portal = document.querySelector('.cds-team-portal')
      if (!portal) return false
      observer = new MutationObserver(onMutation)
      observer.observe(portal, { childList: true, subtree: true })
      return true
    }
    let attempts = 0
    if (!attach()) {
      findTimer = setInterval(() => {
        attempts += 1
        if ((attach() || attempts >= 40) && findTimer) {
          clearInterval(findTimer)
          findTimer = null
        }
      }, 250)
    }

    return () => {
      if (findTimer) clearInterval(findTimer)
      if (observer) observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [resetKey, routeAppId])

  useEffect(function teamPanelDiagnostics() {
    if (!appId || !routeAppId) {
      return
    }
    const cds = gasketData?.cds as { componentTypes?: string[] } | undefined
    const types = cds?.componentTypes
    const branch =
      multiUser === true && showPaywall
        ? 'paywalled'
        : multiUser === true && ventureId && customerId
          ? 'cds_multiusers'
          : multiUser === true && !ventureId
            ? 'missing_venture'
            : teamLegacy === true
              ? 'legacy_sso'
              : multiUser === false && teamLegacy === false
                ? 'flags_off'
                : 'loading_or_unknown'
    logger.info('develop.team.panel', {
      appId: routeAppId,
      branch,
      multiUser,
      teamLegacy,
      hasVentureId: Boolean(ventureId),
      hasCustomerId: Boolean(customerId),
      isSiteLoading,
      cdsIncludesMultiusersEsm: Array.isArray(types) && types.includes('multiusersEsm'),
    })
  }, [
    appId,
    routeAppId,
    multiUser,
    teamLegacy,
    ventureId,
    customerId,
    isSiteLoading,
    showPaywall,
    gasketData,
  ])

  if (!appId || !routeAppId) {
    return null
  }

  if (isSiteLoading || multiUser === undefined || teamLegacy === undefined || isPaywallLoading) {
    return <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSectionEnum.TEAM} />
  }

  // Owners below Professional can't invite — show the upgrade paywall (same
  // Box + Upgrade-button treatment as the Domain paywall) instead of the
  // multi-user invite UI. Collaborators are exempted (owner-pays bypass above),
  // so this only ever gates the sub-Professional OWNER.
  if (multiUser === true && showPaywall) {
    return (
      <Box
        className="bg-intents-ux-box-backgroundColor rounded-lg p-6"
        orientation="horizontal"
        gap="lg"
        inlineAlignChildren="start"
        blockAlignChildren="center"
      >
        <Box orientation="vertical" gap="sm" className="flex-1">
          <text.h3 as="title">{t('builder_upgrade_paid_plan_title')}</text.h3>
          <text.p className="text-intents-ux-text-secondaryColor">
            {t('builder_common_tooltip_upgrade')}
          </text.p>
          <div className="mt-2">
            <Button
              text={t('builder_upgrade_button')}
              design="primary"
              size="sm"
              onClick={() => openUpgradeModal('share-access.upgrade', PAYWALL_ITC.UPGRADE)}
              data-eid={generateClickEID('settings.share-access.upgrade')}
            />
          </div>
        </Box>
        <div className="flex-shrink-0 hidden md:block">
          <RidingArrow />
        </div>
      </Box>
    )
  }

  if (multiUser === true && ventureId && customerId) {
    const routePrefix = `/${market}/develop/${routeAppId}/settings/team`
    const ErrorFallbackWithReset = (
      <Box orientation="vertical" gap="md">
        <Alert emphasis="critical">
          {t('builder_team_load_error', undefined, 'Team management could not be loaded. Try again or use Manage access below.')}
        </Alert>
        <Button
          design="secondary"
          size="sm"
          text="Try again"
          onClick={resetPanel}
        />
      </Box>
    )
    return (
      <ErrorBoundary fallback={ErrorFallbackWithReset}>
        <Box ref={containerRef} className="min-h-[24rem] w-full">
          {/* The multiusersEsm bundle has flat absolute Routes (/users,
              /invite-user, …) but its MultiUsersContext also exposes
              `prepareRoute(p) = routePrefix + p` and uses it INSIDE the
              navigateToRoute hook. So if we pass our `/<market>/.../team`
              prefix as the `routePrefix` PROP, every click calls
              `navigate('/<market>/.../team/invite-user')` — which doesn't
              match `<Route path="/invite-user">` and renders nothing.
              Set the prop to "" so prepareRoute is a no-op, then handle
              the URL prefix at the host's Router level via `basename`:
              react-router strips basename before route matching, so
              `navigate('/invite-user')` resolves to `<Route path="/invite-user">`
              correctly. initialEntries lands the first render on /users
              (the bundle's index route also handles "/" → user list, but
              seeding /users avoids any flicker). The `key={resetKey}` lets
              us force-remount the entire bundle if it gets stuck (e.g.,
              after an invite where the optimistic cache update breaks
              rendering). */}
          <MemoryRouter
            key={resetKey}
            basename={routePrefix}
            initialEntries={[`${routePrefix}/users`]}
          >
            <ComponentLoader
              cds={gasketData?.cds}
              customerId={customerId}
              design="ANTARES"
              loaderMode="esm"
              locale={gasketData?.intl?.locale || 'en-US'}
              // Gated by `aab-multiuser-default-permissions`: flag true → omit the
              // prop so the bundle uses the venture's default relation set; flag
              // false/unset → pass the curated AAB keys. Conditional spread so the
              // prop is fully ABSENT when defaulting (passing undefined is not the
              // same as not passing it to the bundle's validator).
              {...(useDefaultPermissions === true
                ? {}
                : { permissionsToInclude: [...AAB_TEAM_PERMISSION_KEYS] })}
              resourceId={ventureId}
              resourceType="venture"
              routePrefix=""
              source="aab-team-multiusers"
              type="multiusersEsm"
              containerClassName="cds-team-portal"
              LoadingComponent={SpinnerLoader}
              renderErrorFallback={() => ErrorFallbackWithReset}
            />
          </MemoryRouter>
        </Box>
      </ErrorBoundary>
    )
  }

  if (multiUser === true && !ventureId) {
    return (
      <div className="flex items-center justify-center min-h-[12rem]">
        <Spinner size="md" />
      </div>
    )
  }

  if (teamLegacy === true) {
    return (
      <SettingsSection
        title={t('builder_settings_team_title')}
        description={t('builder_settings_team_description')}
        button={(
          <Button
            design="primary"
            size="sm"
            text={t('builder_settings_team_manage_access')}
            href={delegationUrl}
            rel="noopener noreferrer"
            icon={<Users3Icon />}
            external
          />
        )}
      />
    )
  }

  return (
    <Alert emphasis="info">
      {t('builder_team_not_enabled', undefined, 'Team settings are not enabled for this account.')}
    </Alert>
  )
}
