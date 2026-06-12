import { describe, it, expect } from 'vitest';
import { classifyCaptureError } from '../timeout-class.js';

describe('classifyCaptureError', () => {
  it('classifies a page.goto timeout as "goto"', () => {
    const err = new Error('page.goto: Timeout 30000ms exceeded.');
    expect(classifyCaptureError(err)).toBe('goto');
  });

  it('classifies a navigation timeout phrased with "navigating to" as "goto"', () => {
    const err = new Error(
      'page.goto: Timeout 30000ms exceeded.\n=========================\nnavigating to "https://preview.local/", waiting until "domcontentloaded"',
    );
    expect(classifyCaptureError(err)).toBe('goto');
  });

  it('classifies a waitForSelector timeout as "app-ready"', () => {
    const err = new Error(
      'page.waitForSelector: Timeout 15000ms exceeded.\nwaiting for locator("#app > *")',
    );
    expect(classifyCaptureError(err)).toBe('app-ready');
  });

  it('classifies a non-timeout error as "other"', () => {
    expect(classifyCaptureError(new Error('discovery failed'))).toBe('other');
  });

  it('classifies a non-Error value as "other"', () => {
    expect(classifyCaptureError('boom')).toBe('other');
    expect(classifyCaptureError(undefined)).toBe('other');
  });

  it('classifies a bare timeout (no method prefix) as "timeout"', () => {
    const err = new Error('Timeout 5000ms exceeded.');
    expect(classifyCaptureError(err)).toBe('timeout');
  });
});
