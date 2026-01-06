# POC Develop Agent Mode

## What is POC Mode?

POC (Proof of Concept) mode enables a streamlined version of the develop agent with:
- **92% smaller prompt** (134 lines vs 1700 lines)
- **Single file prompt** (`poc-core.md`) instead of 13 files
- **Focused guidance** on using `componentGenerator` vs `fileEdit`
- **Easy iteration** - all behavior in one place

## How to Enable

Set the environment variable:

```bash
export USE_POC_DEVELOP_AGENT=true
```

Or in your `.env` file:

```
USE_POC_DEVELOP_AGENT=true
```

## Verification

When POC mode is enabled, you'll see this message in the console/logs:

```
🔬 POC Develop Agent enabled (USE_POC_DEVELOP_AGENT=true)
```

And in structured logs:

```json
{
  "message": "🔬 POC Develop Agent enabled",
  "envVar": "USE_POC_DEVELOP_AGENT=true",
  "promptLines": 134,
  "originalPromptLines": 1700,
  "reduction": "92%"
}
```

## Troubleshooting

### Not seeing the POC message?

1. **Check the environment variable value:**
   ```bash
   echo $USE_POC_DEVELOP_AGENT
   ```
   It must be exactly `true` (lowercase)

2. **Restart your server/process** after setting the environment variable

3. **Check for warning messages:**
   If you see: `⚠️ USE_POC_DEVELOP_AGENT is set to "..." but must be "true"`
   Then the variable is set but not to the correct value

### Common mistakes:

- ❌ `USE_POC_DEVELOP_AGENT=True` (capital T)
- ❌ `USE_POC_DEVELOP_AGENT=1` (number instead of string)
- ❌ `USE_POC_DEVELOP_AGENT="true"` (quotes may cause issues in some shells)
- ✅ `USE_POC_DEVELOP_AGENT=true` (correct)

## What Changes in POC Mode?

### Prompt Changes

| Original | POC |
|----------|-----|
| 13 prompt files | 1 prompt file |
| ~1700 lines | 134 lines |
| Complex workflows | Focused on component generation |
| Skills, handoffs, commerce, etc. | Core tools + componentGenerator |

### Tools Available

POC mode includes only essential tools:
- `componentGenerator` ⭐ (the focus)
- `fileEdit`
- `readFile`
- `directoryListing`
- `grepSearch`
- `terminalCommand`
- `serverRestart`
- `todoList`
- `suggestedResponse`

### Handoffs

POC mode supports only:
- `color-scheme` agent

(No marketing, commerce, or skills handoffs)

## Editing the POC Prompt

To modify the POC agent behavior, edit:

```
agents/src/prompts/develop/poc-core.md
```

This single file contains all the guidance. Changes take effect after restarting the agent.

## Switching Back to Full Agent

Remove or set to false:

```bash
unset USE_POC_DEVELOP_AGENT
# or
export USE_POC_DEVELOP_AGENT=false
```

Then restart your server/process.

## Files Involved

- `agents/src/prompts/develop/poc-core.md` - The POC prompt
- `agents/src/agents/develop-agent-poc.ts` - POC agent configuration
- `agents/src/agents/develop-agent.ts` - Main agent with POC mode check
- `agents/src/agents/ai-lib-agents/index.ts` - Factory that checks POC mode




