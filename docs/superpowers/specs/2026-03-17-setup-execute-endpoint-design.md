# POST /setup/execute Endpoint

Add an HTTP endpoint to dev-supervisor that lets the agents service trigger deferred setup on demand, enabling the agent to ensure the preview container's filesystem is restored before performing git operations after a Nomad reschedule.

## Context

After a Nomad reschedule, the ephemeral disk is wiped but the `.git` directory survives on a bind mount. The preview container's `nomad_setup.sh` restores the working tree (`git checkout .`, `npm install`), but this setup is **deferred** until the first HTTP request to conserve resources.

The agents service can receive WebSocket messages before setup runs. If `handleMessageStart` performs git operations (via `/exec` through dev-supervisor) before `nomad_setup.sh` has restored the working tree, it races on `.git/index.lock` and operates on a potentially empty filesystem.

PR #1967 added `GET /setup/status` and `GetSetupStatus()` / `HasDeferredSetup()` so the agent can query setup state. This spec adds `POST /setup/execute` so the agent can trigger setup, matching the behavior of a user visiting the preview for the first time.

## Design

### Go: `handleSetupExecute` handler

**File:** `dev-supervisor/cmd/dev-supervisor/api.go`

New handler registered as part of a `/setup` subrouter (refactoring the existing `/setup/status` route to use the subrouter for consistency with `processRouter`, `envRouter`, etc.):

```go
setupRouter := s.router.PathPrefix("/setup").Subrouter()
setupRouter.HandleFunc("/status", s.handleSetupStatus).Methods("GET")
setupRouter.HandleFunc("/execute", s.handleSetupExecute).Methods("POST")
```

**Handler flow** (avoids TOCTOU races and error string matching):

```go
func (s *Server) handleSetupExecute(w http.ResponseWriter, _ *http.Request) {
    // 1. Check current state BEFORE calling ExecuteDeferredSetup
    status := s.procMgr.GetSetupStatus()

    if !status.SetupConfigured {
        // No setup script configured (local dev or non-deferred mode)
        respond(w, 200, SetupExecuteResponse{Status: "not_configured"})
        return
    }

    if status.SetupExecuted {
        // Already ran (idempotent - another caller beat us)
        respond(w, 200, SetupExecuteResponse{Status: "already_executed"})
        return
    }

    // 2. Run the setup script
    if err := s.procMgr.ExecuteDeferredSetup(); err != nil {
        respond(w, 500, SetupExecuteResponse{Status: "error", Error: &errMsg})
        return
    }

    // 3. Start process from saved request if not already running
    //    (mirrors HTTP proxy autostart behavior)
    s.startProcessIfNotRunning()

    respond(w, 200, SetupExecuteResponse{Status: "executed"})
}
```

By checking `GetSetupStatus()` first, we avoid string-matching on error messages from `ExecuteDeferredSetup()`. The TOCTOU window between the status check and the call is harmless - `ExecuteDeferredSetup()` is internally idempotent (mutex + `deferredSetupExecuted` atomic check), so a concurrent caller between our check and call just means we get a fast `nil` return.

Response type:

```go
type SetupExecuteResponse struct {
    Status string  `json:"status"` // "executed", "already_executed", "not_configured", "error"
    Error  *string `json:"error,omitempty"`
}
```

### Go: Process start after setup

After `ExecuteDeferredSetup()` succeeds with status "executed", check if the process is already running. If not, start it using the saved start request (same pattern as the HTTP proxy autostart in `proxy/http/autostart.go`). This ensures the preview process is ready when the user's message triggers a preview render.

### Go: Timeout considerations

`ExecuteDeferredSetup()` runs `nomad_setup.sh` which performs `git checkout .` + `npm install`. This can take 30-60+ seconds. The method already has its own internal timeout (`deferredSetupTimeout`, default 10 minutes) and a 5-minute mutex acquisition timeout. No additional HTTP-level timeout is needed in the handler.

The TypeScript client uses Node.js `http.request` which has no default socket timeout. The Go-side mutex timeout (5 minutes) and deferred setup timeout (10 minutes) bound the request duration. The same pattern applies to existing long-running `/exec` calls.

### TypeScript: `DevSupervisorClient.executeSetup()`

**File:** `agents/src/services/DevSupervisorClient.ts`

```typescript
export interface SetupExecuteResponse {
  status: 'executed' | 'already_executed' | 'not_configured' | 'error';
  error?: string;
}

async executeSetup(): Promise<SetupExecuteResponse> {
  this.logger.info('dev_supervisor.setup_execute.begin');
  try {
    const response = await this.makeRequest('POST', '/setup/execute');
    return response;
  } catch (error) {
    this.logger.error('dev_supervisor.setup_execute.failure', {
      error: getErrorMessage(error)
    });
    throw error;
  }
}
```

Follows the mutation-method pattern (logging `.begin` before the call), consistent with `publish()` and `startProcess()`.

### Tests

**Go unit tests** (`dev-supervisor/cmd/dev-supervisor/api_test.go`):

| Test case              | Setup state                     | Expected                                   |
| ---------------------- | ------------------------------- | ------------------------------------------ |
| No setup configured    | `deferredSetupScript == ""`     | 200, `{"status": "not_configured"}`        |
| Setup succeeds         | Deferred, not yet run           | 200, `{"status": "executed"}`              |
| Setup already executed | `deferredSetupExecuted == true` | 200, `{"status": "already_executed"}`      |
| Setup fails            | Script returns error            | 500, `{"status": "error", "error": "..."}` |

Follow the existing `handleSetupStatus` test pattern in `api_test.go`.

**No new TS tests** - the client method is a thin wrapper matching the pattern of `getSetupStatus()` (also untested as a thin wrapper). Integration testing happens via Go tests and the follow-up PR that wires `executeSetup()` into `handleMessageStart`.

## Files Changed

| File                                            | Change                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `dev-supervisor/cmd/dev-supervisor/api.go`      | Add `handleSetupExecute` handler and `SetupExecuteResponse` type          |
| `dev-supervisor/cmd/dev-supervisor/api_test.go` | Add 4 test cases                                                          |
| `dev-supervisor/cmd/dev-supervisor/main.go`     | Refactor `/setup/status` into setup subrouter, add `/setup/execute` route |
| `agents/src/services/DevSupervisorClient.ts`    | Add `SetupExecuteResponse` interface and `executeSetup()` method          |

## Not in Scope

- Wiring `executeSetup()` into `handleMessageStart` - follow-up PR (reworked #1794)
- Hardening `nomad_setup.sh` - separate concern
- Removing `performRecovery` - depends on the follow-up PR
