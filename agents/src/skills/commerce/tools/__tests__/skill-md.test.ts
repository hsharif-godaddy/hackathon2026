import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

describe('commerce skill.md', () => {
  const content = readFileSync(
    join(__dirname, '../../skill.md'),
    'utf-8',
  );
  const { data } = matter(content);

  it('should have valid frontmatter', () => {
    expect(data.name).toBe('commerce');
    expect(data.description).toBeTruthy();
    expect(data.whenToUse).toBeTruthy();
    expect(data.dependencies).toBeUndefined();
  });
});
