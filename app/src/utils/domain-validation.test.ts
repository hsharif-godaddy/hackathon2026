import { describe, expect, it, vi } from 'vitest';

import { DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';
import { getDomainErrorMessage } from './domain-validation';

describe('getDomainErrorMessage', () => {
  // Mock translation function
  const createMockTranslations = () => {
    const t = vi.fn((key: string) => {
      const translations: Record<string, string> = {
        'builder_domain_error_default': 'An error occurred with your domain.',
        'builder_domain_error_format_invalid': 'Invalid domain format.',
        'builder_domain_error_label_invalid': 'Domain label contains invalid characters.',
        'builder_domain_error_too_short': 'Domain is too short.',
        'builder_domain_error_reserved': 'This subdomain is reserved and cannot be used.',
        'builder_domain_error_profanity': 'Domain contains inappropriate content.',
        'builder_domain_error_fqdn_invalid': 'Invalid fully qualified domain name.',
        'builder_domain_error_subdomain_invalid': 'Invalid subdomain format.',
        'builder_domain_error_label_too_long': 'Domain label is too long.',
        'builder_domain_error_already_taken': 'This domain is already taken.',
      };
      return translations[key] || key;
    });
    return t as unknown as ReturnType<typeof import('@/hooks/useTranslations').useTranslations>;
  };

  describe('error handling', () => {
    it('should return default message when errors array is undefined', () => {
      const t = createMockTranslations();
      const result = getDomainErrorMessage(undefined, t);
      expect(result).toBe('An error occurred with your domain.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_default');
    });

    it('should return default message when errors array is empty', () => {
      const t = createMockTranslations();
      const result = getDomainErrorMessage([], t);
      expect(result).toBe('An error occurred with your domain.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_default');
    });

    it('should return error message when available for unknown error code', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: 'UNKNOWN_ERROR' as DomainValidationError,
        message: 'Custom error message',
        field: 'domain',
        value: 'test',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Custom error message');
    });

    it('should return default message when error has no message and unknown code', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: 'UNKNOWN_ERROR' as DomainValidationError,
        message: '',
        field: 'domain',
        value: 'test',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('An error occurred with your domain.');
    });
  });

  describe('project domain errors', () => {
    it('should handle DOMAIN_FORMAT_INVALID error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_FORMAT_INVALID,
        message: 'Invalid format',
        field: 'projectPrefix',
        value: 'test@@',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Invalid domain format.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_format_invalid');
    });

    it('should handle DOMAIN_LABEL_INVALID error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_LABEL_INVALID,
        message: 'Invalid label',
        field: 'projectPrefix',
        value: 'test_domain',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Domain label contains invalid characters.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_label_invalid');
    });

    it('should handle DOMAIN_TOO_SHORT error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_TOO_SHORT,
        message: 'Too short',
        field: 'projectPrefix',
        value: 'ab',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Domain is too short.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_too_short');
    });

    it('should handle DOMAIN_RESERVED error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_RESERVED,
        message: "Project prefix 'admin' is reserved",
        field: 'projectPrefix',
        value: 'admin',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This subdomain is reserved and cannot be used.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_reserved');
    });

    it('should handle DOMAIN_PROFANITY error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_PROFANITY,
        message: 'Contains profanity',
        field: 'projectPrefix',
        value: 'badword',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Domain contains inappropriate content.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_profanity');
    });
  });

  describe('custom domain errors', () => {
    it('should handle DOMAIN_FQDN_INVALID error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_FQDN_INVALID,
        message: 'Invalid FQDN',
        field: 'customDomain',
        value: 'not-a-valid-fqdn',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Invalid fully qualified domain name.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_fqdn_invalid');
    });

    it('should handle DOMAIN_SUBDOMAIN_INVALID error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_SUBDOMAIN_INVALID,
        message: 'Invalid subdomain',
        field: 'customDomain',
        value: 'sub.-domain.example.com',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Invalid subdomain format.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_subdomain_invalid');
    });

    it('should handle DOMAIN_LABEL_TOO_LONG error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_LABEL_TOO_LONG,
        message: 'Label too long',
        field: 'customDomain',
        value: 'verylongdomainlabelthatexceeds63characters123456789012345678901234567890.example.com',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Domain label is too long.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_label_too_long');
    });
  });

  describe('common errors', () => {
    it('should handle DOMAIN_NOT_UNIQUE error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_NOT_UNIQUE,
        message: 'Domain not unique',
        field: 'domain',
        value: 'taken-domain',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This domain is already taken.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_already_taken');
    });

    it('should handle DOMAIN_ALREADY_OWNED error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_ALREADY_OWNED,
        message: 'Domain already owned',
        field: 'domain',
        value: 'owned-domain',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This domain is already taken.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_already_taken');
    });
  });

  describe('multiple errors handling', () => {
    it('should return message for first error when multiple errors present', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [
        {
          code: DomainValidationError.DOMAIN_TOO_SHORT,
          message: 'Too short',
          field: 'projectPrefix',
          value: 'ab',
        },
        {
          code: DomainValidationError.DOMAIN_RESERVED,
          message: 'Reserved',
          field: 'projectPrefix',
          value: 'admin',
        },
        {
          code: DomainValidationError.DOMAIN_PROFANITY,
          message: 'Profanity',
          field: 'projectPrefix',
          value: 'badword',
        },
      ];
      const result = getDomainErrorMessage(errors, t);
      // Should return message for first error (DOMAIN_TOO_SHORT)
      expect(result).toBe('Domain is too short.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_too_short');
    });
  });

  describe('error object fields', () => {
    it('should handle error with all fields populated', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_FORMAT_INVALID,
        message: 'Detailed error message from API',
        field: 'projectPrefix',
        value: 'test@@domain',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Invalid domain format.');
    });

    it('should handle error with minimal fields', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_RESERVED,
        message: '',
        field: '',
        value: '',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This subdomain is reserved and cannot be used.');
    });
  });
});
