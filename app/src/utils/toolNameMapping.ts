type Translator = (
  id: string,
  values?: Record<string, any>,
  defaultMessage?: string
) => string

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
    case 'todo_list':
    case 'todoList':
      return 'Todo List'
    case 'social_post_create':
    case 'socialPostCreate':
      return 'Social Post Create'
    case 'websiteScraper':
      return 'Website Details'
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
