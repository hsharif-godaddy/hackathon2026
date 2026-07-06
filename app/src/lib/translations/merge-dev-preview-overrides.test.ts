import { beforeEach, describe, expect, it } from 'vitest';

import {
  DESIGN_KIT_GALLERY_SUBTITLE_V2,
  mergeDevPreviewOverrides,
} from '@/lib/translations/merge-dev-preview-overrides';

describe('mergeDevPreviewOverrides', () => {
  const originalNodeEnv: string | undefined = process.env.NODE_ENV;
  const input: Record<string, string> = { builder_existing_key: 'Existing value' };

  beforeEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns messages unchanged outside development', function prodPassthrough() {
    process.env.NODE_ENV = 'production';
    expect(mergeDevPreviewOverrides(input)).toEqual(input);
  });

  it('injects the design kit gallery subtitle in development', function devInject() {
    process.env.NODE_ENV = 'development';
    expect(mergeDevPreviewOverrides(input)).toEqual({
      ...input,
      builder_design_kit_gallery_subtitle_v2: DESIGN_KIT_GALLERY_SUBTITLE_V2,
    });
  });
});
