import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'
import { validateDomainName } from '../../utils/domain-validation.js'

const logger = Logger.create({ service: 'domain-purchase-tool' })

const domainPurchaseInputSchema = z.object({
  brandName: z.string().optional().describe('Human-readable business/project name for domain search suggestions. NOT a domain — no dots or TLDs. Examples: "Sweet Delights Bakery", "Libro Tacos". Omit if user specified an exact domain and no brand context.'),
  domain: z.string().optional().describe('Exact fully-qualified domain name the user wants to buy, including TLD. Examples: "my-sweet-store.com", "libro-tacos.net". Only set when user explicitly states a domain name with a TLD. Never fabricate — leave empty if user only describes a brand.'),
  appId: z.string().optional().describe('The app ID for context (optional, uses current session app if not provided)')
})

/**
 * @example
 * domainPurchase({ brandName: "Letter Club" })
 * domainPurchase({ domain: "letter-club.com" })
 * domainPurchase({ brandName: "Letter Club", domain: "letter-club.com" })
 */
export const domainPurchaseAITool: Tool = createTool(
  `Render in-app domain purchase widget for buying NEW domains. Widget handles search, pricing, and checkout.

Use for: buy/purchase/find/search domains the user does NOT own yet.
NOT for: connecting/attaching/linking an existing domain — direct users to Settings instead.

Pass domain when user specifies an exact domain (e.g. "I want to buy my-sweet-store.com").
Pass brandName as the project/app name for general domain suggestions.
Call immediately without clarifying questions.`,
  domainPurchaseInputSchema,
  async (input, context) => {
    const appId = context?.metadata?.appId as string || input.appId
    if (!appId) {
      logger.error('domain-purchase.missing-app-id', {})
      return {
        success: false,
        error: 'App ID is required',
        message: 'App ID is required to purchase domains. Please ensure you are working within an app context.'
      }
    }

    const permissions = (context?.metadata as any)?.permissions ?? {}
    const canPurchaseDomain = permissions?.canPurchaseDomain ?? false

    logger.info('domain-purchase.permission-check', {
      canPurchaseDomain,
      permissionsHasPurchaseDomain: Object.hasOwn(permissions, 'canPurchaseDomain'),
    })

    if (!canPurchaseDomain) {
      logger.warn('domain-purchase.no-permission', {
        message: 'User does not have domain purchase permission',
      })
      return {
        success: false,
        error: 'Domain purchase permission not granted',
        message: 'This feature is not enabled for your account.'
      }
    }

    const { brandName } = input
    const domain = input.domain?.trim() || undefined

    if (domain) {
      const validation = validateDomainName(domain)
      if (!validation.valid) {
        logger.warn('domain-purchase.invalid-domain', {
          domain,
          error: validation.error,
        })
        return {
          success: false,
          error: validation.error,
          message: `"${domain}" is not a valid domain name. ${validation.error}`
        }
      }
    }

    const displayLabel = domain || brandName

    logger.info('domain-purchase.render', {
      brandName: brandName || 'not-provided',
      domain: domain || 'not-provided',
      appId
    })

    return {
      success: true,
      widgetType: 'domain-purchase',
      widgetData: {
        type: 'domain-purchase',
        brandName,
        domain,
        appId
      },
      message: `Domain purchase widget rendered${displayLabel ? ` for ${displayLabel}` : ''}`
    }
  }
)
