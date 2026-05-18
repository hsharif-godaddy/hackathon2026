# Brand Logo Evaluators

Evaluators specific to the brand-logo flow (logo-designer template). This document captures research on what evaluation dimensions are feasible, what challenges exist, and what evaluators we plan to build.

## Planned Evaluators

### 1. `brand-discovery-quality` (input/context quality)

**Jira:** [GAIENG-1476](https://godaddy-corp.atlassian.net/browse/GAIENG-1476) Story 2 — "Input/context quality"

Transcript-only. Scores whether the agent gathered sufficient brand context (business type, personality, color preferences, style direction) before generating.

**Real-world questions this answers:**
- Is the agent jumping straight to logo generation without understanding the business?
- Does the agent ask about industry, personality, and visual preferences before creating?
- Are we losing users because the agent produces irrelevant results on the first attempt (due to insufficient discovery)?

**Data used to produce score:** Agent transcript — message turns before the first generation tool call.

**Where this data originates in the system:** The agent (running whichever LLM model is configured) conducts a discovery conversation with the user. These messages are captured in the eval transcript by the gosym-probe harness via Socket.IO events.

---

### 2. `color-palette-quality` (generation relevance)

**Jira:** [GAIENG-1476](https://godaddy-corp.atlassian.net/browse/GAIENG-1476) Story 2 — "Logo generation relevance/quality"

Transcript-only. Extracts hex codes from tool calls, evaluates: appropriateness to stated direction, internal harmony, contrast ratios, accessibility.

**Real-world questions this answers:**
- When a user asks for "calming, natural" colors, are we actually generating calming natural colors or random ones?
- Do the generated palettes have sufficient contrast for accessibility?
- Are the colors internally harmonious or clashing?

**Data used to produce score:** Hex codes extracted from `colorScheme` tool call outputs, compared against user's stated preferences earlier in the conversation.

**Where this data originates in the system:** The `colorScheme` tool (`agents/src/tools/ai-lib-tools/color-scheme.ts`) makes a sub-LLM call (using the "fast" model) that generates color palettes as JSON. The agent passes the user's brand description to this tool, and the LLM produces hex codes. No external color API is involved — the creative decision is entirely LLM-generated.

---

### 3. `logo-relevance` (generation quality)

**Jira:** [GAIENG-1476](https://godaddy-corp.atlassian.net/browse/GAIENG-1476) Story 2 — "Logo generation relevance/quality"

Vision-based. Downloads logo image from tool output URL, passes to multimodal evaluator with brand context. Judges visual appropriateness to stated brand direction.

**Real-world questions this answers:**
- Does the generated logo visually match what the user described?
- If someone asks for a "minimalist yoga studio logo," does it look like one?
- Are we generating generic clip-art or contextually appropriate brand marks?

**Data used to produce score:** Logo image downloaded from URL in `media-logo__generate_logo` tool output, passed to a multimodal (vision) LLM alongside the user's stated brand direction from the transcript.

**Where this data originates in the system:** The `media-logo__generate_logo` tool (`agents/src/skills/media-logo/tools/`) calls an external logo generation API via S2S auth. The API requires a valid `customerId` with entitlements. It returns a URL to the generated logo image. This is the only part of the brand flow that hits an external service — unlike colors/fonts which are LLM-generated.

---

### 4. `brand-cohesion` (generation quality)

**Jira:** [GAIENG-1476](https://godaddy-corp.atlassian.net/browse/GAIENG-1476) Story 2 — "Logo generation relevance/quality"

Hybrid. Combines text analysis (color+font harmony) with vision (logo fits the palette/style).

**Real-world questions this answers:**
- Do the logo, colors, and fonts work together as a unified brand identity?
- Would a designer look at this output and say "these pieces belong together"?
- Are we delivering a brand book or just disconnected assets?

**Data used to produce score:** Logo image + hex codes + font names from tool outputs, all passed together to a multimodal LLM that evaluates them as a unified composition.

**Where this data originates in the system:** Combines outputs from three tools: `colorScheme` (LLM-generated hex codes), `fontTheme` (LLM-generated font names, validated against Google Fonts API), and `media-logo__generate_logo` (external logo API image). The `fontTheme` tool (`agents/src/tools/ai-lib-tools/font-theme.ts`) generates font pairings via a sub-LLM call, then validates each suggestion actually exists on Google Fonts via HTTP HEAD requests before returning it.

---

### 5. `edit-handling-quality` (edit/regeneration)

**Jira:** [GAIENG-1476](https://godaddy-corp.atlassian.net/browse/GAIENG-1476) Story 2 — "Edit/regeneration handling"

Transcript-only. Scores whether the agent responded appropriately to user dissatisfaction or change requests. Checks: did the agent acknowledge the feedback, offer alternatives, avoid repeating the same output, and successfully modify the generation?

**Real-world questions this answers:**
- When a user says "I don't like this," does the agent ask clarifying questions or just regenerate blindly?
- If a user asks "make it more modern," does the output actually change?
- Are we frustrating users by repeating similar outputs after they've expressed dissatisfaction?
- Can the agent handle iterative refinement (multiple rounds of feedback) without losing context?

**Data used to produce score:** Full multi-turn transcript — comparing agent responses before and after user feedback, verifying tool call parameters changed between generations.

**Where this data originates in the system:** Same tools as above (`colorScheme`, `fontTheme`, `media-logo__generate_logo`) but called multiple times across conversation turns. The evaluator compares the inputs/outputs between the first and subsequent calls to verify the agent actually changed its approach in response to user feedback.

---

## Can we evaluate visually without screenshots?

The table below summarises which dimensions can be evaluated from transcript data alone (text-only) versus which require the evaluator to actually see an image (vision).

| Dimension | Text-only viable? | Notes |
|---|---|---|
| Color palette appropriateness | Yes | LLMs reason well from hex codes + semantic names ([ColorGPT](#text-only-color-evaluation-colorgpt-2025)) |
| Font pairing logic | Yes | Name + category (serif/sans-serif/weight) is sufficient ([MLLM-as-a-Judge](#multimodal-llm-as-judge-mllm-as-a-judge-2024) — text descriptions can outperform vision for structured attributes) |
| Logo quality/appropriateness | No — needs vision | Complex visual compositions score only 28% accuracy text-only ([ColorGPT](#text-only-color-evaluation-colorgpt-2025)) |
| Overall brand cohesion | Partial | Color+font harmony is text-judgeable, but logo integration requires vision ([Visual Brand Compliance](#visual-brand-compliance-dzone-2025)) |
| Brand discovery quality | Yes | Transcript-only: did agent gather enough context before generating? |
| Edit/regeneration handling | Yes | Transcript-only: did agent respond appropriately to change requests? |

## Research Findings

### Text-only color evaluation (ColorGPT, 2025)

LLMs can reason about colors from hex codes. ColorGPT outperformed specialized supervised methods for palette completion (52.6% vs 47.1%). The combination of hex codes and semantic names (e.g. "sage green #8B9A6B") performed best for full palette generation.

However, for complex visual compositions (like raster images/logos), text-only evaluation scored only 28% accuracy vs 72% for simpler text elements. This confirms that logo quality cannot be meaningfully assessed from text descriptions alone.

Source: https://arxiv.org/html/2508.08987v1

### Multimodal LLM-as-Judge (MLLM-as-a-Judge, 2024)

LLMs' performance in multimodal judging tasks "significantly improved with picture descriptions" — in some cases, detailed textual descriptions outperformed direct image analysis. However, models exhibit persistent biases (egocentric, position, length) and "diverse biases, hallucinatory responses, and inconsistencies in judgment."

For pairwise comparison tasks, GPT-4V achieved ~79% human agreement. But scoring and batch ranking showed "significant divergence from human preferences."

Source: https://mllm-judge.github.io/

### Visual Brand Compliance (DZone, 2025)

Multimodal LLMs can automate brand compliance checking by analyzing visual assets against brand guidelines. The approach works by combining vision input (screenshots/images) with structured brand rules (color hex codes, font specs, logo usage rules).

Source: https://dzone.com/articles/automating-visual-brand-compliance-multimodal-llm

## Challenges

### Screenshot capture targets wrong URL

The current `SiteCapture` system navigates to the **preview container** (the raw generated website on its own port). For brand-logo, the output is a Brand Book that only exists within the builder UI at `https://local.gasket.dev-godaddy.com:8443/en-US/develop/<appId>`. The preview container shows an empty template because no website has been built yet.

Root cause: `SetupContextResolver` reads `ctx.previewUrl` which comes from `provisionApp()` → `urls.preview` (the preview container). There is no mechanism to point the capture at the builder UI.

Options:
1. **Skip screenshots for now** — extract brand data (logo URLs, hex codes, font names) directly from tool call results in the transcript
2. **Download logo images directly** — the logo URL from `media-logo__generate_logo` tool output can be fetched and passed to a vision evaluator without needing the builder UI
3. **Builder UI capture (complex)** — would require auth handling, feature flags, and a different ready-selector for the Brand Book panel

### Vision evaluation without the builder

For logo quality assessment, we don't need to screenshot the builder UI. The transcript contains the logo image URL in the `media-logo__generate_logo` tool result. We can:
- Download the image directly
- Pass it to a multimodal evaluator alongside the structured brand context (hex codes, font names, user's stated preferences)
- Judge: does this logo visually match the requested brand direction?

This avoids the builder auth/flags problem entirely.

