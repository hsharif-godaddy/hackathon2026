import { describe, expect, it } from 'vitest';

import { FILE_MUTATION_TOOL_NAMES } from '@/app/[market]/develop/utils/fileMutationTools';
import { getCanvasStatusDisplayName, getCanvasStatusKey, getToolDisplayName } from './toolNameMapping';

function mockT(id: string, _values?: Record<string, unknown>, defaultMessage?: string) {
  return defaultMessage ?? id;
}

describe('getCanvasStatusKey', function canvasStatusKeyTests() {
  it('maps read-only tools to checking project', function checkingProjectRead() {
    expect(getCanvasStatusKey('readFile')).toBe('builder_canvas_status_checking_project');
    expect(getCanvasStatusKey('grepSearch')).toBe('builder_canvas_status_checking_project');
    expect(getCanvasStatusKey('directoryListing')).toBe('builder_canvas_status_checking_project');
  });

  it('maps file edit aliases to updating project', function updatingProject() {
    expect(getCanvasStatusKey('fileEdit')).toBe('builder_canvas_status_updating_project');
    expect(getCanvasStatusKey('str_replace_based_edit_tool')).toBe('builder_canvas_status_updating_project');
  });

  it('maps planning tools', function planningTools() {
    expect(getCanvasStatusKey('appPlan')).toBe('builder_canvas_status_planning');
    expect(getCanvasStatusKey('todoList')).toBe('builder_canvas_status_planning');
  });

  it('maps design tools to adding styles', function addingStyles() {
    expect(getCanvasStatusKey('colorScheme')).toBe('builder_canvas_status_adding_styles');
    expect(getCanvasStatusKey('media')).toBe('builder_canvas_status_adding_styles');
  });

  it('maps validation tools to checking project', function checkingProjectValidate() {
    expect(getCanvasStatusKey('httpCheck')).toBe('builder_canvas_status_checking_project');
    expect(getCanvasStatusKey('validateCode')).toBe('builder_canvas_status_checking_project');
    expect(getCanvasStatusKey('qaAnalyze')).toBe('builder_canvas_status_checking_project');
  });

  it('maps infra tools to setting up', function settingUp() {
    expect(getCanvasStatusKey('terminalCommand')).toBe('builder_canvas_status_setting_up');
    expect(getCanvasStatusKey('serverRestart')).toBe('builder_canvas_status_setting_up');
  });

  it('maps multi-agent tools to building', function building() {
    expect(getCanvasStatusKey('runAgent')).toBe('builder_canvas_status_building');
    expect(getCanvasStatusKey('awaitAgents')).toBe('builder_canvas_status_building');
  });

  it('maps returnToParent to wrapping up', function wrappingUp() {
    expect(getCanvasStatusKey('returnToParent')).toBe('builder_canvas_status_wrapping_up');
  });

  it('maps restore to restoring', function restoring() {
    expect(getCanvasStatusKey('restore')).toBe('builder_canvas_status_restoring');
  });

  it('maps unknown tools to working', function workingFallback() {
    expect(getCanvasStatusKey('commerce__execute_tool')).toBe('builder_canvas_status_working');
    expect(getCanvasStatusKey('')).toBe('builder_canvas_status_working');
  });

  it('maps every file mutation tool name to updating project', function mutationToolNames() {
    for (const toolName of FILE_MUTATION_TOOL_NAMES) {
      expect(getCanvasStatusKey(toolName)).toBe('builder_canvas_status_updating_project');
    }
  });
});

describe('getCanvasStatusDisplayName', function canvasStatusDisplayTests() {
  it('returns dev fallback copy via translator defaultMessage', function translates() {
    expect(getCanvasStatusDisplayName('grepSearch', mockT)).toBe('Checking your project');
    expect(getCanvasStatusDisplayName('fileEdit', mockT)).toBe('Updating your project');
  });
});
describe('getToolDisplayName', () => {
  describe('empty and invalid inputs', () => {
    it('should return "Unknown Tool" for empty string', () => {
      expect(getToolDisplayName('')).toBe('Unknown Tool');
    });

    it('should return "Unknown Tool" for null', () => {
      expect(getToolDisplayName(null as any)).toBe('Unknown Tool');
    });

    it('should return "Unknown Tool" for undefined', () => {
      expect(getToolDisplayName(undefined as any)).toBe('Unknown Tool');
    });
  });

  describe('directory_listing variants', () => {
    it('should map "directory_listing" to "Directory Listing"', () => {
      expect(getToolDisplayName('directory_listing')).toBe('Directory Listing');
    });

    it('should map "directoryListing" to "Directory Listing"', () => {
      expect(getToolDisplayName('directoryListing')).toBe('Directory Listing');
    });
  });

  describe('file_read variants', () => {
    it('should map "file_read" to "Read File"', () => {
      expect(getToolDisplayName('file_read')).toBe('Read File');
    });

    it('should map "fileRead" to "Read File"', () => {
      expect(getToolDisplayName('fileRead')).toBe('Read File');
    });

    it('should map "read_file" to "Read File"', () => {
      expect(getToolDisplayName('read_file')).toBe('Read File');
    });

    it('should map "readFile" to "Read File"', () => {
      expect(getToolDisplayName('readFile')).toBe('Read File');
    });
  });

  describe('file_edit variants', () => {
    it('should map "file_edit" to "File Edit"', () => {
      expect(getToolDisplayName('file_edit')).toBe('File Edit');
    });

    it('should map "fileEdit" to "File Edit"', () => {
      expect(getToolDisplayName('fileEdit')).toBe('File Edit');
    });
  });

  describe('code_search variants', () => {
    it('should map "code_search" to "Code Search"', () => {
      expect(getToolDisplayName('code_search')).toBe('Code Search');
    });

    it('should map "codeSearch" to "Code Search"', () => {
      expect(getToolDisplayName('codeSearch')).toBe('Code Search');
    });

    it('should map "codebase_search" to "Code Search"', () => {
      expect(getToolDisplayName('codebase_search')).toBe('Code Search');
    });

    it('should map "codebaseSearch" to "Code Search"', () => {
      expect(getToolDisplayName('codebaseSearch')).toBe('Code Search');
    });
  });

  describe('grep_search variants', () => {
    it('should map "grep_search" to "Text Search"', () => {
      expect(getToolDisplayName('grep_search')).toBe('Text Search');
    });

    it('should map "grepSearch" to "Text Search"', () => {
      expect(getToolDisplayName('grepSearch')).toBe('Text Search');
    });
  });

  describe('terminal variants', () => {
    it('should map "terminal" to "Terminal"', () => {
      expect(getToolDisplayName('terminal')).toBe('Terminal');
    });

    it('should map "terminal_command" to "Terminal"', () => {
      expect(getToolDisplayName('terminal_command')).toBe('Terminal');
    });

    it('should map "terminalCommand" to "Terminal"', () => {
      expect(getToolDisplayName('terminalCommand')).toBe('Terminal');
    });

    it('should map "run_command" to "Terminal"', () => {
      expect(getToolDisplayName('run_command')).toBe('Terminal');
    });

    it('should map "runCommand" to "Terminal"', () => {
      expect(getToolDisplayName('runCommand')).toBe('Terminal');
    });

    it('should map "run_terminal_cmd" to "Terminal"', () => {
      expect(getToolDisplayName('run_terminal_cmd')).toBe('Terminal');
    });

    it('should map "runTerminalCmd" to "Terminal"', () => {
      expect(getToolDisplayName('runTerminalCmd')).toBe('Terminal');
    });
  });

  describe('media tool', () => {
    it('should map "media" to "Media"', () => {
      expect(getToolDisplayName('media')).toBe('Media');
    });

    // Legacy mediaSearch tool names (backwards compatibility)
    it('should map "media_search" to "Media"', () => {
      expect(getToolDisplayName('media_search')).toBe('Media');
    });

    it('should map "mediaSearch" to "Media"', () => {
      expect(getToolDisplayName('mediaSearch')).toBe('Media');
    });

    // Legacy tool names fall through to default formatting
    it('should format "image_search" using default formatting', () => {
      expect(getToolDisplayName('image_search')).toBe('Image Search');
    });

    it('should format "video_search" using default formatting', () => {
      expect(getToolDisplayName('video_search')).toBe('Video Search');
    });
  });

  describe('logging variants', () => {
    it('should map "view_logs" to "View Logs"', () => {
      expect(getToolDisplayName('view_logs')).toBe('View Logs');
    });

    it('should map "viewLogs" to "View Logs"', () => {
      expect(getToolDisplayName('viewLogs')).toBe('View Logs');
    });
  });

  describe('app plan variants', () => {
    it('should map "app_plan" to "App Plan"', () => {
      expect(getToolDisplayName('app_plan')).toBe('App Plan');
    });

    it('should map "appPlan" to "App Plan"', () => {
      expect(getToolDisplayName('appPlan')).toBe('App Plan');
    });
  });

  describe('server operation variants', () => {
    it('should map "server_restart" to "Server Restart"', () => {
      expect(getToolDisplayName('server_restart')).toBe('Server Restart');
    });

    it('should map "serverRestart" to "Server Restart"', () => {
      expect(getToolDisplayName('serverRestart')).toBe('Server Restart');
    });

    it('should map "server_status" to "Server Status"', () => {
      expect(getToolDisplayName('server_status')).toBe('Server Status');
    });

    it('should map "serverStatus" to "Server Status"', () => {
      expect(getToolDisplayName('serverStatus')).toBe('Server Status');
    });
  });

  describe('git operation variants', () => {
    it('should map "git_operation" to "Git Operation"', () => {
      expect(getToolDisplayName('git_operation')).toBe('Git Operation');
    });

    it('should map "gitOperation" to "Git Operation"', () => {
      expect(getToolDisplayName('gitOperation')).toBe('Git Operation');
    });
  });

  describe('mysql operation variants', () => {
    it('should map "mysql_operation" to "MySQL Operation"', () => {
      expect(getToolDisplayName('mysql_operation')).toBe('MySQL Operation');
    });

    it('should map "mysqlOperation" to "MySQL Operation"', () => {
      expect(getToolDisplayName('mysqlOperation')).toBe('MySQL Operation');
    });
  });

  describe('image generation variants', () => {
    it('should map "image_generate" to "Image Generate"', () => {
      expect(getToolDisplayName('image_generate')).toBe('Image Generate');
    });

    it('should map "imageGenerate" to "Image Generate"', () => {
      expect(getToolDisplayName('imageGenerate')).toBe('Image Generate');
    });
  });

  describe('icons validator variants', () => {
    it('should map "icons_validator" to "Icons Validator"', () => {
      expect(getToolDisplayName('icons_validator')).toBe('Icons Validator');
    });

    it('should map "iconsValidator" to "Icons Validator"', () => {
      expect(getToolDisplayName('iconsValidator')).toBe('Icons Validator');
    });
  });

  describe('http check variants', () => {
    it('should map "httpCheck" to "Validate Endpoint"', () => {
      expect(getToolDisplayName('httpCheck')).toBe('Validate Endpoint');
    });

    it('should map "http_check" to "Validate Endpoint"', () => {
      expect(getToolDisplayName('http_check')).toBe('Validate Endpoint');
    });
  });

  describe('todo list variants', () => {
    it('should map "todo_list" to "Todo List"', () => {
      expect(getToolDisplayName('todo_list')).toBe('Todo List');
    });

    it('should map "todoList" to "Todo List"', () => {
      expect(getToolDisplayName('todoList')).toBe('Todo List');
    });
  });

  describe('skill-namespaced fallback (skill__tool)', () => {
    it('should render unmapped skill tools without duplicated whitespace', () => {
      expect(getToolDisplayName('blog__write')).toBe('Blog Write');
    });

    it('should render snake_case tool names within a skill namespace', () => {
      expect(getToolDisplayName('database__run_query')).toBe('Database Run Query');
    });
  });

  describe('default fallback formatting', () => {
    it('should format snake_case to Title Case', () => {
      expect(getToolDisplayName('unknown_tool_name')).toBe('Unknown Tool Name');
    });

    it('should format single word to Title Case', () => {
      expect(getToolDisplayName('custom')).toBe('Custom');
    });

    it('should format multiple words with underscores', () => {
      expect(getToolDisplayName('my_custom_tool_name')).toBe('My Custom Tool Name');
    });

    it('should capitalize first letter of each word', () => {
      expect(getToolDisplayName('test_tool')).toBe('Test Tool');
    });

    it('should handle already capitalized words', () => {
      expect(getToolDisplayName('TEST_TOOL')).toBe('TEST TOOL');
    });

    it('should handle mixed case input', () => {
      expect(getToolDisplayName('MiXeD_CaSe_ToOl')).toBe('MiXeD CaSe ToOl');
    });

    it('should handle camelCase by not converting it', () => {
      // camelCase without underscores doesn't get converted
      expect(getToolDisplayName('unknownToolName')).toBe('UnknownToolName');
    });

    it('should collapse consecutive underscores into a single space', () => {
      expect(getToolDisplayName('tool__with___many____underscores')).toBe('Tool With Many Underscores');
    });

    it('should handle leading underscore', () => {
      expect(getToolDisplayName('_leading_underscore')).toBe(' Leading Underscore');
    });

    it('should handle trailing underscore', () => {
      expect(getToolDisplayName('trailing_underscore_')).toBe('Trailing Underscore ');
    });

    it('should handle numbers in tool names', () => {
      expect(getToolDisplayName('tool_v2_test')).toBe('Tool V2 Test');
    });

    it('should handle special characters that remain', () => {
      expect(getToolDisplayName('tool-with-dashes')).toBe('Tool-With-Dashes');
    });
  });

  describe('case sensitivity', () => {
    it('should be case sensitive for exact matches', () => {
      expect(getToolDisplayName('TERMINAL')).not.toBe('Terminal');
      expect(getToolDisplayName('TERMINAL')).toBe('TERMINAL');
    });

    it('should differentiate snake_case from camelCase', () => {
      expect(getToolDisplayName('file_read')).toBe('Read File');
      expect(getToolDisplayName('fileRead')).toBe('Read File');
    });
  });

  describe('comprehensive coverage', () => {
    it('should handle all documented tool variants correctly', () => {
      const toolMappings = [
        ['directory_listing', 'Directory Listing'],
        ['file_read', 'Read File'],
        ['file_edit', 'File Edit'],
        ['code_search', 'Code Search'],
        ['grep_search', 'Text Search'],
        ['terminal', 'Terminal'],
        ['media', 'Media'],
        ['view_logs', 'View Logs'],
        ['app_plan', 'App Plan'],
        ['server_restart', 'Server Restart'],
        ['server_status', 'Server Status'],
        ['git_operation', 'Git Operation'],
        ['mysql_operation', 'MySQL Operation'],
        ['image_generate', 'Image Generate'],
        ['icons_validator', 'Icons Validator'],
        ['todo_list', 'Todo List'],
      ];

      toolMappings.forEach(([input, expected]) => {
        expect(getToolDisplayName(input)).toBe(expected);
      });
    });
  });
});
