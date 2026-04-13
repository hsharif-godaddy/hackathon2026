# Model Override (Ops/SRE Runbook)

Emergency procedure to switch the AI model across all Airo Builder sessions when a provider is experiencing issues.

## Quick Steps

1. Go to [Switchboard](https://switchboard.int.gdcorp.tools/airo-app-builder)
2. Set `appbuilder-model-override` to a valid model name (see below)
3. Users pick up the new model on their next page reload or WebSocket reconnect

## Valid Model Names

| Name                | Description       |
| ------------------- | ----------------- |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 |
| `claude-haiku-4-5`  | Claude Haiku 4.5  |

Valid models can also be found in the model selection dropdown on dev/test or TLA accounts (Settings > Model Override).

The server-side allowlist is defined in `agents/src/server/constants.ts` (`ALLOWED_OVERRIDE_MODELS`). Any value not in this set is rejected and the system falls back to the default model.

## How It Works

1. The BFF reads `appbuilder-model-override` from Switchboard when creating agent JWT tokens
2. The value is embedded as a signed `modelOverride` claim in the JWT
3. The agents service reads the claim and applies the override to all AI operations (main agent, summarizer, tools)
4. If the model name is invalid or unsupported, the system logs a warning and falls back to the default model

## Reverting

Set `appbuilder-model-override` back to `default` in Switchboard. This clears the override and all sessions revert to the system-configured model on their next token refresh.

## User Impact

- **No downtime** -- the switch is seamless
- **No user action required** -- the override takes effect on the next page reload or WebSocket reconnect (token refresh)
- Active sessions continue on the old model until their JWT expires and is refreshed
- The override applies globally to all users and all AI components (agent, summarizer, tools)

## Developer Model Selector (Dev/Test Only)

A separate Switchboard flag `appbuilder-model-selector` enables a per-project model selector in the Settings panel. This is for developer testing only and does not affect production users.

When both are set, the per-project selection takes priority over the global Switchboard override.

## Switchboard Flags

| Flag                        | Type    | Purpose                                                        |
| --------------------------- | ------- | -------------------------------------------------------------- |
| `appbuilder-model-override` | String  | Global model override (set to a valid model name or `default`) |
| `appbuilder-model-selector` | Boolean | Enables per-project model selector UI in dev/test and TLA's    |
