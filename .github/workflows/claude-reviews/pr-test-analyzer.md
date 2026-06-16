# PR Test Analyzer

Identify test coverage gaps and test quality issues in the diff.

## What to Check

### Missing Test Coverage
- New public functions or exported APIs without corresponding test file
- New conditional branches (if/else, switch cases, ternary) without path coverage
- New error handling code (catch blocks, error callbacks) without failure-mode tests
- New integrations with external systems (DB queries, HTTP calls, file I/O) without seam tests

### Edge Cases
- Zero, null, undefined, empty string, empty array inputs not tested
- Boundary values (off-by-one, max int, empty collections, single-element)
- Concurrent/async edge cases (race conditions, timeout behavior)
- Invalid or malformed input at validation boundaries

### Validation Boundaries
- User input entering the system without validation tests
- Data crossing service boundaries (API request/response shapes)
- Configuration values parsed from environment or files

### Integration Seams
- New code calling existing functions: contract tested at the interface?
- Database operations: schema assumptions covered by integration tests?
- Event emitters/listeners: subscriber expectations tested?

### Test Quality
- Tests that assert implementation details instead of behavior (brittle mocks)
- Tests with no assertions or only asserting that code "doesn't throw"
- Shared mutable state between tests (missing beforeEach cleanup)
- Overly broad assertions (e.g., `toMatchObject({})` that matches anything)
- Tests that pass regardless of the code under test (tautological)

### Vitest Patterns (this project uses Vitest, not Jest)
- Using `jest.fn()` instead of `vi.fn()`
- Using `jest.mock()` instead of `vi.mock()`
- Missing `vi.clearAllMocks()` or `vi.restoreAllMocks()` in beforeEach/afterEach
- Timer mocking: `vi.useFakeTimers()` without corresponding `vi.useRealTimers()`

## Severity Classification

- [Critical]: Untested code path that could cause data loss or security bypass
- [Important]: Missing tests for new public API, error paths, or validation boundaries
- [Suggestion]: Missing edge case coverage, test quality improvements, additional assertions

## Exclusions

- Do NOT demand 100% coverage; focus on meaningful gaps
- Do NOT flag missing tests for trivial getters/setters or pure pass-through functions
- Do NOT flag test style preferences (naming conventions, file organization)
- Do NOT require tests for configuration, constants, or type definitions
- Do NOT flag pre-existing untested code unless the diff changes its behavior

## Verification

Before reporting [Important] or higher:
1. Check if tests exist in a different file or under a different name
2. Confirm the untested code path is actually reachable
3. Verify the functionality isn't covered by integration/E2E tests elsewhere
