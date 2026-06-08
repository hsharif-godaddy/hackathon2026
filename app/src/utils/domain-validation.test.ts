import { describe, expect, it, vi } from 'vitest';

import { DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';
import { ApiErrorCode } from './api-errors';
import { DomainApiErrorCode, getDomainErrorMessage, translateDomainApiError } from './domain-validation';

describe('getDomainErrorMessage', () => {
  // Mock translation function
  const createMockTranslations = () => {
    const t = vi.fn(function (key: string) {
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
        'builder_domain_error_already_in_use': 'This domain is already in use.',
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
        field: 'fqdn',
        value: 'not-a-valid-fqdn',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Invalid fully qualified domain name.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_fqdn_invalid', undefined);
    });

    it('should handle DOMAIN_SUBDOMAIN_INVALID error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_SUBDOMAIN_INVALID,
        message: 'Invalid subdomain',
        field: 'fqdn',
        value: 'sub.-domain.example.com',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Invalid subdomain format.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_subdomain_invalid', undefined);
    });

    it('should handle DOMAIN_LABEL_TOO_LONG error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_LABEL_TOO_LONG,
        message: 'Label too long',
        field: 'fqdn',
        value: 'verylongdomainlabelthatexceeds63characters123456789012345678901234567890.example.com',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Domain label is too long.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_label_too_long', undefined);
    });
  });

  describe('common errors', () => {
    it('should handle DOMAIN_NOT_UNIQUE error', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_NOT_UNIQUE,
        message: 'Domain not unique',
        field: 'projectPrefix',
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
        field: 'projectPrefix',
        value: 'owned-domain',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This domain is already taken.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_already_taken');
    });

    it('should handle DOMAIN_NOT_UNIQUE error with fqdn field', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_NOT_UNIQUE,
        message: 'Domain not unique',
        field: 'fqdn',
        value: 'taken.example.com',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This domain is already in use.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_already_in_use', undefined);
    });

    it('should handle DOMAIN_ALREADY_OWNED error with fqdn field', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_ALREADY_OWNED,
        message: 'Domain already owned',
        field: 'fqdn',
        value: 'owned.example.com',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This domain is already in use.');
      expect(t).toHaveBeenCalledWith('builder_domain_error_already_in_use', undefined);
    });

    it('should handle TLD_NOT_SUPPORTED error with fqdn field', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.TLD_NOT_SUPPORTED,
        message: 'The top-level domain .xyz is not supported',
        field: 'fqdn',
        value: 'example.xyz',
        tld: 'xyz',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('builder_domain_error_tld_not_supported');
      expect(t).toHaveBeenCalledWith('builder_domain_error_tld_not_supported', { tld: 'xyz' });
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
        field: 'projectPrefix',
        value: '',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('This subdomain is reserved and cannot be used.');
    });

    it('should return firstError.message for unrecognized field value', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_RESERVED,
        message: 'Server-provided message',
        field: 'unknown' as string,
        value: 'test',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('Server-provided message');
    });

    it('should return default translation for unrecognized field with empty message', () => {
      const t = createMockTranslations();
      const errors: DomainValidationErrorObject[] = [{
        code: DomainValidationError.DOMAIN_RESERVED,
        message: '',
        field: 'somethingNew' as string,
        value: 'test',
      }];
      const result = getDomainErrorMessage(errors, t);
      expect(result).toBe('An error occurred with your domain.');
    });
  });
});

describe('translateDomainApiError', () => {
  const createMockTranslations = () => {
    const t = vi.fn(function (key: string) { return key; });
    return t as unknown as ReturnType<typeof import('@/hooks/useTranslations').useTranslations>;
  };

  it('should translate domain-specific error codes', () => {
    const t = createMockTranslations();
    expect(translateDomainApiError(DomainApiErrorCode.DOMAIN_MODIFY_FAILED, t))
      .toBe('builder_domain_api_error_modify_failed');
    expect(translateDomainApiError(DomainApiErrorCode.FQDN_REQUIRED, t))
      .toBe('builder_domain_api_error_fqdn_required');
    expect(translateDomainApiError(DomainApiErrorCode.INVALID_DOMAIN_FORMAT, t))
      .toBe('builder_domain_api_error_invalid_format');
    expect(translateDomainApiError(DomainApiErrorCode.TLD_NOT_SUPPORTED, t, undefined, { tld: 'drinks' }))
      .toBe('builder_domain_error_tld_not_supported');
  });

  it('should fall back to generic API error codes', () => {
    const t = createMockTranslations();
    expect(translateDomainApiError(ApiErrorCode.SITE_NOT_FOUND, t))
      .toBe('builder_api_error_site_not_found');
    expect(translateDomainApiError(ApiErrorCode.AUTH_REQUIRED, t))
      .toBe('builder_api_error_auth_required');
    expect(translateDomainApiError(ApiErrorCode.SITE_CONFIG_INCOMPLETE, t))
      .toBe('builder_api_error_site_config_incomplete');
  });

  it('should use product-specific key when conflictingProduct is present', () => {
    const t = createMockTranslations();
    expect(
      translateDomainApiError(DomainApiErrorCode.DOMAIN_ALREADY_IN_USE, t, undefined, { conflictingProduct: 'Airo Builder' })
    ).toBe('builder_domain_api_error_already_in_use');
    expect(t).toHaveBeenCalledWith('builder_domain_api_error_already_in_use', { conflictingProduct: 'Airo Builder' }, undefined);
  });

  it('should fall back to placeholder-free key when conflictingProduct is absent', () => {
    const t = createMockTranslations();
    expect(
      translateDomainApiError(DomainApiErrorCode.DOMAIN_ALREADY_IN_USE, t, undefined, {})
    ).toBe('builder_domain_error_already_in_use');
    expect(
      translateDomainApiError(DomainApiErrorCode.DOMAIN_ALREADY_IN_USE, t)
    ).toBe('builder_domain_error_already_in_use');
  });

  it('should return fallback for unknown error codes', () => {
    const t = createMockTranslations();
    expect(translateDomainApiError('TOTALLY_UNKNOWN_CODE', t, 'Something went wrong'))
      .toBe('Something went wrong');
  });

  it('should return default message when code is undefined and no fallback', () => {
    const t = createMockTranslations();
    expect(translateDomainApiError(undefined, t)).toBe('builder_api_error_default');
  });

  it('should return fallback when code is undefined', () => {
    const t = createMockTranslations();
    expect(translateDomainApiError(undefined, t, 'Fallback message')).toBe('Fallback message');
  });

  it('should translate all defined domain-specific error codes', () => {
    const t = createMockTranslations();
    for (const code of Object.values(DomainApiErrorCode)) {
      const result = translateDomainApiError(code, t);
      expect(result).not.toBe('builder_api_error_default');
    }
  });

  it('should translate all defined generic error codes', () => {
    const t = createMockTranslations();
    for (const code of Object.values(ApiErrorCode)) {
      const result = translateDomainApiError(code, t);
      expect(result).not.toBe('builder_api_error_default');
    }
  });
});
