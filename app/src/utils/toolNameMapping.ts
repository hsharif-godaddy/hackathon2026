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
    case 'media_search':
    case 'mediaSearch':
      return 'Media Search'
    case 'image_search':
    case 'imageSearch':
      return 'Image Search'
    case 'video_search':
    case 'videoSearch':
      return 'Video Search'
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
    case 'image_generate':
    case 'imageGenerate':
      return 'Image Generate'
    case 'icons_validator':
    case 'iconsValidator':
      return 'Icons Validator'
    case 'todo_list':
    case 'todoList':
      return 'Todo List'
    default:
      return toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }
}
