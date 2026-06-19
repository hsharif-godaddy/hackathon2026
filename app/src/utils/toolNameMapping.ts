import {
  type CanvasStatusKey,
  defaultMessageForCanvasStatusKey,
} from '@/lib/translations/canvas-status-defaults'

export type { CanvasStatusKey } from '@/lib/translations/canvas-status-defaults'

type Translator = (
  id: string,
  values?: Record<string, any>,
  defaultMessage?: string
) => string

function translateCanvasStatusKey(key: CanvasStatusKey, t: Translator): string {
  return t(key, undefined, defaultMessageForCanvasStatusKey(key))
}

/**
 * Maps a running tool name to a summarized canvas status i18n key.
 *
 * Bucket definitions: docs/superpowers/plans/2026-06-18-canvas-status-pill-copy.md
 */
export function getCanvasStatusKey(toolName: string): CanvasStatusKey {
  if (!toolName) {
    return 'builder_canvas_status_working'
  }

  switch (toolName) {
    case 'file_read':
    case 'fileRead':
    case 'read_file':
    case 'readFile':
    case 'grep_search':
    case 'grepSearch':
    case 'directory_listing':
    case 'directoryListing':
    case 'code_search':
    case 'codeSearch':
    case 'codebase_search':
    case 'codebaseSearch':
    case 'ragSearch':
    case 'knowledgeSearch':
    case 'memoryRead':
    case 'memorySearch':
    case 'memoryListKeys':
    case 'view_logs':
    case 'viewLogs':
    case 'websiteScraper':
    case 'crawlPages':
    case 'screenshot':
    case 'showDoc':
      return 'builder_canvas_status_checking_project'
    case 'file_edit':
    case 'fileEdit':
    case 'str_replace_based_edit_tool':
    case 'text_editor':
    case 'textEditor':
    case 'write_file':
    case 'writeFile':
      return 'builder_canvas_status_updating_project'
    case 'app_plan':
    case 'appPlan':
    case 'todo_list':
    case 'todoList':
      return 'builder_canvas_status_planning'
    case 'colorScheme':
    case 'fontTheme':
    case 'cssColor':
    case 'cssSuggest':
    case 'brand':
    case 'brandBook':
    case 'brandIdentity':
    case 'loadUiKit':
    case 'installDesignSystem':
    case 'listDesignSystems':
    case 'media':
    case 'media_search':
    case 'mediaSearch':
    case 'imageEditor':
    case 'widgetRender':
    case 'websiteRebuild':
    case 'rebuildPageSelector':
      return 'builder_canvas_status_adding_styles'
    case 'httpCheck':
    case 'http_check':
    case 'icons_validator':
    case 'iconsValidator':
    case 'validateCode':
    case 'validate_code':
    case 'qaAnalyze':
    case 'seoAnalysis':
    case 'run_tests':
    case 'runTests':
      return 'builder_canvas_status_checking_project'
    case 'terminal':
    case 'terminal_command':
    case 'terminalCommand':
    case 'run_command':
    case 'runCommand':
    case 'run_terminal_cmd':
    case 'runTerminalCmd':
    case 'server_restart':
    case 'serverRestart':
    case 'server_status':
    case 'serverStatus':
    case 'git_operation':
    case 'gitOperation':
    case 'mysql_operation':
    case 'mysqlOperation':
      return 'builder_canvas_status_setting_up'
    case 'runAgent':
    case 'awaitAgents':
      return 'builder_canvas_status_building'
    case 'returnToParent':
      return 'builder_canvas_status_wrapping_up'
    // Streamed git-restore tool only; user Undo/Version History restore is not a running tool today.
    case 'restore':
      return 'builder_canvas_status_restoring'
    // Explicit Working bucket — not merely unmapped; keeps UX-facing tools out of default fallthrough.
    case 'askQuestion':
    case 'suggestedResponse':
    case 'setWizardStep':
    case 'skill':
    case 'social_post_create':
    case 'socialPostCreate':
    case 'socialPostPublish':
    case 'socialRead':
    case 'requestSecrets':
      return 'builder_canvas_status_working'
    default:
      return 'builder_canvas_status_working'
  }
}

/**
 * Summarized status label for the canvas status pill. Maps tool names to
 * high-level copy (builder_canvas_status_*) instead of granular Thinker labels.
 */
export function getCanvasStatusDisplayName(toolName: string, t: Translator): string {
  return translateCanvasStatusKey(getCanvasStatusKey(toolName), t)
}

/**
 * Active-voice, present-continuous label for a tool that's currently running.
 * Used by the chat Thinker to surface "what's happening" instead of generic
 * "Thinking…". Returns null for unknown tools so callers can fall back.
 */
export function getToolActiveDisplayName(toolName: string, t: Translator): string | null {
  if (!toolName) return null

  switch (toolName) {
    case 'directory_listing':
    case 'directoryListing':
      return t('builder_tools_active_directory_listing')
    case 'file_read':
    case 'fileRead':
    case 'read_file':
    case 'readFile':
      return t('builder_tools_active_file_read')
    case 'file_edit':
    case 'fileEdit':
    case 'str_replace_based_edit_tool':
    case 'text_editor':
    case 'textEditor':
      return t('builder_tools_active_file_edit')
    case 'code_search':
    case 'codeSearch':
    case 'codebase_search':
    case 'codebaseSearch':
      return t('builder_tools_active_code_search')
    case 'grep_search':
    case 'grepSearch':
      return t('builder_tools_active_grep_search')
    case 'terminal':
    case 'terminal_command':
    case 'terminalCommand':
    case 'run_command':
    case 'runCommand':
    case 'run_terminal_cmd':
    case 'runTerminalCmd':
      return t('builder_tools_active_terminal')
    case 'media':
    case 'media_search':
    case 'mediaSearch':
      return t('builder_tools_active_media_search')
    case 'image_generate':
    case 'imageGenerate':
      return t('builder_tools_active_image_generate')
    case 'view_logs':
    case 'viewLogs':
      return t('builder_tools_active_view_logs')
    case 'app_plan':
    case 'appPlan':
      return t('builder_tools_handoff_planning')
    case 'server_restart':
    case 'serverRestart':
      return t('builder_tools_active_server_restart')
    case 'server_status':
    case 'serverStatus':
      return t('builder_tools_active_server_status')
    case 'git_operation':
    case 'gitOperation':
      return t('builder_tools_active_git_operation')
    case 'mysql_operation':
    case 'mysqlOperation':
      return t('builder_tools_active_mysql_operation')
    case 'icons_validator':
    case 'iconsValidator':
      return t('builder_tools_active_icons_validator')
    case 'validateCode':
      return t('builder_tools_validate_code_running')
    case 'todo_list':
    case 'todoList':
      return t('builder_tools_active_todo_list')
    case 'social_post_create':
    case 'socialPostCreate':
      return t('builder_tools_active_social_post_create')
    case 'websiteScraper':
      return t('builder_tools_active_website_scraper')
    case 'restore':
      return t('builder_tools_active_restore')
    case 'runAgent':
      return 'Building'
    default:
      return null
  }
}

export function getToolDisplayName(toolName: string): string {
  if (!toolName) {
    return 'Unknown Tool'
  }

  switch (toolName) {
    case 'directory_listing':
    case 'directoryListing':
      return 'Directory Listing'
    case 'file_read':
    case 'fileRead':
    case 'read_file':
    case 'readFile':
      return 'Read File'
    case 'file_edit':
    case 'fileEdit':
      return 'File Edit'
    case 'str_replace_based_edit_tool':
    case 'text_editor':
    case 'textEditor':
      return 'Text Editor'
    case 'code_search':
    case 'codeSearch':
    case 'codebase_search':
    case 'codebaseSearch':
      return 'Code Search'
    case 'grep_search':
    case 'grepSearch':
      return 'Text Search'
    case 'terminal':
    case 'terminal_command':
    case 'terminalCommand':
    case 'run_command':
    case 'runCommand':
    case 'run_terminal_cmd':
    case 'runTerminalCmd':
      return 'Terminal'
    case 'media':
    case 'media_search':
    case 'mediaSearch':
      return 'Media'
    case 'image_generate':
    case 'imageGenerate':
      return 'Image Generate'
    case 'view_logs':
    case 'viewLogs':
      return 'View Logs'
    case 'app_plan':
    case 'appPlan':
      return 'App Plan'
    case 'server_restart':
    case 'serverRestart':
      return 'Server Restart'
    case 'server_status':
    case 'serverStatus':
      return 'Server Status'
    case 'git_operation':
    case 'gitOperation':
      return 'Git Operation'
    case 'mysql_operation':
    case 'mysqlOperation':
      return 'MySQL Operation'
    case 'icons_validator':
    case 'iconsValidator':
      return 'Icons Validator'
    case 'validateCode':
      return 'Validate Code'
    case 'httpCheck':
    case 'http_check':
      return 'Validate Endpoint'
    case 'todo_list':
    case 'todoList':
      return 'Todo List'
    case 'social_post_create':
    case 'socialPostCreate':
      return 'Social Post Create'
    case 'websiteScraper':
      return 'Website Details'
    // Commerce MCP skill tools. The CommerceMcpToolRenderer renders
    // a richer label from the tool input (e.g. "Commerce: get_store_info"),
    // so these are just fallbacks for places that only have the name.
    case 'commerce__search_tools':
    case 'commerce_search_tools':
    case 'commerceSearchTools':
      return 'Finding commerce tools'
    case 'commerce__execute_tool':
    case 'commerce_execute_tool':
    case 'commerceExecuteTool':
      return 'Running commerce tool'
    case 'commerce__commerce_store_setup':
      return 'Setting up Commerce store'
    case 'commerce__commerce_store_list':
      return 'Listing Commerce stores'
    case 'commerce__commerce_store_get':
      return 'Getting Commerce store'
    case 'commerce__commerce_store_channels_get':
      return 'Getting Commerce channels'
    case 'commerce__commerce_store_channel_ensure':
      return 'Connecting Commerce channel'
    case 'restore':
      return 'User Restore Commit'
    default: {
      // Skill-namespaced tools use `skill__tool` — collapse the `__` separator
      // into a single space so we don't render redundant double-spaces.
      const normalized = toolName.replace(/__+/g, '_')
      return normalized.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
  }
}
