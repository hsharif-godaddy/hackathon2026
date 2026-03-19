import type { ContextAttachment, ContextAttachmentRenderer, ContextAttachmentConfig, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../logging/index.js'

/**
 * Registry for managing context attachment renderers
 * 
 * Provides a centralized system for registering and executing context attachment renderers.
 * Supports both custom renderers for specific types and a default fallback renderer.
 */
export class ContextAttachmentRegistry {
  private renderers = new Map<string, ContextAttachmentRenderer>()
  private configs = new Map<string, ContextAttachmentConfig>()
  private defaultRenderer: ContextAttachmentRenderer | undefined = undefined

  /**
   * Register a context attachment type with optional custom renderer
   */
  register<T = unknown>(config: ContextAttachmentConfig<T>): void {
    logger.debug('context.attachment.registry.register', {
      type: config.type,
      hasCustomRenderer: !!config.renderer,
      defaultPersistence: config.defaultPersistence,
      defaultRenderStrategy: config.defaultRenderStrategy
    })

    this.configs.set(config.type, config)
    
    if (config.renderer) {
      this.renderers.set(config.type, config.renderer)
    }
  }

  /**
   * Register the default fallback renderer
   */
  setDefaultRenderer(renderer: ContextAttachmentRenderer | undefined): void {
    logger.debug('context.attachment.registry.set_default', {
      message: 'Setting default renderer for unregistered context types'
    })
    this.defaultRenderer = renderer
  }

  /**
   * Get the renderer for a specific context type
   */
  getRenderer(type: string): ContextAttachmentRenderer | undefined {
    const customRenderer = this.renderers.get(type)
    if (customRenderer) {
      return customRenderer
    }

    if (this.defaultRenderer?.canHandle(type)) {
      return this.defaultRenderer
    }

    return undefined
  }

  /**
   * Render a context attachment
   */
  async render(
    attachment: ContextAttachment,
    userPrompt: string,
    context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): Promise<RenderedContext | null> {
    const renderer = this.getRenderer(attachment.type)
    
    if (!renderer) {
      logger.warn('context.attachment.registry.no_renderer', {
        type: attachment.type,
        availableRenderers: Array.from(this.renderers.keys())
      })
      return null
    }

    try {
      logger.debug('context.attachment.registry.render.start', {
        type: attachment.type,
        hasData: !!attachment.data,
        renderStrategy: attachment.renderStrategy
      })

      const result = await renderer.render(attachment, userPrompt, context)

      if (result) {
        logger.debug('context.attachment.registry.render.success', {
          type: attachment.type,
          contentLength: result.content?.length || 0,
          hasPromptRewrite: !!result.userPrompt,
          role: result.role,
          insertionOrder: result.insertionOrder
        })
      } else {
        logger.debug('context.attachment.registry.render.null', {
          type: attachment.type,
          message: 'Renderer returned null'
        })
      }

      return result
    } catch (error) {
      logger.error('context.attachment.registry.render.error', {
        type: attachment.type,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  /**
   * Check if a context attachment should be persisted
   */
  shouldPersist(attachment: ContextAttachment): boolean {
    if (attachment.persistence !== undefined) {
      return attachment.persistence === 'save'
    }

    const config = this.configs.get(attachment.type)
    if (config?.defaultPersistence !== undefined) {
      return config.defaultPersistence === 'save'
    }

    const renderer = this.getRenderer(attachment.type)
    if (renderer?.shouldPersist) {
      return renderer.shouldPersist(attachment)
    }

    return false
  }

  /**
   * Get configuration for a context type
   */
  getConfig(type: string): ContextAttachmentConfig | undefined {
    return this.configs.get(type)
  }

  /**
   * Get all registered context types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.configs.keys())
  }

  /**
   * Check if a context type is registered
   */
  isRegistered(type: string): boolean {
    return this.configs.has(type)
  }

  /**
   * Unregister a context type
   */
  unregister(type: string): void {
    logger.debug('context.attachment.registry.unregister', { type })
    this.configs.delete(type)
    this.renderers.delete(type)
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    logger.debug('context.attachment.registry.clear', {
      count: this.configs.size
    })
    this.configs.clear()
    this.renderers.clear()
    this.defaultRenderer = undefined
  }
}

export const contextAttachmentRegistry = new ContextAttachmentRegistry()
