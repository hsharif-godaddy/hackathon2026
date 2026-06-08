'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HeroSectionRef, LOGO_DESIGNER_TEMPLATE, type UploadedDesignFile, validateTemplate } from '@/app/[market]/components/types'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useAuthGateTracking } from '@/hooks/useAuthGateTracking'
import { useHomepageBounceTracking } from '@/hooks/useHomepageBounceTracking'
import { useSafariClass } from '@/hooks/useSafariClass'
import { useSsoSignIn } from '@/hooks/useSsoSignIn'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { validateDomainName } from '@/lib/domain-validation'
import { getErrorMessage } from '@/lib/errors'
import { shipAnalyticsLog } from '@/lib/logging'
import { buildDevelopUrl, extractApiError, fetchQuickCreate, type QuickCreateResponse, setQuickCreateSessionFlags, storeUploadedFiles } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'
import { validateAndClampPrompt } from '@/lib/waf-validation'
import { logAiroHQEvent, logImpressionEvent } from '@/utils/instrumentation'

type SubmitSource = 'example' | 'text'

export function useHomepageSubmission() {
  const t = useTranslations()
  const [promptText, setPromptText] = useState("")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const templateParam = searchParams.get('template')
  const selectedTemplate = validateTemplate(templateParam)
  const isLogoMode = templateParam === LOGO_DESIGNER_TEMPLATE

  const setSelectedTemplate = useCallback((template: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (template === 'default') {
      params.delete('template')
    } else {
      params.set('template', template)
    }
    const queryString = params.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])
  const isTemplateSelectorEnabled = useSwitchboard('appbuilder-template-selector')
  const [uploadedFiles, setUploadedFiles] = useState<UploadedDesignFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMockLogin, setShowMockLogin] = useState(false)
  const heroSectionRef = useRef<HeroSectionRef>(null)
  const lastFilePrefillRef = useRef('')
  const homepageViewRecordedRef = useRef(false)
  const scrollMilestonesLoggedRef = useRef<Set<number>>(new Set())
  const authGateShownAtRef = useRef<number | null>(null)
  const homepageSubmitAttemptRef = useRef(0)
  const pendingHomepageErrorRef = useRef<{
    attemptNumber: number
    errorType: string
    occurredAt: number
  } | null>(null)
  const promptTextRef = useRef(promptText)
  const submitSourceRef = useRef<SubmitSource>('text')
  const fqdnRef = useRef<string | undefined>(undefined)
  promptTextRef.current = promptText

  const { isAuthenticated, isLoading: authIsLoading } = useAuthContext()
  const { subscriptions, isLoading: subscriptionsLoading, isError: subscriptionsError } = useSubscription({ enabled: isAuthenticated })
  const isNewUser = !subscriptionsLoading && !subscriptionsError && subscriptions.length === 0
  const { cohort, logAnalytics } = useAnalytics({
    experimentId: EXPERIMENT_IDS.homepageEngagement,
    baseData: { isAuthenticated },
  })
  const { signIn } = useSsoSignIn()
  const setHeroError = useCallback((next: string | null) => {
    if (next === null && pendingHomepageErrorRef.current) {
      logAnalytics('homepage.error.abandon', {
        attemptNumber: pendingHomepageErrorRef.current.attemptNumber,
        errorType: pendingHomepageErrorRef.current.errorType,
        msFromError: Math.round(Date.now() - pendingHomepageErrorRef.current.occurredAt),
      })
      pendingHomepageErrorRef.current = null
    }
    setError(next)
  }, [logAnalytics])

  const logHomepagePricingView = useCallback(
    ({ viewDurationMs }: { viewDurationMs: number }) => {
      const promptState = promptText.trim().length > 0 ? 'has_content' : 'empty'
      const msFromPageLoad = Math.round(performance.now())
      logAnalytics(
        'homepage.pricing.view',
        {
          msFromPageLoad,
          promptState,
          viewDurationMs,
        },
        {
          kind: 'impression',
          eid: 'homepage.pricing.view',
          impressionProps: {
            promptState,
            viewDurationMs,
          },
        },
      )
    },
    [logAnalytics, promptText],
  )

  useSafariClass()
  useAuthGateTracking(logAnalytics, { authGateShownAtRef, promptTextRef })
  const { markEngaged: markHomepageEngaged } = useHomepageBounceTracking(logAnalytics)

  useEffect(() => {
    if (authIsLoading || homepageViewRecordedRef.current) {
      return
    }
    homepageViewRecordedRef.current = true
    logAnalytics('homepage.view')
    logImpressionEvent('homepage.page.view', { cohort })();
    logAiroHQEvent({
      category: 'impression',
      recommendation_task: 'builder_homepage_viewed',
      recommendation_type: 'navigation'
    })();
  }, [authIsLoading, cohort, logAnalytics])

  useEffect(() => {
    function updateScrollMilestones() {
      if (scrollMilestonesLoggedRef.current.size === 4) return

      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      const promptHasContent = promptTextRef.current.trim().length > 0
      const msFromPageLoad = Math.round(performance.now())

      if (scrollable <= 0) {
        if (!scrollMilestonesLoggedRef.current.has(100)) {
          scrollMilestonesLoggedRef.current.add(25)
          scrollMilestonesLoggedRef.current.add(50)
          scrollMilestonesLoggedRef.current.add(75)
          scrollMilestonesLoggedRef.current.add(100)
          logAnalytics(
            'homepage.scroll.milestone',
            {
              depth: 100,
              msFromPageLoad,
              promptHasContent,
            },
            {
              kind: 'action',
              eid: 'homepage.depth.complete',
              action: 'scroll',
            },
          )
        }
        return
      }

      const percent = (window.scrollY / scrollable) * 100
      for (const depth of [25, 50, 75, 100] as const) {
        if (percent >= depth && !scrollMilestonesLoggedRef.current.has(depth)) {
          scrollMilestonesLoggedRef.current.add(depth)
          const options =
            depth === 25
              ? {
                  kind: 'action' as const,
                  eid: 'homepage.depth.start',
                  action: 'scroll' as const,
                }
              : depth === 100
                ? {
                    kind: 'action' as const,
                    eid: 'homepage.depth.complete',
                    action: 'scroll' as const,
                  }
                : undefined

          logAnalytics('homepage.scroll.milestone', { depth, msFromPageLoad, promptHasContent }, options)
        }
      }
    }

    window.addEventListener('scroll', updateScrollMilestones, { passive: true })
    updateScrollMilestones()
    return () => window.removeEventListener('scroll', updateScrollMilestones)
  }, [logAnalytics])

  const siteLocationParam = searchParams.get('site_location')
  const initialPromptParam = searchParams.get('initialPrompt')
  const fqdnParam = searchParams.get('fqdn')

  const fqdnValidation = useMemo<{ fqdn?: string; invalidReason?: string }>(() => {
    if (!fqdnParam) return {}
    const trimmed = fqdnParam.trim().toLowerCase()
    if (!trimmed) return {}
    const result = validateDomainName(trimmed)
    if (!result.valid) return { invalidReason: result.error }
    return { fqdn: trimmed }
  }, [fqdnParam])
  fqdnRef.current = fqdnValidation.fqdn

  useEffect(() => {
    if (fqdnValidation.invalidReason) {
      logger.warn('homepage.fqdn.invalid', { reason: fqdnValidation.invalidReason })
    }
  }, [fqdnValidation.invalidReason])

  useEffect(() => {
    const siteLocation = siteLocationParam || document.referrer;
    if (siteLocation) {
      shipAnalyticsLog('homepage.redirect.source', { siteLocation });
    }
  }, [siteLocationParam]);

  useEffect(() => {
    if (initialPromptParam && !promptText) {
      const decoded = decodeURIComponent(initialPromptParam)
      const validated = validateAndClampPrompt(decoded)
      setPromptText(validated.text)

      logAnalytics('homepage.prompt.prefill_from_url', {
        clipped: validated.wasClipped,
        promptLength: validated.text.length,
      })

      if (validated.wasClipped) {
        logger.warn('homepage.url-param.clipped', {
          originalLength: decoded.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }
    }
  }, [initialPromptParam, logAnalytics])

  useEffect(() => {
    return () => setIsRedirecting(false)
  }, [])

  const savePromptForRetry = useCallback((prompt: string, context: 'login' | 'session-refresh', fqdn?: string) => {
    try {
      localStorage.setItem('airo-pending-prompt', prompt);
      if (fqdn) {
        localStorage.setItem('airo-pending-fqdn', fqdn);
      } else {
        localStorage.removeItem('airo-pending-fqdn');
      }
      logger.info('homepage.prompt.save', { context, promptLength: prompt.length, hasFqdn: !!fqdn });
    } catch (error) {
      logger.warn('homepage.prompt.save.error', { context, error: getErrorMessage(error) });
    }
  }, [])

  const handleStartBuilding = useCallback(async (overridePrompt?: string, overrideFqdn?: string) => {
    let promptToUse = (typeof overridePrompt === 'string' ? overridePrompt : promptTextRef.current).trim()
    promptToUse = promptToUse.replace(/https?:\/\/example\.com\s*/gi, '').trim()
    const fqdnToUse = typeof overrideFqdn === 'string' ? overrideFqdn : fqdnRef.current

    if (!promptToUse || isRedirecting || isLoading) return

    markHomepageEngaged()

    const preClampPromptLength = promptToUse.length
    const validated = validateAndClampPrompt(promptToUse)
    promptToUse = validated.text

    if (validated.wasClipped) {
      logger.warn('homepage.submit.clipped', {
        originalLength: preClampPromptLength,
        clippedLength: validated.charLength,
        byteLength: validated.byteLength
      })
    }
    const submitSource = submitSourceRef.current
    const firstInputTime = heroSectionRef.current?.getFirstInputTime()

    if (authIsLoading) {
      logger.debug('page.auth.loading', 'Auth state still loading, waiting before proceeding')
      return
    }

    logAnalytics('homepage.prompt.submit_attempt', {
      submitSource,
      promptLength: promptToUse.length,
      msFromPageLoad: Math.round(performance.now()),
      ...(firstInputTime && { msFromFirstInput: Date.now() - firstInputTime }),
    })

    homepageSubmitAttemptRef.current += 1
    const submitAttemptNumber = homepageSubmitAttemptRef.current
    if (pendingHomepageErrorRef.current) {
      logAnalytics('homepage.error.retry', {
        attemptNumber: submitAttemptNumber,
        errorType: pendingHomepageErrorRef.current.errorType,
        msFromError: Math.round(Date.now() - pendingHomepageErrorRef.current.occurredAt),
      })
      pendingHomepageErrorRef.current = null
    }

    setError(null)
    setIsLoading(true)
    setIsRedirecting(true)

    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_homepage_prompt_submit',
      recommendation_type: 'user_prompt'
    })();

    try {
      if (!isAuthenticated) {
        logger.info('page.auth.sso-login', { action: 'showing-sso-login' });
        savePromptForRetry(promptToUse, 'login', fqdnToUse);
        logAnalytics('homepage.auth_gate.shown', { submitSource }, { kind: 'action', eid: 'homepage.auth.gate', action: 'load' })
        authGateShownAtRef.current = Date.now()
        signIn({ onShowMockLogin: () => setShowMockLogin(true) });
        setIsLoading(false);
        setIsRedirecting(false);
        return;
      }

      if (isNewUser) {
        logImpressionEvent('budget.newUser.eligible')();
      }

      const createSiteResponse = await fetchQuickCreate(
        promptToUse,
        undefined,
        fqdnToUse ? { fqdn: fqdnToUse } : undefined,
      )

      if (!createSiteResponse.ok) {
        if (createSiteResponse.status === 401) {
          logger.info('homepage.auth-required', { action: 'triggering-sso-login', phase: 'quick-create' });
          savePromptForRetry(promptToUse, 'session-refresh', fqdnToUse);
          logAnalytics('homepage.auth_gate.shown', { submitSource }, { kind: 'action', eid: 'homepage.auth.gate', action: 'load' })
          authGateShownAtRef.current = Date.now()
          signIn({ onShowMockLogin: () => setShowMockLogin(true) });
          setIsLoading(false);
          setIsRedirecting(false);
          return;
        }

        const errorData = await createSiteResponse.json().catch(() => ({}))
        throw extractApiError(errorData)
      }

      const siteData: QuickCreateResponse = await createSiteResponse.json()
      logger.info('page.site.quick-create.success', { message: 'Site record created instantly', siteId: siteData.id, type: siteData.type })

      setQuickCreateSessionFlags(siteData.id, promptToUse, selectedTemplate, uploadedFiles)

      const filesToStore = uploadedFiles
        .filter(f => f.zipRaw)
        .map(f => ({
          raw: f.zipRaw!,
          fileName: f.name,
          isDesignMd: f.isDesignMd,
          isZip: f.isZip,
          isUiKit: f.isUiKit,
          isAppImport: f.isAppImport,
          isImage: f.isImage,
        }))
      if (filesToStore.length > 0) {
        await storeUploadedFiles(siteData.id, filesToStore)
      }

      const redirectUrl = buildDevelopUrl(siteData.id, siteData.type)

      logger.info('page.site.redirect', { message: 'Redirecting to develop page', siteId: siteData.id, idType: siteData.type, redirectUrl })
      logAnalytics('homepage.redirect.develop', { submitSource }, { kind: 'impression', eid: 'homepage.redirect.develop' })

      pendingHomepageErrorRef.current = null
      router.push(redirectUrl)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('homepage.start_building.failed', { error: errorMsg, details: error instanceof Error ? (error as any).details : undefined })
      logAnalytics('homepage.submit.error', { submitSource, errorMessage: errorMsg.substring(0, 200) })

      let errorMessage = t('builder_abstract_animation_error_generic')
      let errorType = 'generic'

      if (error instanceof Error) {
        if ((error as any).errorCode === 'APP_LIMIT_EXCEEDED') {
          errorType = 'app_limit_exceeded'
          errorMessage = t('builder_homepage_error_app_limit', undefined, 'You have reached the maximum number of apps allowed. Please delete some unused apps to create new ones.')
        } else if (error.message.includes('Failed to create site')) {
          errorType = 'create_failed'
          errorMessage = t('builder_homepage_error_create')
        } else if (error.message.includes('Failed to validate account')) {
          errorType = 'validate_failed'
          errorMessage = t('builder_homepage_error_validate')
        } else if (error.message.includes('Failed to fetch')) {
          errorType = 'network'
          errorMessage = t('builder_homepage_error_network')
        } else if (error.message.includes('fetch')) {
          errorType = 'network'
          errorMessage = t('builder_homepage_error_fetch')
        } else if (error.message.includes('TypeError')) {
          errorType = 'connection'
          errorMessage = t('builder_homepage_error_connection')
        } else {
          errorMessage = error.message
        }
      }

      pendingHomepageErrorRef.current = {
        attemptNumber: homepageSubmitAttemptRef.current,
        errorType,
        occurredAt: Date.now(),
      }
      setError(errorMessage)

      setIsLoading(false)
      setIsRedirecting(false)
    }
  }, [authIsLoading, isAuthenticated, isLoading, isNewUser, isRedirecting, logAnalytics, markHomepageEngaged, router, savePromptForRetry, selectedTemplate, signIn, t, uploadedFiles])

  useEffect(() => {
    if (!isAuthenticated || authIsLoading || subscriptionsLoading) return

    const savedPrompt = localStorage.getItem('airo-pending-prompt')

    if (savedPrompt && (!promptText || promptText.trim() === savedPrompt.trim())) {
      logger.info('homepage.prompt.restore', { message: 'Restoring saved prompt after login' })
      const validated = validateAndClampPrompt(savedPrompt)
      setPromptText(validated.text)
      localStorage.removeItem('airo-pending-prompt')

      const savedFqdn = localStorage.getItem('airo-pending-fqdn')
      localStorage.removeItem('airo-pending-fqdn')
      let restoredFqdn: string | undefined
      if (savedFqdn) {
        const normalizedSavedFqdn = savedFqdn.trim().toLowerCase()
        const fqdnResult = validateDomainName(normalizedSavedFqdn)
        if (fqdnResult.valid) {
          restoredFqdn = normalizedSavedFqdn
        } else {
          logger.warn('homepage.fqdn.restore.invalid', { reason: fqdnResult.error })
        }
      }

      logAnalytics('homepage.auth_prompt.restored')

      if (validated.wasClipped) {
        logger.warn('homepage.restore.clipped', {
          originalLength: savedPrompt.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }

      handleStartBuilding(validated.text, restoredFqdn)
    }
  }, [authIsLoading, handleStartBuilding, isAuthenticated, logAnalytics, promptText, subscriptionsLoading])

  const handleExampleClick = (examplePrompt: string) => {
    submitSourceRef.current = 'example'
    if (heroSectionRef.current) {
      heroSectionRef.current.typeText(examplePrompt)
    } else {
      const validated = validateAndClampPrompt(examplePrompt)
      setPromptText(validated.text)

      if (validated.wasClipped) {
        logger.warn('homepage.example.clipped', {
          originalLength: examplePrompt.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength
        })
      }
    }
  }

  const handleFilesChange = useCallback((files: UploadedDesignFile[]) => {
    setUploadedFiles(files)

    // Snapshot the prefill we last injected BEFORE updating the ref, so the
    // updater compares prev against a stable value rather than reading the ref
    // (which may be reassigned before a deferred state update runs).
    const previousPrefill = lastFilePrefillRef.current

    if (files.length > 0) {
      // count drives ICU pluralization ("this attachment" vs "these attachments").
      const translatedPrefill = t(
        'builder_design_file_upload_prompt_prefill',
        { count: files.length },
        'Use {count, plural, one {this attachment} other {these attachments}} to create a '
      )
      // Guarantee a trailing space so the user can type the noun immediately,
      // without depending on the translation to include one.
      const filePrefill = /\s$/.test(translatedPrefill) ? translatedPrefill : `${translatedPrefill} `
      lastFilePrefillRef.current = filePrefill
      // Overwrite only when the field is empty or still holds a prefill we
      // injected (so a file count change refreshes the plural form, but the
      // user's own text is never clobbered).
      setPromptText(prev => (prev === '' || prev === previousPrefill ? filePrefill : prev))
    } else {
      lastFilePrefillRef.current = ''
      setPromptText(prev => (prev === previousPrefill ? '' : prev))
    }
  }, [t])

  return {
    promptText,
    setPromptText,
    selectedTemplate,
    setSelectedTemplate,
    isLogoMode,
    isTemplateSelectorEnabled,
    uploadedFiles,
    setUploadedFiles: handleFilesChange,
    isLoading,
    error,
    setHeroError,
    showMockLogin,
    setShowMockLogin,
    heroSectionRef,
    handleStartBuilding,
    handleExampleClick,
    logHomepagePricingView,
  }
}
