# Image Search Eval Improvements

## Results Summary (2026-03-04, 200 scenarios)

- **Path A (Getty Direct):** 7.1 avg
- **Path B (Service):** 7.5 avg, delta +0.40
- **Wins:** B: 229, A: 148, Tie: 23
- **B loses 37% of image needs** — closing this gap is the priority

## Problem Categories

### 1. 3D Illustrations / Cartoons Polluting Results

**Impact:** food-truck (B:5), food-truck-builder (B:5), and likely others
**Symptom:** Getty images tagged as photos are actually 3D renders/illustrations. They get indexed and rank high via vector similarity, but look unprofessional and generic for real business websites.
**Root cause:** Getty tags 3D renders as `graphicalStyle: "photography"`. Haiku also doesn't detect them — describes them as if real. Neither source catches them.
**Fix:** Add `imageType` field to Haiku analysis prompt (photograph/3d_render/illustration/vector/graphic). Store in Qdrant, filter at search time to default to photography-only.
**Status:** Done — added imageType to Haiku prompt, stored in Qdrant, default must_not filter excludes non-photographs

### 2. Domain Confusion (Semantic Neighbors)

**Impact:** mental-health-therapist/hero B:2, axe-throwing/corporate B:2, golf-course/hero B:2
**Symptom:** Dense vectors see "therapist office" ≈ "physical therapy clinic", "golf course" ≈ "mini golf", "axe throwing group fun" ≈ "bowling group fun". Sparse vectors don't help enough because keyword overlap is also high.
**Root cause:** After analyzing fresh Getty results, the final HybridSearch re-queries ALL of Qdrant, letting wrong-domain cached images (physical therapy, mini golf, bowling) outrank the correct freshly-analyzed images. The cache is polluted with semantically-close but domain-wrong images from prior queries.
**Fix:** After Getty backfill, prefer freshly-fetched images by looking up the analyzed results directly by Getty ID instead of re-querying the full collection. Only fall back to collection-wide search when we have enough cached results (minCached path).
**Status:** Done — post-backfill now uses GetByIDs to retrieve Getty results directly instead of re-querying full collection

### 3. Long Tail of -1 Losses (102 cases, B scores 7-8 vs A scores 8-9)

**Impact:** Structural — Getty returns 25 candidates vs B returning 5. More candidates = more consistently excellent top-5.
**Symptom:** B results are good but A results are slightly more polished/diverse.
**Status:** TODO — may be partially addressable by improving ranking quality so B's 5 are the absolute best 5.

### 4. Niche Content Gaps

**Impact:** driving-school/theory B:3, tanning-salon B:5, miniature-golf/glow B:5
**Symptom:** Very specific queries where Getty's 25 results naturally contain more relevant options than what's been indexed in Qdrant.
**Status:** TODO
