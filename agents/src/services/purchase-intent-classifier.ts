/**
 * Purchase Intent Classifier
 *
 * Classifies the customer's last message as purchase intent (yes) or not (no)
 */

import type { LoggerLike } from '@airo/ai-common'
import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'

const LLM_TIMEOUT_MS = 1500

/**
 * Phase 1a — high-precision tight regex.
 * When any of these match, we are confident the input is purchase intent.
 */
export const TIGHT_PATTERNS: readonly RegExp[] = [
  /\bupgrade\b[\s\S]{0,30}(?:\bplan\b|\bairo\b)/i,
  /\benable publishing\b/i,
  /\bpurchase (?:the |a )?domain\b/i,
  /\bbuy (?:a |the )?(?:custom )?domain\b/i,
]

/**
 * Phase 1b — loose keyword presence gate.
 * If the input matches *none* of these, it has no purchase-related
 * vocabulary and is confidently not purchase intent.
 */
export const LOOSE_PATTERN: RegExp =
  /\b(?:publish|domain|upgrade|plan|subscri|live|activat|connect|custom|airo)\b/i

const SYSTEM_PROMPT = `You are a classifier for an AI website builder called Airo (by GoDaddy).

A customer's credits have run out. Your task: given their last message, decide
whether they are trying to take an action that requires purchasing or upgrading
their Airo plan.

Rules:
- Answer only "yes" or "no".
- "yes" = the customer is actively trying to do something that requires a plan
  upgrade or domain purchase (publish the site, connect a domain, go live, etc.)
- "no" = the customer is asking a question, complaining, referencing a past
  purchase, declining to upgrade, or the message is unrelated to purchasing.

Examples:

Input: Upgrade my plan so I can publish the site
Answer: yes

Input: Activate a subscription plan to publish the site
Answer: yes

Input: Activate a subscription plan so I can publish the site to theconveniencetrap.com
Answer: yes

Input: Publish the site to theconveniencetrap.com (click Manage Plan to activate subscription, then re-trigger publish)
Answer: yes

Input: Publish your site so it goes live
Answer: yes

Input: Publish your site so the custom domain tinypawsyorkie.com can be connected
Answer: yes

Input: i wish to publish the website with the domain name www.aspacindia.com
Answer: yes

Input: Connect a custom domain
Answer: yes

Input: Make it live
Answer: yes

Input: I've already purchased Airo Plus
Answer: no

Input: why am I being billed again
Answer: no

Input: how much does it cost to upgrade?
Answer: no

Input: do i need to subscribe to publish my site to my domain?
Answer: no

Input: I dont want the paid plan
Answer: no

Input: I cant afford it man
Answer: no

Input: upgrade the hero section to look more modern
Answer: no

Input: can we plan the layout first before publishing?
Answer: no

Input: yes
Answer: no

Input: Please analyze and fix this publish failure.
Answer: no

Input: Add a live chat widget or chatbot to answer common guest questions
Answer: no

Input: Help me plan the structure and pages for my app
Answer: no

Input: Connect Instagram to publish these posts
Answer: no

Input: delete
Answer: no`

type ClassifyMethod = 'tight_regex' | 'loose_regex_miss' | 'haiku'

/**
 * Classify whether the customer's last message expresses purchase intent.
 *
 * Returns false on any error or timeout (fail-closed).
 */
export async function classifyPurchaseIntent(
  userMessage: string,
  deps: { logger: LoggerLike },
): Promise<boolean> {
  const start = Date.now()
  const { logger } = deps

  if (TIGHT_PATTERNS.some((p) => p.test(userMessage))) {
    logClassified(logger, true, 'tight_regex', Date.now() - start)
    return true
  }

  if (!LOOSE_PATTERN.test(userMessage)) {
    logClassified(logger, false, 'loose_regex_miss', Date.now() - start)
    return false
  }

  return runHaikuPhase(userMessage, logger, start)
}

async function runHaikuPhase(
  userMessage: string,
  logger: LoggerLike,
  start: number,
): Promise<boolean> {
  const llmStart = Date.now()

  try {
    const model = await getModel('haiku')

    const result = await Promise.race([
      generateText({
        model,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          },
          {
            role: 'user',
            content: `Input: ${userMessage}\nAnswer:`,
          },
        ],
        temperature: 0,
        maxOutputTokens: 5,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'purchase-intent-classifier',
        },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LLM_TIMEOUT_MS)),
    ])

    if (result === null) {
      logger.warn('purchase_intent.classifier_timeout', {
        durationMs: Date.now() - start,
        timeoutMs: LLM_TIMEOUT_MS,
        userMessageLength: userMessage.length,
      })
      return false
    }

    const intent = result.text.trim().toLowerCase().startsWith('yes')
    logger.info('purchase_intent.classified', {
      result: intent,
      method: 'haiku',
      durationMs: Date.now() - start,
      llmDurationMs: Date.now() - llmStart,
    })
    return intent
  } catch (err) {
    logger.warn('purchase_intent.classifier_error', {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    })
    return false
  }
}

function logClassified(
  logger: LoggerLike,
  result: boolean,
  method: ClassifyMethod,
  durationMs: number,
): void {
  logger.info('purchase_intent.classified', { result, method, durationMs })
}
