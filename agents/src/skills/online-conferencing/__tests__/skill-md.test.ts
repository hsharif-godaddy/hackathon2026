import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

const SKILL_DIR = join(__dirname, '..');
const skill = matter(readFileSync(join(SKILL_DIR, 'skill.md'), 'utf-8'));

describe('online-conferencing skill.md', () => {

  // ---------------------------------------------------------------------------
  // Frontmatter — the YAML fields the skill loader reads at runtime.
  // Wrong or missing fields cause the skill to load incorrectly or not at all.
  // ---------------------------------------------------------------------------
  describe('frontmatter', () => {
    it('has the correct skill name', () => {
      expect(skill.data.name).toBe('online-conferencing');
    });

    it('has a non-empty description', () => {
      expect(typeof skill.data.description).toBe('string');
      expect(skill.data.description.length).toBeGreaterThan(50);
    });

    it('has a non-empty whenToUse', () => {
      expect(typeof skill.data.whenToUse).toBe('string');
      expect(skill.data.whenToUse.length).toBeGreaterThan(100);
    });

    it('has an empty dependencies array (provider SDKs are installed per-provider, not upfront)', () => {
      expect(Array.isArray(skill.data.dependencies)).toBe(true);
      expect(skill.data.dependencies).toHaveLength(0);
    });

    it('has the correct enablementId', () => {
      expect(skill.data.enablementId).toBe('onlineConferencing');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature flag integrity — the enablementId must match an actual key in
  // features.ts enabledSkills. If someone renames the flag there but forgets
  // to update skill.md (or vice versa), this test catches it.
  // ---------------------------------------------------------------------------
  describe('feature flag integrity', () => {
    it('enablementId references a valid key in features.ts enabledSkills', async () => {
      const { getFeatures } = await import('../../../services/features.js');
      const features = getFeatures();
      const enablementId = skill.data.enablementId as string;
      expect(features.enabledSkills).toHaveProperty(enablementId);
    });
  });

  // ---------------------------------------------------------------------------
  // File structure — guidance-only skill with on-demand sections.
  //
  // templates/sections/ IS expected (on-demand documentation).
  // templates/lib/ and templates/server/ are NOT expected (no code templates —
  // the LLM generates all customer-app code from skill.md + sections).
  // tools/ is NOT expected (no custom runtime tools).
  // ---------------------------------------------------------------------------
  describe('file structure', () => {
    it('has templates/sections/ directory (on-demand documentation)', () => {
      expect(existsSync(join(SKILL_DIR, 'templates/sections'))).toBe(true);
    });

    it('has no templates/lib/ (no code templates — LLM generates all code)', () => {
      expect(existsSync(join(SKILL_DIR, 'templates/lib'))).toBe(false);
    });

    it('has no templates/server/ (no code templates)', () => {
      expect(existsSync(join(SKILL_DIR, 'templates/server'))).toBe(false);
    });

    it('has no tools/ directory (guidance-only — no custom runtime tools)', () => {
      expect(existsSync(join(SKILL_DIR, 'tools'))).toBe(false);
    });

    it.each([
      '01-google-meet.md',
      '02-zoom.md',
      '03-teams.md',
      '04-dispatcher-examples.md',
      '05-multi-provider-patterns.md',
      '06-feature-integration.md',
      '07-error-handling-testing.md',
    ])('section file %s exists', (filename) => {
      // Validate filename is safe (no path traversal)
      expect(filename).toMatch(/^[0-9]{2}-[a-z-]+\.md$/);
      expect(existsSync(join(SKILL_DIR, 'templates/sections', filename))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Section loading references — every section file must be referenced from
  // skill.md with the → Read pattern. If a section exists but skill.md doesn't
  // point to it, the agent will never load it.
  // ---------------------------------------------------------------------------
  describe('section references in skill.md', () => {
    const body: string = skill.content;

    it.each([
      '01-google-meet.md',
      '02-zoom.md',
      '03-teams.md',
      '04-dispatcher-examples.md',
      '05-multi-provider-patterns.md',
      '06-feature-integration.md',
      '07-error-handling-testing.md',
    ])('skill.md references %s', (filename) => {
      expect(body).toContain(filename);
    });
  });

  // ---------------------------------------------------------------------------
  // Section content validation — each provider section must contain the
  // expected structure (requestSecrets call, npm install command, integration
  // code example). This catches incomplete sections before they reach runtime.
  // ---------------------------------------------------------------------------
  describe('section content structure', () => {
    it.each([
      '01-google-meet.md',
      '02-zoom.md',
      '03-teams.md',
    ])('%s contains requestSecrets call', (filename) => {
      const content = readFileSync(join(SKILL_DIR, 'templates/sections', filename), 'utf-8');
      expect(content).toMatch(/requestSecrets\s*\(/);
    });

    it.each([
      '01-google-meet.md',
      '02-zoom.md',
      '03-teams.md',
    ])('%s contains npm install command', (filename) => {
      const content = readFileSync(join(SKILL_DIR, 'templates/sections', filename), 'utf-8');
      expect(content).toMatch(/npm install/);
    });
  });

  // ---------------------------------------------------------------------------
  // Env-var consistency — the env var names in the Step 1 getCredentials() spec
  // must exactly match the name: fields in every requestSecrets() call in
  // the section files. If someone edits env var names in Step 1 but forgets
  // the requestSecrets calls (or vice versa), every customer app silently 401s.
  // ---------------------------------------------------------------------------
  describe('env-var consistency', () => {
    it('env var names in Step 1 getCredentials spec match requestSecrets calls in sections', () => {
      const body: string = skill.content;

      // Find the canonical list in Step 1: the line containing "Env var names must match"
      const specLine = body
        .split('\n')
        .find((line) => line.includes('Env var names must match'));

      expect(specLine, 'getCredentials env var spec line not found in Step 1').toBeTruthy();

      // Extract backtick-wrapped ALL_CAPS_WITH_UNDERSCORES from the spec line
      const specEnvVars = new Set(
        [...specLine!.matchAll(/`([A-Z][A-Z_]{2,})`/g)].map((m) => m[1])
      );

      // Extract env var names from requestSecrets calls across all section files
      const sectionsDir = join(SKILL_DIR, 'templates/sections');
      const sectionFiles = [
        '01-google-meet.md',
        '02-zoom.md',
        '03-teams.md',
      ];

      const requestedEnvVars = new Set<string>();
      for (const file of sectionFiles) {
        // Validate filename is safe (no path traversal)
        expect(file).toMatch(/^[0-9]{2}-[a-z-]+\.md$/);
        const content = readFileSync(join(sectionsDir, file), 'utf-8');
        // Match bulleted format: - `ENV_VAR_NAME` (required) or (required - ...)
        for (const match of content.matchAll(/`([A-Z][A-Z_]{2,})`\s*\(required/g)) {
          requestedEnvVars.add(match[1]);
        }
      }

      expect(specEnvVars.size, 'no env vars found in spec line').toBeGreaterThan(0);
      expect(requestedEnvVars.size, 'no env vars found in requestSecrets calls').toBeGreaterThan(0);
      expect([...specEnvVars].sort()).toEqual([...requestedEnvVars].sort());
    });
  });

  // ---------------------------------------------------------------------------
  // Provider coverage in whenToUse — all three providers must be mentioned so
  // the skill is discovered regardless of which one the customer asks for.
  // ---------------------------------------------------------------------------
  describe('provider coverage in whenToUse', () => {
    const whenToUse: string = skill.data.whenToUse ?? '';

    it('mentions Google Meet', () => {
      expect(whenToUse.toLowerCase()).toContain('google meet');
    });

    it('mentions Zoom', () => {
      expect(whenToUse.toLowerCase()).toContain('zoom');
    });

    it('mentions Microsoft Teams', () => {
      expect(whenToUse.toLowerCase()).toContain('teams');
    });

    it('covers key use-case categories (booking, virtual, telehealth)', () => {
      expect(whenToUse.toLowerCase()).toContain('book');
      expect(whenToUse.toLowerCase()).toContain('virtual');
      expect(whenToUse.toLowerCase()).toContain('telehealth');
    });
  });

});
