import { describe, it, expect } from 'vitest';
import { parseJson } from '../src/parse';

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('[{"id": "a"}]')).toEqual([{ id: 'a' }]);
  });

  it('parses nested objects', () => {
    expect(parseJson('{"hero":{"title":"Welcome","nav":[{"href":"/","label":"Home"}]}}')).toEqual({
      hero: { title: 'Welcome', nav: [{ href: '/', label: 'Home' }] },
    });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJson('{not json}')).toThrow();
  });
});
