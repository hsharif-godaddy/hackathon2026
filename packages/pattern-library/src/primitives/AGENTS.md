# AGENTS.md — `src/primitives/`

General-purpose visual primitives — building blocks with no domain semantics that
any area of the library can use. Root [`AGENTS.md`](../../AGENTS.md) and
[`src/AGENTS.md`](../AGENTS.md) cover repo-wide and component-authoring rules; this
file documents what is specific to `primitives/`.

## What belongs here

Visual primitives that:
- Are icon-equivalent in usage (inline, sizing matches icon sizing)
- Carry no chat-, input-, or surface-specific semantics
- Are general enough to be used across any area of `@airo-ux/pattern-library`

Current components:
- `color-swatch/` — a single solid-color circle
- `color-swatch-group/` — a stacked collection of color swatches

## What does not belong here

- Components with chat-thread semantics → `src/chat/`
- Form or prompt components → `src/input/`
- Layout surfaces → `src/surfaces/`
