/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  readCreationSourceFromSession,
  readEntryPointFromSession,
  readIntentCategoryFromSession,
  resolveCreationSource,
  resolveEntryPoint,
  trafficPathwaySessionId,
} from '@/utils/traffic-signals';

describe('trafficPathwaySessionId', function pathwaySuite() {
  it('returns trimmed non-empty pathway value', function pathwayOk() {
    expect(trafficPathwaySessionId('  sid-1  ')).toBe('sid-1');
  });

  it('returns undefined for blank', function pathwayBlank() {
    expect(trafficPathwaySessionId(undefined)).toBeUndefined();
    expect(trafficPathwaySessionId('   ')).toBeUndefined();
  });

  it('passes through decoded pathway value (cookie jar already decoded)', function pathwayDecoded() {
    expect(trafficPathwaySessionId('uuid/segment')).toBe('uuid/segment');
  });
});

describe('resolveEntryPoint', function entryPointSuite() {
  describe('?location parent URL', function locationUrlTests() {
    it('returns FOS for godaddy.com host with no path segment', function homepageFos() {
      expect(resolveEntryPoint(['https://www.godaddy.com/'], 'default')).toBe('FOS');
      expect(resolveEntryPoint(['https://dashboard.godaddy.com'], 'default')).toBe('FOS');
    });

    it('skips non-godaddy URLs entirely and falls through to next candidate', function externalSkipped() {
      expect(resolveEntryPoint(['https://partner.example.com/landing/page', 'gd_nav_airo'], 'default')).toBe('gd_nav_airo');
      expect(resolveEntryPoint(['https://partner.example.com/'], 'fallback')).toBe('fallback');
    });

    it('returns full path before query string', function fullPath() {
      expect(
        resolveEntryPoint(
          ['https://dashboard.godaddy.com/venture/ml_logo?ventureId=2f8bce42-e7aa-4b7d-91c9-3e188f269916'],
          'default',
        ),
      ).toBe('venture/ml_logo');
    });

    it('skips malformed location URLs and uses itc', function invalidLocation() {
      expect(resolveEntryPoint(['https://[invalid', 'gd_nav_airo'], 'default')).toBe('gd_nav_airo');
    });
  });

  describe('priority order', function priorityTests() {
    it('uses location-derived path before itc and site_location', function locationPriority() {
      expect(
        resolveEntryPoint(
          ['https://dashboard.godaddy.com/venture/ml_logo', 'gd_nav_airo', 'other'],
          'default',
        ),
      ).toBe('venture/ml_logo');
    });

    it('uses itc when both params present (itc wins)', function itcPriority() {
      expect(resolveEntryPoint(['gd_nav_airo', 'other'], 'default')).toBe('gd_nav_airo');
    });

    it('uses site_location when itc is null', function siteLocationFallback() {
      expect(resolveEntryPoint([null, 'direct_link'], 'default')).toBe('direct_link');
    });

    it('uses fallback when all params are null', function allNull() {
      expect(resolveEntryPoint([null, null], 'aab_homepage')).toBe('aab_homepage');
    });

    it('uses fallback when all params are empty strings', function allEmpty() {
      expect(resolveEntryPoint(['', ''], 'direct_nav')).toBe('direct_nav');
    });
  });

  describe('sanitization', function sanitizationTests() {
    it('trims whitespace from values', function trimWhitespace() {
      expect(resolveEntryPoint(['  gd_nav_airo  ', null], 'default')).toBe('gd_nav_airo');
    });

    it('replaces invalid characters with underscores', function replaceInvalid() {
      expect(resolveEntryPoint(['test@value!', null], 'default')).toBe('test_value_');
    });

    it('clamps to 64 characters', function clampLength() {
      const longValue = 'a'.repeat(100);
      expect(resolveEntryPoint([longValue, null], 'default').length).toBe(64);
    });
  });

  describe('real-world scenarios', function scenariosTests() {
    it('handles GoDaddy Nav via itc parameter', function gdNavItc() {
      expect(resolveEntryPoint(['gd_nav_airo', null], 'aab_homepage')).toBe('gd_nav_airo');
    });

    it('handles GoDaddy Nav via site_location parameter', function gdNavSiteLocation() {
      expect(resolveEntryPoint([null, 'gd_nav_airo'], 'aab_homepage')).toBe('gd_nav_airo');
    });

    it('handles AAB homepage with no params', function aabHomepage() {
      expect(resolveEntryPoint([null, null], 'aab_homepage')).toBe('aab_homepage');
    });

    it('handles direct URL navigation with no params', function directNav() {
      expect(resolveEntryPoint([null, null], 'direct_nav')).toBe('direct_nav');
    });
  });
});

describe('readEntryPointFromSession', function readEntryPointSuite() {
  beforeEach(function clearStorage() {
    sessionStorage.clear();
  });

  it('returns value stored for appId', function appIdStored() {
    sessionStorage.setItem('entry-point-app-1', 'gd_nav_airo');
    expect(readEntryPointFromSession('app-1')).toBe('gd_nav_airo');
  });

  it('falls back to job mapping when appId key is missing', function jobFallback() {
    sessionStorage.setItem('initial-job-id-app-1', 'job-1');
    sessionStorage.setItem('entry-point-job-1', 'aab_homepage');
    expect(readEntryPointFromSession('app-1')).toBe('aab_homepage');
  });

  it('prefers appId key over job fallback', function appIdWins() {
    sessionStorage.setItem('entry-point-app-1', 'direct_nav');
    sessionStorage.setItem('initial-job-id-app-1', 'job-1');
    sessionStorage.setItem('entry-point-job-1', 'aab_homepage');
    expect(readEntryPointFromSession('app-1')).toBe('direct_nav');
  });

  it('returns undefined when nothing is stored', function missing() {
    expect(readEntryPointFromSession('app-1')).toBeUndefined();
  });
});

describe('resolveCreationSource', function creationSourceSuite() {
  it('returns ui_kit_import for UI kit uploads', function uiKit() {
    expect(resolveCreationSource({ isUiKit: true }, null, 'text')).toBe('ui_kit_import');
  });

  it('returns code_import for zip uploads', function zipUpload() {
    expect(resolveCreationSource({ isZip: true }, null, 'text')).toBe('code_import');
  });

  it('returns design_file for other file uploads', function designFile() {
    expect(resolveCreationSource({}, null, 'text')).toBe('design_file');
  });

  it('returns logo_design for logo-designer template', function logoDesign() {
    expect(resolveCreationSource(null, 'logo-designer', 'text')).toBe('logo_design');
  });

  it('returns business_plan for business-plan template', function businessPlan() {
    expect(resolveCreationSource(null, 'business-plan', 'text')).toBe('business_plan');
  });

  it('returns example_selected for example submissions', function exampleSelected() {
    expect(resolveCreationSource(null, null, 'example')).toBe('example_selected');
  });

  it('returns free_text for plain text submissions', function freeText() {
    expect(resolveCreationSource(null, 'default', 'text')).toBe('free_text');
  });

  it('prioritizes ui kit over zip flag when both set', function uiKitPriority() {
    expect(resolveCreationSource({ isUiKit: true, isZip: true }, null, 'text')).toBe('ui_kit_import');
  });

  it('prioritizes file upload over template and example', function filePriority() {
    expect(resolveCreationSource({ isZip: true }, 'logo-designer', 'example')).toBe('code_import');
  });
});

describe('readCreationSourceFromSession', function readCreationSourceSuite() {
  beforeEach(function clearStorage() {
    sessionStorage.clear();
  });

  it('returns value stored for appId', function appIdStored() {
    sessionStorage.setItem('creation-source-app-1', 'free_text');
    expect(readCreationSourceFromSession('app-1')).toBe('free_text');
  });

  it('falls back to job mapping when appId key is missing', function jobFallback() {
    sessionStorage.setItem('initial-job-id-app-1', 'job-1');
    sessionStorage.setItem('creation-source-job-1', 'example_selected');
    expect(readCreationSourceFromSession('app-1')).toBe('example_selected');
  });

  it('returns undefined when nothing is stored', function missing() {
    expect(readCreationSourceFromSession('app-1')).toBeUndefined();
  });
});

describe('readIntentCategoryFromSession', function readIntentCategorySuite() {
  beforeEach(function clearStorage() {
    sessionStorage.clear();
  });

  it('returns value stored for appId', function appIdStored() {
    sessionStorage.setItem('intent-category-app-1', 'restaurant');
    expect(readIntentCategoryFromSession('app-1')).toBe('restaurant');
  });

  it('falls back to job mapping when appId key is missing', function jobFallback() {
    sessionStorage.setItem('initial-job-id-app-1', 'job-1');
    sessionStorage.setItem('intent-category-job-1', 'portfolio');
    expect(readIntentCategoryFromSession('app-1')).toBe('portfolio');
  });

  it('returns undefined when nothing is stored', function missing() {
    expect(readIntentCategoryFromSession('app-1')).toBeUndefined();
  });
});
