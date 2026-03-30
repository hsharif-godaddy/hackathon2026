# Remove AWS Bedrock AI Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all AWS Bedrock provider integration from Airo App Builder, leaving only GoCode as the supported AI provider.

**Architecture:** This is a removal/cleanup task affecting multiple packages. The provider abstraction layer isolates changes to `packages/ai-lib/`, with additional updates needed in `setup/`, `agents/`, and documentation. The `bedrock-log-viewer/` standalone tool will be completely removed.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Turborepo

**Jira Ticket:** [AIROBUILD-1077](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1077)

---

## File Structure Map

### Files to Delete Entirely

- `bedrock-log-viewer/` - Standalone S3 log viewer tool (entire directory)
- `packages/ai-lib/examples/basic-bedrock.ts` - Basic Bedrock example
- `packages/ai-lib/examples/agentic-bedrock-simple.ts` - Simple agentic example
- `packages/ai-lib/examples/agentic-bedrock-simple-tool.ts` - Tool example
- `packages/ai-lib/examples/agentic-bedrock-prompt-caching.ts` - Caching example
- `packages/ai-lib/examples/agentic-bedrock-full.ts` - Full example
- `packages/ai-lib/examples/agentic-bedrock-file-upload.ts` - File upload example
- `agents/src/server/routes/__tests__/bedrock-validation.test.ts` - Bedrock validation tests (if exists)

### Files to Modify - Core Provider Code

- `packages/ai-lib/src/core/types.ts` - Remove 'bedrock' from provider union (line 56)
- `packages/ai-lib/src/providers/unified-provider.ts` - Remove Bedrock provider creation
- `packages/ai-lib/src/utils/model-normalization.ts` - Remove Bedrock model mappings
- `packages/ai-lib/src/utils/model-pricing.ts` - Remove Bedrock pricing (lines 157-232)
- `packages/ai-lib/src/utils/prompt-caching.ts` - Remove Bedrock cache support (lines 19-380)
- `packages/ai-lib/src/utils/token-counter.ts` - Remove Bedrock token counting
- `packages/ai-lib/src/utils/embeddings.ts` - Remove Bedrock embedding support
- `packages/ai-lib/package.json` - Remove dependencies and scripts

### Files to Modify - Tests

- `packages/ai-lib/src/utils/__tests__/model-pricing.test.ts` - Remove Bedrock test cases
- `packages/ai-lib/src/utils/__tests__/model-normalization.test.ts` - Remove Bedrock test cases
- `packages/ai-lib/src/utils/__tests__/token-counter.test.ts` - Remove Bedrock test cases
- `packages/ai-lib/src/utils/__tests__/prompt-caching.test.ts` - Remove Bedrock test cases

### Files to Modify - Setup Tool

- `setup/src/env-generator.ts` - Remove "aws-bedrock" from provider union (line 17)

### Files to Modify - Agents Service

- `agents/src/utils/model-selection.ts` - Verify GoCode-only support
- `agents/src/services/ConversationHistoryLoader.ts` - Remove Bedrock references (if any)

### Files to Modify - Documentation

- `packages/ai-lib/INTEGRATION_GUIDE.md` - Remove Bedrock setup instructions (lines 30-87)
- `packages/ai-lib/SETUP.md` - Remove Bedrock configuration
- `packages/ai-lib/README.md` - Update provider list
- `packages/ai-lib/examples/README.md` - Remove Bedrock example references
- `packages/design-extractor/.env.example` - Remove Bedrock option (lines 10-13)
- `agents/.env.example` - Remove AWS variables
- `app/.env.example` - Remove AWS variables (if present)

---

## Task 1: Verify Current State and Run Tests

**Goal:** Establish baseline - ensure all tests pass before making changes.

**Files:**

- Read: Multiple files to understand current state
- Test: All test suites

- [ ] **Step 1: Run all ai-lib tests to establish baseline**

Run: `cd packages/ai-lib && pnpm test`

Expected: All tests pass (or document which tests are currently failing)

- [ ] **Step 2: Run ai-lib typecheck**

Run: `cd packages/ai-lib && pnpm typecheck`

Expected: No type errors

- [ ] **Step 3: Run full build to verify current state**

Run: `pnpm build`

Expected: Build succeeds

- [ ] **Step 4: Document baseline state**

Create a note of current test/build status for comparison after changes.

---

## Task 2: Remove Bedrock Example Files

**Goal:** Delete all Bedrock example files from `packages/ai-lib/examples/`.

**Files:**

- Delete: `packages/ai-lib/examples/basic-bedrock.ts`
- Delete: `packages/ai-lib/examples/agentic-bedrock-simple.ts`
- Delete: `packages/ai-lib/examples/agentic-bedrock-simple-tool.ts`
- Delete: `packages/ai-lib/examples/agentic-bedrock-prompt-caching.ts`
- Delete: `packages/ai-lib/examples/agentic-bedrock-full.ts`
- Delete: `packages/ai-lib/examples/agentic-bedrock-file-upload.ts`

- [ ] **Step 1: Delete Bedrock example files**

```bash
cd packages/ai-lib/examples
rm -f basic-bedrock.ts
rm -f agentic-bedrock-simple.ts
rm -f agentic-bedrock-simple-tool.ts
rm -f agentic-bedrock-prompt-caching.ts
rm -f agentic-bedrock-full.ts
rm -f agentic-bedrock-file-upload.ts
```

Expected: 6 files deleted

- [ ] **Step 2: Verify files are deleted**

Run: `ls packages/ai-lib/examples/agentic-bedrock-* 2>&1`

Expected: "No such file or directory"

- [ ] **Step 3: Update examples README**

Modify: `packages/ai-lib/examples/README.md`

Remove all references to Bedrock examples.

- [ ] **Step 4: Verify examples README**

Run: `grep -i bedrock packages/ai-lib/examples/README.md`

Expected: No matches (empty output)

- [ ] **Step 5: Commit changes**

```bash
git add packages/ai-lib/examples/
git commit -m "chore: remove Bedrock example files"
```

---

## Task 3: Update package.json Dependencies and Scripts

**Goal:** Remove Bedrock dependencies and scripts from `packages/ai-lib/package.json`.

**Files:**

- Modify: `packages/ai-lib/package.json`

- [ ] **Step 1: Read current package.json**

Run: `cat packages/ai-lib/package.json | grep -A 2 -B 2 bedrock`

Expected: See dependencies and scripts with bedrock references

- [ ] **Step 2: Remove Bedrock dependencies**

Edit `packages/ai-lib/package.json`:

Remove these lines from `dependencies`:

```json
"@ai-sdk/amazon-bedrock": "^4.0.83",
"@aws-sdk/client-bedrock-runtime": "^3.890.0",
"@aws-sdk/credential-providers": "^3.888.0",
```

- [ ] **Step 3: Remove Bedrock scripts**

Edit `packages/ai-lib/package.json`:

Remove these lines from `scripts`:

```json
"example:basic-bedrock": "npx tsx examples/basic-bedrock.ts",
"example:agentic-simple": "npx tsx examples/agentic-bedrock-simple.ts",
"example:agentic-full": "npx tsx examples/agentic-bedrock-full.ts",
"example:prompt-caching": "npx tsx examples/agentic-bedrock-prompt-caching.ts",
"example:file-upload": "npx tsx examples/agentic-bedrock-file-upload.ts",
```

Update the `setup` script to remove "or npm run example:basic-bedrock":

```json
"setup": "echo 'Copy env.example to .env and fill in your API keys, then run npm run example:basic-openai'"
```

- [ ] **Step 4: Verify package.json changes**

Run: `grep -i bedrock packages/ai-lib/package.json`

Expected: No matches

Run: `grep -i "@aws-sdk" packages/ai-lib/package.json`

Expected: Only `@aws-sdk/client-sts` remains (used for S2S auth)

- [ ] **Step 5: Install dependencies to update lockfile**

Run: `pnpm install`

Expected: Bedrock packages removed from node_modules

- [ ] **Step 6: Commit changes**

```bash
git add packages/ai-lib/package.json pnpm-lock.yaml
git commit -m "chore: remove Bedrock dependencies from ai-lib"
```

---

## Task 4: Update Core Types - Remove 'bedrock' from Provider Union

**Goal:** Remove 'bedrock' as a valid provider option in type definitions.

**Files:**

- Modify: `packages/ai-lib/src/core/types.ts:56`

- [ ] **Step 1: Read current types**

Run: `sed -n '50,60p' packages/ai-lib/src/core/types.ts`

Expected: See line 56 with `defaultProvider?: 'openai' | 'anthropic' | 'bedrock' | 'custom'`

- [ ] **Step 2: Remove 'bedrock' from provider union**

Edit `packages/ai-lib/src/core/types.ts` line 56:

Change:

```typescript
defaultProvider?: 'openai' | 'anthropic' | 'bedrock' | 'custom'
```

To:

```typescript
defaultProvider?: 'openai' | 'anthropic' | 'custom'
```

- [ ] **Step 3: Verify the change**

Run: `sed -n '50,60p' packages/ai-lib/src/core/types.ts | grep defaultProvider`

Expected: See updated line without 'bedrock'

- [ ] **Step 4: Run typecheck**

Run: `cd packages/ai-lib && pnpm typecheck`

Expected: May have type errors in other files - those will be fixed in subsequent tasks

- [ ] **Step 5: Commit changes**

```bash
git add packages/ai-lib/src/core/types.ts
git commit -m "refactor(ai-lib): remove 'bedrock' from provider type union"
```

---

## Task 5: Remove Bedrock Provider from unified-provider.ts

**Goal:** Remove all Bedrock provider creation and configuration logic.

**Files:**

- Modify: `packages/ai-lib/src/providers/unified-provider.ts`

- [ ] **Step 1: Read unified-provider to find Bedrock code**

Run: `grep -n "bedrock\|Bedrock" packages/ai-lib/src/providers/unified-provider.ts -i`

Expected: See line numbers with Bedrock references

- [ ] **Step 2: Identify sections to remove**

Read the file to identify:

- `createBedrockProvider()` function
- `validateBedrockConfig()` function
- AWS credential handling imports and logic
- Bedrock-specific conditionals in provider selection

- [ ] **Step 3: Remove Bedrock imports**

Remove imports from top of file:

```typescript
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromIni } from "@aws-sdk/credential-providers";
// Any other AWS SDK imports related to Bedrock
```

- [ ] **Step 4: Remove createBedrockProvider function**

Delete the entire `createBedrockProvider()` function and any helper functions it uses.

- [ ] **Step 5: Remove Bedrock provider selection logic**

Find switch/if statements that handle 'bedrock' provider selection and remove those cases.

- [ ] **Step 6: Verify no Bedrock references remain**

Run: `grep -i bedrock packages/ai-lib/src/providers/unified-provider.ts`

Expected: No matches

- [ ] **Step 7: Run typecheck**

Run: `cd packages/ai-lib && pnpm typecheck`

Expected: Should have fewer errors than before (may still have errors in other files)

- [ ] **Step 8: Commit changes**

```bash
git add packages/ai-lib/src/providers/unified-provider.ts
git commit -m "refactor(ai-lib): remove Bedrock provider from unified-provider"
```

---

## Task 6: Remove Bedrock Models from model-normalization.ts

**Goal:** Remove all Bedrock ARN model mappings and definitions.

**Files:**

- Modify: `packages/ai-lib/src/utils/model-normalization.ts`
- Modify: `packages/ai-lib/src/utils/__tests__/model-normalization.test.ts`

- [ ] **Step 1: Identify Bedrock model patterns**

Run: `grep -n "bedrock\|anthropic\.claude.*global\|anthropic\.claude.*us\." packages/ai-lib/src/utils/model-normalization.ts -i`

Expected: See Bedrock ARN patterns like `global.anthropic.claude-sonnet-4-6`

- [ ] **Step 2: Remove Bedrock model mappings**

Edit `packages/ai-lib/src/utils/model-normalization.ts`:

Remove all model definitions containing:

- Bedrock ARN patterns (e.g., `global.anthropic.claude-*`)
- `us.anthropic.claude-*` patterns
- Any Bedrock-specific model ID mappings

- [ ] **Step 3: Verify removal**

Run: `grep -i "bedrock\|global\.anthropic\|us\.anthropic" packages/ai-lib/src/utils/model-normalization.ts`

Expected: No matches

- [ ] **Step 4: Update tests - remove Bedrock test cases**

Edit `packages/ai-lib/src/utils/__tests__/model-normalization.test.ts`:

Remove test cases that test Bedrock model normalization.

- [ ] **Step 5: Run tests**

Run: `cd packages/ai-lib && pnpm test model-normalization`

Expected: All tests pass

- [ ] **Step 6: Commit changes**

```bash
git add packages/ai-lib/src/utils/model-normalization.ts packages/ai-lib/src/utils/__tests__/model-normalization.test.ts
git commit -m "refactor(ai-lib): remove Bedrock model mappings from normalization"
```

---

## Task 7: Remove Bedrock Pricing from model-pricing.ts

**Goal:** Remove Bedrock pricing calculations (lines 157-232 per ticket).

**Files:**

- Modify: `packages/ai-lib/src/utils/model-pricing.ts`
- Modify: `packages/ai-lib/src/utils/__tests__/model-pricing.test.ts`

- [ ] **Step 1: Identify Bedrock pricing code**

Run: `sed -n '150,240p' packages/ai-lib/src/utils/model-pricing.ts | grep -n bedrock -i`

Expected: See Bedrock pricing logic in specified line range

- [ ] **Step 2: Remove Bedrock pricing calculations**

Edit `packages/ai-lib/src/utils/model-pricing.ts`:

Remove lines 157-232 (or the actual range containing Bedrock pricing).
This includes Bedrock model pricing definitions and calculation logic.

- [ ] **Step 3: Verify removal**

Run: `grep -i bedrock packages/ai-lib/src/utils/model-pricing.ts`

Expected: No matches

- [ ] **Step 4: Update tests - remove Bedrock pricing tests**

Edit `packages/ai-lib/src/utils/__tests__/model-pricing.test.ts`:

Remove test cases that validate Bedrock pricing calculations.

- [ ] **Step 5: Run tests**

Run: `cd packages/ai-lib && pnpm test model-pricing`

Expected: All tests pass

- [ ] **Step 6: Commit changes**

```bash
git add packages/ai-lib/src/utils/model-pricing.ts packages/ai-lib/src/utils/__tests__/model-pricing.test.ts
git commit -m "refactor(ai-lib): remove Bedrock pricing calculations"
```

---

## Task 8: Remove Bedrock Cache Support from prompt-caching.ts

**Goal:** Remove Bedrock cache point support (lines 19-380 per ticket).

**Files:**

- Modify: `packages/ai-lib/src/utils/prompt-caching.ts`
- Modify: `packages/ai-lib/src/utils/__tests__/prompt-caching.test.ts`

- [ ] **Step 1: Identify Bedrock cache code**

Run: `grep -n "bedrock" packages/ai-lib/src/utils/prompt-caching.ts -i`

Expected: See line numbers with Bedrock cache logic

- [ ] **Step 2: Read the cache implementation**

Run: `head -n 400 packages/ai-lib/src/utils/prompt-caching.ts | tail -n 370`

Expected: See Bedrock-specific cache point logic in lines 19-380

- [ ] **Step 3: Remove Bedrock cache point logic**

Edit `packages/ai-lib/src/utils/prompt-caching.ts`:

Remove Bedrock-specific cache point implementation (lines 19-380 or actual range).
Keep OpenAI/Anthropic cache logic intact.

- [ ] **Step 4: Verify removal**

Run: `grep -i bedrock packages/ai-lib/src/utils/prompt-caching.ts`

Expected: No matches

- [ ] **Step 5: Update tests - remove Bedrock cache tests**

Edit `packages/ai-lib/src/utils/__tests__/prompt-caching.test.ts`:

Remove test cases that validate Bedrock prompt caching.

- [ ] **Step 6: Run tests**

Run: `cd packages/ai-lib && pnpm test prompt-caching`

Expected: All tests pass

- [ ] **Step 7: Commit changes**

```bash
git add packages/ai-lib/src/utils/prompt-caching.ts packages/ai-lib/src/utils/__tests__/prompt-caching.test.ts
git commit -m "refactor(ai-lib): remove Bedrock prompt caching support"
```

---

## Task 9: Remove Bedrock Token Counting from token-counter.ts

**Goal:** Remove Bedrock Claude model token counting and ARN handling.

**Files:**

- Modify: `packages/ai-lib/src/utils/token-counter.ts`
- Modify: `packages/ai-lib/src/utils/__tests__/token-counter.test.ts`

- [ ] **Step 1: Identify Bedrock token counting code**

Run: `grep -n "bedrock" packages/ai-lib/src/utils/token-counter.ts -i`

Expected: See Bedrock ARN model ID handling

- [ ] **Step 2: Remove Bedrock token counting logic**

Edit `packages/ai-lib/src/utils/token-counter.ts`:

Remove:

- Bedrock Claude model token counting
- Bedrock ARN model ID handling (e.g., extracting model from ARN strings)

- [ ] **Step 3: Verify removal**

Run: `grep -i "bedrock\|arn:aws" packages/ai-lib/src/utils/token-counter.ts`

Expected: No matches

- [ ] **Step 4: Update tests - remove Bedrock token tests**

Edit `packages/ai-lib/src/utils/__tests__/token-counter.test.ts`:

Remove test cases that validate Bedrock token counting.

- [ ] **Step 5: Run tests**

Run: `cd packages/ai-lib && pnpm test token-counter`

Expected: All tests pass

- [ ] **Step 6: Commit changes**

```bash
git add packages/ai-lib/src/utils/token-counter.ts packages/ai-lib/src/utils/__tests__/token-counter.test.ts
git commit -m "refactor(ai-lib): remove Bedrock token counting support"
```

---

## Task 10: Remove Bedrock Embeddings from embeddings.ts

**Goal:** Remove Bedrock embedding model support if present.

**Files:**

- Modify: `packages/ai-lib/src/utils/embeddings.ts` (if Bedrock references exist)

- [ ] **Step 1: Check for Bedrock embeddings**

Run: `grep -i bedrock packages/ai-lib/src/utils/embeddings.ts`

Expected: May have matches, or may be empty if no Bedrock embedding support

- [ ] **Step 2: Remove Bedrock embedding logic (if present)**

If Bedrock references found:

Edit `packages/ai-lib/src/utils/embeddings.ts`:

Remove Bedrock embedding model definitions and logic.

- [ ] **Step 3: Verify removal**

Run: `grep -i bedrock packages/ai-lib/src/utils/embeddings.ts`

Expected: No matches

- [ ] **Step 4: Run typecheck**

Run: `cd packages/ai-lib && pnpm typecheck`

Expected: Should have fewer type errors

- [ ] **Step 5: Commit changes (if changes made)**

```bash
git add packages/ai-lib/src/utils/embeddings.ts
git commit -m "refactor(ai-lib): remove Bedrock embedding support"
```

---

## Task 11: Update Setup Tool - Remove aws-bedrock Provider

**Goal:** Update setup tool to only support GoCode provider.

**Files:**

- Modify: `setup/src/env-generator.ts:17`

- [ ] **Step 1: Read current ModelConfig interface**

Run: `sed -n '15,25p' setup/src/env-generator.ts`

Expected: See line 17 with `provider: "aws-bedrock" | "gocode"`

- [ ] **Step 2: Update ModelConfig provider type**

Edit `setup/src/env-generator.ts` line 17:

Change:

```typescript
provider: "aws-bedrock" | "gocode";
```

To:

```typescript
provider: "gocode";
```

- [ ] **Step 3: Remove AWS-specific fields from ModelConfig**

Edit `setup/src/env-generator.ts`:

Remove or make optional (depending on usage):

```typescript
awsRegion?: string;
awsProfile?: string;
```

These should be removed if they're Bedrock-specific.

- [ ] **Step 4: Search for aws-bedrock usage in setup**

Run: `grep -n "aws-bedrock" setup/src/env-generator.ts`

Expected: See if there are provider selection switches/conditionals

- [ ] **Step 5: Remove aws-bedrock conditionals**

Edit `setup/src/env-generator.ts`:

Remove any conditionals or logic that handles "aws-bedrock" provider selection.

- [ ] **Step 6: Verify changes**

Run: `grep -i "aws-bedrock\|bedrock" setup/src/env-generator.ts`

Expected: No matches

- [ ] **Step 7: Run setup typecheck**

Run: `cd setup && pnpm typecheck`

Expected: No type errors

- [ ] **Step 8: Commit changes**

```bash
git add setup/src/env-generator.ts
git commit -m "refactor(setup): remove aws-bedrock provider option, use GoCode only"
```

---

## Task 12: Verify Agents Service - GoCode-Only Support

**Goal:** Ensure agents service works with GoCode only, remove any Bedrock references.

**Files:**

- Read: `agents/src/utils/model-selection.ts`
- Read: `agents/src/services/ConversationHistoryLoader.ts`
- Delete: `agents/src/server/routes/__tests__/bedrock-validation.test.ts` (if exists)

- [ ] **Step 1: Check for bedrock validation test**

Run: `test -f agents/src/server/routes/__tests__/bedrock-validation.test.ts && echo "EXISTS" || echo "NOT FOUND"`

Expected: Either EXISTS or NOT FOUND

- [ ] **Step 2: Delete bedrock validation test (if exists)**

If file exists:

```bash
rm -f agents/src/server/routes/__tests__/bedrock-validation.test.ts
```

- [ ] **Step 3: Check model-selection for Bedrock references**

Run: `grep -i bedrock agents/src/utils/model-selection.ts`

Expected: May have matches or none

- [ ] **Step 4: Remove Bedrock logic from model-selection (if present)**

If Bedrock references found:

Edit `agents/src/utils/model-selection.ts`:

Remove Bedrock-specific model selection logic.

- [ ] **Step 5: Check ConversationHistoryLoader**

Run: `grep -i bedrock agents/src/services/ConversationHistoryLoader.ts`

Expected: May have matches or none

- [ ] **Step 6: Remove Bedrock references from ConversationHistoryLoader (if present)**

If Bedrock references found:

Edit `agents/src/services/ConversationHistoryLoader.ts`:

Remove Bedrock-specific logic.

- [ ] **Step 7: Run agents tests**

Run: `cd agents && pnpm test:unit`

Expected: All tests pass

- [ ] **Step 8: Commit changes (if any made)**

```bash
git add agents/src/
git commit -m "refactor(agents): remove Bedrock references from agents service"
```

---

## Task 13: Delete bedrock-log-viewer Directory

**Goal:** Completely remove the standalone Bedrock log viewer tool.

**Files:**

- Delete: `bedrock-log-viewer/` (entire directory)

- [ ] **Step 1: Verify directory exists**

Run: `test -d bedrock-log-viewer && echo "EXISTS" || echo "NOT FOUND"`

Expected: EXISTS

- [ ] **Step 2: Check directory size**

Run: `du -sh bedrock-log-viewer`

Expected: See directory size (for documentation)

- [ ] **Step 3: Delete the entire directory**

```bash
rm -rf bedrock-log-viewer
```

Expected: Directory deleted

- [ ] **Step 4: Verify deletion**

Run: `test -d bedrock-log-viewer && echo "STILL EXISTS" || echo "DELETED"`

Expected: DELETED

- [ ] **Step 5: Check if bedrock-log-viewer is referenced in root files**

Run: `grep -r "bedrock-log-viewer" . --include="package.json" --include="*.md" --exclude-dir=node_modules --exclude-dir=.git`

Expected: May find references in root documentation

- [ ] **Step 6: Commit deletion**

```bash
git add -A
git commit -m "chore: remove bedrock-log-viewer standalone tool"
```

---

## Task 14: Update Environment File Templates

**Goal:** Remove AWS-related environment variables from .env.example files.

**Files:**

- Modify: `agents/.env.example`
- Modify: `app/.env.example`
- Modify: `packages/design-extractor/.env.example`
- Modify: `packages/ai-lib/env.example`

- [ ] **Step 1: Check agents .env.example for AWS vars**

Run: `grep -i "aws\|bedrock" agents/.env.example`

Expected: May see AWS_REGION, AWS_PROFILE, AWS_ACCESS_KEY_ID, etc.

- [ ] **Step 2: Remove AWS variables from agents .env.example**

Edit `agents/.env.example`:

Remove:

- AWS_REGION
- AWS_PROFILE
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- Any BEDROCK\_\* variables

- [ ] **Step 3: Check app .env.example**

Run: `grep -i "aws\|bedrock" app/.env.example`

Expected: May have AWS variables or may be clean

- [ ] **Step 4: Remove AWS variables from app .env.example (if present)**

Edit `app/.env.example`:

Remove AWS-related variables if found.

- [ ] **Step 5: Update design-extractor .env.example**

Run: `grep -n "bedrock" packages/design-extractor/.env.example -i`

Expected: See Bedrock configuration option (lines 10-13 per ticket)

Edit `packages/design-extractor/.env.example`:

Remove Bedrock provider option, update default to GoCode.

- [ ] **Step 6: Update ai-lib env.example**

Run: `grep -i "bedrock\|aws" packages/ai-lib/env.example`

Expected: May have AWS/Bedrock configuration examples

Edit `packages/ai-lib/env.example`:

Remove Bedrock configuration examples.

- [ ] **Step 7: Verify all env files**

Run: `grep -r "bedrock" agents/.env.example app/.env.example packages/design-extractor/.env.example packages/ai-lib/env.example -i`

Expected: No matches

- [ ] **Step 8: Commit changes**

```bash
git add agents/.env.example app/.env.example packages/design-extractor/.env.example packages/ai-lib/env.example
git commit -m "chore: remove AWS/Bedrock variables from env templates"
```

---

## Task 15: Update Documentation - INTEGRATION_GUIDE.md

**Goal:** Remove Bedrock setup instructions from ai-lib integration guide.

**Files:**

- Modify: `packages/ai-lib/INTEGRATION_GUIDE.md`

- [ ] **Step 1: Check for Bedrock content**

Run: `grep -n "bedrock" packages/ai-lib/INTEGRATION_GUIDE.md -i`

Expected: See Bedrock setup instructions (lines 30-87 per ticket)

- [ ] **Step 2: Identify Bedrock section bounds**

Run: `sed -n '25,95p' packages/ai-lib/INTEGRATION_GUIDE.md | grep -n "##\|###"`

Expected: See section headers to identify what to remove

- [ ] **Step 3: Remove Bedrock setup section**

Edit `packages/ai-lib/INTEGRATION_GUIDE.md`:

Remove lines 30-87 (or the actual range containing Bedrock setup).
This includes:

- Bedrock provider configuration
- AWS credential setup
- Bedrock-specific examples

- [ ] **Step 4: Verify removal**

Run: `grep -i bedrock packages/ai-lib/INTEGRATION_GUIDE.md`

Expected: No matches

- [ ] **Step 5: Commit changes**

```bash
git add packages/ai-lib/INTEGRATION_GUIDE.md
git commit -m "docs(ai-lib): remove Bedrock setup from integration guide"
```

---

## Task 16: Update Documentation - SETUP.md and README.md

**Goal:** Remove Bedrock configuration from setup documentation and README.

**Files:**

- Modify: `packages/ai-lib/SETUP.md`
- Modify: `packages/ai-lib/README.md`

- [ ] **Step 1: Update SETUP.md**

Run: `grep -i bedrock packages/ai-lib/SETUP.md`

Expected: See Bedrock configuration docs

Edit `packages/ai-lib/SETUP.md`:

Remove all Bedrock configuration sections, AWS credential setup instructions.

- [ ] **Step 2: Verify SETUP.md**

Run: `grep -i bedrock packages/ai-lib/SETUP.md`

Expected: No matches

- [ ] **Step 3: Update README.md**

Run: `grep -i bedrock packages/ai-lib/README.md`

Expected: See Bedrock mentioned in provider list

Edit `packages/ai-lib/README.md`:

Remove Bedrock from supported providers list.
Update examples to not reference Bedrock.

- [ ] **Step 4: Verify README.md**

Run: `grep -i bedrock packages/ai-lib/README.md`

Expected: No matches

- [ ] **Step 5: Commit changes**

```bash
git add packages/ai-lib/SETUP.md packages/ai-lib/README.md
git commit -m "docs(ai-lib): remove Bedrock references from setup and readme"
```

---

## Task 17: Update Additional Documentation Files

**Goal:** Remove remaining Bedrock references from other documentation.

**Files:**

- Modify: `packages/ai-lib/PROMPT-CACHING.md` (if has Bedrock examples)
- Modify: `packages/ai-lib/UNIFIED-PROVIDER-MIGRATION.md` (if mentions Bedrock)
- Modify: Any root-level docs that mention Bedrock

- [ ] **Step 1: Check PROMPT-CACHING.md**

Run: `grep -i bedrock packages/ai-lib/PROMPT-CACHING.md`

Expected: May have Bedrock caching examples

- [ ] **Step 2: Update PROMPT-CACHING.md (if needed)**

Edit `packages/ai-lib/PROMPT-CACHING.md`:

Remove Bedrock prompt caching examples.

- [ ] **Step 3: Check UNIFIED-PROVIDER-MIGRATION.md**

Run: `grep -i bedrock packages/ai-lib/UNIFIED-PROVIDER-MIGRATION.md`

Expected: May mention Bedrock migration

- [ ] **Step 4: Update UNIFIED-PROVIDER-MIGRATION.md (if needed)**

Edit `packages/ai-lib/UNIFIED-PROVIDER-MIGRATION.md`:

Remove Bedrock migration examples and references.

- [ ] **Step 5: Search for Bedrock in root docs**

Run: `grep -r "bedrock" *.md --ignore-case 2>/dev/null`

Expected: May find references in root CLAUDE.md, README.md, etc.

- [ ] **Step 6: Update root documentation (if needed)**

Edit any root-level markdown files that mention Bedrock.

- [ ] **Step 7: Final documentation sweep**

Run: `grep -r "bedrock\|aws-bedrock" . --include="*.md" --exclude-dir=node_modules --exclude-dir=.git -i`

Expected: No matches (or only in git history/changelogs)

- [ ] **Step 8: Commit changes**

```bash
git add *.md packages/ai-lib/*.md
git commit -m "docs: remove remaining Bedrock references from documentation"
```

---

## Task 18: Run Full Test Suite and Build

**Goal:** Verify all changes are working - no broken tests or builds.

**Files:**

- Test: All packages

- [ ] **Step 1: Run ai-lib tests**

Run: `cd packages/ai-lib && pnpm test`

Expected: All tests pass (compare with baseline from Task 1)

- [ ] **Step 2: Run ai-lib typecheck**

Run: `cd packages/ai-lib && pnpm typecheck`

Expected: No type errors

- [ ] **Step 3: Run setup typecheck**

Run: `cd setup && pnpm typecheck`

Expected: No type errors

- [ ] **Step 4: Run agents tests**

Run: `cd agents && pnpm test:unit`

Expected: All tests pass

- [ ] **Step 5: Run full workspace build**

Run: `pnpm build`

Expected: All packages build successfully

- [ ] **Step 6: Run full workspace typecheck**

Run: `pnpm typecheck`

Expected: No type errors across workspace

- [ ] **Step 7: Run full workspace lint**

Run: `pnpm lint`

Expected: No lint errors

---

## Task 19: Final Verification and Cleanup

**Goal:** Comprehensive verification that all Bedrock code is removed.

**Files:**

- Verify: Entire codebase

- [ ] **Step 1: Search for remaining bedrock references in source**

Run: `grep -r "bedrock" packages/ai-lib/src agents/src setup/src --ignore-case`

Expected: No matches

- [ ] **Step 2: Search for AWS SDK Bedrock imports**

Run: `grep -r "@ai-sdk/amazon-bedrock\|@aws-sdk/client-bedrock-runtime\|@aws-sdk/credential-providers" . --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude-dir=.git`

Expected: No matches

- [ ] **Step 3: Verify package.json files**

Run: `grep -r "@ai-sdk/amazon-bedrock\|@aws-sdk/client-bedrock-runtime\|@aws-sdk/credential-providers" . --include="package.json" --exclude-dir=node_modules`

Expected: No matches (except possibly in pnpm-lock.yaml history)

- [ ] **Step 4: Check for orphaned Bedrock test files**

Run: `find . -name "*bedrock*.test.ts" -o -name "*bedrock*.spec.ts" 2>/dev/null | grep -v node_modules`

Expected: No files found

- [ ] **Step 5: Verify bedrock-log-viewer is gone**

Run: `test -d bedrock-log-viewer && echo "ERROR: Still exists" || echo "OK: Deleted"`

Expected: OK: Deleted

- [ ] **Step 6: Check git status**

Run: `git status`

Expected: Clean working tree (or only untracked files)

---

## Task 20: Create Summary and Open PR

**Goal:** Document changes and create pull request.

**Files:**

- Create: Commit summary

- [ ] **Step 1: Review commit history**

Run: `git log --oneline main..HEAD`

Expected: See all commits from this branch

- [ ] **Step 2: Verify commit count**

Run: `git rev-list --count main..HEAD`

Expected: Should be around 15-20 commits

- [ ] **Step 3: Run final build check**

Run: `pnpm build && pnpm typecheck && pnpm lint`

Expected: All pass

- [ ] **Step 4: Push branch**

Run: `git push -u origin deverton/remove-bedrock`

Expected: Branch pushed successfully

- [ ] **Step 5: Create PR summary**

Prepare PR description with:

- Summary: Removes AWS Bedrock AI provider support, leaving GoCode as sole provider
- Changes:
  - Removed Bedrock provider code from packages/ai-lib/
  - Deleted bedrock-log-viewer/ standalone tool
  - Removed 3 AWS dependencies (@ai-sdk/amazon-bedrock, @aws-sdk/client-bedrock-runtime, @aws-sdk/credential-providers)
  - Updated setup tool to only support GoCode
  - Removed 6 Bedrock example files
  - Updated all documentation
- Testing: All builds pass, no type errors, tests updated
- Jira: AIROBUILD-1077

- [ ] **Step 6: Open PR**

Use `gh pr create` or GitHub UI to create PR against main branch.

---

## Testing Checklist

After implementation, verify:

### Unit Tests

- [ ] All ai-lib tests pass: `cd packages/ai-lib && pnpm test`
- [ ] All agents tests pass: `cd agents && pnpm test:unit`
- [ ] All setup tests pass: `cd setup && pnpm test`

### Type Checking

- [ ] ai-lib typecheck passes: `cd packages/ai-lib && pnpm typecheck`
- [ ] Workspace typecheck passes: `pnpm typecheck`

### Build

- [ ] Full workspace build succeeds: `pnpm build`
- [ ] No Bedrock dependencies in package.json files

### Manual Verification

- [ ] No "bedrock" or "aws-bedrock" strings in source code: `grep -r "bedrock" packages/ai-lib/src agents/src setup/src -i`
- [ ] bedrock-log-viewer/ directory deleted
- [ ] All Bedrock example files deleted
- [ ] No AWS SDK Bedrock imports remain
- [ ] Documentation updated (no Bedrock references)

### Regression Testing

- [ ] GoCode provider still works for agent creation
- [ ] Streaming responses work with GoCode
- [ ] Tool calling works with GoCode
- [ ] Token counting works for GoCode models

---

## Rollback Plan

If issues arise:

1. **Reset to main:**

   ```bash
   git reset --hard main
   ```

2. **Cherry-pick specific commits:**

   ```bash
   git cherry-pick <commit-hash>
   ```

3. **Revert specific commits:**
   ```bash
   git revert <commit-hash>
   ```

---

## Notes

- **DRY Principle:** Each commit is focused on a single logical change
- **YAGNI:** Removing unused code (Bedrock) to reduce maintenance burden
- **Frequent Commits:** Each task ends with a commit for easy rollback
- **Type Safety:** Typecheck after each major change to catch issues early
- **Testing:** Run tests after each significant modification
- **Documentation:** Keep docs in sync with code changes

---

## Acceptance Criteria

- [x] All AWS Bedrock provider code removed from `packages/ai-lib/`
- [x] All Bedrock-specific configuration removed from environment files and setup tools
- [x] All Bedrock-related dependencies removed from package.json files
- [x] `bedrock-log-viewer/` directory completely removed
- [x] All Bedrock examples removed from `packages/ai-lib/examples/`
- [x] All Bedrock tests removed or updated to focus on GoCode only
- [x] Documentation updated to remove all Bedrock references
- [x] All builds pass: `pnpm build`, `pnpm typecheck`, `pnpm lint`
- [x] Existing GoCode functionality remains unchanged and tested

**Estimated Effort:** 3-5 days (as per ticket)
