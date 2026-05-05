# Retire Knowledge Service — Switch to GoKnowb + Cohere Rerank

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the Qdrant-backed `knowledge-service` HTTP driver and route all agent knowledge base search through GoKnowb with Cohere reranking, client-side per-document dedup, over-fetch, and top-K=3.

**Architecture:** Delete the `KnowledgeServiceDriver` + all fallback code paths. Update `KnowBDriver` defaults to use `LEXICAL_AND_SEMANTIC` searchType + Cohere rerank + over-fetch of 15 + client-side dedup by `kbNodeId` + top-K=3. Set `scoreThreshold: 0.0` explicitly to override Bedrock's default 0.5 (which would drop all Cohere rerank results). No absolute-threshold filter — rely on Cohere ordering + top-K.

**Tech Stack:** TypeScript, `@godaddy/goknowb-client` v1.0.9, Vitest, Node 20.

**Scope:** `agents/` package only. CDK Qdrant stack, `knowledge-service/` Go service directory, and GitHub workflows are out of scope for this PR — separate cleanup later.

**Expected behavior after:**

- Top-1 accuracy on 15-query test: 10/10 (measured 2026-05-04)
- Irrelevant queries surfaced by Cohere at score ≤ 0.03; top-K=3 returned regardless (agent LLM filters)
- Dedup ensures 3 results = 3 unique documents

---

## File Map

**Delete:**

- `agents/src/tools/ai-lib-tools/drivers/knowledge-service-driver.ts` — entire file

**Modify:**

- `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts` — new defaults + dedup + over-fetch
- `agents/src/tools/ai-lib-tools/drivers/index.ts` — remove KS exports
- `agents/src/tools/knowb-search-tool.ts` — remove KS fallback
- `agents/src/tools/ai-lib-tools/knowb-search.ts` — update schema defaults + remove KS comment
- `agents/src/server/context-builders.ts` — drop KS driver; always use KnowB

**Create:**

- `agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts` — unit tests for dedup + search config

---

## Task 1: Add dedup helper + write tests (TDD)

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts`
- Create: `agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts`

- [ ] **Step 1: Create test file with failing dedup tests**

Create `agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { dedupByKbNodeId, type KnowBResultItem } from "../knowb-driver.js";

describe("dedupByKbNodeId", () => {
  it("returns empty array when input is empty", () => {
    expect(dedupByKbNodeId([])).toEqual([]);
  });

  it("keeps single result unchanged", () => {
    const input: KnowBResultItem[] = [
      { kbNodeId: "/airo_info/deployment", text: "a", score: 0.5 },
    ];
    expect(dedupByKbNodeId(input)).toEqual(input);
  });

  it("removes duplicate kbNodeIds, keeping first occurrence (highest score)", () => {
    const input: KnowBResultItem[] = [
      { kbNodeId: "/airo_info/deployment", text: "chunk-a", score: 0.57 },
      { kbNodeId: "/airo_info/deployment", text: "chunk-b", score: 0.37 },
      { kbNodeId: "/airo_info/media_manager", text: "media-a", score: 0.06 },
    ];

    const result = dedupByKbNodeId(input);

    expect(result).toEqual([
      { kbNodeId: "/airo_info/deployment", text: "chunk-a", score: 0.57 },
      { kbNodeId: "/airo_info/media_manager", text: "media-a", score: 0.06 },
    ]);
  });

  it("preserves order of first-seen kbNodeIds", () => {
    const input: KnowBResultItem[] = [
      { kbNodeId: "/doc-b", text: "b1", score: 0.9 },
      { kbNodeId: "/doc-a", text: "a1", score: 0.8 },
      { kbNodeId: "/doc-b", text: "b2", score: 0.7 },
      { kbNodeId: "/doc-a", text: "a2", score: 0.6 },
    ];

    const result = dedupByKbNodeId(input);

    expect(result.map((r) => r.kbNodeId)).toEqual(["/doc-b", "/doc-a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails with import error**

Run: `pnpm --filter @airo/agents test:unit knowb-driver.test`
Expected: FAIL — `dedupByKbNodeId` not exported from `knowb-driver.ts`

- [ ] **Step 3: Add `dedupByKbNodeId` to `knowb-driver.ts`**

Add this exported function near the top of `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts` (after the existing `KnowBResultItem` interface definition):

```typescript
/**
 * Deduplicate search results by `kbNodeId`, keeping the first (highest-scoring)
 * occurrence per document. Bedrock returns chunk-level hits; multiple chunks of
 * the same document can occupy top-K slots, starving other relevant docs.
 */
export function dedupByKbNodeId(results: KnowBResultItem[]): KnowBResultItem[] {
  const seen = new Set<string>();
  const out: KnowBResultItem[] = [];
  for (const r of results) {
    if (seen.has(r.kbNodeId)) continue;
    seen.add(r.kbNodeId);
    out.push(r);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit knowb-driver.test`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts \
        agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts
git commit -m "feat(agents): add dedupByKbNodeId helper for KnowB results"
```

---

## Task 2: Switch `KnowBDriver.search` to Cohere rerank + over-fetch + dedup + top-K

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts`
- Modify: `agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts`

- [ ] **Step 1: Add failing integration-style test that verifies request shape**

Append to `agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts`:

```typescript
import { vi } from "vitest";
import {
  GoKnowbClientImpl,
  SearchType,
  RerankingStrategy,
} from "@godaddy/goknowb-client";
import { KnowBDriver } from "../knowb-driver.js";

describe("KnowBDriver.search — request shape", () => {
  it("sends LEXICAL_AND_SEMANTIC + COHERE rerank + over-fetch + scoreThreshold 0.0", async () => {
    const searchSpy = vi
      .spyOn(GoKnowbClientImpl.prototype, "search")
      .mockResolvedValue({
        results: [
          {
            location: { kbNodeId: "/airo_info/deployment" },
            content: { text: "a", type: "TEXT" },
            score: 0.5,
          },
        ],
      });

    process.env.SSO_JWT = "fake-jwt";
    const driver = new KnowBDriver();

    await driver.search({ query: "publish my changes" });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const req = searchSpy.mock.calls[0]![0];
    expect(req.searchType).toBe(SearchType.LEXICAL_AND_SEMANTIC);
    expect(req.rerankingConfig?.type).toBe(RerankingStrategy.COHERE);
    expect(req.rerankingConfig?.results).toBe(15);
    expect(req.filter.maxNumberOfResult).toBe(15);
    expect(req.filter.scoreThreshold).toBe(0.0);
    expect(req.filter.kbNodeIds).toEqual(["/airo_info"]);

    searchSpy.mockRestore();
    delete process.env.SSO_JWT;
  });

  it("deduplicates results and trims to top 3", async () => {
    const searchSpy = vi
      .spyOn(GoKnowbClientImpl.prototype, "search")
      .mockResolvedValue({
        results: [
          {
            location: { kbNodeId: "/airo_info/deployment" },
            content: { text: "chunk-a", type: "TEXT" },
            score: 0.57,
          },
          {
            location: { kbNodeId: "/airo_info/deployment" },
            content: { text: "chunk-b", type: "TEXT" },
            score: 0.37,
          },
          {
            location: { kbNodeId: "/airo_info/media_manager" },
            content: { text: "m", type: "TEXT" },
            score: 0.06,
          },
          {
            location: { kbNodeId: "/airo_info/llm_models" },
            content: { text: "l", type: "TEXT" },
            score: 0.04,
          },
          {
            location: { kbNodeId: "/airo_info/email" },
            content: { text: "e", type: "TEXT" },
            score: 0.03,
          },
        ],
      });

    process.env.SSO_JWT = "fake-jwt";
    const driver = new KnowBDriver();

    const result = await driver.search({ query: "publish my changes" });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results![0].kbNodeId).toBe("/airo_info/deployment");
    expect(result.results![0].text).toBe("chunk-a");
    expect(result.results![1].kbNodeId).toBe("/airo_info/media_manager");
    expect(result.results![2].kbNodeId).toBe("/airo_info/llm_models");

    searchSpy.mockRestore();
    delete process.env.SSO_JWT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit knowb-driver.test`
Expected: FAIL — request shape test fails because current code sends `SearchType.AUTO` with no rerank; dedup test fails because current code returns 5 raw results with duplicates.

- [ ] **Step 3: Update `KnowBDriver` defaults + search request + post-processing**

In `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts`:

**3a.** Add `RerankingStrategy` to the goknowb-client import (top of file):

```typescript
import {
  GoKnowbClientImpl,
  TokenProvider,
  SearchType,
  RerankingStrategy,
  type SearchKBRequest,
  type CreateKBNodeRequest,
} from "@godaddy/goknowb-client";
```

**3b.** Replace the default constants inside the `KnowBDriver` class:

```typescript
  // Default configuration
  // See docs: GoKnowb RAG Configuration Reference (Confluence) + plan 2026-05-04.
  private static readonly DEFAULT_KB_NODE_IDS = ['/airo_info'];
  /** Final top-K returned to callers (post-dedup). */
  private static readonly DEFAULT_MAX_RESULTS = 3;
  /**
   * Over-fetch factor × final top-K → number of candidates we ask Bedrock for.
   * 15 candidates gives dedup room + broader Cohere rerank input.
   */
  private static readonly OVER_FETCH_COUNT = 15;
  /**
   * Explicit score threshold of 0.0. Bedrock's default is 0.5 — applied
   * server-side to Cohere rerank scores it would filter out nearly all
   * relevant results (empirically measured 0.06–0.57 range). We let Cohere
   * rerank ordering + top-K do the selection instead.
   */
  private static readonly DEFAULT_SCORE_THRESHOLD = 0.0;
```

**3c.** Replace the body of the `search` method's request building + response mapping. Find this block:

```typescript
const request: SearchKBRequest = {
  filter: {
    kbNodeIds,
    maxNumberOfResult: maxResults,
    scoreThreshold,
  },
  query: query.trim(),
  searchType: SearchType.AUTO,
};

const response = await this.client.search(request);

const results: KnowBResultItem[] = response.results.map((item) => ({
  kbNodeId: item.location.kbNodeId,
  text: item.content.text,
  score: item.score,
}));
```

Replace it with:

```typescript
// Over-fetch Cohere-reranked candidates, then dedup + trim client-side.
// Bedrock rerank score replaces raw cosine in `item.score`.
const request: SearchKBRequest = {
  filter: {
    kbNodeIds,
    maxNumberOfResult: KnowBDriver.OVER_FETCH_COUNT,
    scoreThreshold,
  },
  query: query.trim(),
  searchType: SearchType.LEXICAL_AND_SEMANTIC,
  rerankingConfig: {
    type: RerankingStrategy.COHERE,
    results: KnowBDriver.OVER_FETCH_COUNT,
  },
};

const response = await this.client.search(request);

const rawResults: KnowBResultItem[] = response.results.map((item) => ({
  kbNodeId: item.location.kbNodeId,
  text: item.content.text,
  score: item.score,
}));

const results = dedupByKbNodeId(rawResults).slice(0, maxResults);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit knowb-driver.test`
Expected: PASS on all tests (6/6).

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts \
        agents/src/tools/ai-lib-tools/drivers/__tests__/knowb-driver.test.ts
git commit -m "feat(agents): switch KnowB search to Cohere rerank + dedup + top-3"
```

---

## Task 3: Delete `knowledge-service-driver.ts` + remove its exports

**Files:**

- Delete: `agents/src/tools/ai-lib-tools/drivers/knowledge-service-driver.ts`
- Modify: `agents/src/tools/ai-lib-tools/drivers/index.ts`

- [ ] **Step 1: Delete the driver file**

```bash
rm agents/src/tools/ai-lib-tools/drivers/knowledge-service-driver.ts
```

- [ ] **Step 2: Remove KnowledgeServiceDriver exports from drivers index**

In `agents/src/tools/ai-lib-tools/drivers/index.ts`, find:

```typescript
export {
  KnowledgeServiceDriver,
  getKnowledgeServiceUrl,
  getKnowledgeServiceDriver,
} from "./knowledge-service-driver.js";
```

Remove that line entirely.

- [ ] **Step 3: Verify typecheck exposes callers (will be fixed in Task 4 + 5)**

Run: `pnpm --filter @airo/agents typecheck 2>&1 | grep -E "knowledge-service-driver|getKnowledgeServiceDriver"`
Expected: errors in `knowb-search-tool.ts` and `context-builders.ts`, to be fixed next. (No other callers should exist.)

- [ ] **Step 4: Commit**

```bash
git add agents/src/tools/ai-lib-tools/drivers/knowledge-service-driver.ts \
        agents/src/tools/ai-lib-tools/drivers/index.ts
git commit -m "refactor(agents): delete KnowledgeServiceDriver (superseded by KnowB+Cohere)"
```

---

## Task 4: Remove KnowledgeService fallback from `knowb-search-tool.ts`

**Files:**

- Modify: `agents/src/tools/knowb-search-tool.ts`

- [ ] **Step 1: Remove the import**

In `agents/src/tools/knowb-search-tool.ts`, delete this line:

```typescript
import { getKnowledgeServiceDriver } from "./ai-lib-tools/drivers/knowledge-service-driver.js";
```

- [ ] **Step 2: Update the header comment**

Find the top-of-file comment block:

```typescript
/**
 * KnowB Search Tool
 *
 * Searches GoDaddy's knowledge base API for deployment and application documentation.
 * Uses KnowledgeServiceDriver when configured (KNOWLEDGE_SERVICE_URL or KNOWLEDGE_PROXY_URL),
 * falling back to KnowBDriver for backward compatibility.
 */
```

Replace with:

```typescript
/**
 * KnowB Search Tool
 *
 * Searches GoDaddy's knowledge base via GoKnowb + Cohere reranking.
 * Post-processing (dedup + top-K=3) is handled inside KnowBDriver.
 */
```

- [ ] **Step 3: Remove the fallback driver selection**

Find:

```typescript
    // Use KnowledgeServiceDriver when configured, fall back to KnowBDriver
    const driver = getKnowledgeServiceDriver() ?? knowBDriver;
    const driverResult = await driver.search({
```

Replace with:

```typescript
    const driverResult = await knowBDriver.search({
```

- [ ] **Step 4: Run typecheck + unit tests**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS for `knowb-search-tool.ts` (only `context-builders.ts` still broken)

Run: `pnpm --filter @airo/agents test:unit knowb-search-tool`
Expected: PASS if tests exist, or 0 tests found.

- [ ] **Step 5: Commit**

```bash
git add agents/src/tools/knowb-search-tool.ts
git commit -m "refactor(agents): route knowb-search-tool through KnowBDriver only"
```

---

## Task 5: Clean up `knowb-search.ts` schema comment + default threshold

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/knowb-search.ts`

- [ ] **Step 1: Update the scoreThreshold field comment + default**

In `agents/src/tools/ai-lib-tools/knowb-search.ts`, find the `scoreThreshold` field in the zod schema:

```typescript
    // KnowB uses AWS Bedrock embeddings with a different score distribution than
    // the Knowledge Service (which uses text-embedding-3-large via GoCode). KnowB
    // scores cluster in a narrower 0.35-0.51 range, so 0.67 intentionally acts as
    // a strict filter. Knowledge Service uses 0.50 (see knowledge-service-driver.ts).
    scoreThreshold: z
      .number()
      .optional()
      .default(0.67)
      .describe('Minimum similarity score threshold (0.0-1.0)'),
```

Replace with:

```typescript
    // Cohere rerank replaces raw cosine and outputs probability-calibrated
    // scores that do NOT correspond to raw cosine magnitudes. The driver
    // sends scoreThreshold: 0.0 to Bedrock regardless, because Bedrock's
    // default 0.5 would drop most Cohere rerank results. Keep this field
    // exposed for backward compatibility, but note the final ranking comes
    // from Cohere + dedup + top-K=3 inside KnowBDriver, not this threshold.
    scoreThreshold: z
      .number()
      .optional()
      .default(0.0)
      .describe('Score threshold passed to Bedrock. Defaults to 0.0 because Cohere rerank + top-K drives selection.'),
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS for `knowb-search.ts`.

- [ ] **Step 3: Commit**

```bash
git add agents/src/tools/ai-lib-tools/knowb-search.ts
git commit -m "refactor(agents): update knowb-search schema default + comment for Cohere"
```

---

## Task 6: Strip KnowledgeService driver usage from `context-builders.ts`

**Files:**

- Modify: `agents/src/server/context-builders.ts`

- [ ] **Step 1: Remove the import**

In `agents/src/server/context-builders.ts`, delete this line:

```typescript
import { getKnowledgeServiceDriver } from "../tools/ai-lib-tools/drivers/knowledge-service-driver.js";
```

- [ ] **Step 2: Simplify the `searchDocumentation` function**

Find:

```typescript
const knowledgeDriver = getKnowledgeServiceDriver();

updateActiveObservation({
  metadata: {
    retrievalType: "semantic_search",
    retrievalBackend: knowledgeDriver ? "knowledge-service" : "knowb",
    appId: params.appId,
    sessionId: params.sessionId,
    maxResults: params.maxResults,
    scoreThreshold: params.scoreThreshold,
  },
});

const driver = knowledgeDriver ?? new KnowBDriver();
```

Replace with:

```typescript
updateActiveObservation({
  metadata: {
    retrievalType: "semantic_search",
    retrievalBackend: "knowb",
    appId: params.appId,
    sessionId: params.sessionId,
    maxResults: params.maxResults,
    scoreThreshold: params.scoreThreshold,
  },
});

const driver = new KnowBDriver();
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS across the whole package.

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/context-builders.ts
git commit -m "refactor(agents): drop KnowledgeService driver from context-builders"
```

---

## Task 7: Final verification

**Files:** (read-only)

- [ ] **Step 1: Verify no `knowledge-service` imports remain in `agents/src`**

Run:

```bash
grep -rnE "knowledge-service|knowledgeService|KnowledgeService|getKnowledgeServiceDriver" agents/src \
  | grep -v ".d.ts"
```

Expected: zero matches. If any match exists, address before moving on.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `pnpm --filter @airo/agents lint`
Expected: PASS (or only pre-existing warnings unrelated to these files).

- [ ] **Step 4: Run unit tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected:

- New `knowb-driver.test.ts` tests: all PASS.
- Baseline `ShareTokenRepository.test.ts` (15 failures) and `budget-report-handler.test.ts` (15 failures) remain failing — these are pre-existing on main, not caused by this work.
- No other test files should be newly broken.

- [ ] **Step 5: Run build**

Run: `pnpm --filter @airo/agents build`
Expected: PASS.

- [ ] **Step 6: Summary commit (if any residual fixups)**

If any last-minute cleanup needed:

```bash
git add -A
git commit -m "chore(agents): final cleanup for knowledge-service retirement"
```

Otherwise skip.

---

## Out of Scope for This Plan

The following are intentionally left for separate, follow-up PRs:

1. **Remove `knowledge-service/` Go service directory** — separate commit/PR once agents side is confirmed working in staging.
2. **Remove CDK Qdrant stack** (`cdk/lib/qdrant-stack.ts`, `qdrant-ecr-stack.ts`) — pairs with deletion of the knowledge-service directory.
3. **Remove GitHub workflows** (`.github/workflows/knowledge-service*.yml`, `docker-build-qdrant.yml`, `knowledge_base.yml`, `aws-deploy-knowledge-service.yml`) — same follow-up PR.
4. **Upload corpus to `/airo_info` with `KNOWB003` + metadata** — operational task, not code.
5. **Verify 45-query Confluence accuracy baseline on new config** — manual run of `agents/scripts/knowb-test.ts`.

These are tracked separately and do not block agents-side migration.

---

## Rollback Plan

All changes are behind no feature flag — a clean revert of each commit rolls back instantly.

1. `git revert <task-6-sha>..<task-1-sha>` restores all KnowledgeService driver code + fallback wiring.
2. KnowledgeService HTTP API stays operational until explicitly removed in a later PR, so reverting the client side immediately re-enables the Qdrant path.

---

## Success Criteria

- `grep -rnE "knowledge-service|KnowledgeService" agents/src` returns 0 matches (post-delete).
- `pnpm --filter @airo/agents typecheck` passes.
- `pnpm --filter @airo/agents lint` passes.
- `pnpm --filter @airo/agents build` passes.
- New `knowb-driver.test.ts` tests pass; no previously-passing test newly fails.
- Every agent `knowBSearchAITool` call produces a request with `searchType=LEXICAL_AND_SEMANTIC`, `rerankingConfig={type:COHERE,results:15}`, `scoreThreshold=0.0`, returns at most 3 results with unique `kbNodeId`.
