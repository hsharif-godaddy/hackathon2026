# Using mitmproxy

Inspect and fault-inject the LLM backend (GoCode) for local debugging.

## Setup

1. Install on macOS: `brew install mitmproxy`
2. Start the proxy: `./scripts/mitmproxy/mitmproxy-gocode.sh`
   - Defaults to the **dev** GoCode S2S endpoint (`https://api.gocode.caas.dev-gdcorp.tools`),
     matching a local `agents/.env` with `NODE_ENV=development`.
   - Override the upstream for other environments, e.g. prod:
     `GOCODE_UPSTREAM=https://api.gocode.caas.gdcorp.tools ./scripts/mitmproxy/mitmproxy-gocode.sh`
   - mitmweb listens on `:8080` (proxy) and opens its web UI on `:8081`.
3. Point the agent at the proxy — add to `agents/.env` (remove when done):

   ```
   OPENAI_BASE_URL=http://localhost:8080
   ANTHROPIC_BASE_URL=http://localhost:8080
   ```

   Both are needed in the default local config: `ANTHROPIC_BASE_URL` captures
   Claude chat calls (routed through the Anthropic provider) while
   `OPENAI_BASE_URL` carries OpenAI-compatible/embedding traffic. This works even
   with `GOCODE_USE_S2S_AUTH=true`: the S2S endpoint honors these overrides (see
   `packages/ai-lib/src/utils/s2s-auth.ts`). The S2S fetch wrapper still injects
   the `Authorization: sso-jwt` token before the request reaches the proxy, so no
   extra auth setup is needed.
4. Restart agents and use the app as usual.

You should now see requests in the mitmproxy web view (`http://localhost:8081`).

## Fault injection

Edit `gocode-random-error.py` to enable scenarios (rate limits, budget-exceeded,
timeouts, dropped streams, truncation, etc.). `mitmproxy` hot-reloads it on change.
