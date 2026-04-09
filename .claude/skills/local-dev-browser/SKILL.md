---
name: local-dev-browser
description: Use when investigating the local Airo Builder app with agent-browser - covers login, console capture, app creation flow, and common debugging of the local dev environment at https://local.gasket.dev-godaddy.com:8443/
---

# Local Dev Browser Testing

Use agent-browser to interact with the local Airo Builder dev environment for debugging and investigation.

## Prerequisites

- The local dev server must be running (`pnpm run dev`)
- **REQUIRED:** Load the `agent-browser` skill before using any commands below (invoke it via the Skill tool)

## Setup

### 1. Read Credentials

Each developer's GoDaddy SSO credentials live in the project root `.env` (manually created, gitignored):

```bash
# Read from .env in the airo-app-builder repo root (strips quotes and inline comments)
GODADDY_DEV_USERNAME=$(grep -oP 'GODADDY_DEV_USERNAME=\K[^#\s"'\'']*' .env)
GODADDY_DEV_PASSWORD=$(grep -oP 'GODADDY_DEV_PASSWORD=\K[^#\s"'\'']*' .env)
```

### 2. Launch Browser

Always use `--headed` so the developer can see the browser and follow along:

```bash
agent-browser --session localdev --headed open "https://local.gasket.dev-godaddy.com:8443/"
```

A trusted local HTTPS setup (for example, using `mkcert`, using dev-runner) is normally used for local dev. On the rare occasion environments instead use self-signed certificates, which can cause certificate warnings or connection failures in the browser or `agent-browser` until the local CA/certificate is trusted.

If the page does not open because the certificate is rejected, trust the local development CA/certificate for `https://local.gasket.dev-godaddy.com:8443/` or open the site in a regular browser and accept the warning before retrying.
**Note:** `--headed` must be passed on the first command that starts the session (i.e. the `open`). Once the daemon is running, it cannot be changed without closing and reopening.

### 3. Console Logs

agent-browser captures console output (log, warn, error, info) natively:

```bash
agent-browser --session localdev console          # View captured logs
agent-browser --session localdev console --clear   # Clear log buffer
agent-browser --session localdev console --json    # JSON output for parsing
```

## Login Flow

The app uses GoDaddy SSO via an iframe. After clicking "Start building" on the homepage, an SSO login modal appears **inside the page** as an iframe. agent-browser can see into this iframe via normal `snapshot -i`.

### Steps

```bash
# 1. Homepage - fill in a prompt
agent-browser --session localdev snapshot -i
# Find the prompt textbox (placeholder like "I want to build a site about...")
agent-browser --session localdev fill @<textbox-ref> "A simple portfolio site"

# 2. Click "Start building" (re-snapshot to get updated ref since fill may change refs)
agent-browser --session localdev snapshot -i
# Find: button "Start building" — will be disabled if textbox is empty
agent-browser --session localdev click @<start-building-ref>

# 3. Wait for SSO modal to appear, then snapshot
agent-browser --session localdev wait 2000
agent-browser --session localdev snapshot -i
# You will see an Iframe "Container for sign in" section with:
#   - textbox "Username or Customer #"
#   - textbox "Password"
#   - button "Sign In"

# 4. Fill credentials — use printf|xargs for the password to avoid shell escaping issues
agent-browser --session localdev fill @<username-ref> "$GODADDY_DEV_USERNAME"
printf '%s\0' "$GODADDY_DEV_PASSWORD" | xargs -0 agent-browser --session localdev fill @<password-ref>

# 5. Sign in — redirects back to homepage, which then initiates app creation
agent-browser --session localdev click @<signin-ref>
agent-browser --session localdev wait --load networkidle
agent-browser --session localdev get url
# Expected flow:
#   1. Redirects back to homepage (/) with saved prompt
#   2. App creation starts automatically (calls control plane)
#   3. Redirects to /develop/<id>?type=job (loading/polling page)
#   4. Once job completes, transitions to /develop/<id> (builder)
```

### Cookie Consent

A cookie consent banner may appear on the homepage. Look for an "Accept" button in the snapshot and click it before proceeding.

## Key Pages After Login

| URL Pattern              | Page                    | What It Shows                                                       |
| ------------------------ | ----------------------- | ------------------------------------------------------------------- |
| `/`                      | Homepage                | Prompt input, template buttons                                      |
| `/apps`                  | App listing             | Grid of existing apps                                               |
| `/develop/<id>?type=job` | Job polling / "Waiting" | "Loading your App" spinner — polls control plane for job completion |
| `/develop/<id>`          | Builder                 | Chat pane (left), preview/edit/code (right)                         |

## Debugging the "Stuck on Loading" Issue

After login, the app redirects to `/develop/<id>?type=job`. This page:

1. Polls the local control plane (`localhost:4100`) for job status
2. Shows "Teaching your code how to fly..." / "Loading your App"
3. Says "This usually takes 30-60 seconds"

**To investigate why it's stuck:**

```bash
# Screenshot to see visual state
agent-browser --session localdev screenshot /tmp/loading-state.png

# Check console logs for errors
agent-browser --session localdev console

# Check network requests to control plane
agent-browser --session localdev eval --stdin <<'EVALEOF'
JSON.stringify(performance.getEntriesByType('resource').filter(r => r.name.includes('4100') || r.name.includes('api/airo')).map(r => ({ url: r.name.split('?')[0], status: r.responseStatus, duration: Math.round(r.duration) })), null, 2)
EVALEOF
```

**Also check the control plane directly from the terminal:**

```bash
# Check if control plane is running
curl -s http://localhost:4100/health

# Check job status (get jobId from the URL)
curl -s http://localhost:4100/api/airo/v1/jobs/<jobId>

# Check control plane logs
tail -50 local-control-plane/dev.log
```

## Initialization State Machine

The develop page uses an XState machine with these phases:

`idle` -> `checkingCreation` (polls job) -> `creating` (job->app) -> `initializingPage` -> `loadingHistory` -> `ready`

The `loadingPhase` store drives the UI: `initializing` | `deploying` | `polling` | `verifying-agent` | `complete` | `error`

Key file: `app/src/app/develop/hooks/initializationMachine.ts`

## Tips

- Always use `--session localdev` to keep state across commands
- Take screenshots liberally — `agent-browser --session localdev screenshot /tmp/descriptive-name.png`
- Re-snapshot after every click/navigation — refs get invalidated
- The SSO iframe is cross-origin but agent-browser CAN see into it via `snapshot -i` when it's displayed within the app page
- Do NOT navigate directly to the SSO URL — stay on the app page so the iframe context works
- Use `printf '%s\0' 'password' | xargs -0` pattern for passwords with whitespace or `!` (history expansion in interactive shells)
- Close the session when done: `agent-browser --session localdev close`
