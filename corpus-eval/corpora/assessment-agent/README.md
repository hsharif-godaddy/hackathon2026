# Assessment Agent Test Corpus

Test corpus for evaluating the AssessmentAgent classification accuracy. Contains 568 test cases organized by expected task type classification.

## Overview

The AssessmentAgent classifies user prompts into task types for budget billing:

- **fix**: Bug fixes and troubleshooting
- **general**: Everything else (default)

The agent uses a two-tier classification approach:

1. **Embedding path** (~50-100ms): Fast semantic similarity matching
2. **Haiku LLM fallback** (~1-2s): For ambiguous cases requiring reasoning

## Corpus Files

| File           | Cases | Description                                                 |
| -------------- | ----- | ----------------------------------------------------------- |
| `publish.yaml` | 113   | Publish/deploy related prompts                              |
| `domain.yaml`  | 110   | Domain registration and management                          |
| `fix.yaml`     | 115   | Bug fixes and troubleshooting                               |
| `general.yaml` | 230   | General requests + edge cases + negations + initial prompts |

**Total: 568 test cases**

## Test Case Categories

Each corpus file contains various test categories:

### By Complexity

- **Clear intent**: Direct, unambiguous requests ("publish my app")
- **Questions**: Interrogative forms ("can you publish my app?")
- **Typos/informal**: Misspellings and casual language ("publsh my site plz")
- **Multilingual**: Non-English prompts (ES, FR, DE, ZH, JA, KO, TH, PT, IT)
- **Multi-turn**: Conversation chains requiring previous message context
- **Long-form**: Detailed, rambling prompts with multiple sentences
- **Complex**: Multi-detail requests combining several related needs

### Special Categories (in general.yaml)

- **Negations**: "don't publish", "not yet", "cancel the deploy"
- **Edge cases**: Ambiguous intent, keyword-in-context issues
- **Adversarial**: Prompt injection attempts, misleading context

## Tags

### By Task Type

- `publish`, `domain`, `fix`, `general`

### By Test Category

- `clear-intent` - Unambiguous requests
- `question` - Interrogative forms
- `typo` - Misspellings and informal language
- `multilingual` - Non-English prompts
- `multi-turn` - Requires conversation context
- `long-form` - Detailed, verbose prompts
- `complex` - Multi-detail requests
- `negation` - Negated action requests
- `edge-case` - Ambiguous classification
- `adversarial` - Injection/misleading attempts
- `keyword-context` - Keywords in non-action context
- `initial` - Initial app creation prompts (must be general)
- `hero-example` - Homepage example prompts from HeroExamples.tsx
- `launch-keyword` - Contains "launch" but means create, not publish

### By Language

- `en-us` - English
- `es-es` - Spanish
- `fr-fr` - French
- `de-de` - German
- `zh-cn` - Chinese (Simplified)
- `ja-jp` - Japanese
- `ko-kr` - Korean
- `th-th` - Thai
- `pt-br` - Portuguese (Brazil)
- `it-it` - Italian

### Path Validation

- `path-validation` - Cases with explicit path expectations (for routing tests)
- `embedding` - Should match via fast embedding path
- `haiku` - Should require LLM fallback

**Note:** Path mismatches are tracked as warnings, not failures. A case passes if the classification is correct, regardless of which path was taken. Use the `path-validation` tag to filter cases where routing matters.

## Running Evaluations

```bash
# Run all assessment-agent corpus files
pnpm --filter corpus-eval eval:assessment

# Run specific category
pnpm --filter corpus-eval eval:assessment:publish
pnpm --filter corpus-eval eval:assessment:domain
pnpm --filter corpus-eval eval:assessment:fix
pnpm --filter corpus-eval eval:assessment:general

# Run with verbose output
pnpm --filter corpus-eval eval:assessment:verbose

# Filter by tags
pnpm --filter corpus-eval eval run corpora/assessment-agent/ --tags "multilingual"
pnpm --filter corpus-eval eval run corpora/assessment-agent/ --tags "negation,edge-case"

# Compare models
pnpm --filter corpus-eval eval compare corpora/assessment-agent/ -m haiku,sonnet

# Generate HTML report (JSON is always saved)
pnpm --filter corpus-eval eval run corpora/assessment-agent/ --html
```

## Expected Accuracy Targets

| Category              | Target |
| --------------------- | ------ |
| **Overall**           | > 85%  |
| **Clear intent**      | > 95%  |
| **Multilingual**      | > 80%  |
| **Multi-turn**        | > 85%  |
| **Negation handling** | > 90%  |
| **Edge cases**        | > 75%  |

## Adding Test Cases

When adding new test cases:

1. Add to the appropriate category file based on expected task type
2. Use a unique ID following the pattern: `{category}-{type}-{number}`
3. Include relevant tags for filtering
4. Add `rationale` for non-obvious expected outcomes
5. For multi-turn cases, include `previousMessage`

Example:

```yaml
- id: "publish-complex-042"
  prompt: "I've tested everything locally and it looks good. Can you deploy the latest version to production?"
  expectedTaskType: "publish"
  expectedPath: "embedding"
  tags: ["clear-intent", "long-form", "en-us"]
  rationale: "Clear publish intent despite verbose phrasing"
```

## Corpus Design Principles

1. **Realistic prompts**: Mirror actual user behavior in an AI app builder
2. **Category balance**: Each task type well-represented
3. **Edge coverage**: Include ambiguous and adversarial cases
4. **Multilingual support**: Test cross-lingual semantic matching
5. **Context sensitivity**: Test multi-turn conversation understanding
