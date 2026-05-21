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
