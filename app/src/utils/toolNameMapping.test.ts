import { describe, expect, it } from 'vitest';

import { getToolDisplayName } from './toolNameMapping';

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

  describe('media search variants', () => {
    it('should map "media_search" to "Media Search"', () => {
      expect(getToolDisplayName('media_search')).toBe('Media');
    });

    it('should map "mediaSearch" to "Media Search"', () => {
      expect(getToolDisplayName('mediaSearch')).toBe('Media');
    });

    it('should map "image_search" to "Image Search"', () => {
      expect(getToolDisplayName('image_search')).toBe('Image Search');
    });

    it('should map "imageSearch" to "Image Search"', () => {
      expect(getToolDisplayName('imageSearch')).toBe('Image Search');
    });

    it('should map "video_search" to "Video Search"', () => {
      expect(getToolDisplayName('video_search')).toBe('Video Search');
    });

    it('should map "videoSearch" to "Video Search"', () => {
      expect(getToolDisplayName('videoSearch')).toBe('Video Search');
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

  describe('todo list variants', () => {
    it('should map "todo_list" to "Todo List"', () => {
      expect(getToolDisplayName('todo_list')).toBe('Todo List');
    });

    it('should map "todoList" to "Todo List"', () => {
      expect(getToolDisplayName('todoList')).toBe('Todo List');
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

    it('should handle multiple underscores', () => {
      expect(getToolDisplayName('tool__with___many____underscores')).toBe('Tool  With   Many    Underscores');
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
        ['media_search', 'Media'],
        ['image_search', 'Image Search'],
        ['video_search', 'Video Search'],
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
