import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Static eval: SEO guidance is split between the develop prompt primer
// (agents/src/prompts/develop/seo.md) and the loaded-on-demand seo skill
// (agents/src/skills/seo/skill.md). The primer tells the agent to load the
// skill for SEO work; the skill carries the v8-specific implementation detail.

const here = dirname(fileURLToPath(import.meta.url));
const agentsSrc = resolve(here, '..');

function readFile(relPath: string): string {
  return readFileSync(resolve(agentsSrc, relPath), 'utf-8');
}

const primer = readFile('prompts/develop/seo.md').toLowerCase();
const skill = readFile('skills/seo/skill.md').toLowerCase();
const backend = readFile('prompts/develop/backend.md').toLowerCase();
const templateDesc = readFile('prompts/template-descriptions/v8.md').toLowerCase();

describe('SEO generation eval (static prompt assertions)', () => {
  describe('develop primer', () => {
    it('directs the agent to load the seo skill for SEO work', () => {
      expect(primer).toContain('`seo` skill');
    });

    it('mentions the key SEO surface areas', () => {
      expect(primer).toContain('react-helmet');
      expect(primer).toContain('seo-routes');
      expect(primer).toContain('sitemap');
    });
  });

  describe('seo skill body', () => {
    it('teaches react-helmet usage', () => {
      expect(skill).toContain('@dr.pogodin/react-helmet');
    });

    it('teaches title, description, canonical, OG, twitter', () => {
      expect(skill).toContain('<title>');
      expect(skill).toContain('<meta name="description"');
      expect(skill).toContain('canonical');
      expect(skill).toContain('og:title');
      expect(skill).toContain('og:image');
      expect(skill).toContain('twitter:card');
    });

    it('teaches JSON-LD structured data', () => {
      expect(skill).toContain('application/ld+json');
    });

    it('teaches the seo-routes registry', () => {
      expect(skill).toContain('seo-routes');
      expect(skill).toContain('sitemap');
    });

    it('covers image hygiene and semantic HTML', () => {
      expect(skill).toContain('fetchpriority');
      expect(skill).toContain('alt');
      expect(skill).toContain('<h1>');
    });
  });

  describe('backend + template description', () => {
    it('points at src/server/entry.ts as the handler registration site', () => {
      expect(backend + templateDesc).toContain('src/server/entry.ts');
    });
  });
});
