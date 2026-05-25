#!/usr/bin/env node

/**
 * Pre-commit validator for agents/src/skills/ changes.
 *
 * Checks every skill directory touched by the staged commit:
 *
 * 1. skill.md required (HARD FAIL):
 *    Any staged file under agents/src/skills/<name>/ requires a skill.md
 *    to exist (either staged or already committed). Without it the skill
 *    is invisible to skill({ action: "list" }) and cannot be loaded.
 *
 * 2. Frontmatter fields required (HARD FAIL):
 *    skill.md must contain a YAML frontmatter block (--- ... ---) with
 *    non-empty `name:` and `description:` fields. Both are required for
 *    agent routing. Missing either causes the skill to fall back to the
 *    directory name and an empty description, making it invisible to the
 *    agent's intent-matching logic.
 *
 * 3. tools/index.ts required when tools/ is staged (HARD FAIL):
 *    If files under agents/src/skills/<name>/tools/ are staged,
 *    tools/index.ts must also be present. build-skill-tools.ts only
 *    imports from tools/index.ts — files in other paths are silently
 *    ignored.
 *
 * Exit codes:
 *   0 - passed (or skipped: no staged skill files)
 *   1 - validation failed
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const SKILLS_DIR = 'agents/src/skills';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// git exits 128 when the requested path/ref doesn't exist; any other
// non-zero exit is a real error that should NOT be silently swallowed.
const GIT_NOT_FOUND_EXIT = 128;

/**
 * Run git with positional args (no shell). Returns trimmed stdout.
 * Returns '' on exit 128 (ref/path not found). Throws on other errors.
 */
function git(...args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (err && err.status === GIT_NOT_FOUND_EXIT) return '';
    if (err && typeof err.message === 'string') {
      err.message = `git ${args.join(' ')}: ${err.message}`;
    }
    throw err;
  }
}

/**
 * Return the unique skill directory names from staged files under SKILLS_DIR.
 * e.g. "agents/src/skills/my-skill/skill.md" → "my-skill"
 */
function getStagedSkillDirs() {
  let output;
  try {
    output = execFileSync('git', ['diff', '--cached', '--name-only', '--', SKILLS_DIR], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(
      `${RED}[skill-check] Could not run git diff --cached: ${err.message}${RESET}`
    );
    console.error('  Validator skipped. If this is a GUI git client, ensure git is on PATH.');
    return null;
  }

  const skillNames = new Set();
  for (const file of output.split('\n').filter(Boolean)) {
    const relative = file.slice(SKILLS_DIR.length + 1); // strip "agents/src/skills/"
    if (!relative.includes('/')) continue; // top-level file (e.g. README.md), not a skill
    const skillName = relative.split('/')[0];
    if (skillName) skillNames.add(skillName);
  }
  return skillNames;
}

/**
 * Parse frontmatter from skill.md content using gray-matter.
 * Returns { kind: 'ok', data } on success, { kind: 'missing' } when no
 * frontmatter fence exists, or { kind: 'invalid', message } on parse error.
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { kind: 'missing' };
  try {
    return { kind: 'ok', data: matter(content).data };
  } catch (err) {
    return { kind: 'invalid', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Strip the version suffix from an npm spec to get the bare package name.
 * "lodash@^4.0.0" → "lodash" ; "@scope/name@1.2" → "@scope/name" ; "lodash" → "lodash"
 */
function bareName(spec) {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/');
    if (slash === -1) return spec;
    const at = spec.slice(slash + 1).indexOf('@');
    return at === -1 ? spec : spec.slice(0, slash + 1 + at);
  }
  const at = spec.indexOf('@');
  return at === -1 ? spec : spec.slice(0, at);
}

/**
 * Extract string items from a parsed frontmatter array field.
 * Returns [] when the field is absent or not an array.
 */
function getStringList(data, field) {
  const value = data?.[field];
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string');
}

function main() {
  const skillDirs = getStagedSkillDirs();
  if (skillDirs === null) return 0; // git unavailable; warning already logged
  if (skillDirs.size === 0) return 0; // no skill files staged

  const failures = [];

  const CORPUS_DIR = 'evals/corpus-eval/corpora/skill-loader';

  for (const skillName of skillDirs) {
    const skillDir = join(REPO_ROOT, SKILLS_DIR, skillName);
    const skillMdPath = join(skillDir, 'skill.md');
    const toolsIndexPath = join(skillDir, 'tools', 'index.ts');

    // One git call covers all staged paths for this skill directory.
    const stagedFiles = new Set(
      git('diff', '--cached', '--name-only', '--', `${SKILLS_DIR}/${skillName}/`)
        .split('\n').filter(Boolean)
    );
    const skillMdRelPath = `${SKILLS_DIR}/${skillName}/skill.md`;
    const skillMdStaged = stagedFiles.has(skillMdRelPath);
    const stagedToolsFiles = [...stagedFiles].some(f => f.startsWith(`${SKILLS_DIR}/${skillName}/tools/`));

    // Skill is being deleted — nothing to validate, let the commit proceed.
    if (!existsSync(skillMdPath)) continue;

    // Check 1: skill.md must be staged or already committed (not just on disk).
    const skillMdInHead = git('ls-tree', 'HEAD', '--name-only', '--', skillMdRelPath);
    if (!skillMdStaged && !skillMdInHead) {
      failures.push({
        skill: skillName,
        error: 'skill.md exists on disk but is not staged — it will be missing from this commit',
        fix: `Run: git add agents/src/skills/${skillName}/skill.md`,
      });
      continue;
    }

    const content = readFileSync(skillMdPath, 'utf8');
    const parsed = parseFrontmatter(content);

    // Check 2: frontmatter block must exist with name + description + whenToUse
    if (parsed.kind === 'missing') {
      failures.push({
        skill: skillName,
        error: 'skill.md is missing YAML frontmatter (--- block)',
        fix: 'Add a frontmatter block at the top:\n    ---\n    name: your-skill\n    description: What this skill does.\n    ---',
      });
    } else if (parsed.kind === 'invalid') {
      failures.push({
        skill: skillName,
        error: `skill.md has invalid YAML frontmatter: ${parsed.message}`,
        fix: 'Fix the YAML syntax error in the frontmatter block.',
      });
    } else {
      const frontmatter = parsed.data;
      if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
        failures.push({
          skill: skillName,
          error: 'skill.md frontmatter is missing required field: name',
          fix: `Add  name: ${skillName}  to the frontmatter block.`,
        });
      }
      if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
        failures.push({
          skill: skillName,
          error: 'skill.md frontmatter is missing required field: description',
          fix: 'Add a one-sentence  description:  field to the frontmatter block.',
        });
      }
      if (typeof frontmatter.whenToUse !== 'string' || !frontmatter.whenToUse.trim()) {
        failures.push({
          skill: skillName,
          error: 'skill.md frontmatter is missing required field: whenToUse',
          fix: 'Add a one-sentence  whenToUse:  field to the frontmatter block.',
        });
      }

      // Check 4: no package may appear in both `dependencies` and `devDependencies`.
      // The skill loader installs each list with a separate `npm install` invocation —
      // dev runs second with `--save-dev`, so npm's last-write-wins quietly moves the
      // package to devDependencies and removes it from runtime. Authoring mistake;
      // catch it before review rather than as a silent runtime regression.
      const deps = getStringList(frontmatter, 'dependencies').map(bareName);
      const devDeps = getStringList(frontmatter, 'devDependencies').map(bareName);
      const overlap = deps.filter(d => devDeps.includes(d));
      if (overlap.length > 0) {
        failures.push({
          skill: skillName,
          error: `Package(s) listed in both dependencies and devDependencies: ${overlap.join(', ')}`,
          fix: 'Remove the duplicate(s) from one list. The dev install runs second, so npm would silently move the package to devDependencies and runtime imports would break.',
        });
      }
    }

    // Check 3: if tools/ has staged changes, tools/index.ts must exist
    if (stagedToolsFiles && !existsSync(toolsIndexPath)) {
      failures.push({
        skill: skillName,
        error: 'tools/ has staged changes but tools/index.ts is missing',
        fix: `Create agents/src/skills/${skillName}/tools/index.ts and export at least one SkillToolDefinition.`,
      });
    }

    // Warn (non-blocking) when skill.md is staged but no corpus eval YAML exists.
    if (skillMdStaged) {
      const corpusPath = join(REPO_ROOT, CORPUS_DIR, `${skillName}.yaml`);
      const corpusStagedFiles = git('diff', '--cached', '--name-only', '--', `${CORPUS_DIR}/${skillName}.yaml`);
      if (!existsSync(corpusPath) && !corpusStagedFiles) {
        console.warn(
          `\n${CYAN}[skill-check] Warning:${RESET} Skill ${BOLD}${skillName}${RESET} has no corpus eval file.`
        );
        console.warn(
          `  Consider adding ${CYAN}${CORPUS_DIR}/${skillName}.yaml${RESET} with positive/negative routing cases.`
        );
        console.warn(`  See ${CYAN}${CORPUS_DIR}/custom-domain.yaml${RESET} for an example.\n`);
      }
    }
  }

  if (failures.length === 0) return 0;

  console.error(`\n${RED}${BOLD}[skill-check] Skill validation failed${RESET}`);
  for (const { skill, error, fix } of failures) {
    console.error(`\n  ${BOLD}${skill}${RESET}: ${error}`);
    console.error(`    ${CYAN}Fix:${RESET} ${fix}`);
  }
  console.error(
    `\n  See ${CYAN}agents/src/skills/README.md${RESET} for the complete skill structure guide.`
  );
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`${RED}${BOLD}[skill-check] Validator crashed unexpectedly${RESET}`);
  console.error(`  ${err?.message ?? err}`);
  if (err?.stdout) {
    const s = err.stdout.toString().trim();
    if (s) console.error(`  git stdout: ${s}`);
  }
  if (err?.stderr) {
    const s = err.stderr.toString().trim();
    if (s) console.error(`  git stderr: ${s}`);
  }
  console.error('  Commit blocked. Check git availability and repo state.');
  process.exit(1);
}
