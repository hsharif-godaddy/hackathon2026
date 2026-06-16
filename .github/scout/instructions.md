# Scout — canonical methodology + CI procedure

This file is the **single source of truth** for how Scout judges work. Both
consumers read it:
- **CI** (`.github/workflows/scout.yml`) reads it via `git show origin/main:…` and
  then follows **Part B** to run autonomously.
- The **local `/scout` skill** (`~/.claude/skills/scout/SKILL.md`) references **Part A**
  for methodology, then runs its own interactive bot-PR flow.

Keep all *judgment* (what to pick, how to size, how to split) in Part A so the two
consumers can't drift. Only execution differs.

---

# Part A — Methodology (shared; how Scout judges)

Category `split` (break up an oversized TS/TSX file) is the only runnable category.

## A1. Selection thesis — burden × influence, NOT size
Size only earns a spot on the longlist; **evidence** decides. A 1,800-line file that's
one cohesive algorithm, low-churn, single-author is **fine** — leave it. A file many
people collide on, mixing concerns, with a clean seam, is the target. Rank by
**churn × author-spread × mixed-concerns × fan-in / canonical-example × a real seam**.

**Why influence matters here:** this codebase is in 24/7 AI-assisted development and
merged code becomes precedent future sessions copy. Fixing a heavily-read/copied file
propagates; Scout's own PRs become precedent too, so splits must be *exemplary*.

## A2. Size is the size of the EXTRACTION, not the file  ← read this twice
**`Size` = net LOC *relocated* by the proposed split. It is NOT the file's line count.**
A 3,000-line file is **not** automatically an `L`. Do not equate file size with split
size — that mistake makes Scout wrongly skip big files or mislabel everything `L`.

**Almost every large file has a small clean seam.** Most god-files carry a *preamble*
of shared **types + pure helpers**, or a cluster of **independent sub-components**,
that lifts out as a pure **Mode-A** move sized **S or M** — even when the file is huge.
Concrete precedent: `agent-factory.ts` was **1,908 LOC** but the right split relocated
only **~224 LOC** of types+helpers → an **`M · ✅`** extraction, leaving the two big
classes in place.

**So, when sizing a candidate:**
1. Find the *smallest valuable clean seam* first (the type/helper/sub-component cluster).
2. Size the split by *that extraction's* relocated LOC.
3. **Prefer that M/S Mode-A cluster** over either (a) decomposing the whole construct
   (`L · ⚠` Mode-B) or (b) skipping the file. Reach for an `L` Mode-B decomposition
   **only** when there is no smaller clean seam *and* the single construct itself is
   the problem.

### Size / Risk rubric
- **Size** (review volume), by net LOC relocated: **S ≤ 150 · M 151–500 · L > 500**.
  Note files touched as `N→M` in the body (secondary; doesn't change the letter).
- **Risk**: **✅** Mode A (pure verbatim move; byte-identical, only `export`/import
  wiring added) · **⚠** Mode B (construct decomposed; not byte-identical).

## A3. Find the candidates
Pass 1 — longlist by size (a filter, not the signal):
```
git ls-files '*.ts' '*.tsx' | grep -vE '\.d\.ts$|/__generated__/|/generated/|\.generated\.' \
  | xargs wc -l 2>/dev/null | grep -vE ' total$' | sort -rn | head -20
```
Pass 2 — gather evidence for the top ~10 (`git log --since=6.months` for churn/authors;
`git grep -l <basename>` for fan-in). Then **read** each top file and judge what a
script can't: how many *independent* concerns it mixes, and — per A2 — **what clean
M/S cluster (types / pure helpers / sub-components) can be lifted out**.

## A4. Split modes (behavior-preserving ONLY)
- **Mode A — pure verbatim move** (the default; types, helpers, selectors, independent
  sub-components): move chunks verbatim into sibling module(s); add only `export`/import
  wiring; `git diff` of moved lines is byte-identical.
- **Mode B — decomposition** (single-construct god-file: one class, one Zustand
  `create()`): decompose the construct; bodies move verbatim into the new wrappers,
  only assembly changes. Higher-risk (`⚠`), its own PR.
- **Both:** preserve the public surface (original path re-exports what it exported);
  remove imports the change made unused; tests follow the code (relocate a standalone
  unit's tests; leave Mode-B slice tests at the composed boundary). If it can't be done
  behavior-preserving, **abort the candidate**.

## A5. Dedup — don't redo captured work
Exclude any candidate file already represented in an **open** `scout` PR or one
**merged within the last 60 days**:
```
gh pr list --repo <REPO> --label scout --state all --json number,state,mergedAt,files
```
Union the file paths of (open ∪ merged-≤60d) and drop any candidate in that set.

## A6. When to skip (and when NOT to)
"Big but fine" is a valid verdict — a cohesive, low-churn, single-concern file with **no
extractable cluster** → report and skip. **But a big file that DOES have a clean M/S
type/helper/sub-component cluster is NOT "big but fine"** — that's a candidate; don't
skip it. "Nothing worth the risk" is a fine outcome only when no clean seam exists;
returning it while obvious M/S clusters sit unextracted is a miss (see A2).

## A7. Local gate (must be green before any commit)
Derive the owning package; run `pnpm --filter <pkg> typecheck && lint && test`
(Mode B: full package suite). Any red → fix the wiring or abort; never proceed on a red
gate. Confirm a green baseline *before* moving anything so a pre-existing failure isn't
mistaken for yours.

---

# Part B — Autonomous execution (CI only)

The local skill ignores this part (it has its own bot-PR flow). CI: produce at most ONE
behavior-preserving cleanup on a branch — do NOT open a PR (the `open-pr` job does that
as `airo-scout[bot]`). Inputs arrive in the workflow prompt: `REPO`, `CATEGORIES`,
`MAX_SIZE`, `BRANCH`.

1. Run Part A (scan → evidence → read → size by *extraction* per A2 → dedup per A5).
2. Apply gating: only categories in `CATEGORIES` (today `split`); drop candidates whose
   computed Size exceeds `MAX_SIZE`. Sizing per A2 — a huge file with an M cluster is
   **M**, eligible under `MAX_SIZE=M`; do not pre-disqualify big files by line count.
3. Auto-pick the single top remaining candidate. If none qualify (no clean seam, all
   deduped, or genuinely all > `MAX_SIZE`), print `SCOUT: no candidate` and STOP. Before
   emitting that, re-check A2 — "no candidate" while an obvious M/S cluster exists is a bug.
4. Split per A4; run the A7 gate. If red, print `SCOUT: gate failed` and STOP (push nothing).
   If not behavior-preserving, print `SCOUT: not safe` and STOP.
5. Commit — **the commit message IS the PR content** (`open-pr` uses `gh pr create --fill`):
```
git checkout -b "$BRANCH"
git -c user.name="airo-scout[bot]" \
    -c user.email="291686450+airo-scout[bot]@users.noreply.github.com" \
    commit -m "$(cat <<'MSG'
[Scout] split · <S|M|L> · <✅|⚠> — <short description>

> 🔭 Opened by Scout — automated structural-split cleanup. Pure code move; review the move, not new logic.

**Scope:** split · <S|M|L> (<LOC> LOC, <N>→<M> files) · <✅ verbatim move | ⚠ decomposition>

## What
<what moved where>

## Why
<the seam / burden×influence reason>

## How
Pure structural move; bodies verbatim; original path re-exports to preserve the public surface.

## Verification
- moved lines byte-identical (diff)
- pnpm --filter <pkg> typecheck / lint / test ✓
MSG
)"
```
   Stage only the files the split touched (explicit paths — never `git add -A`).
6. `git push origin "$BRANCH"`. Report the branch + chosen candidate. Do NOT open a PR.
