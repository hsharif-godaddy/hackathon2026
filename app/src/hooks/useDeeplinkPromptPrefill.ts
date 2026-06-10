'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef } from 'react'
import { useIntl } from 'react-intl'

import type { LogAnalytics } from '@/hooks/useAnalytics'
import { buildDeeplinkPromptKey, sanitizePromptKeySuffix } from '@/lib/deeplink-prompt'
import { validateItc } from '@/lib/itc'
import { logger } from '@/lib/request-context'
import { validateAndClampPrompt } from '@/lib/waf-validation'

interface UseDeeplinkPromptPrefillOptions {
  /**
   * Current prompt text. Read only to yield when something else already set it
   * (saved-prompt restore, example click, file prefill, user typing) — the
   * deep-link prefill must not clobber it. Not in the effect deps (the effect
   * keys off the URL/i18n inputs, not prompt edits).
   */
  promptText: string
  /** Called with the resolved prefill text. The parent wires its own state setter. */
  onPrefill: (text: string) => void
  logAnalytics: LogAnalytics
}

/**
 * Prefills the homepage prompt box from an email deep link, and emits the
 * `homepage.firstprompt.prefill` impression for it.
 *
 * Two paths, resolved in ONE effect so precedence isn't source-order-dependent —
 * a valid localized key wins over raw text:
 * - `?initialPromptKey=<suffix>` → localized prompt via `builder_deeplink_prompt_<suffix>`
 *   (existence-checked against `intl.messages`, never `t()`/`formatMessage`, which
 *   would dump the raw id on a miss).
 * - `?initialPrompt=<text>` → raw text (legacy behavior; still also logs the
 *   untouched `homepage.prompt.prefill_from_url` event).
 *
 * The impression carries `prefillSource` (`key`|`raw`), `initialPromptKey` (key
 * path), sanitized `itc`/`itcSource`, `locale`, `clipped`, `promptLength`.
 *
 * Self-contained: reads its own search params + i18n, calls out only via
 * `onPrefill` / `logAnalytics`. Mirrors `usePaywallDeeplink`.
 */
export function useDeeplinkPromptPrefill({
  promptText,
  onPrefill,
  logAnalytics,
}: UseDeeplinkPromptPrefillOptions): void {
  const intl = useIntl()
  const searchParams = useSearchParams()
  const hasPrefilledRef = useRef(false)

  const initialPromptParam = searchParams.get('initialPrompt')
  const initialPromptKeyParam = searchParams.get('initialPromptKey')
  const itcSourceParam = searchParams.get('itc_source')
  const itcParam = searchParams.get('itc')

  const itcSource = useMemo(() => validateItc(itcSourceParam), [itcSourceParam])
  const itc = useMemo(() => validateItc(itcParam), [itcParam])

  useEffect(() => {
    if (promptText) return
    // StrictMode dedupe: survives mount→cleanup→mount where promptText is still ''
    if (hasPrefilledRef.current) return

    // Precedence: a valid initialPromptKey (localized path) wins over raw initialPrompt.
    const suffix = sanitizePromptKeySuffix(initialPromptKeyParam)
    if (initialPromptKeyParam && !suffix) {
      // `reason` distinguishes a marketing param-format mistake from a not-yet-created key.
      logger.warn('homepage.prompt.prefill_key_unknown', { key: initialPromptKeyParam, reason: 'malformed' })
    }
    if (suffix) {
      const key = buildDeeplinkPromptKey(suffix)
      // Existence check on the raw messages map — NOT t()/formatMessage, which
      // returns the id itself for a missing key and would prefill the raw id.
      if (key in intl.messages) {
        const resolved = intl.formatMessage({ id: key })
        const validated = validateAndClampPrompt(resolved)
        onPrefill(validated.text)
        hasPrefilledRef.current = true

        const keyImpressionProps = {
          prefillSource: 'key' as const,
          initialPromptKey: suffix,
          ...(itc ? { itc } : {}),
          ...(itcSource ? { itcSource } : {}),
          locale: intl.locale,
          clipped: validated.wasClipped,
          promptLength: validated.text.length,
        }
        logAnalytics('homepage.firstprompt.prefill', keyImpressionProps, {
          kind: 'impression',
          eid: 'homepage.firstprompt.prefill',
          impressionProps: keyImpressionProps,
        })

        if (validated.wasClipped) {
          logger.warn('homepage.url-param.clipped', {
            originalLength: resolved.length,
            clippedLength: validated.charLength,
            byteLength: validated.byteLength,
          })
        }
        return
      }
      // Key suffix valid but no such message → ignore, fall through to initialPrompt.
      // Skip the warn while messages haven't loaded yet (empty map = late
      // client-fetch hydration): the effect re-runs once they arrive, so a
      // genuinely not-yet-created key still warns then. Without this gate, every
      // EXISTING key emits a false `not_found` on any late-hydration load —
      // polluting the very "key not created in i18n" signal this reason feeds.
      if (Object.keys(intl.messages).length > 0) {
        logger.warn('homepage.prompt.prefill_key_unknown', { key, reason: 'not_found' })
      }
    }

    if (initialPromptParam) {
      const decoded = decodeURIComponent(initialPromptParam)
      const validated = validateAndClampPrompt(decoded)
      onPrefill(validated.text)
      hasPrefilledRef.current = true

      logAnalytics('homepage.prompt.prefill_from_url', {
        clipped: validated.wasClipped,
        promptLength: validated.text.length,
      })

      const rawImpressionProps = {
        prefillSource: 'raw' as const,
        ...(itc ? { itc } : {}),
        ...(itcSource ? { itcSource } : {}),
        locale: intl.locale,
        clipped: validated.wasClipped,
        promptLength: validated.text.length,
      }
      logAnalytics('homepage.firstprompt.prefill', rawImpressionProps, {
        kind: 'impression',
        eid: 'homepage.firstprompt.prefill',
        impressionProps: rawImpressionProps,
      })

      if (validated.wasClipped) {
        logger.warn('homepage.url-param.clipped', {
          originalLength: decoded.length,
          clippedLength: validated.charLength,
          byteLength: validated.byteLength,
        })
      }
    }
    // intl.messages IS in the dep array so the effect re-runs if messages hydrate
    // after first render (the layout's client-fetch fallback). The `!promptText`
    // guard keeps it idempotent so prefill_from_url cannot double-fire.
  }, [initialPromptParam, initialPromptKeyParam, itc, itcSource, intl.messages, intl.locale, logAnalytics])
}
