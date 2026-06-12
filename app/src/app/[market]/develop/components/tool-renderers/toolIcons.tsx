/**
 * Icon mapping for tools in the action grouping allowlist.
 *
 * When adding a new tool to ACTION_GROUP_TOOL_NAMES, add its icon here
 * so the collapsed action group view shows the correct icon.
 */

import {
  Activity,
  Database,
  File,
  FileCode,
  FileText,
  GitBranch,
  ListTodo,
  Package,
  Palette,
  Pencil,
  ScrollText,
  Server,
  SquareTerminal,
  TextSearch,
  Wrench,
} from 'lucide-react'

const ICON_CLASS = 'w-2 h-2'

export function getToolIcon(toolName: string | undefined): React.ReactNode {
  switch (toolName) {
    case 'readFile':
    case 'read_file':
    case 'fileRead':
    case 'file_read':
    case 'directoryListing':
    case 'directory_listing':
      return <File className={ICON_CLASS} aria-hidden="true" />

    case 'fileEdit':
    case 'file_edit':
    case 'str_replace_based_edit_tool':
    case 'strReplaceBasedEditTool':
    case 'textEditor':
    case 'text_editor':
      return <Pencil className={ICON_CLASS} aria-hidden="true" />

    case 'terminalCommand':
    case 'terminal_command':
    case 'runCommand':
    case 'run_command':
    case 'terminal':
      return <SquareTerminal className={ICON_CLASS} aria-hidden="true" />

    case 'grepSearch':
    case 'grep_search':
    case 'codeSearch':
    case 'code_search':
    case 'codebaseSearch':
    case 'codebase_search':
      return <TextSearch className={ICON_CLASS} aria-hidden="true" />

    case 'setProjectName':
    case 'set_project_name':
      return <FileText className={ICON_CLASS} aria-hidden="true" />

    case 'todoList':
    case 'todo_list':
      return <ListTodo className={ICON_CLASS} aria-hidden="true" />

    case 'gitOperation':
    case 'git_operation':
      return <GitBranch className={ICON_CLASS} aria-hidden="true" />

    case 'serverRestart':
    case 'server_restart':
    case 'serverStatus':
    case 'server_status':
      return <Server className={ICON_CLASS} aria-hidden="true" />

    case 'mysqlOperation':
    case 'mysql_operation':
      return <Database className={ICON_CLASS} aria-hidden="true" />

    case 'appPlan':
    case 'app_plan':
    case 'validateCode':
      return <FileCode className={ICON_CLASS} aria-hidden="true" />

    case 'viewLogs':
    case 'view_logs':
      return <ScrollText className={ICON_CLASS} aria-hidden="true" />

    case 'skill':
      return <Package className={ICON_CLASS} aria-hidden="true" />

    case 'httpCheck':
    case 'http_check':
      return <Activity className={ICON_CLASS} aria-hidden="true" />

    case 'listDesignSystems':
    case 'installDesignSystem':
    case 'loadUiKit':
      return <Palette className={ICON_CLASS} aria-hidden="true" />

    default:
      return <Wrench className={ICON_CLASS} aria-hidden="true" />
  }
}
