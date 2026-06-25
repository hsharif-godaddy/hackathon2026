import { contextAttachmentRegistry } from './ContextAttachmentRegistry.js'
import { DefaultContextRenderer, AiEditContextRenderer, VisualContextRenderer, SelectedAssetsContextRenderer, BuildErrorContextRenderer, RuntimeErrorContextRenderer, TodoListContextRenderer, ZipUploadContextRenderer, UiKitUploadContextRenderer, FileUploadContextRenderer, DeepBuildDocContextRenderer } from './renderers/index.js'
import { logger } from '../logging/index.js'

/**
 * Initialize the context attachment registry with default renderers
 * 
 * This should be called once during application startup to register
 * all custom renderers and set the default fallback renderer.
 */
export function initializeContextRegistry(): void {
  contextAttachmentRegistry.register({
    type: 'ai_edit_context',
    renderer: new AiEditContextRenderer(),
    defaultPersistence: 'save'
  })

  contextAttachmentRegistry.register({
    type: 'visual_context',
    renderer: new VisualContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'selected_assets',
    renderer: new SelectedAssetsContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'build_error',
    renderer: new BuildErrorContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'runtime_error',
    renderer: new RuntimeErrorContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'todo_list_context',
    renderer: new TodoListContextRenderer(),
    defaultPersistence: 'save'
  })

  contextAttachmentRegistry.register({
    type: 'zip_upload',
    renderer: new ZipUploadContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'app_import_upload',
    renderer: new ZipUploadContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'ui_kit_upload',
    renderer: new UiKitUploadContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.register({
    type: 'file_upload',
    renderer: new FileUploadContextRenderer(),
    defaultPersistence: 'save'
  })

  contextAttachmentRegistry.register({
    type: 'deep_build_doc',
    renderer: new DeepBuildDocContextRenderer(),
    defaultPersistence: 'ephemeral'
  })

  contextAttachmentRegistry.setDefaultRenderer(new DefaultContextRenderer())

  logger.info('context.registry.initialize.complete', {
    registeredTypes: contextAttachmentRegistry.getRegisteredTypes(),
    count: contextAttachmentRegistry.getRegisteredTypes().length
  })
}
