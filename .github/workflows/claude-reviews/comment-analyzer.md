# Comment Analyzer

Review documentation quality in changed code. Only run when the diff modifies comments or documentation.

## What to Check

### What vs Why
- Comments that describe WHAT the code does (redundant with reading the code)
- Missing comments explaining WHY non-obvious decisions were made
- Complex algorithms or business rules without explanatory context

### Stale Comments
- Comments that reference behavior no longer present in the code
- TODO/FIXME comments referencing completed work (check if the issue is resolved)
- JSDoc parameter descriptions that don't match current function signatures
- Comments mentioning old variable/function names after a rename in the same diff

### Missing Documentation
- Public API functions without JSDoc (exported from a package boundary)
- Complex type definitions without usage examples or purpose description
- Configuration options without description of valid values and defaults
- Non-obvious regex patterns without explanation of what they match

### Orphan TODOs
- New TODO/FIXME/HACK without a linked issue, ticket, or deadline
- TODOs that describe work being done in the same PR (should be removed)
- TODO comments that are actually requirements disguised as future work

### Misleading Names
- Variable/function names that suggest behavior different from implementation
- Boolean names that read backwards (`isNotValid` instead of `isInvalid`)
- Function names suggesting pure computation that have side effects
- Names using domain terms incorrectly relative to the project's glossary

## Severity Classification

- [Critical]: Documentation that would cause a developer to use the API incorrectly, leading to bugs
- [Important]: Stale JSDoc with wrong parameter types/names (could mislead callers); misleading names on public APIs
- [Suggestion]: Missing docs on public APIs, what-not-why comments, orphan TODOs, naming improvements

## Exclusions

- Do NOT flag missing comments on self-explanatory code
- Do NOT flag comment style (punctuation, capitalization, line length)
- Do NOT flag internal/private functions for missing JSDoc
- Do NOT require comments on test files
- Do NOT flag TODO comments that reference a valid open issue/ticket
- Do NOT flag pre-existing comment issues in unchanged lines

## Verification

Before reporting [Important] or higher:
1. Confirm the comment/name is actually misleading by reading the implementation
2. Check if documentation exists in a separate doc file or README
3. Verify the stale comment references code that was actually changed (not a pre-existing issue)
