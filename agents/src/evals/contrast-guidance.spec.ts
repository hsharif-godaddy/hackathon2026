import { describe, it, expect } from 'vitest';
import { UI_KIT_COLOR_CONTRAST_GUARDRAIL } from '../prompts/ui-kit-guardrail.js';

// Static eval (AIROBUILD-3143 / 2976). Pins the KIT-scoped color & contrast
// guardrail (UI_KIT_COLOR_CONTRAST_GUARDRAIL), which is injected into the
// per-turn kit anchor (context-manager) — NOT core.md, per the "don't touch
// core.md" rule. Each test asserts ONE rule topic so a future reword is forced
// to revisit the matching assertion rather than silently dropping a rule.

const coreLower: string = UI_KIT_COLOR_CONTRAST_GUARDRAIL.toLowerCase();

describe('AIROBUILD-3143 — kit color & contrast guardrail (static prompt assertions)', () => {
  it('Default A: semantic foreground tokens carry every text color (no invented hex)', () => {
    // Failure prevented (no-kit): agent invents grays like `#7A7670` on cream
    // surfaces (~1.8:1) because no kit ink token exists to anchor to.
    expect(coreLower).toContain('carry every text color with the semantic foreground tokens');
    expect(coreLower).toContain('no guaranteed contrast');
  });

  it('Default B: high-contrast token on light/brand/gradient surfaces', () => {
    // Failure prevented: low-emphasis text on a light gradient (~2.3:1).
    expect(coreLower).toContain('gradient');
    expect(coreLower).toContain('higher-contrast token');
  });

  it('Rule 1: no opacity modifier on text colors', () => {
    // Failure prevented: an opacity-faded text color composites toward the
    // background below AA (~1.9:1 observed).
    expect(coreLower).toContain('opacity modifier on text');
  });

  it('Rule 2: non-text tokens (border/divider/ring) kept off text', () => {
    // Failure prevented: a hairline/divider token rendered as text (~1.3:1).
    expect(coreLower).toContain('keep them off text');
    expect(coreLower).toContain('divider');
  });

  it('Rule 3: keep low-emphasis labels at the small-label size', () => {
    expect(coreLower).toContain('small-label size');
  });

  it('Rule 4: do not claim WCAG AA compliance (no contrast tool to verify)', () => {
    // Failure prevented: the agent asserts AA compliance it never verified.
    expect(coreLower).toContain('no contrast-measuring tool');
    expect(coreLower).toContain('meets wcag aa');
  });

  it('Rule 5: an explicit customer color request overrides the defaults', () => {
    // The guardrail is a default, not a cage — mirrors the tool-layer carve-out
    // (#5744) where color-scheme `apply` writes through the kit lock. Prevents
    // the agent refusing or awkwardly routing a deliberate customer color ask.
    expect(coreLower).toContain('defaults, not a cage');
    expect(coreLower).toContain('when the customer explicitly asks for a specific color, honor it');
  });
});
