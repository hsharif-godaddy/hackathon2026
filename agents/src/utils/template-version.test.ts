import { describe, it, expect } from 'vitest';
import { extractTemplateVersion, getTemplateFromEnvironment } from './template-version.js';

describe('Template Version Extraction', () => {
  describe('extractTemplateVersion', () => {
    it('should extract version from relative paths', () => {
      expect(extractTemplateVersion('app-templates/v1')).toBe('v1');
      expect(extractTemplateVersion('app-templates/v2')).toBe('v2');
      expect(extractTemplateVersion('app-templates/v3')).toBe('v3');
    });

    it('should extract version from absolute paths', () => {
      expect(extractTemplateVersion('/absolute/path/to/app-templates/v1')).toBe('v1');
      expect(extractTemplateVersion('/home/user/projects/app-templates/v2')).toBe('v2');
      expect(extractTemplateVersion('/var/www/templates/v3')).toBe('v3');
    });

    it('should handle custom template names', () => {
      expect(extractTemplateVersion('custom-template-v4')).toBe('custom-template-v4');
      expect(extractTemplateVersion('some/nested/path/custom-template')).toBe('custom-template');
      expect(extractTemplateVersion('experimental-template')).toBe('experimental-template');
    });

    it('should handle edge cases', () => {
      expect(extractTemplateVersion('')).toBe('v3');
      expect(extractTemplateVersion('.')).toBe('.');
      expect(extractTemplateVersion('..')).toBe('..');
    });

    it('should handle Windows-style paths', () => {
      // Note: On Unix systems, backslashes are treated as literal characters
      // This test documents the current behavior rather than cross-platform compatibility
      expect(extractTemplateVersion('app-templates\\v1')).toBe('app-templates\\v1');
      expect(extractTemplateVersion('C:\\projects\\app-templates\\v2')).toBe('C:\\projects\\app-templates\\v2');
      
      // For actual cross-platform support, paths should use forward slashes or path.normalize
      expect(extractTemplateVersion('app-templates/v1')).toBe('v1');
      expect(extractTemplateVersion('C:/projects/app-templates/v2')).toBe('v2');
    });

    it('should handle URLs and special characters', () => {
      expect(extractTemplateVersion('https://github.com/user/repo/app-templates/v1')).toBe('v1');
      expect(extractTemplateVersion('templates/v2-beta')).toBe('v2-beta');
      expect(extractTemplateVersion('templates/v3.1.0')).toBe('v3.1.0');
    });
  });

  describe('BaseAgent template selection logic', () => {

    it('should extract template from environment variable', () => {
      expect(getTemplateFromEnvironment('app-templates/v1')).toBe('v1');
      expect(getTemplateFromEnvironment('app-templates/v2')).toBe('v2');
      expect(getTemplateFromEnvironment('app-templates/v3')).toBe('v3');
    });

    it('should fallback to default for invalid paths', () => {
      expect(getTemplateFromEnvironment('')).toBe('default');
      expect(getTemplateFromEnvironment('.')).toBe('default');
    });

    it('should handle custom template names in environment', () => {
      expect(getTemplateFromEnvironment('custom-templates/experimental')).toBe('experimental');
      expect(getTemplateFromEnvironment('/path/to/my-template')).toBe('my-template');
    });
  });
});
