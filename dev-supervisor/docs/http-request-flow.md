# HTTP Request Flow with Idle and Deferred Setup

This diagram shows all possible flows when an HTTP request is received by the dev-supervisor HTTP proxy with both idle mode and deferred setup enabled.

```mermaid
flowchart TD
    Start([HTTP Request Arrives]) --> IsHealth{Is /airo/health?}

    %% Health Check Path
    IsHealth -->|Yes| CheckProxyEnabled{Proxy Enabled?}
    CheckProxyEnabled -->|No| UnhealthyProxyDisabled[503 Unhealthy<br/>proxy not enabled]
    CheckProxyEnabled -->|Yes| CheckProcessState{Process State?}

    CheckProcessState -->|Stopped| HasAutostart{Has Autostart?<br/>deferred setup OR<br/>start-on-request}
    HasAutostart -->|Yes| HealthyAutostart[200 Healthy<br/>reason: autostart]
    HasAutostart -->|No| ProbeBackend1[Probe Backend<br/>HTTP GET /]

    CheckProcessState -->|Running/Starting/Error| ProbeBackend1

    ProbeBackend1 --> BackendCheck1{Backend Response?}
    BackendCheck1 -->|2xx| HealthyBackend[200 Healthy]
    BackendCheck1 -->|Connection Error| UnhealthyUnreachable[503 Unhealthy<br/>target not reachable]
    BackendCheck1 -->|Non-2xx| UnhealthyStatus[503 Unhealthy<br/>target returned status X]

    %% Regular Request Path
    IsHealth -->|No| CheckStopped{Process Stopped?}

    CheckStopped -->|No| Forward[Forward to Backend<br/>via Reverse Proxy]
    Forward --> UpdateActivity[Update Activity<br/>Reset Idle Timer]
    UpdateActivity --> End([Response Returned])

    CheckStopped -->|Yes| TriggerAutostart[Trigger Autostart]
    TriggerAutostart --> HasDeferred{Has Deferred<br/>Setup?}

    %% Deferred Setup Path
    HasDeferred -->|Yes| AcquireMutex{Acquire Setup<br/>Mutex?}
    AcquireMutex -->|Timeout 5min| AutostartError1[500 Service Setup Failed]
    AcquireMutex -->|Acquired| CheckExecuted{Already<br/>Executed?}
    CheckExecuted -->|Yes| SkipSetup[Skip Setup]
    CheckExecuted -->|No| RunSetup[Run nomad_setup.sh]

    RunSetup --> SetupResult{Setup Result?}
    SetupResult -->|Success| MarkExecuted[Mark Setup Executed<br/>Save Start Request]
    SetupResult -->|Failure| AutostartError2[500 Service Setup Failed]

    MarkExecuted --> SkipSetup
    SkipSetup --> GetStartReq{Get Start<br/>Request?}

    HasDeferred -->|No| GetStartReq

    %% Process Start Path
    GetStartReq -->|None| AutostartError3[500 Service Config Error]
    GetStartReq -->|Found| StartProcess[Start Process<br/>npm run dev]

    StartProcess --> StartResult{Start Result?}
    StartResult -->|AlreadyStarting/Running| LogRace[Log Concurrent Race]
    StartResult -->|Error| AutostartError4[503 Service Unavailable]
    StartResult -->|Success| LogRace

    LogRace --> WaitLoop[Wait for Process Ready<br/>60s timeout]

    WaitLoop --> CheckState{Process State?}
    CheckState -->|Stopped| AutostartError5[502 Startup Failed]
    CheckState -->|Running| TCPProbe[TCP Probe Backend<br/>30s deadline, 100ms retry]
    CheckState -->|Error| AutostartError6[502 Startup Failed]
    CheckState -->|Starting/Stopping| WaitStateChange{Wait for<br/>State Change}

    WaitStateChange -->|Client Canceled| ClientCanceled[Client Disconnected]
    WaitStateChange -->|Timeout 60s| AutostartError7[504 Startup Timeout]
    WaitStateChange -->|State Changed| CheckState

    TCPProbe --> ProbeResult{Probe Result?}
    ProbeResult -->|Success| ForwardRequest[Forward Request<br/>to Backend]
    ProbeResult -->|Process Died| AutostartError8[502 Startup Failed]
    ProbeResult -->|Timeout 30s| AutostartError9[504 Probe Timeout]
    ProbeResult -->|Client Canceled| ClientCanceled2[Client Disconnected]

    ForwardRequest --> UpdateActivity2[Update Activity<br/>Reset Idle Timer]
    UpdateActivity2 --> End

    %% Styling
    classDef healthy fill:#90EE90
    classDef unhealthy fill:#FFB6C1
    classDef error fill:#FF6B6B
    classDef process fill:#87CEEB

    class HealthyAutostart,HealthyBackend healthy
    class UnhealthyProxyDisabled,UnhealthyUnreachable,UnhealthyStatus unhealthy
    class AutostartError1,AutostartError2,AutostartError3,AutostartError4,AutostartError5,AutostartError6,AutostartError7,AutostartError8,AutostartError9,ClientCanceled,ClientCanceled2 error
    class RunSetup,StartProcess,WaitLoop,TCPProbe process
```

## Key Flows

### Health Check Path

**When process is stopped with autostart:**

- Returns `200 OK` with `"reason": "autostart"` immediately
- Does NOT check the backend
- Indicates the system is ready to serve requests on-demand

**When process is running or in other states:**

- Probes the backend with `HTTP GET /`
- Returns `200 OK` only if backend responds with 2xx
- Returns `503` if backend is unreachable or returns non-2xx

### Regular Request Path (Autostart)

**When process is stopped:**

1. **Deferred Setup (if configured)**

   - Acquires mutex (prevents concurrent setup)
   - Checks if already executed (idempotent)
   - Runs `nomad_setup.sh` (restores workspace if corrupted)
   - Marks as executed

2. **Process Start**

   - Starts the backend process (`npm run dev`)
   - Handles race conditions (already starting/running)

3. **Wait for Ready**

   - Waits up to 60 seconds for process to reach `Running` state
   - Uses state change notifications (not polling)
   - Handles client cancellation

4. **TCP Readiness Probe**

   - After process reports `Running`, probes the backend TCP port
   - Retries every 100ms for up to 30 seconds
   - Each connection attempt has 500ms timeout
   - Ensures backend server is actually accepting connections
   - Avoids "connection refused" errors on first requests

5. **Forward Request**
   - Reverse proxies the original request to backend
   - Updates activity timestamp (resets idle timer)

**When process is running:**

- Immediately forwards request to backend
- Updates activity timestamp

### Error Cases

| Error                       | HTTP Status | Reason                                        |
| --------------------------- | ----------- | --------------------------------------------- |
| Setup mutex timeout         | 500         | Another request stuck in setup for 5+ minutes |
| Setup script failure        | 500         | nomad_setup.sh exited with error              |
| No start request config     | 500         | Missing process start configuration           |
| Process start error         | 503         | Failed to start the process                   |
| Startup failed (stopped)    | 502         | Process started but immediately stopped       |
| Startup failed (error)      | 502         | Process entered error state                   |
| Startup timeout             | 504         | Process didn't become ready within 60s        |
| TCP probe process died      | 502         | Process died while probing backend port       |
| TCP probe timeout           | 504         | Backend port not ready within 30s             |
| Client disconnect           | -           | Client canceled while waiting                 |

### Activity Tracking

Every successfully forwarded request updates the activity timestamp, resetting the idle timeout:

- **Local dev:** 5 minutes (via `docker-compose-generator.ts`)
- **Preview (Nomad):** 30 minutes (via Nomad job template)

After the idle timeout expires with no activity, the process is automatically stopped to save resources.

## Configuration

**Deferred Setup:**

```bash
DEV_SUPERVISOR_SETUP_SCRIPT=/management-scripts/nomad_setup.sh
DEV_SUPERVISOR_DEFER_RESTART_SETUP=true  # Opt-in (defaults to false)
```

**Start-on-Request (Idle Mode):**

```bash
DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=true
DEV_SUPERVISOR_IDLE_TIMEOUT=30m
DEV_SUPERVISOR_IDLE_CHECK_INTERVAL=30s
NOMAD_TASK_NAME=preview  # Safety: only enabled for preview variant
```

## Implementation Details

- **Health check:** `dev-supervisor/internal/proxy/http/health.go`
- **Autostart:** `dev-supervisor/internal/proxy/http/autostart.go`
- **Deferred setup:** `dev-supervisor/internal/processmanager/manager.go` (`ExecuteDeferredSetup()`)
- **Idle detection:** `dev-supervisor/internal/proxy/http/activity.go`
- **Setup script:** `container-scripts/preview/nomad_setup.sh`
