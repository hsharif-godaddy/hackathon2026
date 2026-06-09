import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { SkillLoaderTool, buildSkillsPromptSection, escapeXml } from '../skill-loader-tool.js';

// Mock the terminal and dev supervisor dependencies.
// We capture every command issued so tests can assert on the exact
// `npm install` / `npm install --save-dev` invocations.
const capturedCommands: string[] = [];

vi.mock('../terminal.js', () => ({
  TerminalTool: vi.fn().mockImplementation(function () { return {
    executeCommand: vi.fn().mockImplementation(async function (_path: string, opts: { command: string }) {
      capturedCommands.push(opts.command);
      return { success: true, exitCode: 0 };
    })
  }; })
}));

const { DevSupervisorError: MockDevSupervisorError } = vi.hoisted(() => {
  class DevSupervisorError extends Error {
    constructor(public readonly code: string, public readonly statusCode: number, message: string) {
      super(message);
      this.name = 'DevSupervisorError';
    }
  }
  return { DevSupervisorError };
});

vi.mock('../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: MockDevSupervisorError,
}));

vi.mock('../../workspace/index.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path');
  return {
    createForWorkspace: (_appId: string) => {
      const basePath = (globalThis as Record<string, unknown>).__skillLoaderTestAppDir as string | undefined;
      if (!basePath) return null;
      const files = {
        view: async ({ path: filePath }: { path: string }) => {
          const full = nodePath.join(basePath, filePath);
          if (!nodeFs.existsSync(full)) {
            throw new MockDevSupervisorError('not_found', 404, `${filePath}: no such file or directory`);
          }
          const content = nodeFs.readFileSync(full, 'utf-8');
          return { content, encoding: 'utf-8', path: filePath, lines: content.split('\n').length, size: content.length, truncated: false };
        },
        write: async ({ path: filePath, content }: { path: string; content: string }) => {
          const full = nodePath.join(basePath, filePath);
          nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
          nodeFs.writeFileSync(full, content);
          return { bytesWritten: content.length };
        },
        tree: async ({ path: treePath, recursive }: { path?: string; recursive?: boolean } = {}) => {
          const base = nodePath.join(basePath, treePath ?? '');
          const entries: Array<{ path: string; kind: string; size: number; modifiedAt: string }> = [];
          function walk(dir: string): void {
            let names: string[];
            try { names = nodeFs.readdirSync(dir); } catch { return; }
            for (const name of names) {
              const full = nodePath.join(dir, name);
              const stat = nodeFs.statSync(full);
              const rel = nodePath.relative(basePath, full);
              if (stat.isDirectory()) {
                entries.push({ path: rel, kind: 'directory', size: 0, modifiedAt: '' });
                if (recursive) walk(full);
              } else {
                entries.push({ path: rel, kind: 'file', size: stat.size, modifiedAt: '' });
              }
            }
          }
          walk(base);
          return { entries, truncated: false };
        },
      };
      return { files, tasks: undefined };
    },
  };
});

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

  describe('#parseSkillPackageList (dependencies)', function parseTests() {
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
      return (tool as any).parseSkillPackageList(skillName, 'dependencies');
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

  describe('#parseSkillPackageList (devDependencies)', function parseDevTests() {
    let tool: SkillLoaderTool;
    let tempDir: string;
    let skillsDir: string;

    beforeEach(async () => {
      tool = new SkillLoaderTool();
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-dev-test-'));
      skillsDir = path.join(tempDir, 'skills');
      await fs.mkdir(skillsDir, { recursive: true });
      (tool as any).skillsDir = skillsDir;
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function parseDev(skillName: string): Promise<string[]> {
      return (tool as any).parseSkillPackageList(skillName, 'devDependencies');
    }

    async function createSkillFile(skillName: string, content: string): Promise<void> {
      const skillDir = path.join(skillsDir, skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'skill.md'), content);
    }

    it('should parse devDependencies separately from dependencies', async function separateLists() {
      await createSkillFile('email-like', `---
name: email-like
description: Skill that needs runtime deps and type-only devDeps
dependencies:
  - nodemailer
devDependencies:
  - "@types/nodemailer"
---
# Email-like
`);

      const deps = await (tool as any).parseSkillPackageList('email-like', 'dependencies');
      const devDeps = await parseDev('email-like');
      expect(deps).toEqual(['nodemailer']);
      expect(devDeps).toEqual(['@types/nodemailer']);
    });

    it('should return empty list when only dependencies are declared', async function noDevDeps() {
      await createSkillFile('prod-only', `---
name: prod-only
description: Runtime deps only
dependencies:
  - lodash
---
# Prod Only
`);

      expect(await parseDev('prod-only')).toEqual([]);
    });

    it('should validate package names just like prod dependencies', async function validateDevNames() {
      await createSkillFile('bad-dev-deps', `---
name: bad-dev-deps
description: Skill with malicious dev deps
devDependencies:
  - "@types/node"
  - "../malicious"
  - "lodash; rm -rf /"
---
# Bad Dev Deps
`);

      expect(await parseDev('bad-dev-deps')).toEqual(['@types/node']);
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

  describe('#installTemplates', function installTemplatesTests() {
    let tool: SkillLoaderTool;
    let tempDir: string;
    let skillsDir: string;
    let appDir: string;

    beforeEach(async () => {
      tool = new SkillLoaderTool();
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-install-test-'));
      skillsDir = path.join(tempDir, 'skills');
      appDir = path.join(tempDir, 'app');
      (globalThis as Record<string, unknown>).__skillLoaderTestAppDir = appDir;
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.mkdir(path.join(appDir, 'src/server/api/health'), { recursive: true });
      (tool as any).skillsDir = skillsDir;

      await fs.writeFile(
        path.join(appDir, 'src/server/entry.ts'),
        `import express from "express";
import healthGet from "./api/health/GET";

const app = express();
app.get("/api/health", healthGet);
export default app;
`,
        'utf8',
      );
      await fs.writeFile(
        path.join(appDir, 'src/server/api/health/GET.ts'),
        'export default function healthGet() {}\n',
        'utf8',
      );
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function createSkillWithTemplate(skillName: string, templatePath: string, content: string): Promise<void> {
      const skillDir = path.join(skillsDir, skillName);
      await fs.mkdir(path.join(skillDir, 'templates', path.dirname(templatePath)), { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'skill.md'),
        `---
name: ${skillName}
description: Test skill
---
# Test Skill
`,
        'utf8',
      );
      await fs.writeFile(path.join(skillDir, 'templates', templatePath), content, 'utf8');
    }

    it('regenerates entry.ts when a skill installs a root-level API route', async function rootApiRoute() {
      await createSkillWithTemplate(
        'root-api',
        'server/api/GET.ts',
        'export default function rootGet() {}\n',
      );

      const result = await tool.installTemplates({
        skill: 'root-api',
        appPath: appDir,
        appId: 'test-app',
      });

      expect(result.success).toBe(true);
      const entry = await fs.readFile(path.join(appDir, 'src/server/entry.ts'), 'utf8');
      expect(entry).toContain('import get_0 from "./api/GET";');
      expect(entry).toContain('import health_get_1 from "./api/health/GET";');
      expect(entry).toContain('app.get("/api", get_0);');
      expect(entry).toContain('app.get("/api/health", health_get_1);');
    });

    it('runs npm install and npm install --save-dev for the two frontmatter groups', async function devDepsInstall() {
      const skillDir = path.join(skillsDir, 'with-types');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'skill.md'),
        `---
name: with-types
description: Skill that needs runtime + type-only deps
dependencies:
  - nodemailer
devDependencies:
  - "@types/nodemailer"
---
# With Types
`,
        'utf8',
      );

      capturedCommands.length = 0;

      const result = await tool.installTemplates({
        skill: 'with-types',
        appPath: appDir,
        appId: 'test-app',
      });

      expect(result.success).toBe(true);
      expect(capturedCommands).toContain('npm install nodemailer');
      expect(capturedCommands).toContain('npm install --save-dev @types/nodemailer');

      expect(result.dependenciesInstalled).toEqual([
        expect.objectContaining({ package: 'nodemailer', success: true }),
      ]);
      expect(result.devDependenciesInstalled).toEqual([
        expect.objectContaining({ package: '@types/nodemailer', success: true }),
      ]);
      expect(result.dependenciesFailed).toBeUndefined();
      expect(result.devDependenciesFailed).toBeUndefined();
    });
  });

  describe('#listSkills frontmatter parsing', function listSkillsTests() {
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

    it('should parse intents array from frontmatter', async function parsesIntents() {
      await createSkillFile('with-intents', `---
name: with-intents
description: Has intent phrases
intents:
  - sell stuff/run a store
  - manage products
---
# With Intents
`);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      const skill = result.skills!.find(s => s.name === 'with-intents');
      expect(skill).toBeDefined();
      expect(skill!.intents).toEqual(['sell stuff/run a store', 'manage products']);
    });

    it('should leave intents undefined when frontmatter omits the field', async function omitsIntents() {
      await createSkillFile('no-intents', `---
name: no-intents
description: No intents
---
# No Intents
`);

      const result = await tool.listSkills();
      const skill = result.skills!.find(s => s.name === 'no-intents');
      expect(skill!.intents).toBeUndefined();
    });

    it('should drop non-string entries from intents', async function filtersBadIntents() {
      await createSkillFile('bad-intents', `---
name: bad-intents
description: Bad intent shape
intents:
  - good phrase
  - 42
  - null
---
# Bad Intents
`);

      const result = await tool.listSkills();
      const skill = result.skills!.find(s => s.name === 'bad-intents');
      expect(skill!.intents).toEqual(['good phrase']);
    });
  });

  describe('#buildSkillsPromptSection', function buildSectionTests() {
    it('should combine description and whenToUse into single description', function formatsWithWhen() {
      const section = buildSkillsPromptSection([
        { name: 'blog', description: 'Install blog system', whenToUse: 'User wants a blog.' },
        { name: 'auth', description: 'Add authentication' },
      ]);

      expect(section).toContain('## Available Skills');
      expect(section).toContain('<available_skills>');
      expect(section).toContain('<skill name="blog">');
      expect(section).toContain('<description>Install blog system Use this when: User wants a blog.</description>');
      expect(section).toContain('<skill name="auth">');
      expect(section).toContain('<description>Add authentication</description>');
      expect(section).not.toContain('<when_to_use>');
    });

    it('should build intent map in instructions without duplicating in description', function intentsInMap() {
      const section = buildSkillsPromptSection([
        { name: 'commerce', description: 'Commerce', intents: ['online store/sell products', 'set up store'] },
        { name: 'authentication', description: 'Auth', intents: ['login/signup'] },
        { name: 'no-intents', description: 'Not in map' },
      ]);

      expect(section).toContain('<skill name="commerce">');
      expect(section).toContain('<description>Commerce</description>');
      expect(section).toContain('<skill name="authentication">');
      expect(section).toContain('<description>Auth</description>');
      expect(section).toContain('<description>Not in map</description>');
      expect(section).not.toContain('Intents:');
      expect(section).toContain('Quick intent map:');
      expect(section).toContain('online store/sell products → commerce');
      expect(section).toContain('set up store → commerce');
      expect(section).toContain('login/signup → authentication');
      expect(section).not.toContain('→ no-intents');
    });

    it('should render plain description and omit intent_map when no intents', function noExtras() {
      const section = buildSkillsPromptSection([
        { name: 'plain', description: 'No intents here' },
      ]);

      expect(section).not.toContain('<intents>');
      expect(section).not.toContain('<when_to_use>');
      expect(section).not.toContain('Quick intent map:');
      expect(section).toContain('<skill name="plain">');
      expect(section).toContain('<description>No intents here</description>');
    });

    it('should produce valid structure with empty skills array', function emptySkills() {
      const section = buildSkillsPromptSection([]);

      expect(section).toContain('## Available Skills');
      expect(section).toContain('<available_skills>');
      expect(section).toContain('</available_skills>');
      expect(section).toContain('IMPORTANT');
      expect(section).toContain('CONFIDENTIALITY');
      expect(section).not.toContain('Quick intent map:');
      expect(section).not.toContain('</skill>');
    });

    it('should handle skill with both whenToUse and intents without duplication', function bothFields() {
      const section = buildSkillsPromptSection([
        {
          name: 'commerce',
          description: 'E-commerce integration',
          whenToUse: 'User wants to sell products online.',
          intents: ['online store', 'sell products'],
        },
      ]);

      expect(section).toContain('<description>E-commerce integration Use this when: User wants to sell products online.</description>');
      expect(section).not.toContain('Intents:');
      expect(section).toContain('**Quick intent map:** online store → commerce | sell products → commerce');
    });

    it('should include confidentiality block in output', function confidentiality() {
      const section = buildSkillsPromptSection([
        { name: 'test', description: 'Test skill' },
      ]);

      expect(section).toContain('CONFIDENTIALITY');
      expect(section).toContain('internal implementation details');
      expect(section).toContain('never mention skill names');
    });

    it('should place intent map before XML block with pipe separators', function intentMapStructure() {
      const section = buildSkillsPromptSection([
        { name: 'a', description: 'Skill A', intents: ['phrase-one'] },
        { name: 'b', description: 'Skill B', intents: ['phrase-two', 'phrase-three'] },
      ]);

      expect(section).toContain('**Quick intent map:** phrase-one → a | phrase-two → b | phrase-three → b');
      const xmlStart = section.indexOf('<available_skills>');
      const mapPos = section.indexOf('Quick intent map:');
      expect(mapPos).toBeLessThan(xmlStart);
    });

    it('should escape XML special characters in skill metadata', function escapesXml() {
      const section = buildSkillsPromptSection([
        {
          name: 'q&a',
          description: 'Handles Q&A with <custom> tags',
          whenToUse: 'User asks "questions" or uses </description> injection',
        },
        {
          name: 'multiline',
          description: 'Line one\nLine two\r\nLine three',
        },
      ]);

      expect(section).toContain('<skill name="q&amp;a">');
      expect(section).toContain('Handles Q&amp;A with &lt;custom&gt; tags');
      expect(section).toContain('User asks &quot;questions&quot; or uses &lt;/description&gt; injection');
      expect(section).not.toContain('</description> injection</description>');
      expect(section).toContain('Line one Line two Line three');

      const descMatches = section.match(/<description>[^<]*<\/description>/g);
      expect(descMatches).not.toBeNull();
      for (const match of descMatches!) {
        expect(match).not.toContain('\n');
      }
    });

    it('should preserve representative phrases from real on-disk skills', async function realSkillsGuardrail() {
      // Drift guardrail: if someone deletes/truncates an `intents` entry in
      // a real skill.md, this test fails. Phrases below are the canonical
      // anchors moved from the previous hardcoded intentRoutes array.
      const realTool = new SkillLoaderTool();
      const result = await realTool.listSkills();
      expect(result.success).toBe(true);
      const section = buildSkillsPromptSection(result.skills!);

      const phrases = [
        'online store', 'sell products', 'catalog data',
        'product catalog UI',
        'buy now', 'one-time payment',
        'members-only',
        'appointments',
        'set up blog',
        'write blog post',
        'multi-language',
        'store locator', 'directions',
        'transactional email',
        'CRUD',
        'AI chatbot',
        'buy domain', 'want domain', 'purchase domain',
        'search rankings', 'meta tags',
        // Payment router intents (replaces old stripe + commerce-one-time-payment intents)
        'accept payments', 'charge customers',
        'Stripe / Stripe checkout / Stripe payments',
        // Routing-time ordering hints for commerce sub-skills. Without
        // these the LLM may build storefront / one-time-payment UI before
        // Commerce MCP has verified/setup store data, producing UI wired to
        // an unconfigured store.
        'storefront UI/shop page/product detail page/PDP',
        'build/update shop page/product catalog/product grid/load products from API',
        'product detail page/product page/PDP/product route',
      ];
      for (const phrase of phrases) {
        expect(section).toContain(phrase);
      }

      // Each routed skill must have its own <skill name="..."> tag
      const routedSkills = [
        'commerce', 'commerce-storefront',
        'authentication', 'online-appointments', 'blog',
        'blog-writing', 'i18n', 'google-maps', 'email',
        'database', 'ai-agent', 'payment', 'custom-domain',
        'seo',
      ];
      for (const skill of routedSkills) {
        expect(section).toContain(`<skill name="${skill}">`);
      }

      // The intent map must contain → entries for every routed skill
      expect(section).toContain('Quick intent map:');
      for (const skill of routedSkills) {
        expect(section).toContain(`→ ${skill}`);
      }

      // Every skill with a description must have a non-empty <description>
      for (const s of result.skills!.filter(sk => sk.description)) {
        expect(section).toContain(`<skill name="${s.name}">`);
        expect(section).not.toMatch(new RegExp(`<skill name="${s.name}">\\s*<description></description>`));
      }

      // Skills with whenToUse must have escaped version merged into <description>
      const skillsWithWhenToUse = result.skills!.filter(s => s.whenToUse);
      for (const s of skillsWithWhenToUse) {
        expect(section).toContain(escapeXml(s.whenToUse!));
      }
    });

    it('should expose the develop-prompt guardrail paragraph in the source', function guardrailPresentInCoreMd() {
      // The guardrail paragraph in develop/core.md is the behavioral core
      // that prevents strict-follower LLMs from loading skills during the
      // initial design-preview phase. It lives in a markdown file with no
      // runtime reference to keep it in sync. A silent deletion or
      // truncation would go undetected until an LLM builds a full multi-
      // skill site (commerce + auth + database etc.) during what should
      // be a visual-only preview. This fixture guarantees the paragraph's
      // defining phrase, both concrete trigger variants, and every backend
      // skill named in the exclusion clause survive edits.
      const coreMdPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'prompts',
        'develop',
        'core.md'
      );
      const coreMd = readFileSync(coreMdPath, 'utf-8');

      expect(coreMd).toContain('**Initial design preview is visual-only:**');
      expect(coreMd).toContain('INITIAL SCOPE:');
      expect(coreMd).toContain('Build ONLY the homepage design for this preview');
      expect(coreMd).toContain('Build ONLY the main app view for this preview');

      // Visual/asset skills are the explicit exceptions to the "no skills"
      // rule. This assertion anchors the permissive clause and verifies
      // those three skills are in the allow-list, not the exclusion list.
      expect(coreMd).toContain(
        'Visual/asset skills (media-logo, media-image, media-video) remain usable'
      );

      // Cross-reference paragraph at the "Initial Build from Handoff"
      // section (~300 lines later) reinforces the guardrail at the
      // moment the agent is mid-build and most likely to attempt a
      // skill load. Silent deletion of the reinforcement would leave
      // the main guardrail correct but the build-workflow unguarded.
      expect(coreMd).toContain('**Skill loading during this workflow:**');

      // The exclusion clause enumerates every backend-integration skill
      // that MUST NOT load during the initial design-preview phase.
      // Silent truncation of any entry below would let that skill slip
      // through during homepage construction.
      //
      // Each fragment includes its terminator (comma for mid-list, period
      // for the final entry) so prefix-ambiguous names remain distinct:
      // "commerce," doesn't match "commerce-storefront," and "blog,"
      // doesn't match "blog-writing,". Match the actual ordering and
      // terminator in the core.md sentence.
      const excludedBackendSkillFragments = [
        'commerce,',
        'commerce-storefront,',
        'payment,',
        'authentication,',
        'database,',
        'email,',
        'online-appointments,',
        'blog,',
        'blog-writing,',
        'i18n,',
        'google-maps,',
        'ai-agent.',
      ];
      for (const fragment of excludedBackendSkillFragments) {
        expect(coreMd).toContain(fragment);
      }
    });
  });

  describe('#listSkills and #loadSkill - profile-gated enablement', function profileGatedTests() {
    let tool: SkillLoaderTool;
    let tempDir: string;
    let skillsDir: string;

    beforeEach(async () => {
      tool = new SkillLoaderTool();
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-profile-test-'));
      skillsDir = path.join(tempDir, 'skills');
      await fs.mkdir(skillsDir, { recursive: true });
      (tool as any).skillsDir = skillsDir;
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    async function createSkillFile(skillName: string, content: string): Promise<void> {
      const skillDir = path.join(skillsDir, skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'skill.md'), content);
    }

    it('listSkills excludes a profile-gated skill when disabled', async function listExcludes() {
      await createSkillFile('gated-skill', `---
name: gated-skill
description: A gated skill
enablementId: my-gated
---
# Gated Skill
`);

      // Mock skills.isEnabled to return false for 'my-gated'
      const featuresModule = await import('../../services/features.js');
      vi.spyOn(featuresModule.skills, 'isEnabled').mockReturnValue(false);
      vi.spyOn(featuresModule.skills, 'isProfileGated').mockReturnValue(true);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(0);
    });

    it('listSkills includes a profile-gated skill when enabled', async function listIncludes() {
      await createSkillFile('gated-skill', `---
name: gated-skill
description: A gated skill
enablementId: my-gated
---
# Gated Skill
`);

      const featuresModule = await import('../../services/features.js');
      vi.spyOn(featuresModule.skills, 'isEnabled').mockReturnValue(true);
      vi.spyOn(featuresModule.skills, 'isProfileGated').mockReturnValue(true);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills![0].name).toBe('gated-skill');
    });

    it('loadSkill rejects a disabled skill', async function loadRejects() {
      await createSkillFile('disabled-skill', `---
name: disabled-skill
description: A disabled skill
enablementId: my-disabled
---
# Disabled Skill
`);

      const featuresModule = await import('../../services/features.js');
      vi.spyOn(featuresModule.skills, 'isEnabled').mockReturnValue(false);

      const result = await tool.loadSkill({ skill: 'disabled-skill' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('loadSkill allows a skill without enablementId', async function loadAllowsNoId() {
      await createSkillFile('open-skill', `---
name: open-skill
description: An ungated skill
---
# Open Skill
`);

      const result = await tool.loadSkill({ skill: 'open-skill' });
      expect(result.success).toBe(true);
      expect(result.instructions).toContain('# Open Skill');
    });

    it('loadSkill allows an enabled skill', async function loadAllowsEnabled() {
      await createSkillFile('enabled-skill', `---
name: enabled-skill
description: An enabled skill
enablementId: my-enabled
---
# Enabled Skill
`);

      const featuresModule = await import('../../services/features.js');
      vi.spyOn(featuresModule.skills, 'isEnabled').mockReturnValue(true);

      const result = await tool.loadSkill({ skill: 'enabled-skill' });
      expect(result.success).toBe(true);
      expect(result.instructions).toContain('# Enabled Skill');
    });
  });

  describe('skill frontmatter parsing regression', function frontmatterRegression() {
    it('every shipped skill.md should have a parseable name and description', async function allSkillsParse() {
      const matter = await import('gray-matter');
      const skillsDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../skills'
      );
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

      const failures: string[] = [];
      for (const skillName of skillDirs) {
        const skillMdPath = path.join(skillsDir, skillName, 'skill.md');
        let content: string;
        try {
          content = await fs.readFile(skillMdPath, 'utf-8');
        } catch {
          continue;
        }
        try {
          const { data } = matter.default(content);
          if (!data.name) failures.push(`${skillName}/skill.md: missing 'name'`);
          if (!data.description) failures.push(`${skillName}/skill.md: missing 'description'`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${skillName}/skill.md: YAML parse error - ${msg}`);
        }
      }
      expect(failures, `Skill frontmatter failures:\n${failures.join('\n')}`).toHaveLength(0);
    });
  });

  describe('#listSkills and #loadSkill - market gating', function marketGatingTests() {
    let tool: SkillLoaderTool;
    let tempDir: string;
    let skillsDir: string;

    beforeEach(async () => {
      tool = new SkillLoaderTool();
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-market-test-'));
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

    it('listSkills includes a market-restricted skill when market matches', async function listIncludesMatch() {
      await createSkillFile('us-only', `---
name: us-only
description: US only skill
markets:
  - en-US
---
# US Only
`);

      const result = await tool.listSkills({ market: 'en-US' });
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills![0].name).toBe('us-only');
    });

    it('listSkills excludes a market-restricted skill when market does not match', async function listExcludesNoMatch() {
      await createSkillFile('us-only', `---
name: us-only
description: US only skill
markets:
  - en-US
---
# US Only
`);

      const result = await tool.listSkills({ market: 'de-DE' });
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(0);
    });

    it('listSkills excludes a market-restricted skill when market is absent', async function listExcludesNoMarket() {
      await createSkillFile('us-only', `---
name: us-only
description: US only skill
markets:
  - en-US
---
# US Only
`);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(0);
    });

    it('listSkills includes an unrestricted skill regardless of market', async function listIncludesUnrestricted() {
      await createSkillFile('open-skill', `---
name: open-skill
description: Unrestricted skill
---
# Open Skill
`);

      const result = await tool.listSkills({ market: 'de-DE' });
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
      expect(result.skills![0].name).toBe('open-skill');
    });

    it('listSkills includes an unrestricted skill when market is absent', async function listIncludesUnrestrictedNoMarket() {
      await createSkillFile('open-skill', `---
name: open-skill
description: Unrestricted skill
---
# Open Skill
`);

      const result = await tool.listSkills();
      expect(result.success).toBe(true);
      expect(result.skills).toHaveLength(1);
    });

    it('loadSkill succeeds when market matches restriction', async function loadSucceedsMatch() {
      await createSkillFile('us-only', `---
name: us-only
description: US only skill
markets:
  - en-US
---
# US Only
`);

      const result = await tool.loadSkill({ skill: 'us-only', market: 'en-US' });
      expect(result.success).toBe(true);
      expect(result.instructions).toContain('# US Only');
    });

    it('loadSkill fails when market does not match restriction', async function loadFailsNoMatch() {
      await createSkillFile('us-only', `---
name: us-only
description: US only skill
markets:
  - en-US
---
# US Only
`);

      const result = await tool.loadSkill({ skill: 'us-only', market: 'de-DE' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available in your market');
    });

    it('loadSkill fails when no market is provided for a restricted skill', async function loadFailsNoMarket() {
      await createSkillFile('us-only', `---
name: us-only
description: US only skill
markets:
  - en-US
---
# US Only
`);

      const result = await tool.loadSkill({ skill: 'us-only' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available in your market');
    });

    it('loadSkill succeeds for an unrestricted skill with no market argument', async function loadUnrestrictedNoMarket() {
      await createSkillFile('open-skill', `---
name: open-skill
description: Unrestricted skill
---
# Open Skill
`);

      const result = await tool.loadSkill({ skill: 'open-skill' });
      expect(result.success).toBe(true);
    });
  });

  // #getDistinctMarkets was removed — market filtering happens per-turn via
  // AgentContextPipeline calling listSkills({ market }), so the startup-time
  // distinct-markets scan is no longer needed.
});
