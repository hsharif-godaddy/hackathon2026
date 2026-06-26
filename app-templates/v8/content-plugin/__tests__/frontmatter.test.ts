import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../src/frontmatter';

describe('parseFrontmatter', () => {
  it('parses frontmatter fields and trims the body', () => {
    const raw: string = `---\ntitle: Hello\npublished: true\ntags: [a, b]\n---\n\n# Body\ntext`;
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({ title: 'Hello', published: true, tags: ['a', 'b'] });
    expect(content).toBe('# Body\ntext');
  });

  it('strips surrounding quotes and keeps ISO date strings', () => {
    const raw: string = `---\npublishedAt: '2026-06-20T10:00:00Z'\ntitle: "Quoted"\n---\nbody`;
    const { data } = parseFrontmatter(raw);
    expect(data.publishedAt).toBe('2026-06-20T10:00:00Z');
    expect(data.title).toBe('Quoted');
  });

  it('returns whole input as content when there is no frontmatter', () => {
    const { data, content } = parseFrontmatter('no frontmatter here');
    expect(data).toEqual({});
    expect(content).toBe('no frontmatter here');
  });
});
