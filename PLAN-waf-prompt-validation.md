---
status: implemented
---

# Implementation Plan: WAF Prompt Validation (Byte-Based)

**Date**: 2026-02-23
**Status**: Ready for Implementation
**Priority**: High (blocks user submissions > 8KB)

## Executive Summary

Implement byte-accurate validation for homepage prompt input to prevent WAF (Web Application Firewall) from blocking requests exceeding 8KB limit. Current character-based limits allow multi-byte input (emojis, special characters) to exceed WAF threshold, causing submission failures.

**Evidence**: User reports 7,830 chars works, 8,092 chars fails = ~8KB limit
**WAF Location**: In front of Builder App only (client → API requests)
**Root Cause**: No byte-based validation, only character limits
**Solution**: Byte-accurate enforcement with 7,400 byte safe limit

## Problem Statement

### Current Issues

1. **Character limits don't prevent byte overruns**

   - `MAX_PROMPT_LENGTH = 40,000` characters
   - Emojis: 3-4 bytes each (e.g., 3,000 emojis = 12KB)
   - No byte validation before submission

2. **Multiple input paths bypass validation**

   - ✅ Textarea onChange handler
   - ❌ Speech recognition (`syncSpeechTranscript` effect)
   - ❌ Example clicks (typeText function)
   - ❌ Paste operations (no onPaste handler)
   - ❌ Programmatic updates

3. **WAF blocks requests before server validation**
   - WAF operates upstream of `/api/sites/quick-create`
   - Server-side validation alone cannot prevent WAF blocks
   - Client-side enforcement is mandatory

## Architecture Decisions

### Decision 1: Byte-Based Limits (Not Character-Based)

**Chosen**: Use 7,400 bytes as authoritative limit
**Reasoning**:

- WAF limit: 8,000 bytes
- JSON overhead: ~600 bytes (`{"initialPrompt":"..."}`)
- Safety margin ensures all input types work
- Character count shown to users (familiar) but validation by bytes (accurate)

**Rejected Alternative**: 6,000 character limit (inaccurate for multi-byte input)

### Decision 2: Truncate Instead of Reject

**Chosen**: Auto-truncate oversized input to byte limit
**Reasoning**:

- Better UX than hard rejection
- Users can see truncated text and adjust
- Works for paste operations with large content

**Rejected Alternative**: Block input when limit reached (frustrating UX)

### Decision 3: Centralized Validation Helper

**Chosen**: Single `validateAndClampPrompt()` function applied to all input paths
**Reasoning**:

- Consistent enforcement across all input methods
- Easy to test and maintain
- Prevents bypass via speech/examples/paste

**Rejected Alternative**: Per-input validation (error-prone, duplicated logic)

### Decision 4: Don't Fix Duplication Bug (Yet)

**Chosen**: Leave prompt duplication in v2-control-plane-adapter.ts
**Reasoning**:

- Duplication occurs downstream (control plane → mgmt-airo)
- Doesn't affect WAF (WAF is upstream: client → app)
- Risk of breaking mgmt-airo integration
- Can revisit later if needed

**Rejected Alternative**: Remove duplication immediately (unknown impact)

## Implementation Steps

### Step 1: Create Byte-Based Validation Utility

**File**: `app/src/lib/waf-validation.ts` (NEW FILE)

**Tasks**:

- [ ] Create file with byte validation functions
- [ ] Implement `getByteLength(text)` using TextEncoder
- [ ] Implement `truncateToByteLimit(text, maxBytes)` with binary search
- [ ] Implement `validateAndClampPrompt(text)` as centralized helper
- [ ] Export `MAX_PROMPT_BYTES = 7400` constant
- [ ] Add JSDoc comments explaining byte limits and WAF context

**Code**:

```typescript
/**
 * WAF Validation for Homepage Prompt Input
 *
 * WAF blocks requests > 8KB (8,000 bytes). This utility provides byte-accurate
 * validation and truncation to prevent WAF rejections.
 */

// Conservative limit: 7,400 bytes leaves 600 byte margin for JSON overhead
export const MAX_PROMPT_BYTES = 7400;

/**
 * Calculate UTF-8 byte length of a string
 */
export function getByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Truncate text to fit within byte limit (handles multi-byte UTF-8 correctly)
 */
export function truncateToByteLimit(
  text: string,
  maxBytes: number = MAX_PROMPT_BYTES,
): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);

  if (encoded.length <= maxBytes) {
    return text;
  }

  // Binary search for max characters that fit
  let left = 0;
  let right = text.length;

  while (left < right) {
    const mid = Math.floor((left + right + 1) / 2);
    const substring = text.substring(0, mid);

    if (encoder.encode(substring).length <= maxBytes) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  return text.substring(0, left);
}

/**
 * Validate and clamp prompt to byte limit (use this for ALL input paths)
 */
export function validateAndClampPrompt(text: string) {
  const clamped = truncateToByteLimit(text);
  const byteLength = getByteLength(clamped);
  const wasClipped = clamped.length !== text.length;

  return {
    text: clamped,
    byteLength,
    charLength: clamped.length,
    wasClipped,
    isValid: byteLength <= MAX_PROMPT_BYTES,
    // User-friendly estimate (1.2 bytes/char average)
    remainingChars: Math.max(
      0,
      Math.floor((MAX_PROMPT_BYTES - byteLength) / 1.2),
    ),
  };
}
```

**Acceptance Criteria**:

- ✅ `getByteLength("hello")` returns 5
- ✅ `getByteLength("👋")` returns 4 (emoji)
- ✅ `truncateToByteLimit("a".repeat(10000), 100)` returns 100 chars
- ✅ `validateAndClampPrompt` preserves text under limit
- ✅ `validateAndClampPrompt` truncates text over limit

---

### Step 2: Update MAX_PROMPT_LENGTH Constant

**File**: `app/src/lib/features.ts`

**Line**: 35

**Tasks**:

- [ ] Update `MAX_PROMPT_LENGTH` from 40000 to 6000
- [ ] Add comment explaining it's display-only
- [ ] Reference waf-validation.ts for actual enforcement

**Code Change**:

```typescript
// BEFORE:
export const MAX_PROMPT_LENGTH = 40000;

// AFTER:
/**
 * Maximum prompt length in characters (display hint only)
 *
 * Actual enforcement is byte-based (7,400 bytes) to prevent WAF rejections.
 * This character limit is a rough guideline for users.
 *
 * See: app/src/lib/waf-validation.ts for byte-accurate validation
 */
export const MAX_PROMPT_LENGTH = 6000;
```

**Impact Analysis**:

- Affects: `HeroSection.tsx` (maxLength, button disabled, error display)
- Affects: `app/src/tests/mocks.ts:135`
- Affects: `app/src/app/page.test.tsx:33`
- Affects: `app/src/app/manage-plan/page.test.tsx:40`

**Acceptance Criteria**:

- ✅ Constant updated to 6000
- ✅ Comment explains byte-based enforcement
- ✅ Tests still pass (will update in Step 7)

---

### Step 3: Apply Byte Validation to HeroSection onChange

**File**: `app/src/app/components/HeroSection.tsx`

**Location**: Lines 328-342

**Tasks**:

- [ ] Import `validateAndClampPrompt` and `getByteLength`
- [ ] Replace character-based logic with byte validation
- [ ] Apply truncation to user input
- [ ] Preserve existing error clearing behavior

**Code Changes**:

**3a. Add imports** (after line 16):

```typescript
import {
  validateAndClampPrompt,
  getByteLength,
  MAX_PROMPT_BYTES,
} from "@/lib/waf-validation";
```

**3b. Update onChange handler** (lines 328-342):

```typescript
onChange={(e) => {
  // Block input during typing animation or speech recognition
  if (isTyping || isListening) return

  const newValue = e.target.value

  // Apply byte-based validation and truncation
  const validated = validateAndClampPrompt(newValue)

  isUserTypingRef.current = true
  setDisplayText(validated.text)
  debouncedSetPromptText(validated.text)

  // Clear error when user starts typing (avoid unnecessary calls)
  if (error && lastErrorClearRef.current !== validated.text) {
    lastErrorClearRef.current = validated.text
    setError(null)
  }
}}
```

**Acceptance Criteria**:

- ✅ Typing normal text works unchanged
- ✅ Typing past byte limit auto-truncates
- ✅ No console errors
- ✅ Debounce still works

---

### Step 4: Apply Byte Validation to Speech Recognition

**File**: `app/src/app/components/HeroSection.tsx`

**Location**: Lines 49-57 (`syncSpeechTranscript` effect)

**Tasks**:

- [ ] Apply `validateAndClampPrompt` to speech input
- [ ] Preserve existing transcript merging logic
- [ ] Truncate if speech + existing text exceeds limit

**Code Change**:

```typescript
// Update speech transcript effect (lines 49-57)
useEffect(
  function syncSpeechTranscript() {
    if (isListening && speechTranscript) {
      const baseText = textBeforeListeningRef.current;
      const separator = baseText && !baseText.endsWith(" ") ? " " : "";
      const newText = baseText + separator + speechTranscript;

      // Apply byte validation to speech input
      const validated = validateAndClampPrompt(newText);

      setDisplayText(validated.text);
      setPromptText(validated.text);
    }
  },
  [isListening, speechTranscript, setPromptText],
);
```

**Acceptance Criteria**:

- ✅ Speech recognition works unchanged under limit
- ✅ Speech input truncates if over limit
- ✅ No interruption to listening state

---

### Step 5: Apply Byte Validation to Example Clicks (typeText)

**File**: `app/src/app/components/HeroSection.tsx`

**Location**: Lines 196-234 (`typeText` function)

**Tasks**:

- [ ] Apply validation in Safari fast path
- [ ] Apply validation in animation path
- [ ] Ensure examples under limit still animate fully

**Code Changes**:

**5a. Safari path** (around line 202-204):

```typescript
// Skip animation on Safari for better performance
if (isSafari) {
  const validated = validateAndClampPrompt(targetText);
  setDisplayText(validated.text);
  setPromptText(validated.text);
  return;
}
```

**5b. Animation completion** (around line 227):

```typescript
// Only update parent state at the end to reduce re-renders
if (i === targetText.length) {
  const validated = validateAndClampPrompt(newText);
  setPromptText(validated.text);
}
```

**Acceptance Criteria**:

- ✅ Example clicks animate normally
- ✅ Long examples truncate to byte limit
- ✅ Safari fast path works

---

### Step 6: Update Button Disabled Logic and Character Counter

**File**: `app/src/app/components/HeroSection.tsx`

**Location**: Lines 384 (button), 394-404 (error display)

**Tasks**:

- [ ] Update button disabled to use byte validation
- [ ] Replace character limit error with byte-based counter
- [ ] Show counter only when approaching limit
- [ ] Add translation keys with fallbacks

**Code Changes**:

**6a. Update maxLength attribute** (line 350):

```typescript
maxLength={10000}  // Soft limit, actual enforcement is byte-based
```

**6b. Update button disabled** (line 384):

```typescript
disabled={
  !promptText.trim() ||
  isLoading ||
  isTyping ||
  getByteLength(promptText) > MAX_PROMPT_BYTES
}
```

**6c. Replace character limit display** (lines 394-404):

```typescript
{(() => {
  const validation = validateAndClampPrompt(promptText);
  const showCounter = validation.charLength > 5000 || !validation.isValid;

  return showCounter && isExpanded && (
    <div className="mt-0.5 px-4 text-left flex justify-between items-center">
      <text.p size={0} className="text-intents-ux-text-secondary font-mono">
        {validation.charLength.toLocaleString()} characters
      </text.p>

      {!validation.isValid ? (
        <text.p size={0} className="font-medium" emphasis="critical">
          {t('builder_homepage_hero_over_limit', {}, 'Prompt is too long, please shorten it')}
        </text.p>
      ) : validation.remainingChars < 500 && (
        <text.p size={0} className="font-medium" emphasis="warning">
          {t('builder_homepage_hero_near_limit',
            { remaining: validation.remainingChars },
            'About {remaining} characters remaining'
          )}
        </text.p>
      )}
    </div>
  );
})()}
```

**Translation Keys** (with fallbacks):

- `builder_homepage_hero_over_limit`: "Prompt is too long, please shorten it"
- `builder_homepage_hero_near_limit`: "About {remaining} characters remaining"

**Acceptance Criteria**:

- ✅ Counter appears when > 5,000 chars
- ✅ Counter shows warning when < 500 chars remaining
- ✅ Counter shows error when over limit
- ✅ Button disabled when over byte limit
- ✅ Translation fallbacks work

---

### Step 7: Add Server-Side Validation

**File**: `app/src/app/api/sites/quick-create/route.ts`

**Location**: After line 47 (after extracting projectPrompt)

**Tasks**:

- [ ] Import validation utilities
- [ ] Validate prompt byte length
- [ ] Return 413 Payload Too Large if over limit
- [ ] Log validation failures

**Code Change**:

```typescript
// Add import at top of file
import { validateAndClampPrompt, MAX_PROMPT_BYTES } from "@/lib/waf-validation";

// After line 47 (after const projectPrompt = prompt || initialPrompt)
const promptValidation = validateAndClampPrompt(projectPrompt);

if (!promptValidation.isValid) {
  logger.warn("sites.quick-create.prompt-exceeds-waf-limit", {
    accountId: user.accountId,
    byteLength: promptValidation.byteLength,
    maxBytes: MAX_PROMPT_BYTES,
    charLength: promptValidation.charLength,
  });

  return NextResponse.json(
    {
      error: "Prompt is too long",
      details:
        "Your description exceeds the maximum size. Please shorten it and try again.",
    },
    { status: 413 }, // 413 Payload Too Large
  );
}

// Optional: Add byte length to success log (around line 57)
logger.info("sites.quick-create.start", {
  accountId: account_id,
  promptLength: projectPrompt.length,
  promptBytes: promptValidation.byteLength, // Add this
});
```

**Acceptance Criteria**:

- ✅ Server rejects prompts > 7,400 bytes
- ✅ Returns 413 status code
- ✅ Error logged with byte metrics
- ✅ Existing error handler displays message (page.tsx:172-174, :221)

---

### Step 8: Add Unit Tests

**File**: `app/src/lib/__tests__/waf-validation.test.ts` (NEW FILE)

**Tasks**:

- [ ] Create test file
- [ ] Test `getByteLength` with ASCII, emoji, mixed content
- [ ] Test `truncateToByteLimit` at exact boundaries
- [ ] Test `validateAndClampPrompt` edge cases

**Test Cases**:

```typescript
import { describe, it, expect } from "vitest";
import {
  getByteLength,
  truncateToByteLimit,
  validateAndClampPrompt,
  MAX_PROMPT_BYTES,
} from "../waf-validation";

describe("waf-validation", () => {
  describe("getByteLength", () => {
    it("calculates ASCII text correctly", () => {
      expect(getByteLength("hello")).toBe(5);
      expect(getByteLength("a".repeat(100))).toBe(100);
    });

    it("calculates emoji byte length correctly", () => {
      expect(getByteLength("👋")).toBe(4); // Wave emoji = 4 bytes
      expect(getByteLength("🎉")).toBe(4); // Party popper = 4 bytes
      expect(getByteLength("💯")).toBe(4); // 100 emoji = 4 bytes
    });

    it("calculates mixed content correctly", () => {
      expect(getByteLength("Hello 👋 World")).toBe(17); // 11 ASCII + 4 emoji + 2 spaces
    });
  });

  describe("truncateToByteLimit", () => {
    it("preserves text under limit", () => {
      const text = "a".repeat(100);
      expect(truncateToByteLimit(text, 200)).toBe(text);
    });

    it("truncates ASCII text at exact byte limit", () => {
      const text = "a".repeat(1000);
      const result = truncateToByteLimit(text, 100);
      expect(result.length).toBe(100);
      expect(getByteLength(result)).toBe(100);
    });

    it("truncates emoji text without breaking characters", () => {
      const text = "👋".repeat(1000); // 4000 bytes
      const result = truncateToByteLimit(text, 100);
      expect(getByteLength(result)).toBeLessThanOrEqual(100);
      // Should truncate to 25 emojis (100 bytes)
      expect(result.length).toBe(25);
    });

    it("handles mixed content correctly", () => {
      const text = "Hello 👋 ".repeat(1000);
      const result = truncateToByteLimit(text, 100);
      expect(getByteLength(result)).toBeLessThanOrEqual(100);
    });
  });

  describe("validateAndClampPrompt", () => {
    it("marks valid text as valid", () => {
      const result = validateAndClampPrompt("Hello world");
      expect(result.isValid).toBe(true);
      expect(result.text).toBe("Hello world");
      expect(result.wasClipped).toBe(false);
    });

    it("truncates and marks invalid text", () => {
      const text = "a".repeat(10000);
      const result = validateAndClampPrompt(text);
      expect(result.isValid).toBe(true); // After clipping, it's valid
      expect(result.wasClipped).toBe(true);
      expect(getByteLength(result.text)).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    });

    it("provides accurate char and byte lengths", () => {
      const text = "Hello 👋";
      const result = validateAndClampPrompt(text);
      expect(result.charLength).toBe(7); // 5 + space + 1 emoji
      expect(result.byteLength).toBe(10); // 6 ASCII + 4 emoji
    });
  });
});
```

**Acceptance Criteria**:

- ✅ All tests pass
- ✅ Coverage > 90% for waf-validation.ts
- ✅ Tests run in CI pipeline

---

### Step 9: Update Integration Tests

**File**: `app/src/app/components/__tests__/HeroSection.test.tsx`

**Tasks**:

- [ ] Update existing tests to use byte-based validation
- [ ] Add test for speech recognition truncation
- [ ] Add test for example click truncation
- [ ] Update MAX_PROMPT_LENGTH expectations

**Test Updates**:

```typescript
// Update imports
import { MAX_PROMPT_BYTES } from '@/lib/waf-validation';

// Update test that checks character limit
it('should disable submit button when prompt exceeds byte limit', () => {
  const longText = 'a'.repeat(8000); // 8000 bytes
  // ... test that button is disabled
});

// Add new test
it('should truncate pasted text to byte limit', () => {
  const { getByTestId } = renderWithProviders(<HeroSection {...props} />);
  const textarea = getByTestId('homepage-prompt-input');

  // Paste text exceeding limit
  const longText = '👋'.repeat(2000); // 8000 bytes
  fireEvent.paste(textarea, { clipboardData: { getData: () => longText } });

  // Should be truncated to ~1850 emojis (7400 bytes)
  expect(textarea.value.length).toBeLessThan(2000);
});
```

**Acceptance Criteria**:

- ✅ All existing tests pass
- ✅ New byte validation tests pass
- ✅ Test coverage maintained or improved

---

### Step 10: Manual Testing

**Test Plan**:

| Test Case          | Input                          | Expected Result                | Status |
| ------------------ | ------------------------------ | ------------------------------ | ------ |
| Short ASCII        | "Hello world" (11 bytes)       | Accepts, no counter            | ⬜     |
| Long ASCII         | 6,000 chars ASCII (6000 bytes) | Accepts, shows counter         | ⬜     |
| Near limit ASCII   | 7,000 chars ASCII (7000 bytes) | Accepts, shows warning         | ⬜     |
| Over limit ASCII   | 8,000 chars ASCII (8000 bytes) | Truncates to 7400, shows error | ⬜     |
| Emoji only         | 2,000 emojis (8000 bytes)      | Truncates to ~1850 emojis      | ⬜     |
| Mixed content      | "Hello 👋 ".repeat(1000)       | Truncates correctly            | ⬜     |
| Paste long text    | Paste 10,000 chars             | Auto-truncates to byte limit   | ⬜     |
| Speech recognition | Speak long text                | Truncates when over limit      | ⬜     |
| Example click      | Click example, type more       | Enforces limit                 | ⬜     |
| Submit at limit    | 7,399 bytes                    | Server accepts                 | ⬜     |
| Submit over limit  | 7,401 bytes (if bypassed)      | Server rejects with 413        | ⬜     |

**Testing Steps**:

1. Start dev server: `pnpm --filter website dev`
2. Open browser: http://localhost:3000
3. Run through each test case
4. Check browser console for errors
5. Check server logs for validation events
6. Verify counter display and messages
7. Verify button disabled state

---

## Success Criteria

### Functional Requirements

- ✅ All input paths enforce 7,400 byte limit
- ✅ Multi-byte characters (emoji) handled correctly
- ✅ Character counter appears when approaching limit
- ✅ Button disabled when over limit
- ✅ Server rejects oversized prompts (backup)
- ✅ No regressions in existing functionality

### Non-Functional Requirements

- ✅ Performance: Byte calculation < 5ms for 10,000 chars
- ✅ UX: Validation feels responsive (no lag)
- ✅ Accessibility: Counter readable by screen readers
- ✅ Browser support: Works in Chrome, Firefox, Safari, Edge

### Code Quality

- ✅ TypeScript types correct
- ✅ Unit test coverage > 90%
- ✅ Integration tests pass
- ✅ No console errors or warnings
- ✅ JSDoc comments on all public functions

---

## Risk Assessment & Mitigation

### Risk 1: Binary Search Performance

**Severity**: Low
**Impact**: Slow validation on very long input
**Likelihood**: Low (most prompts < 10,000 chars)
**Mitigation**: Binary search is O(log n), fast enough for UI
**Contingency**: Add caching if performance issue detected

### Risk 2: Speech Recognition Edge Cases

**Severity**: Medium
**Impact**: Speech input might bypass validation
**Likelihood**: Low (validation applied in effect)
**Mitigation**: Thorough testing with speech input
**Contingency**: Add validation to all setPromptText calls

### Risk 3: Translation Keys Missing

**Severity**: Low
**Impact**: Shows key string instead of translated message
**Likelihood**: High (no translation system in repo)
**Mitigation**: Use fallback strings in t() calls
**Contingency**: English fallbacks always work

### Risk 4: Browser Compatibility

**Severity**: Low
**Impact**: TextEncoder not available in old browsers
**Likelihood**: Very Low (TextEncoder widely supported since 2017)
**Mitigation**: Test in all major browsers
**Contingency**: Polyfill if needed (unlikely)

### Risk 5: Server Validation Bypass

**Severity**: Low
**Impact**: User could bypass client validation via API tools
**Likelihood**: Low (deliberate action)
**Mitigation**: Server-side validation catches this
**Contingency**: Monitor 413 errors, adjust limit if needed

---

## Rollout Plan

### Phase 1: Development (Day 1-2)

- [ ] Implement Steps 1-7 (code changes)
- [ ] Run unit tests locally
- [ ] Manual testing on localhost

### Phase 2: Testing (Day 3)

- [ ] Complete Step 8-9 (tests)
- [ ] Run full test suite
- [ ] Cross-browser testing
- [ ] Edge case testing (emoji, speech, paste)

### Phase 3: Code Review (Day 4)

- [ ] Create PR with all changes
- [ ] Request code review
- [ ] Address feedback
- [ ] Update tests if needed

### Phase 4: Deployment (Day 5)

- [ ] Merge to main
- [ ] Deploy to staging
- [ ] Smoke test on staging
- [ ] Deploy to production
- [ ] Monitor logs for validation errors

---

## Monitoring & Alerts

### Metrics to Track

- `sites.quick-create.prompt-exceeds-waf-limit` log frequency
- Average prompt byte length
- Distribution of prompt lengths
- % of submissions near limit (> 6,500 bytes)
- 413 errors from server validation

### Success Metrics (Week 1)

- Zero WAF blocks due to oversized prompts
- < 1% of submissions rejected by server (413)
- No increase in bounce rate on homepage
- No support tickets about prompt limits

### Alert Conditions

- Alert if > 5% of submissions hit 413 error
- Alert if average byte length > 6,500 (may indicate gaming/abuse)
- Alert if WAF blocks increase (indicates client validation failing)

---

## Follow-Up Work (Optional)

### Optional Enhancement 1: Fix Duplication Bug

**File**: `app/src/lib/control-plane/v2-control-plane-adapter.ts`
**Lines**: 173-186

**Investigation Steps**:

1. Check mgmt-airo API documentation
2. Test with only `variables.initialPrompt` (remove top-level)
3. Test with only top-level `initialPrompt` (remove variables)
4. Verify both backend and frontend work
5. If safe, remove duplicate and increase limit to 15,000 bytes

**Risk**: Breaking mgmt-airo integration
**Reward**: Double available prompt size
**Decision**: Defer until after initial rollout

### Optional Enhancement 2: Progressive Character Counter

Show character count always (not just near limit) with progressive coloring:

- 0-5,000 chars: Gray (neutral)
- 5,000-6,500 chars: Green (plenty of room)
- 6,500-7,200 chars: Yellow (approaching limit)
- 7,200+ chars: Red (very close to limit)

### Optional Enhancement 3: Smart Truncation Message

When truncating, show user exactly what was removed:
"Pasted text was too long. Last 523 characters were removed."

---

## Appendix A: File Changes Summary

| File                                                    | Type | Lines Changed | Complexity |
| ------------------------------------------------------- | ---- | ------------- | ---------- |
| `app/src/lib/waf-validation.ts`                         | NEW  | ~80           | Medium     |
| `app/src/lib/features.ts`                               | EDIT | 1             | Low        |
| `app/src/app/components/HeroSection.tsx`                | EDIT | ~50           | High       |
| `app/src/app/api/sites/quick-create/route.ts`           | EDIT | ~15           | Low        |
| `app/src/lib/__tests__/waf-validation.test.ts`          | NEW  | ~100          | Low        |
| `app/src/app/components/__tests__/HeroSection.test.tsx` | EDIT | ~30           | Medium     |

**Total**: ~276 lines changed across 6 files

---

## Appendix B: Translation Keys

Required keys with fallbacks:

```typescript
// Key: builder_homepage_hero_over_limit
// Fallback: "Prompt is too long, please shorten it"
// Usage: When prompt exceeds byte limit

// Key: builder_homepage_hero_near_limit
// Fallback: "About {remaining} characters remaining"
// Usage: When within 500 chars of limit
// Variables: { remaining: number }
```

---

## Appendix C: Testing Commands

```bash
# Run unit tests
pnpm --filter website test -- waf-validation

# Run integration tests
pnpm --filter website test -- HeroSection

# Run all tests
pnpm --filter website test

# Type check
pnpm --filter website typecheck

# Lint
pnpm --filter website lint

# Start dev server
pnpm --filter website dev

# Build production
pnpm --filter website build
```

---

## Sign-Off

**Implementation Ready**: ✅ Yes
**Estimated Effort**: 3-5 days
**Risk Level**: Low-Medium
**Dependencies**: None
**Blocker**: None

**Next Steps**:

1. Review this plan with team
2. Get approval to proceed
3. Create GitHub issue
4. Begin implementation (Step 1)
