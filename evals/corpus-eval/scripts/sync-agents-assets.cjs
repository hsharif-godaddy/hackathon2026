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

const { cpSync, existsSync, lstatSync, mkdirSync, readdirSync } = require('fs');
const { join, dirname, relative } = require('path');

const agentsSrc = join(__dirname, '../../../agents/src');
const agentsDist = join(__dirname, '../../../agents/dist');

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

const skillsSrc = join(agentsSrc, 'skills');
const skillsDist = join(agentsDist, 'skills');

if (!existsSync(skillsSrc)) {
  console.error(`ERROR: agents/src/skills not found at ${skillsSrc}`);
  process.exit(1);
}

/**
 * Recursively find skill.md under skillsSrc. Uses lstat so symlinks are never followed.
 */
function findSkillMdFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const info = lstatSync(fullPath);
    if (info.isSymbolicLink()) {
      continue;
    }
    if (info.isDirectory()) {
      findSkillMdFiles(fullPath, found);
      continue;
    }
    if (info.isFile() && name === 'skill.md') {
      found.push(fullPath);
    }
  }
  return found;
}

let copied = 0;
for (const srcMd of findSkillMdFiles(skillsSrc)) {
  const rel = relative(skillsSrc, srcMd);
  const destMd = join(skillsDist, rel);
  ensureDir(dirname(destMd));
  cpSync(srcMd, destMd);
  copied++;
}

console.log(`✓ Copied ${copied} skill.md file(s) → agents/dist/skills/`);
console.log('Assets synced. Ready to run skill-loader eval.');
