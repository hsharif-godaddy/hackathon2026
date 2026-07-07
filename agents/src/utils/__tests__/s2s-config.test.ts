import { afterEach, describe, expect, it } from 'vitest';

import { getDefaultS2SConfigV2 } from '../s2s-config.js';

describe('getDefaultS2SConfigV2', () => {
  afterEach(() => {
    delete process.env.S2S_AWS_PROFILE;
    delete process.env.SSO_HOST;
  });

  it('falls back to the gocode / test-sso defaults when env is unset', () => {
    delete process.env.S2S_AWS_PROFILE;
    delete process.env.SSO_HOST;
    expect(getDefaultS2SConfigV2()).toEqual({
      awsProfile: 'gocode',
      ssoHost: 'sso.test-godaddy.com',
    });
  });

  it('honors S2S_AWS_PROFILE and SSO_HOST overrides', () => {
    process.env.S2S_AWS_PROFILE = 'care-profile';
    process.env.SSO_HOST = 'sso.dev-godaddy.com';
    expect(getDefaultS2SConfigV2()).toEqual({
      awsProfile: 'care-profile',
      ssoHost: 'sso.dev-godaddy.com',
    });
  });

  it('resolves each field independently when only S2S_AWS_PROFILE is set', () => {
    process.env.S2S_AWS_PROFILE = 'care-profile';
    delete process.env.SSO_HOST;
    expect(getDefaultS2SConfigV2()).toEqual({
      awsProfile: 'care-profile',
      ssoHost: 'sso.test-godaddy.com',
    });
  });

  it('resolves each field independently when only SSO_HOST is set', () => {
    delete process.env.S2S_AWS_PROFILE;
    process.env.SSO_HOST = 'sso.dev-godaddy.com';
    expect(getDefaultS2SConfigV2()).toEqual({
      awsProfile: 'gocode',
      ssoHost: 'sso.dev-godaddy.com',
    });
  });
});
