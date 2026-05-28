import { describe, expect, it } from 'vitest';

import {
  GETTY_CONFIG_HELP,
  GETTY_CONFIG_LEGACY_TOKEN_NOTICE,
  GETTY_CONFIG_MEDIA_AUTH_MISSING,
} from '../getty-config-messages.js';

describe('getty-config-messages', () => {
  it('documents IAM auth in configure help', () => {
    expect(GETTY_CONFIG_HELP).toContain('USE_S2S_AUTH=true');
    expect(GETTY_CONFIG_HELP).not.toContain('SSO_JWT');
  });

  it('includes configure help in missing-auth message', () => {
    expect(GETTY_CONFIG_MEDIA_AUTH_MISSING).toContain('USE_S2S_AUTH');
    expect(GETTY_CONFIG_MEDIA_AUTH_MISSING).toContain(GETTY_CONFIG_HELP);
    expect(GETTY_CONFIG_MEDIA_AUTH_MISSING).not.toContain('SSO_JWT');
  });

  it('includes configure help in legacy token notice', () => {
    expect(GETTY_CONFIG_LEGACY_TOKEN_NOTICE).toContain('GETTY_TOKEN');
    expect(GETTY_CONFIG_LEGACY_TOKEN_NOTICE).toContain(GETTY_CONFIG_HELP);
  });
});
