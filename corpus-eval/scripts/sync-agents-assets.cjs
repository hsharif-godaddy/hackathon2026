#!/usr/bin/env node
/**
 * Copies non-TypeScript assets from agents/src to agents/dist
 * so that the skill-loader evaluator can find prompt and skill.md files
 * without requiring a full agents build.
 *
 * Copies:
 *   agents/src/prompts/   → agents/dist/prompts/
 *   agents/src/skills/**\/skill.md → agents/dist/skills/**\/skill.md
 */

'use strict';

const { cpSync, existsSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');

const agentsSrc = join(__dirname, '../../agents/src');
const agentsDist = join(__dirname, '../../agents/dist');

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Copy entire prompts directory
const promptsSrc = join(agentsSrc, 'prompts');
const promptsDist = join(agentsDist, 'prompts');

if (!existsSync(promptsSrc)) {
  console.error(`ERROR: agents/src/prompts not found at ${promptsSrc}`);
  process.exit(1);
}

ensureDir(agentsDist);
cpSync(promptsSrc, promptsDist, { recursive: true });
console.log(`✓ Copied prompts → agents/dist/prompts`);

// Copy skill.md files from each skill subdirectory
const { readdirSync, lstatSync } = require('fs');
const skillsSrc = join(agentsSrc, 'skills');
const skillsDist = join(agentsDist, 'skills');

if (!existsSync(skillsSrc)) {
  console.error(`ERROR: agents/src/skills not found at ${skillsSrc}`);
  process.exit(1);
}

// lstatSync (not statSync) so symlinks are excluded — they report isDirectory()=false
// via lstat, preventing traversal outside the project root if a symlink exists in skills/.
const skillDirs = readdirSync(skillsSrc).filter(name => {
  return lstatSync(join(skillsSrc, name)).isDirectory();
});

let copied = 0;
for (const skill of skillDirs) {
  const srcMd = join(skillsSrc, skill, 'skill.md');
  if (!existsSync(srcMd)) continue;

  const destMd = join(skillsDist, skill, 'skill.md');
  ensureDir(dirname(destMd));
  cpSync(srcMd, destMd);
  copied++;
}

console.log(`✓ Copied skill.md for ${copied} skill(s) → agents/dist/skills/`);
console.log('Assets synced. Ready to run skill-loader eval.');
