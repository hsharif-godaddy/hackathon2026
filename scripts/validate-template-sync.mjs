#!/usr/bin/env node

/**
 * Pre-commit validator for app-templates/v8 changes.
 *
 * Four protections against the failure mode where a base-template change
 * (deletion or modification) silently breaks customer apps stuck on a
 * prior version of an unsynced file:
 *
 * 1. Hash-drift check (HARD FAIL):
 *    For files in app-templates/v8/ (excluding rsync-managed dirs such
 *    as dev-tools/, source-mapper/, airo-secrets/) that are
 *    tracked in container-scripts/preview/sync-template-files.js
 *    SYNC_MANIFEST and are being modified (status M) in this commit, the
 *    file's PREVIOUS content hash (the version on HEAD) must be present
 *    in `known_hashes` in the staged manifest. Without this, customer
 *    apps stuck on the prior version will silently skip the sync and end
 *    up out of date with the base template. Skipped for entries with
 *    `force: true`. Renames (R) are treated as additions (no hash check)
 *    because sync-template-files.js compares hashes at the same path —
 *    a rename leaves the customer's old-path file orphaned regardless,
 *    so manifest restructuring (not hash backfills) is what's needed.
 *
 * 2. Untracked-template-file guard (HARD FAIL):
 *    Modifications, additions, and deletions of files in app-templates/v8/
 *    (excluding rsync-managed dirs - see RSYNC_MANAGED_DIRS) that are
 *    NOT listed in SYNC_MANIFEST are blocked. Customer apps only receive
 *    updates for files explicitly
 *    tracked in the manifest, so any untracked change risks silent drift
 *    between the base template and in-flight customer apps. Override:
 *
 *        ALLOW_UNTRACKED_V8_CHANGE=1 git commit ...
 *
 *    when the file is intentionally not synced (e.g., container-only
 *    config like Dockerfile.dev, package-lock.json, or files baked in at
 *    image build time). Prefer adding the file to SYNC_MANIFEST when it
 *    needs to reach existing customer apps.
 *
 * 3. Tracked-file deletion guard (HARD FAIL):
 *    Deletions of v8 files that ARE in SYNC_MANIFEST are blocked.
 *    Removing the base-template file leaves customer apps that already
 *    received it permanently stuck with their copy (sync-template-files
 *    logs "Base template missing, skipping" and moves on). The manifest
 *    entry must be removed AND the file repurposed/stubbed in the same
 *    commit, with override:
 *
 *        ALLOW_UNTRACKED_V8_CHANGE=1 git commit ...
 *
 *    (same override as #2 — both represent "I know what I'm doing with
 *    customer drift").
 *
 * 4. Rsync-managed deletion guard (HARD FAIL):
 *    Deletions and renames inside any rsync-managed directory (dev-tools/,
 *    source-mapper/, airo-secrets/ - see RSYNC_MANAGED_DIRS) are blocked
 *    outright. Customer apps lag the base template on every dimension
 *    EXCEPT these rsync'd directories (rsync --delete'd on container
 *    start), so any deletion here can break customers whose vite.config.ts
 *    (or other files) still imports the removed module. Override with:
 *
 *        ALLOW_RSYNC_MANAGED_DELETE=1 git commit ...
 *
 *    when you've verified the import has been removed everywhere AND
 *    that no in-flight customer app references it (or you've left a
 *    no-op stub behind). Copies (C) are NOT blocked since they don't
 *    remove the original.
 *
 * Exit codes:
 *   0 - passed (or skipped: no relevant staged files)
 *   1 - validation failed
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const TEMPLATE_DIR = 'app-templates/v8/';
// Directories that are rsync'd wholesale into customer apps by
// container-scripts/preview/nomad_setup.sh. These are exempt from
// SYNC_MANIFEST enforcement because rsync --delete makes hash-gated
// sync redundant - the file is overwritten regardless.
// Keep in sync with the rsync list in nomad_setup.sh.
const RSYNC_MANAGED_DIRS = [
  'app-templates/v8/dev-tools/',
  'app-templates/v8/source-mapper/',
  'app-templates/v8/airo-secrets/',
];
// Prefix-match correctness in isRsyncManaged() depends on each entry
// ending with `/`. Without it, `startsWith('airo-secrets')` would also
// exempt a hypothetical `airo-secrets-utils/` sibling.
for (const d of RSYNC_MANAGED_DIRS) {
  if (!d.endsWith('/')) {
    throw new Error(`[template-sync] RSYNC_MANAGED_DIRS entry "${d}" must end with /`);
  }
}
const MANIFEST_PATH = 'container-scripts/preview/sync-template-files.js';

// git exits 128 when the requested path/ref doesn't exist; any other
// non-zero exit is a real error (git missing, repo corrupt, perms, etc.)
// that should NOT be silently swallowed.
const GIT_NOT_FOUND_EXIT = 128;

function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Run git with positional args (no shell). Returns stdout as a string.
 * Throws on errors that aren't "ref/path not found" (exit 128); for the
 * not-found case, returns null so callers can distinguish missing files
 * from real failures (perms, ENOENT for git binary, etc.).
 */
function gitShow(spec) {
  try {
    return execFileSync('git', ['show', spec], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    if (err && err.status === GIT_NOT_FOUND_EXIT) return null;
    // Re-throw with the spec prefixed so the top-level crash handler
    // can tell the developer which file/ref triggered the failure.
    if (err && typeof err.message === 'string') {
      err.message = `git show ${spec}: ${err.message}`;
    }
    throw err;
  }
}

/**
 * Read the staged (index) version of a file. Returns null if the file
 * is not in the index (e.g., staged for deletion or never tracked).
 */
function readStaged(file) {
  return gitShow(`:${file}`);
}

/**
 * Read the HEAD version of a file. Returns null if the file did not
 * exist on HEAD.
 */
function readHead(file) {
  return gitShow(`HEAD:${file}`);
}

/**
 * Get staged changes as [{ status, path, oldPath? }] entries.
 * status is one of A, M, D, R (rename), C (copy), T (type).
 *
 * Returns null on git failure (e.g., GUI client without git on PATH);
 * caller should treat null as "skip validation, log a warning".
 */
function getStagedChanges() {
  let output;
  try {
    output = execFileSync('git', ['diff', '--cached', '--name-status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    console.error(`${RED}[template-sync] Could not run git diff --cached: ${err.message}${RESET}`);
    console.error('  Validator skipped. If this is a GUI git client, ensure git is on PATH.');
    return null;
  }
  const changes = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('\t');
    const code = parts[0];
    const status = code[0];
    if (status === 'R' || status === 'C') {
      // Validate before pushing; downstream checks treat undefined paths
      // as "not in template" and would silently drop a v8 change.
      if (!parts[1] || !parts[2]) {
        console.warn(`${YELLOW}[template-sync] Warning: skipping unrecognized git output line: ${JSON.stringify(line)}${RESET}`);
        continue;
      }
      changes.push({ status, oldPath: parts[1], path: parts[2] });
    } else {
      if (!parts[1]) {
        console.warn(`${YELLOW}[template-sync] Warning: skipping unrecognized git output line: ${JSON.stringify(line)}${RESET}`);
        continue;
      }
      changes.push({ status, path: parts[1] });
    }
  }
  return changes;
}

/**
 * Parse SYNC_MANIFEST entries from the manifest file content.
 * Returns Map<file, { hashes: Set<string>, force: boolean }>.
 *
 * The manifest is a hand-maintained JS literal with a stable shape:
 * each entry has `file`, `known_hashes`, and `force` (in that order),
 * with optional `description` and `syncGroup`. We extract via regex
 * rather than importing because the consts are not exported and the
 * staged blob may live only in the index.
 *
 * NOTE: Hashes here are computed against utf8-decoded content to match
 * `sync-template-files.js` behavior exactly (which also uses utf8
 * reads). If a binary file is ever added to the manifest, BOTH this
 * validator and sync-template-files.js will need to switch to raw
 * Buffer reads to match `md5(1)` CLI output.
 */
function parseManifest(content) {
  const entries = new Map();
  // The closing `]` of `known_hashes` is anchored to `\s*,\s*force:` so a `]`
  // appearing inside a hash comment (e.g. `// landed in [#1234]`) does not
  // prematurely terminate the array capture — the non-greedy backtracking
  // continues past in-comment `]` chars until it finds a `]` that is
  // syntactically followed by the next field.
  const blockRe = /\{\s*file:\s*['"]([^'"]+)['"][\s\S]*?known_hashes:\s*\[([\s\S]*?)\]\s*,\s*force:\s*(true|false)/g;
  let match;
  while ((match = blockRe.exec(content)) !== null) {
    const file = match[1];
    const hashes = new Set(
      [...match[2].matchAll(/['"]([0-9a-f]{32})['"]/gi)].map((h) => h[1].toLowerCase())
    );
    const force = match[3] === 'true';
    entries.set(file, { hashes, force });
  }
  return entries;
}

/**
 * Sanity check: the regex above assumes a fixed field order. If the
 * manifest is reformatted or new entries use a different shape, some
 * entries may silently fail to parse. Compare against a count of
 * top-level `file:` keys and fail loudly on mismatch.
 */
function countFileKeys(content) {
  // Line-anchored to avoid false positives from descriptions/comments that
  // happen to contain the substring `file: "..."` (e.g.
  // `description: 'Writes the file: "x"'`). Paired with `!==` in the
  // partial-parse guard so a future single-line reformatting — which would
  // make blockRe over-count vs this — still trips loudly rather than
  // silently passing.
  const matches = content.match(/^\s*file:\s*['"]/gm);
  return matches ? matches.length : 0;
}

function isInTemplate(p) {
  return p && p.startsWith(TEMPLATE_DIR);
}

function isRsyncManaged(p) {
  return !!p && RSYNC_MANAGED_DIRS.some((d) => p.startsWith(d));
}

function templateRelative(p) {
  return p.slice(TEMPLATE_DIR.length);
}

/**
 * Load + sanity-check the staged SYNC_MANIFEST. Returns the parsed
 * entries Map on success, or null on any failure (after logging).
 *
 * The manifest must be read from the INDEX (not HEAD) so the validator
 * sees any new known_hashes the developer added in this commit. If the
 * manifest is being staged for deletion, that's a hard fail — the
 * validator depends on it.
 */
function loadManifest() {
  const stagedManifest = readStaged(MANIFEST_PATH);
  if (stagedManifest === null) {
    console.error(`${RED}${BOLD}[template-sync] Could not read staged ${MANIFEST_PATH}${RESET}`);
    console.error('  The manifest is missing from the index. If you intended to delete it,');
    console.error('  the validator depends on it for v8 template enforcement and cannot run.');
    console.error('  Restore the staged manifest, or remove the validator hook in the same commit.');
    return null;
  }
  const manifest = parseManifest(stagedManifest);
  const expected = countFileKeys(stagedManifest);
  if (manifest.size === 0) {
    console.error(`${RED}${BOLD}[template-sync] Failed to parse SYNC_MANIFEST in ${MANIFEST_PATH}${RESET}`);
    console.error('  Either the manifest is empty (unexpected) or its on-disk format has');
    console.error('  drifted from the regex used here. Update parseManifest() in');
    console.error('  scripts/validate-template-sync.mjs to match the new shape.');
    return null;
  }
  if (manifest.size !== expected) {
    console.error(`${RED}${BOLD}[template-sync] Partial parse of SYNC_MANIFEST in ${MANIFEST_PATH}${RESET}`);
    console.error(`  Found ${expected} 'file:' keys but parsed ${manifest.size} entries.`);
    console.error('  Some entries likely use a field order or formatting the regex does not');
    console.error('  recognize (expected: file → known_hashes → force). Update parseManifest()');
    console.error('  in scripts/validate-template-sync.mjs or normalize the manifest formatting.');
    return null;
  }
  return manifest;
}

function checkRsyncManagedDeletions(changes) {
  const failures = [];
  for (const change of changes) {
    if (change.status === 'D' && isRsyncManaged(change.path)) {
      failures.push(change.path);
      continue;
    }
    // Type-change (T) is destructive under rsync --delete: a regular
    // file converted to a symlink (or vice versa) gets rsynced verbatim
    // to every customer app. A dangling symlink there would break any
    // import resolving through it — same class of failure the deletion
    // guard exists to prevent.
    if (change.status === 'T' && isRsyncManaged(change.path)) {
      failures.push(`${change.path} (type-changed — destructive under rsync --delete)`);
      continue;
    }
    // Renames where the OLD path was in an rsync-managed dir cause the
    // old filename to disappear from customer apps (rsync --delete syncs
    // the whole tree). True whether the new path is inside or outside
    // the same dir. Copies (C) preserve the original, so they're allowed.
    if (change.status === 'R' && isRsyncManaged(change.oldPath)) {
      const where = isRsyncManaged(change.path)
        ? `renamed within rsync-managed dir to ${change.path}`
        : `renamed/moved out of rsync-managed dir to ${change.path}`;
      failures.push(`${change.oldPath} (${where})`);
    }
  }
  if (failures.length === 0) return true;

  if (process.env.ALLOW_RSYNC_MANAGED_DELETE === '1') {
    console.log(`${YELLOW}[template-sync] ALLOW_RSYNC_MANAGED_DELETE=1 set; permitting rsync-managed removals:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
    return true;
  }

  console.error(`${RED}${BOLD}[template-sync] Refusing to remove files from rsync-managed v8 directories${RESET}`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  console.error(`${BOLD}Why this is blocked:${RESET}`);
  console.error('  Customer apps rsync --delete these directories on every container');
  console.error(`  start (${RSYNC_MANAGED_DIRS.map((d) => d.replace(TEMPLATE_DIR, '')).join(', ')}),`);
  console.error('  so removing a file here propagates to every customer immediately.');
  console.error('  If any in-flight customer file still imports the removed module,');
  console.error('  their preview/build will fail with "Could not resolve" errors.');
  console.error('');
  console.error(`${BOLD}Safer alternatives:${RESET}`);
  console.error('  1. Replace the file with a no-op stub that satisfies existing imports');
  console.error('     (see app-templates/v8/dev-tools/src/vite-tsc-plugin.ts).');
  console.error('  2. If the import has been removed from the base template AND you have');
  console.error('     verified no customer app could possibly still import it, override:');
  console.error('');
  console.error(`     ${CYAN}ALLOW_RSYNC_MANAGED_DELETE=1 git commit ...${RESET}`);
  return false;
}

function checkHashDrift(changes, manifest) {
  let ok = true;
  // Renames are deliberately excluded: sync-template-files.js compares
  // hashes at the same path, so a rename leaves the customer's file
  // orphaned regardless of any known_hashes backfill on the new path.
  // Renames are validated by the untracked-file guard instead (which
  // forces an explicit manifest update on the new path).
  // Type-changes (T, e.g. file ↔ symlink) are included alongside M so
  // a tracked file flipping types does not silently bypass the check.
  const candidates = changes.filter(
    (c) =>
      isInTemplate(c.path) &&
      !isRsyncManaged(c.path) &&
      (c.status === 'M' || c.status === 'T')
  );

  for (const change of candidates) {
    const rel = templateRelative(change.path);
    const entry = manifest.get(rel);
    if (!entry) continue; // handled by checkUntrackedTemplateFiles
    if (entry.force) continue;

    const previousContent = readHead(change.path);
    if (previousContent === null) {
      // M/T means "modified relative to HEAD", so HEAD MUST have this
      // file. A null here means git returned exit 128 for some reason
      // OTHER than legitimate not-found (e.g., bad object / corrupt
      // pack). Fail loudly rather than silently skipping the hash check.
      ok = false;
      console.error(
        `${RED}${BOLD}[template-sync] Could not read HEAD:${change.path}${RESET}`
      );
      console.error('  This file is staged as modified but its HEAD version could not');
      console.error('  be retrieved. The repository may be corrupt, or the file may');
      console.error('  have been added in a prior staged commit. Investigate before');
      console.error('  bypassing — silent skip would let drift slip through.');
      console.error('');
      continue;
    }

    const previousHash = md5(previousContent);
    if (entry.hashes.has(previousHash)) continue;

    ok = false;
    console.error(
      `${RED}${BOLD}[template-sync] Missing known_hashes entry for ${change.path}${RESET}`
    );
    console.error(`  Manifest entry: ${rel}`);
    console.error(`  Previous (HEAD) MD5: ${BOLD}${previousHash}${RESET}`);
    console.error('');
    console.error(`${BOLD}Why this is blocked:${RESET}`);
    console.error('  This file is tracked in SYNC_MANIFEST. Customer apps still on the');
    console.error('  previous version will only get auto-synced if their MD5 is listed in');
    console.error('  `known_hashes`. Without this entry they silently fall behind the base');
    console.error('  template and may break the next time an incompatible change ships.');
    console.error('');
    console.error(`${BOLD}Fix:${RESET}`);
    console.error(`  Add the hash to the entry in ${MANIFEST_PATH}:`);
    console.error('');
    console.error(`${CYAN}    {`);
    console.error(`      file: '${rel}',`);
    console.error(`      ...`);
    console.error(`      known_hashes: [`);
    console.error(`        ...,`);
    console.error(`        '${previousHash}', // <new-commit-or-pr> - <one-line context>`);
    console.error(`      ],`);
    console.error(`      ...`);
    console.error(`    }${RESET}`);
    console.error('');
  }

  return ok;
}

/**
 * Block any v8 (non-dev-tools) addition, modification, deletion, or
 * rename where the relevant manifest entry is missing. Renames trigger
 * a check on BOTH oldPath (must have been tracked) and path (must be
 * tracked now), since either side missing implies a broken sync.
 * Tracked-file deletions are blocked because customer apps that already
 * received the file will keep their stale copy forever.
 */
function checkUntrackedTemplateFiles(changes, manifest) {
  const violations = [];

  for (const change of changes) {
    if (!isInTemplate(change.path) || isRsyncManaged(change.path)) {
      // For renames OUT of v8 we still want to flag the old path if it
      // was tracked (since deleting the manifest entry without removing
      // the file means customer drift). Fall through to oldPath check.
      if (!(change.status === 'R' && isInTemplate(change.oldPath) && !isRsyncManaged(change.oldPath))) {
        continue;
      }
    }

    if (change.status === 'D') {
      const rel = templateRelative(change.path);
      const entry = manifest.get(rel);
      if (entry) {
        violations.push({ path: change.path, reason: 'tracked file deleted (manifest entry still present)' });
      } else {
        violations.push({ path: change.path, reason: 'untracked file deleted' });
      }
      continue;
    }

    if (change.status === 'R') {
      const oldRel = isInTemplate(change.oldPath) ? templateRelative(change.oldPath) : null;
      const newRel = isInTemplate(change.path) && !isRsyncManaged(change.path)
        ? templateRelative(change.path)
        : null;

      if (oldRel && manifest.has(oldRel)) {
        violations.push({
          path: change.oldPath,
          reason: `renamed to ${change.path} but old manifest entry still present (will orphan customer files)`
        });
      } else if (oldRel && !newRel) {
        // Untracked v8 file renamed OUT of v8 entirely. Functionally
        // equivalent to deleting an untracked v8 file (which IS blocked
        // above) — both make the file disappear from the template tree.
        // Without this branch, `git mv app-templates/v8/X outside/X`
        // would silently bypass the untracked-v8 guard.
        violations.push({
          path: change.oldPath,
          reason: `untracked v8 file renamed out of template (equivalent to deletion)`
        });
      }
      if (newRel && !manifest.has(newRel)) {
        violations.push({ path: change.path, reason: `rename target not in SYNC_MANIFEST` });
      }
      continue;
    }

    // M, A, C, T
    const rel = templateRelative(change.path);
    if (!manifest.has(rel)) {
      // D status is handled earlier via `continue` and never reaches here,
      // so it is intentionally absent from this map.
      const statusLabel = ({ A: 'new file', C: 'copied file', T: 'type-changed file' })[change.status] ?? 'modified file';
      violations.push({ path: change.path, reason: `${statusLabel} not in SYNC_MANIFEST` });
    }
  }

  if (violations.length === 0) return true;

  if (process.env.ALLOW_UNTRACKED_V8_CHANGE === '1') {
    console.log(`${YELLOW}[template-sync] ALLOW_UNTRACKED_V8_CHANGE=1 set; permitting untracked v8 changes:${RESET}`);
    for (const v of violations) console.log(`  - ${v.path} (${v.reason})`);
    return true;
  }

  console.error(`${RED}${BOLD}[template-sync] Refusing v8 changes that don't reconcile with SYNC_MANIFEST${RESET}`);
  for (const v of violations) console.error(`  - ${v.path} (${v.reason})`);
  console.error('');
  console.error(`${BOLD}Why this is blocked:${RESET}`);
  console.error('  Customer apps only receive updates for files listed in SYNC_MANIFEST.');
  console.error('  Adding, modifying, deleting, or renaming a v8 file without the matching');
  console.error('  manifest update leaves in-flight customer apps stranded on stale content,');
  console.error('  causing silent drift that can break later when an incompatible change ships.');
  console.error('');
  console.error(`${BOLD}Fix (pick one):${RESET}`);
  console.error(`  1. Update SYNC_MANIFEST in ${MANIFEST_PATH} so existing customer apps get`);
  console.error('     the correct sync behavior on their next container start.');
  console.error('  2. If the file is intentionally not synced (container-only config baked');
  console.error('     in at image build time, or a deletion you have verified safe), bypass:');
  console.error('');
  console.error(`     ${CYAN}ALLOW_UNTRACKED_V8_CHANGE=1 git commit ...${RESET}`);
  return false;
}

/**
 * SSR skill template files that must stay byte-for-byte identical to
 * their v8 template counterparts. The skill installs these into customer
 * apps; drift means migrated apps get different code than what the base
 * template ships.
 */
export const SSR_SKILL_TEMPLATE_PAIRS = [
  {
    skillPath: 'agents/src/skills/ssr-migration/templates/server/entry.ts',
    v8Path: 'app-templates/v8/src/server/entry.ts',
  },
  {
    skillPath: 'agents/src/skills/ssr-migration/templates/entry-server.tsx',
    v8Path: 'app-templates/v8/src/entry-server.tsx',
  },
  {
    skillPath: 'agents/src/skills/ssr-migration/templates/components/CookieBanner.tsx',
    v8Path: 'app-templates/v8/src/components/CookieBanner.tsx',
  },
  {
    skillPath: 'agents/src/skills/ssr-migration/templates/components/CookieBannerErrorBoundary.tsx',
    v8Path: 'app-templates/v8/src/components/CookieBannerErrorBoundary.tsx',
  },
  {
    skillPath: 'agents/src/skills/ssr-migration/templates/lib/seo-routes.ts',
    v8Path: 'app-templates/v8/src/lib/seo-routes.ts',
  },
  {
    skillPath: 'agents/src/skills/ssr-migration/templates/components/Spinner.tsx',
    v8Path: 'app-templates/v8/src/components/Spinner.tsx',
  },
];

export function checkSsrSkillTemplateSync(changes, readers = {}) {
  const { readStaged: rs = readStaged, readHead: rh = readHead } = readers;
  const stagedPaths = new Set(changes.map((c) => c.path));
  const failures = [];

  for (const pair of SSR_SKILL_TEMPLATE_PAIRS) {
    const skillStaged = stagedPaths.has(pair.skillPath);
    const v8Staged = stagedPaths.has(pair.v8Path);
    if (!skillStaged && !v8Staged) continue;

    const skillContent = skillStaged ? rs(pair.skillPath) : rh(pair.skillPath);
    const v8Content = v8Staged ? rs(pair.v8Path) : rh(pair.v8Path);

    if (skillContent === null || v8Content === null) continue;
    if (skillContent !== v8Content) failures.push(pair);
  }

  if (failures.length === 0) return true;

  console.error(`${RED}${BOLD}[template-sync] SSR skill templates out of sync with v8 template${RESET}`);
  for (const f of failures) {
    console.error(`  - ${f.skillPath}`);
    console.error(`    ↕ ${f.v8Path}`);
  }
  console.error('');
  console.error(`${BOLD}Why this is blocked:${RESET}`);
  console.error('  The SSR skill installs these files into customer apps during migration.');
  console.error('  If they differ from the v8 base template, migrated apps get different');
  console.error('  code than apps created from scratch — silent divergence that breaks');
  console.error('  sync-template-files.js hash matching down the line.');
  console.error('');
  console.error(`${BOLD}Fix:${RESET}`);
  console.error('  Update the skill template to match the v8 template (or vice versa)');
  console.error('  so both sides are identical before committing.');
  return false;
}

function main() {
  const changes = getStagedChanges();
  if (changes === null) return 0; // git unavailable; warning already logged

  const ssrSkillPaths = new Set(SSR_SKILL_TEMPLATE_PAIRS.flatMap((p) => [p.skillPath, p.v8Path]));
  const relevant = changes.some(
    (c) => isInTemplate(c.path) || (c.oldPath && isInTemplate(c.oldPath)) || ssrSkillPaths.has(c.path)
  );
  if (!relevant) return 0;

  const ssrSkillOk = checkSsrSkillTemplateSync(changes);

  const v8Relevant = changes.some((c) => isInTemplate(c.path) || (c.oldPath && isInTemplate(c.oldPath)));
  if (!v8Relevant) return ssrSkillOk ? 0 : 1;

  const manifest = loadManifest();
  if (manifest === null) return 1;

  const rsyncManagedOk = checkRsyncManagedDeletions(changes);
  const untrackedOk = checkUntrackedTemplateFiles(changes, manifest);
  const hashOk = checkHashDrift(changes, manifest);

  return rsyncManagedOk && untrackedOk && hashOk && ssrSkillOk ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (err) {
  // Final safety net for any non-128 git error that propagates out of
  // gitShow (or any other unexpected throw). Without this the developer
  // sees a raw Node stack trace with no [template-sync] context, making
  // a real validator crash indistinguishable from a script bug.
  console.error(`${RED}${BOLD}[template-sync] Validator crashed unexpectedly${RESET}`);
  console.error(`  ${err && err.message ? err.message : err}`);
  // Some git failures (e.g. ambiguous-ref disambiguation) write the most
  // useful diagnostic to stdout rather than stderr, so log both.
  if (err && err.stdout) {
    const stdout = err.stdout.toString().trim();
    if (stdout) console.error(`  git stdout: ${stdout}`);
  }
  if (err && err.stderr) {
    const stderr = err.stderr.toString().trim();
    if (stderr) console.error(`  git stderr: ${stderr}`);
  }
  console.error('  Commit blocked. Check git availability and repo integrity.');
  process.exit(1);
  }
}
