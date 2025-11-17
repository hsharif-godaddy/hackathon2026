import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { AuthService, AuthRequiredError } from '../../services/auth-service.js'
import { logger } from '../../logging/index.js'

/**
 * Create GoDaddy Commerce Product Tool
 * 
 * Automatically handles OAuth authentication if needed.
 * Creates products in the user's GoDaddy Commerce store.
 */
export const createGoDaddyProductTool: Tool = createTool(
  'Create a new product in the user\'s e-commerce application. Use this when the user asks to create, add, or build a product listing (e.g., "create a coffee product", "add espresso beans"). Automatically handles OAuth authentication. Returns created product details.',
  z.object({
    name: z.string().describe('Product name (e.g., "Premium Coffee Beans")'),
    description: z.string().optional().describe('Product description'),
    price: z.number().optional().describe('Product price in USD (e.g., 29.99)'),
    sku: z.string().optional().describe('Product SKU/identifier')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for GoDaddy product creation')
    }

    logger.info('godaddy.product.create.begin', {
      appId,
      productName: input.name
    })

    try {
      // Get OAuth access token for this app
      const { accessToken } = await AuthService.getAccessToken({
        appId,
        scopes: ['commerce.product:write'],
        provider: 'godaddy'
      })

      logger.info('godaddy.product.create.token_obtained', {
        appId,
        productName: input.name
      })
    } catch (err) {
      // If authentication is required, return authRequest inline
      if (err instanceof AuthRequiredError) {
        logger.info('godaddy.product.create.auth_required', {
          appId,
          productName: input.name,
          scopes: err.scopes
        })
        
        return {
          success: true,
          authRequired: true,
          message: 'No access token found. Call the oauthConnect tool to authenticate.',
          authRequest: {
            type: 'auth_request',
            provider: 'godaddy',
            scopes: err.scopes,
            redirectUrl: err.redirectUrl,
            state: err.state,
            title: 'Authentication Required',
            description: 'This action requires GoDaddy OAuth permission for:'
          }
        }
      }
      // Unexpected errors still throw
      throw err
    }

    // Mock successful product creation for testing
    // TODO: Replace with actual GoDaddy Commerce API call when endpoint is ready
    const mockProduct = {
      id: `prod_${Date.now()}`,
      name: input.name,
      description: input.description || `A sample product: ${input.name}`,
      price: {
        amount: input.price || 0,
        currency: 'USD'
      },
      sku: input.sku || `SKU-${Date.now()}`,
      status: 'active',
      createdAt: new Date().toISOString()
    }

    logger.info('godaddy.product.create.success', {
      appId,
      productName: input.name,
      productId: mockProduct.id,
      mock: true
    })

    return {
      success: true,
      product: mockProduct,
      message: `Successfully created product '${input.name}' in your GoDaddy store (mock)`
    }
  }
)
