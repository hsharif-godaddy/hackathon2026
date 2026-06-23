# Corpus Coverage Check

## Purpose

Verify that skill trigger changes are backed by eval coverage in the
corpus-eval skill-loader test suite. A skill whose `whenToUse`/`intents`
change without corpus updates risks silent trigger regressions.

## Corpus Location

```
evals/corpus-eval/corpora/skill-loader/<skill-name>.yaml
```

Each file contains test cases with `expectedSkill` (positive) or
`expectedSkill: null` (negative) assertions.

## Heuristic

### 1. Existence check

Does the corpus file exist for this skill?

- **Missing + new skill**: [Suggestion] — recommend creating one
- **Missing + established skill being modified**: [Important] — trigger
  changes without eval coverage risk silent regressions
- **Exists**: proceed to staleness check

### 2. Staleness check (only if whenToUse/intents were modified)

Compare the skill's current `whenToUse` and `intents` against the corpus
file's positive cases:

- Extract key phrases from the new/modified `whenToUse` (split on commas,
  periods, "or" conjunctions)
- Extract phrases from new/modified `intents` entries (split on `/`)
- For each extracted phrase, check if any corpus case's `prompt` field
  would plausibly exercise it

Flag as stale when:
- A new intent phrase has no corresponding positive test case
- A removed intent phrase still has positive cases expecting this skill
  (those cases may now be wrong)
- The skill's negative cases don't include near-misses for the new
  trigger surface

### 3. Coverage quality

If the corpus exists and is not stale, assess minimums:

- At least 5 positive cases (different phrasings of the core intent)
- At least 3 negative cases (near-misses that should NOT trigger)
- At least 1 case tagged `hard` (buried intent or keyword near-miss)

Below minimums: [Suggestion] to expand coverage.

## What NOT to flag

- A skill that has never had a corpus file and isn't being modified —
  that's pre-existing uncovered state, not a regression
- Corpus changes unrelated to the skill under review
- Corpus files for skills not in the current review scope
