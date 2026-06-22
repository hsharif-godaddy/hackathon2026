import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

describe('content-system skill.md', () => {
  const content = readFileSync(join(__dirname, '../skill.md'), 'utf-8');
  const { data, content: body } = matter(content);

  it('has valid frontmatter', () => {
    expect(data.name).toBe('content-system');
    expect(data.description).toBeTruthy();
    expect(data.whenToUse).toBeTruthy();
  });

  it('documents the five rules by name', () => {
    expect(body).toMatch(/Content-layer-first for user-visible text/);
    expect(body).toMatch(/Direct member access only/);
    expect(body).toMatch(/Render editable content where you read it/);
    expect(body).toMatch(/sole expression child/);
    expect(body).toMatch(/ContentListContext/);
  });

  it('documents the file layout with site/pages/data', () => {
    expect(body).toMatch(/site\.json/);
    expect(body).toMatch(/pages\//);
    expect(body).toMatch(/data\//);
  });

  it('references virtual:content imports', () => {
    expect(body).toMatch(/virtual:content/);
  });

  it('documents the retrofit workflow for pre-CMS apps', () => {
    expect(body).toMatch(/Retrofitting a Pre-CMS App/);
    expect(body).toMatch(/checkContentRules/);
  });
});

describe('develop content-layer.md includes content layer section', () => {
  const core = readFileSync(
    join(__dirname, '../../../prompts/develop/content-layer.md'),
    'utf-8',
  );

  it('mentions src/content/', () => {
    expect(core).toMatch(/src\/content\//);
  });

  it('surfaces all five rules', () => {
    expect(core).toMatch(/Content-layer-first/);
    expect(core).toMatch(/Direct member access/);
    expect(core).toMatch(/Render editable content where you read it/);
    expect(core).toMatch(/Two-element composition/);
    expect(core).toMatch(/over a content list/);
  });

  it('points at the content-system skill', () => {
    expect(core).toMatch(/content-system/);
  });

  it('directs the agent to use content_scaffold for new content roots', () => {
    expect(core).toMatch(/content_scaffold/);
  });
});
