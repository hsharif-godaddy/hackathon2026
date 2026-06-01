import { describe, expect, it } from 'vitest';

import type { AtlasExtractedForm } from '../../types/atlas-api.js';
import { mapAtlasForms } from '../AtlasCrawlerAdapter.js';

describe('mapAtlasForms', () => {
  it('returns [] for undefined or empty input', () => {
    expect(mapAtlasForms(undefined)).toEqual([]);
    expect(mapAtlasForms([])).toEqual([]);
  });

  it('maps a typical newsletter form', () => {
    const input: AtlasExtractedForm[] = [{
      action: '/subscribe',
      method: 'post',
      fields: [
        { tag: 'input', type: 'email', name: 'email', placeholder: 'you@example.com', required: true, label: 'Email' },
      ],
      submitButton: { text: 'Subscribe', type: 'submit' },
    }];

    expect(mapAtlasForms(input)).toEqual([{
      action: '/subscribe',
      method: 'post',
      fields: [
        { type: 'email', name: 'email', placeholder: 'you@example.com', required: true, label: 'Email' },
      ],
      submitButton: { text: 'Subscribe' },
    }]);
  });

  it('narrows arbitrary method strings to "get" or "post"', () => {
    const weird: AtlasExtractedForm[] = [{
      method: 'PUT',
      fields: [{ tag: 'input', type: 'text', required: false }],
    } as AtlasExtractedForm];

    expect(mapAtlasForms(weird)[0]?.method).toBe('get');
  });

  it('defaults missing method to "get"', () => {
    const noMethod: AtlasExtractedForm[] = [{
      fields: [{ tag: 'input', type: 'text', required: false }],
    } as AtlasExtractedForm];

    expect(mapAtlasForms(noMethod)[0]?.method).toBe('get');
  });

  it('survives malformed fields array (non-array → empty)', () => {
    const broken = [{
      method: 'post',
      fields: 'not-an-array',
    }] as unknown as AtlasExtractedForm[];

    const result = mapAtlasForms(broken);
    expect(result).toHaveLength(1);
    expect(result[0]?.fields).toEqual([]);
  });

  it('omits optional field properties when absent', () => {
    const input: AtlasExtractedForm[] = [{
      method: 'get',
      fields: [{ tag: 'input', type: 'text', required: false }],
    }];

    const field = mapAtlasForms(input)[0]?.fields[0];
    expect(field).toEqual({ type: 'text', required: false });
    expect(field).not.toHaveProperty('name');
    expect(field).not.toHaveProperty('label');
  });

  it('omits options when empty', () => {
    const input: AtlasExtractedForm[] = [{
      method: 'get',
      fields: [{ tag: 'select', type: 'select', required: false, options: [] }],
    }];

    expect(mapAtlasForms(input)[0]?.fields[0]).not.toHaveProperty('options');
  });

  it('preserves options when populated', () => {
    const input: AtlasExtractedForm[] = [{
      method: 'get',
      fields: [{ tag: 'select', type: 'select', required: false, options: ['small', 'medium', 'large'] }],
    }];

    expect(mapAtlasForms(input)[0]?.fields[0]?.options).toEqual(['small', 'medium', 'large']);
  });

  it('preserves form id and className when present', () => {
    const input: AtlasExtractedForm[] = [{
      action: '/contact',
      method: 'post',
      id: 'newsletter-form',
      className: 'contact-us signup-form',
      fields: [{ tag: 'input', type: 'email', name: 'email', required: true }],
      submitButton: { text: 'Send', type: 'submit' },
    }];

    const result = mapAtlasForms(input);
    expect(result[0]).toMatchObject({
      id: 'newsletter-form',
      className: 'contact-us signup-form',
    });
  });

  it('omits id and className when absent', () => {
    const input: AtlasExtractedForm[] = [{
      method: 'get',
      fields: [{ tag: 'input', type: 'text', required: false }],
    }];

    const result = mapAtlasForms(input);
    expect(result[0]).not.toHaveProperty('id');
    expect(result[0]).not.toHaveProperty('className');
  });
});
