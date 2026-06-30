/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';

import { getSsoHostParams } from './getSsoHostParams';

function setLocation(hostname: string, port: string = ''): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      port,
      origin: `https://${hostname}${port ? `:${port}` : ''}`,
    },
  });
}

describe('getSsoHostParams', function describeGetSsoHostParams() {
  const originalLocation: Location = window.location;

  afterEach(function restoreLocation() {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('strips .godaddy.com for prod', function prod() {
    setLocation('airo-builder.godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('strips .test-godaddy.com', function test() {
    setLocation('airo-builder.test-godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('strips .dev-godaddy.com', function dev() {
    setLocation('airo-builder.dev-godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('strips .stg-godaddy.com', function stg() {
    setLocation('airo-builder.stg-godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('strips .ote-godaddy.com', function ote() {
    setLocation('airo-builder.ote-godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('preserves multi-label app on local dev', function localGasket() {
    setLocation('local.gasket.dev-godaddy.com', '8443');
    expect(getSsoHostParams()).toEqual({ app: 'local.gasket', port: '8443' });
  });

  it('preserves multi-label app on pre-test', function preTest() {
    setLocation('pre-test-airo-builder.test-godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'pre-test-airo-builder', port: '' });
  });

  it('falls back when hostname is not a known GoDaddy domain', function unknown() {
    setLocation('evil.example.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('falls back when hostname has no leading subdomain', function bare() {
    setLocation('godaddy.com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('uses the provided fallback for unknown hostnames', function customFallback() {
    setLocation('evil.example.com');
    expect(getSsoHostParams('custom-app')).toEqual({ app: 'custom-app', port: '' });
  });

  it('suppresses port 80', function port80() {
    setLocation('airo-builder.godaddy.com', '80');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('suppresses port 443', function port443() {
    setLocation('airo-builder.godaddy.com', '443');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });

  it('suppresses port 3000 (Next dev)', function port3000() {
    setLocation('local.gasket.dev-godaddy.com', '3000');
    expect(getSsoHostParams()).toEqual({ app: 'local.gasket', port: '' });
  });

  it('passes through arbitrary non-standard ports', function customPort() {
    setLocation('local.gasket.dev-godaddy.com', '9999');
    expect(getSsoHostParams()).toEqual({ app: 'local.gasket', port: '9999' });
  });

  it('case-insensitively matches the root domain', function caseInsensitive() {
    setLocation('AIRO-Builder.Test-Godaddy.Com');
    expect(getSsoHostParams()).toEqual({ app: 'airo-builder', port: '' });
  });
});
