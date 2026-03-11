import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { SkillLoaderTool, buildSkillsPromptSection } from '../skill-loader-tool.js';

// Mock the terminal and dev supervisor dependencies
vi.mock('../terminal.js', () => ({
  TerminalTool: vi.fn().mockImplementation(() => ({
    executeCommand: vi.fn().mockResolvedValue({ success: true, exitCode: 0 })
  }))
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp: vi.fn().mockReturnValue({})
  }
}));

describe('skill-loader-tool', function packageTests() {
  describe('#validatePackageName', function validateTests() {
    let tool: SkillLoaderTool;

    beforeEach(() => {
      tool = new SkillLoaderTool();
    });

    // Access private method for testing
    function validate(packageName: string): boolean {
      return (tool as any).validatePackageName(packageName);
    }

    describe('valid package names', function validNames() {
      it('should accept simple package names', function simple() {
        expect(validate('lodash')).toBe(true);
        expect(validate('express')).toBe(true);
        expect(validate('better-auth')).toBe(true);
        expect(validate('react-dom')).toBe(true);
      });

      it('should accept scoped packages', function scoped() {
        expect(validate('@types/node')).toBe(true);
        expect(validate('@tanstack/react-query')).toBe(true);
        expect(validate('@godaddy/terminus')).toBe(true);
      });

      it('should accept packages with dots and underscores', function special() {
        expect(validate('socket.io')).toBe(true);
        expect(validate('lodash_es')).toBe(true);
      });

      it('should accept exact version pinning', function exactVersion() {
        expect(validate('lodash@4.17.21')).toBe(true);
        expect(validate('better-auth@1.0.0')).toBe(true);
        expect(validate('express@4.18.2')).toBe(true);
      });

      it('should accept caret version ranges', function caretVersion() {
        expect(validate('lodash@^4.17.0')).toBe(true);
        expect(validate('react@^18.0.0')).toBe(true);
        expect(validate('better-auth@^1.0.0')).toBe(true);
      });

      it('should accept tilde version ranges', function tildeVersion() {
        expect(validate('lodash@~4.17.0')).toBe(true);
        expect(validate('express@~4.18.0')).toBe(true);
      });

      it('should accept version tags', function versionTags() {
        expect(validate('lodash@latest')).toBe(true);
        expect(validate('react@next')).toBe(true);
        expect(validate('typescript@beta')).toBe(true);
      });

      it('should accept scoped packages with versions', function scopedWithVersion() {
        expect(validate('@types/node@20.0.0')).toBe(true);
        expect(validate('@tanstack/react-query@^5.0.0')).toBe(true);
        expect(validate('@godaddy/terminus@4.12.1')).toBe(true);
      });

      it('should accept prerelease versions', function prerelease() {
        expect(validate('react@19.0.0-rc.0')).toBe(true);
        expect(validate('typescript@5.0.0-beta')).toBe(true);
      });

      it('should accept range operators', function rangeOperators() {
        expect(validate('lodash@>=4.0.0')).toBe(true);
        expect(validate('express@>4.0.0')).toBe(true);
        expect(validate('react@<=18.0.0')).toBe(true);
      });
    });

    describe('invalid package names', function invalidNames() {
      it('should reject directory traversal attempts', function traversal() {
        expect(validate('../malicious')).toBe(false);
        expect(validate('../../etc/passwd')).toBe(false);
        expect(validate('package/../../../etc')).toBe(false);
      });

      it('should reject packages with spaces', function spaces() {
        expect(validate('invalid package')).toBe(false);
        expect(validate(' lodash')).toBe(false);
        expect(validate('lodash ')).toBe(false);
      });

      it('should reject packages with uppercase', function uppercase() {
        expect(validate('Lodash')).toBe(false);
        expect(validate('REACT')).toBe(false);
        expect(validate('Better-Auth')).toBe(false);
      });

      it('should reject packages starting with dots', function dotPrefix() {
        expect(validate('.hidden')).toBe(false);
        expect(validate('..parent')).toBe(false);
      });

      it('should reject shell injection attempts', function shellInjection() {
        expect(validate('lodash; rm -rf /')).toBe(false);
        expect(validate('lodash && cat /etc/passwd')).toBe(false);
        expect(validate('lodash | echo pwned')).toBe(false);
        expect(validate('$(malicious)')).toBe(false);
        expect(validate('`malicious`')).toBe(false);
      });

      it('should reject empty strings', function empty() {
        expect(validate('')).toBe(false);
      });

      it('should reject packages with special characters', function specialChars() {
        expect(validate('package!')).toBe(false);
        expect(validate('package#name')).toBe(false);
        expect(validate('package$var')).toBe(false);
        expect(validate('package%20name')).toBe(false);
      });
    });
  });

  describe('#parseSkillDependencies', function parseTests() {
    let tool: SkillLoaderTool;
    let tempDir: string;
    let skillsDir: string;

    beforeEach(async () => {
      tool = new SkillLoaderTool();
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      skillsDir = path.join(tempDir, 'skills');
      await fs.mkdir(skillsDir, { recursive: true });

      // Override the skills directory for testing
      (tool as any).skillsDir = skillsDir;
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    // Access private method for testing
    async function parse(skillName: string): Promise<string[]> {
      return (tool as any).parseSkillDependencies(skillName);
    }

    async function createSkillFile(skillName: string, content: string): Promise<void> {
      const skillDir = path.join(skillsDir, skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'skill.md'), content);
    }

    it('should parse simple dependencies', async function parseSimple() {
      await createSkillFile('test-skill', `---
name: test-skill
description: A test skill
dependencies:
  - lodash
  - express
---
# Test Skill
`);

      const deps = await parse('test-skill');
      expect(deps).toEqual(['lodash', 'express']);
    });

    it('should parse versioned dependencies', async function parseVersioned() {
      await createSkillFile('versioned-skill', `---
name: versioned-skill
description: Skill with pinned versions
dependencies:
  - better-auth@1.2.3
  - lodash@^4.17.0
  - express@~4.18.0
---
# Versioned Skill
`);

      const deps = await parse('versioned-skill');
      expect(deps).toEqual(['better-auth@1.2.3', 'lodash@^4.17.0', 'express@~4.18.0']);
    });

    it('should parse scoped dependencies with versions', async function parseScoped() {
      await createSkillFile('scoped-skill', `---
name: scoped-skill
description: Skill with scoped packages
dependencies:
  - "@types/node@20.0.0"
  - "@tanstack/react-query@^5.0.0"
---
# Scoped Skill
`);

      const deps = await parse('scoped-skill');
      expect(deps).toEqual(['@types/node@20.0.0', '@tanstack/react-query@^5.0.0']);
    });

    it('should filter out invalid package names', async function filterInvalid() {
      await createSkillFile('invalid-deps-skill', `---
name: invalid-deps-skill
description: Skill with some invalid deps
dependencies:
  - valid-package
  - "../malicious"
  - "lodash; rm -rf /"
  - express
---
# Mixed Skill
`);

      const deps = await parse('invalid-deps-skill');
      expect(deps).toEqual(['valid-package', 'express']);
    });

    it('should return empty array for skill without dependencies', async function noDeps() {
      await createSkillFile('no-deps-skill', `---
name: no-deps-skill
description: Skill without dependencies
---
# No Dependencies
`);

      const deps = await parse('no-deps-skill');
      expect(deps).toEqual([]);
    });

    it('should return empty array for missing skill', async function missingSkill() {
      const deps = await parse('nonexistent-skill');
      expect(deps).toEqual([]);
    });

    it('should handle non-string dependencies gracefully', async function nonStringDeps() {
      await createSkillFile('mixed-types-skill', `---
name: mixed-types-skill
description: Skill with mixed type deps
dependencies:
  - lodash
  - 123
  - true
  - express
---
# Mixed Types
`);

      const deps = await parse('mixed-types-skill');
      expect(deps).toEqual(['lodash', 'express']);
    });

    it('should parse dependencies with tags', async function parseTags() {
      await createSkillFile('tag-skill', `---
name: tag-skill
description: Skill with tag versions
dependencies:
  - react@latest
  - typescript@next
  - some-package@beta
---
# Tag Skill
`);

      const deps = await parse('tag-skill');
      expect(deps).toEqual(['react@latest', 'typescript@next', 'some-package@beta']);
    });
  });

  describe('#validateSkillName', function validateSkillTests() {
    let tool: SkillLoaderTool;

    beforeEach(() => {
      tool = new SkillLoaderTool();
    });

    // Access private method for testing
    function validate(skillName: string): boolean {
      return (tool as any).validateSkillName(skillName);
    }

    it('should accept valid skill names', function validSkills() {
      expect(validate('blog')).toBe(true);
      expect(validate('authentication')).toBe(true);
      expect(validate('social-posts')).toBe(true);
      expect(validate('e_commerce')).toBe(true);
      expect(validate('skill123')).toBe(true);
    });

    it('should reject directory traversal', function traversal() {
      expect(validate('../etc')).toBe(false);
      expect(validate('../../passwd')).toBe(false);
      expect(validate('skill/../etc')).toBe(false);
    });

    it('should reject absolute paths', function absolutePaths() {
      expect(validate('/etc/passwd')).toBe(false);
      expect(validate('/root/.ssh')).toBe(false);
    });

    it('should reject skills with spaces', function spaces() {
      expect(validate('my skill')).toBe(false);
      expect(validate(' skill')).toBe(false);
    });

    it('should reject skills with dots', function dots() {
      expect(validate('skill.name')).toBe(false);
      expect(validate('.hidden')).toBe(false);
    });
  });

  describe('#listSkills whenToUse', function listSkillsTests() {
    let tool: SkillLoaderTool;
    let tempDir: string;
    let skillsDir: string;

    beforeEach(async () => {
      tool = new SkillLoaderTool();
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-test-'));
      skillsDir = path.join(tempDir, 'skills');
      await fs.mkdir(skillsDir, { recursive: true });
      (tool as any).skillsDir = skillsDir;
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function createSkillFile(skillName: string, content: string): Promise<void> {
      const skillDir = path.join(skillsDir, skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'skill.md'), content);
    }

    it('should return whenToUse from frontmatter', async function returnsWhenToUse() {
      await createSkillFile('test-skill', `---
name: test-skill
description: A test skill
whenToUse: User wants to test things. Phrases like "run tests", "add tests".
---
# Test Skill
`);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills![0].whenToUse).toBe('User wants to test things. Phrases like "run tests", "add tests".');
    });

    it('should omit whenToUse when not in frontmatter', async function omitsWhenMissing() {
      await createSkillFile('no-when', `---
name: no-when
description: Skill without whenToUse
---
# No When
`);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills![0].whenToUse).toBeUndefined();
    });

    it('should ignore non-string whenToUse values', async function ignoresNonString() {
      await createSkillFile('bad-when', `---
name: bad-when
description: Skill with array whenToUse
whenToUse:
  - item1
  - item2
---
# Bad When
`);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills![0].whenToUse).toBeUndefined();
    });
  });

  describe('#buildSkillsPromptSection', function buildSectionTests() {
    it('should format skills with whenToUse', function formatsWithWhen() {
      const section = buildSkillsPromptSection([
        { name: 'blog', description: 'Install blog system', whenToUse: 'User wants a blog.' },
        { name: 'auth', description: 'Add authentication' },
      ]);

      expect(section).toContain('## Available Skills');
      expect(section).toContain('- **blog**: Install blog system *When to use:* User wants a blog.');
      expect(section).toContain('- **auth**: Add authentication');
      // No "When to use" for auth since it has no whenToUse
      expect(section).not.toContain('**auth**: Add authentication *When to use:*');
    });
  });
});
