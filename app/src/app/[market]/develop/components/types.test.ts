import { describe, expect, it } from 'vitest';

import { buildEditModeEnabledMessage, IframeMessageType } from './types';

describe('buildEditModeEnabledMessage', function buildEditModeEnabledMessageTests() {
  it('should return EDIT_MODE_ENABLED with cmsInlineEditEnabled: true', function trueCase() {
    const result = buildEditModeEnabledMessage(true);
    expect(result).toEqual({ type: IframeMessageType.EDIT_MODE_ENABLED, cmsInlineEditEnabled: true });
  });

  it('should return EDIT_MODE_ENABLED with cmsInlineEditEnabled: false', function falseCase() {
    const result = buildEditModeEnabledMessage(false);
    expect(result).toEqual({ type: IframeMessageType.EDIT_MODE_ENABLED, cmsInlineEditEnabled: false });
  });
});
