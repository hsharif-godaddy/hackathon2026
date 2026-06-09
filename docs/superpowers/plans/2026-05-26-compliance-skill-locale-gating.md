# Compliance Skill Locale Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the `compliance-docs` skill from loading for customers outside allowed markets (initially `en-US` only) by adding a `markets` allowlist to skill frontmatter and enforcing it at list and load time.

**Architecture:** A new optional `markets: string[]` field in `skill.md` YAML frontmatter specifies which BCP-47 locales may use the skill. `SkillLoaderTool.listSkills` and `loadSkill` accept an optional `market` argument and filter/reject accordingly. The agent-facing `skillAITool` extracts `context.metadata.market` and passes it through. Skills with no `markets` field remain unrestricted.

**Tech Stack:** TypeScript, Vitest, gray-matter (already used for frontmatter parsing)

---

## File Map

| File | Change |
|---|---|
| `agents/src/skills/compliance-docs/skill.md` | Add `markets: [en-US]` to frontmatter |
| `agents/src/tools/skill-loader-tool.ts` | Extend `SkillLoaderOptions`, `listSkills` options, and `SkillListItem`; add market filter logic |
| `agents/src/tools/ai-lib-tools/skill-loader.ts` | Extract market from context; pass to `listSkills` and `loadSkill` |
| `agents/src/tools/__tests__/skill-loader-tool.test.ts` | Add market-filtering test suite |

---

### Task 1: Add `markets` frontmatter to compliance-docs skill

**Files:**
- Modify: `agents/src/skills/compliance-docs/skill.md`

- [ ] **Step 1: Add `markets` field to frontmatter**

Open `agents/src/skills/compliance-docs/skill.md`. The current frontmatter looks like:

```yaml
---
name: compliance-docs
description: Generate legal compliance pages (Privacy Policy, Terms of Use).
whenToUse: ...
enablementId: complianceDocs
intents:
  - privacy policy/terms of use/legal pages/ToU/privacy page/terms page
---
```

Add `markets` after `enablementId`:

```yaml
---
name: compliance-docs
description: Generate legal compliance pages (Privacy Policy, Terms of Use).
whenToUse: User wants to add, create, or generate a privacy policy, terms of use, or legal pages — either by name (phrases like "add a privacy policy", "add a terms of use", "generate terms of use", "I need legal pages", "create a ToU page") OR by path (any request to build/create a page at `/privacy`, `/privacy-policy`, `/terms`, `/terms-of-use`, or `/tos`, including path-only build requests from the preview's "page doesn't exist" popup that arrive as messages like `"The page at path /privacy doesn't exist yet, please build it with appropriate content."`).
enablementId: complianceDocs
markets:
  - en-US
intents:
  - privacy policy/terms of use/legal pages/ToU/privacy page/terms page
---
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/skills/compliance-docs/skill.md
git commit -m "feat(compliance-docs): restrict skill to en-US market via markets frontmatter"
```

---

### Task 2: Extend `SkillLoaderTool` types and add market filtering

**Files:**
- Modify: `agents/src/tools/skill-loader-tool.ts`

- [ ] **Step 1: Write failing tests first**

Open `agents/src/tools/__tests__/skill-loader-tool.test.ts`. Add a new `describe` block after the existing `'#listSkills and #loadSkill - profile-gated enablement'` block (around line 900+):

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @airo/agents test:unit "skill-loader-tool" 2>&1 | tail -20
```

Expected: failures on market-related tests because `listSkills` and `loadSkill` don't accept `market` yet.

- [ ] **Step 3: Extend `SkillLoaderOptions` to include `market`**

In `agents/src/tools/skill-loader-tool.ts`, find `SkillLoaderOptions` (around line 14):

```typescript
export interface SkillLoaderOptions {
  /** Name of the skill to load (e.g., 'blog', 'commerce') */
  skill: string;
}
```

Replace with:

```typescript
export interface SkillLoaderOptions {
  /** Name of the skill to load (e.g., 'blog', 'commerce') */
  skill: string;
  /**
   * BCP-47 market/locale string (e.g., 'en-US'). When provided, skills with a
   * `markets` frontmatter allowlist are only loaded if this value is included.
   * When absent, market-restricted skills are rejected.
   */
  market?: string;
}
```

- [ ] **Step 4: Extend `SkillListItem` to include `markets`**

Find `SkillListItem` (around line 128):

```typescript
export interface SkillListItem {
  name: string;
  description: string;
  whenToUse?: string;
  enablementId?: string;
  /** Trigger phrases shown in the system-prompt intent map. Each phrase routes to this skill's name. */
  intents?: string[];
  /** True when this skill is pinned for the current conversation. */
  pinned?: boolean;
}
```

Replace with:

```typescript
export interface SkillListItem {
  name: string;
  description: string;
  whenToUse?: string;
  enablementId?: string;
  /** Trigger phrases shown in the system-prompt intent map. Each phrase routes to this skill's name. */
  intents?: string[];
  /** True when this skill is pinned for the current conversation. */
  pinned?: boolean;
  /**
   * BCP-47 market allowlist from skill frontmatter. Absent means unrestricted.
   * A skill in this list is only shown/loaded when the request market matches.
   */
  markets?: string[];
}
```

- [ ] **Step 5: Add `market` parameter to `listSkills` and apply filter**

Find `listSkills` signature (around line 634):

```typescript
async listSkills(options?: { pinned?: Set<string> }): Promise<...>
```

Replace with:

```typescript
async listSkills(options?: { pinned?: Set<string>; market?: string }): Promise<...>
```

Inside the method, find where `enablementId` is extracted and the feature check runs (around line 660–698). Immediately after the `enablementId` block (after the `return null` for disabled skills), add the market filter:

```typescript
// Extract markets from frontmatter
const skillMarkets = Array.isArray(data.markets)
  ? (data.markets as unknown[]).filter((m): m is string => typeof m === 'string')
  : undefined;

// If markets is set, only include this skill when the request market matches
if (skillMarkets && skillMarkets.length > 0) {
  const { market } = options ?? {};
  if (!market || !skillMarkets.includes(market)) {
    this.logger.debug('skill.list.market_restricted', {
      skill: skillName,
      skillMarkets,
      requestMarket: market,
    });
    return null;
  }
}
```

Also populate `markets` on the returned `SkillListItem`. Find where the `skillItem` is built (around line 708):

```typescript
const skillItem: SkillListItem = { name, description };
if (whenToUse) {
  skillItem.whenToUse = whenToUse;
}
if (intents) {
  skillItem.intents = intents;
}
if (enablementId) {
  skillItem.enablementId = enablementId;
}
```

Add after the `enablementId` block:

```typescript
if (skillMarkets && skillMarkets.length > 0) {
  skillItem.markets = skillMarkets;
}
```

Note: `skillMarkets` is declared inside the `try` block above. You will need to declare it in the outer scope. Adjust the variable declaration at the top of the `try` block:

```typescript
let skillMarkets: string[] | undefined;
```

And assign it inside the `try` block as shown above.

- [ ] **Step 6: Add `market` check to `loadSkill`**

Find the `loadSkill` method (around line 227). After the existing `enablementId` check (around line 278–285), add:

```typescript
// Check market restriction
const loadMarkets = Array.isArray(frontmatter.markets)
  ? (frontmatter.markets as unknown[]).filter((m): m is string => typeof m === 'string')
  : undefined;
if (loadMarkets && loadMarkets.length > 0) {
  const { market } = options;
  if (!market || !loadMarkets.includes(market)) {
    this.logger.warn('skill.load.market_restricted', { skill, loadMarkets, requestMarket: market });
    return {
      success: false,
      skill,
      error: `Skill '${skill}' is not available in your market.`,
    };
  }
}
```

- [ ] **Step 7: Run tests and confirm they pass**

```bash
pnpm --filter @airo/agents test:unit "skill-loader-tool" 2>&1 | tail -20
```

Expected: all tests pass including the new market-gating suite.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @airo/agents typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add agents/src/tools/skill-loader-tool.ts \
        agents/src/tools/__tests__/skill-loader-tool.test.ts
git commit -m "feat(skill-loader): add market allowlist gating to listSkills and loadSkill"
```

---

### Task 3: Wire market through `skillAITool`

**Files:**
- Modify: `agents/src/tools/ai-lib-tools/skill-loader.ts`

- [ ] **Step 1: Extract market from context and pass to `listSkills` and `loadSkill`**

Open `agents/src/tools/ai-lib-tools/skill-loader.ts`. The tool handler starts with:

```typescript
async (input, context?: AgentContext) => {
  const skillLoader = new SkillLoaderTool();
  const appRepo = new AppRepository();

  // List action - show all available skills
  if (input.action === 'list') {
    const conversationId = context?.metadata?.conversationId as string | undefined;
    const pinned = conversationId
      ? new Set(skillToolManager.getPinnedSkills(conversationId))
      : undefined;
    const result = await skillLoader.listSkills({ pinned });
```

Replace the beginning of the handler up through the `listSkills` call with:

```typescript
async (input, context?: AgentContext) => {
  const skillLoader = new SkillLoaderTool();
  const appRepo = new AppRepository();
  const market = context?.metadata?.market as string | undefined;

  // List action - show all available skills
  if (input.action === 'list') {
    const conversationId = context?.metadata?.conversationId as string | undefined;
    const pinned = conversationId
      ? new Set(skillToolManager.getPinnedSkills(conversationId))
      : undefined;
    const result = await skillLoader.listSkills({ pinned, market });
```

Then find the `load` action block where `loadSkill` is called (around line 52):

```typescript
  if (input.action === 'load') {
    const result = await skillLoader.loadSkill({ skill: input.skill });
```

Replace with:

```typescript
  if (input.action === 'load') {
    const result = await skillLoader.loadSkill({ skill: input.skill, market });
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @airo/agents typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Run full unit test suite for agents**

```bash
pnpm --filter @airo/agents test:unit 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add agents/src/tools/ai-lib-tools/skill-loader.ts
git commit -m "feat(skill-loader-tool): pass market from agent context to listSkills and loadSkill"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full agent typecheck and tests**

```bash
pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents test:unit 2>&1 | tail -20
```

Expected: typecheck passes, all tests pass.

- [ ] **Step 2: Run full lint**

```bash
pnpm --filter @airo/agents lint 2>&1 | tail -10
```

Expected: no lint errors.

- [ ] **Step 3: Confirm compliance-docs skill.md frontmatter is valid YAML**

```bash
node -e "
const matter = require('gray-matter');
const fs = require('fs');
const { data } = matter(fs.readFileSync('agents/src/skills/compliance-docs/skill.md', 'utf8'));
console.log('markets:', data.markets);
console.log('enablementId:', data.enablementId);
"
```

Expected output:
```
markets: [ 'en-US' ]
enablementId: complianceDocs
```

- [ ] **Step 4: Final commit if any lint auto-fixes were applied**

If lint made changes:

```bash
git add -p
git commit -m "chore: lint fixes for market gating"
```
