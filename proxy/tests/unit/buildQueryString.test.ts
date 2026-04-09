import { buildQueryString } from '../../src/clients/getty-client.js';

describe('buildQueryString', () => {
  it('should handle simple scalar params', () => {
    const result = buildQueryString({ phrase: 'sunset', page: 1, pageSize: 10 });
    expect(result).toBe('phrase=sunset&page=1&pageSize=10');
  });

  it('should handle a single-element array as one param', () => {
    const result = buildQueryString({ phrase: 'sunset', orientations: ['horizontal'] } as any);
    expect(result).toContain('orientations=horizontal');
    expect(result).not.toContain('%2C');
  });

  it('should handle multi-element arrays as repeated params', () => {
    const result = buildQueryString({ phrase: 'sunset', orientations: ['horizontal', 'square'] } as any);
    const params = new URLSearchParams(result);
    expect(params.getAll('orientations')).toEqual(['horizontal', 'square']);
  });

  it('should handle multiple array params simultaneously', () => {
    const result = buildQueryString({
      phrase: 'business meeting',
      orientations: ['horizontal', 'vertical'],
      moods: ['warm', 'natural'],
      graphical_styles: ['photography'],
    } as any);

    const params = new URLSearchParams(result);
    expect(params.getAll('orientations')).toEqual(['horizontal', 'vertical']);
    expect(params.getAll('moods')).toEqual(['warm', 'natural']);
    expect(params.getAll('graphical_styles')).toEqual(['photography']);
    expect(params.get('phrase')).toBe('business meeting');
  });

  it('should skip null and undefined values', () => {
    const result = buildQueryString({ phrase: 'test', page: null, q: undefined } as any);
    const params = new URLSearchParams(result);
    expect(params.get('phrase')).toBe('test');
    expect(params.has('page')).toBe(false);
    expect(params.has('q')).toBe(false);
  });

  it('should skip empty arrays', () => {
    const result = buildQueryString({ phrase: 'test', orientations: [] } as any);
    const params = new URLSearchParams(result);
    expect(params.has('orientations')).toBe(false);
  });

  it('should convert numeric values to strings', () => {
    const result = buildQueryString({ phrase: 'test', page: 1, page_size: 3 });
    const params = new URLSearchParams(result);
    expect(params.get('page')).toBe('1');
    expect(params.get('page_size')).toBe('3');
  });

  it('should preserve all Getty filter params from a realistic search', () => {
    const result = buildQueryString({
      phrase: 'clean modern house exterior',
      page: 1,
      page_size: 3,
      sort_order: 'best_match',
      orientations: ['horizontal', 'square'],
      graphical_styles: ['photography'],
      compositions: ['wide_shot', 'full_frame'],
      moods: ['warm'],
      number_of_people: ['none'],
      minimum_size: 'large',
      color: '#4A90D9',
    } as any);

    const params = new URLSearchParams(result);
    expect(params.get('phrase')).toBe('clean modern house exterior');
    expect(params.get('sort_order')).toBe('best_match');
    expect(params.getAll('orientations')).toEqual(['horizontal', 'square']);
    expect(params.getAll('graphical_styles')).toEqual(['photography']);
    expect(params.getAll('compositions')).toEqual(['wide_shot', 'full_frame']);
    expect(params.getAll('moods')).toEqual(['warm']);
    expect(params.getAll('number_of_people')).toEqual(['none']);
    expect(params.get('minimum_size')).toBe('large');
    expect(params.get('color')).toBe('#4A90D9');
  });
});
