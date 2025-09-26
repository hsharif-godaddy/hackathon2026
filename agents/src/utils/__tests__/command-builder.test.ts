import { describe, it, expect } from 'vitest';
import { 
  CommandBuilder, 
  CommandBuilderError,
  buildCurlCommand,
  buildNpmCommand,
  buildGitCommand
} from '../command-builder.js';

describe('command-builder', function commandBuilderTests() {
  describe('#CommandBuilder', function commandBuilderClass() {
    describe('constructor', function constructorTests() {
      it('should create builder with valid program', function validProgram() {
        const builder = new CommandBuilder('curl');
        expect(builder.getArgs()).toEqual([]);
      });

      it('should reject empty program name', function rejectEmpty() {
        expect(() => new CommandBuilder('')).toThrow(/must be a non-empty string/);
        expect(() => new CommandBuilder('   ')).toThrow(/must be a non-empty string/);
      });

      it('should reject non-string program', function rejectNonString() {
        expect(() => new CommandBuilder(123 as any)).toThrow(/must be a non-empty string/);
        expect(() => new CommandBuilder(null as any)).toThrow(/must be a non-empty string/);
      });

      it('should reject program with dangerous characters', function rejectDangerous() {
        const dangerousPrograms = ['curl;rm', 'curl&evil', 'curl|bad', 'curl`cmd`', 'curl$(evil)'];
        
        for (const program of dangerousPrograms) {
          expect(() => new CommandBuilder(program)).toThrow(/dangerous characters/);
        }
      });

      it('should reject program with paths', function rejectPaths() {
        expect(() => new CommandBuilder('/usr/bin/curl')).toThrow(/should be a command name, not a path/);
        expect(() => new CommandBuilder('./curl')).toThrow(/should be a command name, not a path/);
        expect(() => new CommandBuilder('path\\to\\curl')).toThrow(/should be a command name, not a path/);
      });

      it('should reject program with spaces', function rejectSpaces() {
        expect(() => new CommandBuilder('curl wget')).toThrow(/cannot contain spaces/);
        expect(() => new CommandBuilder('curl -h')).toThrow(/cannot contain spaces/);
      });
    });

    describe('#addFlag', function addFlagTests() {
      it('should add valid flags', function validFlags() {
        const builder = new CommandBuilder('curl');
        builder.addFlag('-f').addFlag('--verbose').addFlag('--silent');
        
        const args = builder.getArgs();
        expect(args).toEqual(["'-f'", "'--verbose'", "'--silent'"]);
      });

      it('should reject non-string flags', function rejectNonString() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addFlag(123 as any)).toThrow(/must be a non-empty string/);
      });

      it('should reject empty flags', function rejectEmpty() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addFlag('')).toThrow(/must be a non-empty string/);
        expect(() => builder.addFlag('   ')).toThrow(/must be a non-empty string/);
      });

      it('should reject flags without dash prefix', function rejectNoDash() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addFlag('verbose')).toThrow(/must start with -/);
        expect(() => builder.addFlag('f')).toThrow(/must start with -/);
      });
    });

    describe('#addOption', function addOptionTests() {
      it('should add valid options with string values', function validStringOptions() {
        const builder = new CommandBuilder('curl');
        builder.addOption('--timeout', '30').addOption('-H', 'Content-Type: application/json');
        
        const args = builder.getArgs();
        expect(args).toEqual(["'--timeout'", "'30'", "'-H'", "'Content-Type: application/json'"]);
      });

      it('should add valid options with numeric values', function validNumericOptions() {
        const builder = new CommandBuilder('curl');
        builder.addOption('--max-time', 10).addOption('-p', 8080);
        
        const args = builder.getArgs();
        expect(args).toEqual(["'--max-time'", "'10'", "'-p'", "'8080'"]);
      });

      it('should reject non-string option names', function rejectNonStringOption() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addOption(123 as any, 'value')).toThrow(/must be a non-empty string/);
      });

      it('should reject empty option names', function rejectEmptyOption() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addOption('', 'value')).toThrow(/must be a non-empty string/);
      });

      it('should reject options without dash prefix', function rejectNoDashOption() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addOption('timeout', '30')).toThrow(/must start with -/);
      });

      it('should reject empty option values', function rejectEmptyValue() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addOption('--timeout', '')).toThrow(/cannot be empty/);
        expect(() => builder.addOption('--timeout', '   ')).toThrow(/cannot be empty/);
      });
    });

    describe('#addArgument', function addArgumentTests() {
      it('should add valid arguments', function validArguments() {
        const builder = new CommandBuilder('curl');
        builder.addArgument('http://example.com').addArgument('output.json');
        
        const args = builder.getArgs();
        expect(args).toEqual(["'http://example.com'", "'output.json'"]);
      });

      it('should reject non-string arguments', function rejectNonString() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addArgument(123 as any)).toThrow(/must be a string/);
      });

      it('should reject empty arguments', function rejectEmpty() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addArgument('')).toThrow(/cannot be empty/);
        expect(() => builder.addArgument('   ')).toThrow(/cannot be empty/);
      });

      it('should trim whitespace from arguments', function trimWhitespace() {
        const builder = new CommandBuilder('curl');
        builder.addArgument('  example.com  ');
        
        const args = builder.getArgs();
        expect(args).toEqual(["'example.com'"]);
      });
    });

    describe('#addUrl', function addUrlTests() {
      it('should add valid URLs', function validUrls() {
        const builder = new CommandBuilder('curl');
        builder.addUrl('http://localhost:8080').addUrl('https://example.com:443/api');
        
        const args = builder.getArgs();
        expect(args).toEqual(["'http://localhost:8080'", "'https://example.com:443/api'"]);
      });

      it('should validate URL format', function validateFormat() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addUrl('not-a-url')).toThrow(/Invalid URL/);
        // FTP is actually a valid protocol, so let's test with actually invalid URLs
        expect(() => builder.addUrl('://invalid')).toThrow(/Invalid URL/);
      });

      it('should validate host in URL', function validateHost() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addUrl('http://host;rm/path')).toThrow(/dangerous characters/);
        expect(() => builder.addUrl('http://host`cmd`/path')).toThrow(/dangerous characters/);
      });

      it('should reject empty URLs', function rejectEmpty() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addUrl('')).toThrow(/must be a non-empty string/);
      });
    });

    describe('#addArguments', function addArgumentsTests() {
      it('should add multiple arguments', function multipleArgs() {
        const builder = new CommandBuilder('curl');
        builder.addArguments(['arg1', 'arg2', 'arg3']);
        
        const args = builder.getArgs();
        expect(args).toEqual(["'arg1'", "'arg2'", "'arg3'"]);
      });

      it('should reject non-array input', function rejectNonArray() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addArguments('not-array' as any)).toThrow(/must be an array/);
      });

      it('should validate each argument', function validateEach() {
        const builder = new CommandBuilder('curl');
        expect(() => builder.addArguments(['valid', '', 'also-valid'])).toThrow(/cannot be empty/);
      });
    });

    describe('#build', function buildTests() {
      it('should build simple command', function buildSimple() {
        const builder = new CommandBuilder('curl');
        builder.addFlag('-f').addOption('--timeout', '30').addArgument('http://example.com');
        
        const command = builder.build();
        expect(command).toBe("'curl' '-f' '--timeout' '30' 'http://example.com'");
      });

      it('should enforce maximum length', function enforceMaxLength() {
        const builder = new CommandBuilder('curl', { maxLength: 50 });
        builder.addArgument('x'.repeat(100));
        
        expect(() => builder.build()).toThrow(/exceeds maximum length/);
      });

      it('should validate built command by default', function validateByDefault() {
        const builder = new CommandBuilder('curl');
        // Manually inject unescaped dangerous content (simulating a bypass)
        (builder as any).args = ["'http://example.com'", "&&", "rm", "-rf", "/"]; // Unescaped dangerous chars
        
        expect(() => builder.build()).toThrow(/dangerous pattern/);
      });

      it('should skip validation when disabled', function skipValidation() {
        const builder = new CommandBuilder('curl', { validateCommand: false });
        builder.addArgument('potentially-dangerous && echo test');
        
        // Should not throw because validation is disabled
        expect(() => builder.build()).not.toThrow();
      });

      it('should apply custom validator', function customValidator() {
        const customValidator = (cmd: string) => {
          if (cmd.includes('forbidden')) {
            throw new Error('Custom validation failed');
          }
        };
        
        const builder = new CommandBuilder('curl', { customValidator });
        builder.addArgument('forbidden-content');
        
        expect(() => builder.build()).toThrow(/Custom validation failed/);
      });
    });

    describe('#reset', function resetTests() {
      it('should reset arguments', function resetArgs() {
        const builder = new CommandBuilder('curl');
        builder.addFlag('-f').addArgument('test');
        
        expect(builder.getArgs()).toHaveLength(2);
        
        builder.reset();
        expect(builder.getArgs()).toHaveLength(0);
      });

      it('should allow chaining after reset', function chainAfterReset() {
        const builder = new CommandBuilder('curl');
        builder.addFlag('-f').reset().addArgument('new-arg');
        
        expect(builder.getArgs()).toEqual(["'new-arg'"]);
      });
    });
  });

  describe('#buildCurlCommand', function buildCurlCommandTests() {
    it('should build basic curl command', function buildBasic() {
      const command = buildCurlCommand('http://example.com');
      expect(command).toBe("'curl' '-f' 'http://example.com'");
    });

    it('should build curl with timeout options', function buildWithTimeouts() {
      const command = buildCurlCommand('http://example.com', {
        connectTimeout: 5,
        maxTime: 10
      });
      expect(command).toBe("'curl' '-f' '--connect-timeout' '5' '--max-time' '10' 'http://example.com'");
    });

    it('should build curl with custom method', function buildWithMethod() {
      const command = buildCurlCommand('http://example.com', {
        method: 'POST'
      });
      expect(command).toBe("'curl' '-f' '-X' 'POST' 'http://example.com'");
    });

    it('should build curl with headers', function buildWithHeaders() {
      const command = buildCurlCommand('http://example.com', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token'
        }
      });
      expect(command).toBe("'curl' '-f' '-H' 'Content-Type: application/json' '-H' 'Authorization: Bearer token' 'http://example.com'");
    });

    it('should build curl with data', function buildWithData() {
      const command = buildCurlCommand('http://example.com', {
        method: 'POST',
        data: 'simple-data'
      });
      expect(command).toBe("'curl' '-f' '-X' 'POST' '-d' 'simple-data' 'http://example.com'");
    });

    it('should disable fail flag when specified', function disableFailFlag() {
      const command = buildCurlCommand('http://example.com', {
        failOnError: false
      });
      expect(command).toBe("'curl' 'http://example.com'");
    });

    it('should validate URL in curl command', function validateUrl() {
      expect(() => buildCurlCommand('http://host;rm/path')).toThrow();
      expect(() => buildCurlCommand('not-a-url')).toThrow();
    });
  });

  describe('#buildNpmCommand', function buildNpmCommandTests() {
    it('should build basic npm command', function buildBasic() {
      const command = buildNpmCommand('install');
      expect(command).toBe("'npm' 'install'");
    });

    it('should build npm command with arguments', function buildWithArgs() {
      const command = buildNpmCommand('install', ['express', '--save']);
      expect(command).toBe("'npm' 'install' 'express' '--save'");
    });

    it('should build npm scripts', function buildScripts() {
      const command = buildNpmCommand('run', ['build']);
      expect(command).toBe("'npm' 'run' 'build'");
    });
  });

  describe('#buildGitCommand', function buildGitCommandTests() {
    it('should build basic git command', function buildBasic() {
      const command = buildGitCommand('status');
      expect(command).toBe("'git' 'status'");
    });

    it('should build git command with arguments', function buildWithArgs() {
      const command = buildGitCommand('clone', ['https://github.com/user/repo.git', 'local-dir']);
      expect(command).toBe("'git' 'clone' 'https://github.com/user/repo.git' 'local-dir'");
    });

    it('should build git commit command', function buildCommit() {
      const command = buildGitCommand('commit', ['-m', 'Initial commit']);
      expect(command).toBe("'git' 'commit' '-m' 'Initial commit'");
    });
  });

  describe('security and injection prevention', function securityTests() {
    it('should prevent command injection in all builder methods', function preventInjection() {
      const builder = new CommandBuilder('curl');
      
      // Test injection attempts that should be caught by flag validation
      expect(() => builder.addFlag('not-a-flag')).toThrow(/must start with -/); // Invalid flag format
      
      // These get escaped properly so they don't throw at add time, but would be caught at build time if unescaped
      expect(() => builder.addOption('--timeout', '30; evil-command')).not.toThrow(); // Gets escaped
      expect(() => builder.addArgument('file.txt && rm important.txt')).not.toThrow(); // Gets escaped
      expect(() => builder.addUrl('http://example.com; curl attacker.com')).toThrow(); // Invalid URL format
    });

    it('should properly escape shell arguments', function escapeArguments() {
      const builder = new CommandBuilder('echo');
      builder.addArgument("Hello 'World' with spaces");
      
      const command = builder.build();
      expect(command).toContain("'Hello '\\''World'\\'' with spaces'");
    });

    it('should validate complete command for dangerous patterns', function validateComplete() {
      const builder = new CommandBuilder('curl');
      builder.addArgument('http://example.com');
      
      // Manually inject dangerous content (simulating a bug)
      builder.args.push('&&', 'rm', '-rf', '/');
      
      expect(() => builder.build()).toThrow(/dangerous pattern/);
    });

    it('should handle edge cases safely', function handleEdgeCases() {
      const builder = new CommandBuilder('curl');
      
      // Test with special characters that should be escaped
      builder.addArgument('file with spaces.txt');
      builder.addArgument('file"with"quotes.txt');
      builder.addArgument("file'with'apostrophes.txt");
      
      const command = builder.build();
      expect(command).toContain("'file with spaces.txt'");
      expect(command).toContain("'file\"with\"quotes.txt'");
      expect(command).toContain("'file'\\''with'\\''apostrophes.txt'");
    });
  });

  describe('performance and limits', function performanceTests() {
    it('should handle reasonable number of arguments efficiently', function handleManyArgs() {
      const builder = new CommandBuilder('echo');
      
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        builder.addArgument(`arg${i}`);
      }
      const command = builder.build();
      const duration = Date.now() - start;
      
      expect(command).toContain('arg99');
      expect(duration).toBeLessThan(100); // Should be very fast
    });

    it('should enforce command length limits', function enforceLimits() {
      const builder = new CommandBuilder('echo', { maxLength: 100 });
      
      builder.addArgument('x'.repeat(50));
      builder.addArgument('y'.repeat(50));
      
      expect(() => builder.build()).toThrow(/exceeds maximum length/);
    });
  });
});
