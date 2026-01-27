# Start-on-Request Design

**Date:** 2026-01-23
**Status:** Approved (Revised after Codex review)
**Revision:** 2 - Incorporated Codex feedback

## Overview

Implement automatic start-on-request functionality for preview apps that automatically starts stopped apps when users visit them, and auto-stops after idle timeout to optimize resource usage.

### Goals

- Reduce resource consumption for idle preview apps
- Maintain seamless UX - users shouldn't notice apps are stopped
- Work consistently across local development and production (Nomad)
- Only apply to preview variant (publish stays always-on)

### Non-Goals

- Applying auto-stop to publish variant (must stay running)
- Modifying control plane lifecycle state tracking
- Supporting partial shutdowns (e.g., stop backend but keep proxy)

## Design Revisions (Codex Review Feedback)

**Initial design issues identified and fixed:**

1. **Root-only trigger** → Changed to auto-start on ANY request (not just `/`)
2. **WebSocket idle disconnect** → Track active WebSocket connections to prevent idle stop
3. **Cached config staleness** → Use current process config when available
4. **Goroutine leak** → Stop idle monitor in `StopAllProcesses()`
5. **HTML spinner breaks non-browsers** → Use hold-and-forward approach for all clients
6. **Ignored stop errors** → Log errors from idle stop operations
7. **Activity too broad** → Only count proxied requests as activity (not static assets)

These fixes ensure the feature works reliably for all client types (browsers, APIs, WebSockets, mobile apps) and doesn't leak resources.

## Architecture

### Current State

**dev-supervisor** is deployed as:
- **One instance per variant** (separate Nomad tasks for preview/publish)
- Acts as **PID 1** and **HTTP proxy** for the variant's app process
- Has existing components:
  - `ProcessManager` - Manages single app process lifecycle
  - `HTTPProxy` - Reverse proxy with TLS, health checks, static serving
  - `RequestRouter` - Routes requests based on path/content type
  - `HealthMonitor` - Automated health checking and restarts

### Target State

Add start-on-request functionality by:

1. **Activity Tracking** - Track last request time atomically
2. **Idle Monitor** - Background goroutine checks for idle timeout
3. **Auto-Start on `/`** - Intercept root path requests, start if stopped
4. **Streaming Progress** - Show startup progress for browser requests
5. **Silent Start for WebSocket** - Wait without HTML response for WS upgrades

## Design Details

### 1. Configuration

**Environment Variables:**

```bash
# Enable start-on-request (default: false, only for preview variant)
DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=true

# Idle timeout before auto-stopping (default: 30m)
DEV_SUPERVISOR_IDLE_TIMEOUT=30m

# Idle check interval (default: 30s)
DEV_SUPERVISOR_IDLE_CHECK_INTERVAL=30s
```

**Variant Detection:**

Only enable for `NOMAD_TASK_NAME == "preview"`. If enabled for other variants, log warning and disable.

**Config Struct:**

```go
type Config struct {
    // ... existing fields ...
    StartOnRequestEnabled bool
    IdleTimeout           time.Duration
    IdleCheckInterval     time.Duration
}
```

### 2. ProcessManager Changes

**Add Idle Tracking:**

```go
type ProcessManager struct {
    // ... existing fields ...
    lastActivityTime      atomic.Value     // stores time.Time
    idleTimeout           time.Duration
    idleCheckInterval     time.Duration
    idleMonitorCancel     context.CancelFunc
    startOnRequestEnabled bool
    initialStartRequest   *ProcessStartRequest // Cached for auto-restart
    activeWebSockets      sync.Map             // map[net.Conn]bool - tracks active WS connections
}
```

**Enable Method:**

```go
func (pm *ProcessManager) EnableStartOnRequest(idleTimeout, checkInterval time.Duration) {
    pm.startOnRequestEnabled = true
    pm.idleTimeout = idleTimeout
    pm.idleCheckInterval = checkInterval
    pm.UpdateActivity() // Initialize to now

    ctx, cancel := context.WithCancel(context.Background())
    pm.idleMonitorCancel = cancel

    go pm.idleMonitorLoop(ctx)
}

func (pm *ProcessManager) UpdateActivity() {
    pm.lastActivityTime.Store(time.Now())
}
```

**Idle Monitor Loop:**

```go
func (pm *ProcessManager) idleMonitorLoop(ctx context.Context) {
    ticker := time.NewTicker(pm.idleCheckInterval)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            pm.checkIdleAndStop()
        }
    }
}

func (pm *ProcessManager) checkIdleAndStop() {
    status := pm.GetStatus()
    if status.State != ProcessStateRunning {
        return // Already stopped
    }

    // Check if any WebSocket connections are active
    hasActiveWS := false
    pm.activeWebSockets.Range(func(key, value interface{}) bool {
        hasActiveWS = true
        return false // stop iteration
    })

    if hasActiveWS {
        slog.Debug("idle.check.has_active_websockets",
            "count", "at least one")
        return // Don't stop if WebSockets are active
    }

    lastActivity := pm.lastActivityTime.Load().(time.Time)
    idleDuration := time.Since(lastActivity)

    if idleDuration > pm.idleTimeout {
        slog.Info("idle.stopping",
            "idle_duration", idleDuration,
            "threshold", pm.idleTimeout,
            "pid", status.PID)

        err := pm.Stop(ProcessStopRequest{
            Signal:  "SIGTERM",
            Timeout: 30,
        })

        if err != nil {
            slog.Error("idle.stop_failed",
                "error", err,
                "pid", status.PID,
                "idle_duration", idleDuration)
        } else {
            slog.Info("idle.stopped",
                "pid", status.PID,
                "uptime", time.Since(status.StartTime))
        }
    }
}

func (pm *ProcessManager) RegisterWebSocket(conn net.Conn) {
    pm.activeWebSockets.Store(conn, true)
    slog.Debug("websocket.registered", "remote_addr", conn.RemoteAddr())
}

func (pm *ProcessManager) UnregisterWebSocket(conn net.Conn) {
    pm.activeWebSockets.Delete(conn)
    slog.Debug("websocket.unregistered", "remote_addr", conn.RemoteAddr())
}
```

**Cache Initial Start Request:**

```go
func (pm *ProcessManager) Start(req ProcessStartRequest) error {
    pm.mu.Lock()
    defer pm.mu.Unlock()

    // Cache initial request for auto-restarts
    if pm.initialStartRequest == nil {
        reqCopy := req
        pm.initialStartRequest = &reqCopy
    }

    // Check for concurrent start attempts
    if pm.currentProcess != nil {
        status := pm.currentProcess.GetInfo()
        if status.State == ProcessStateRunning {
            return fmt.Errorf("process is already running")
        }
        if status.State == ProcessStateStarting {
            return fmt.Errorf("process is already starting")
        }
    }

    // ... rest of existing Start logic ...
}

func (pm *ProcessManager) GetInitialStartRequest() *ProcessStartRequest {
    pm.mu.RLock()
    defer pm.mu.RUnlock()

    // Prefer current process config (most recent)
    if pm.currentProcess != nil {
        return &pm.currentProcess.config
    }

    // Fallback to cached initial request
    return pm.initialStartRequest
}

func (pm *ProcessManager) StopIdleMonitor() {
    if pm.idleMonitorCancel != nil {
        pm.idleMonitorCancel()
        pm.idleMonitorCancel = nil
        slog.Info("idle_monitor.stopped")
    }
}

// Call in StopAllProcesses():
// pm.StopIdleMonitor()
```

### 3. HTTP Proxy Integration

**RequestRouter Changes:**

```go
type RequestRouter struct {
    // ... existing fields ...
    procMgr               *ProcessManager
    startOnRequestEnabled bool
}

func (rr *RequestRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Check if we need to auto-start (ANY request can trigger it)
    if rr.procMgr != nil && rr.startOnRequestEnabled {
        status := rr.procMgr.GetStatus()
        if status.State == ProcessStateStopped {
            // Auto-start for any request (hold and forward)
            rr.handleAutoStart(w, r)
            return
        }
    }

    // Existing routing logic for API routes
    if strings.HasPrefix(r.URL.Path, rr.apiPrefix) {
        // Update activity before proxying
        if rr.procMgr != nil && rr.startOnRequestEnabled {
            rr.procMgr.UpdateActivity()
        }
        rr.proxyHandler.ServeHTTP(w, r)
        return
    }

    // Static serving disabled - proxy everything to backend
    if !rr.isProductionMode {
        // Update activity before proxying
        if rr.procMgr != nil && rr.startOnRequestEnabled {
            rr.procMgr.UpdateActivity()
        }
        rr.proxyHandler.ServeHTTP(w, r)
        return
    }

    // Static serving enabled - handle based on file extension
    if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
        // Has file extension? Serve as static file (no activity update - doesn't hit backend)
        if path.Ext(r.URL.Path) != "" {
            if r.Method == http.MethodOptions {
                rr.writeStaticOptionsResponse(w, r)
                return
            }
            rr.staticHandler.ServeHTTP(w, r)
            return
        }

        // No extension - try static handler, fallback to SPA or proxy
        if rr.staticHandler != nil {
            recorder := httptest.NewRecorder()
            rr.staticHandler.ServeHTTP(recorder, r)

            if recorder.Code != http.StatusNotFound {
                // File found - serve it (no activity update)
                // ... copy response ...
                return
            }

            // File not found - behavior depends on method and SPA mode
            if r.Method != http.MethodGet && rr.spaFallback != "" {
                http.NotFound(w, r)
                return
            }
        }

        // SPA fallback for GET requests (no activity update - static file)
        if rr.spaFallback != "" && r.Method == http.MethodGet {
            http.ServeFile(w, r, rr.spaFallback)
            return
        }
    }

    // Default - proxy to backend (counts as activity)
    if rr.procMgr != nil && rr.startOnRequestEnabled {
        rr.procMgr.UpdateActivity()
    }
    rr.proxyHandler.ServeHTTP(w, r)
}
```

**Auto-Start with Hold-and-Forward:**

```go
func (rr *RequestRouter) handleAutoStart(w http.ResponseWriter, r *http.Request) {
    slog.Info("autostart.triggered",
        "path", r.URL.Path,
        "method", r.Method,
        "remote_addr", r.RemoteAddr)

    // Get cached start request
    startReq := rr.procMgr.GetInitialStartRequest()
    if startReq == nil {
        slog.Error("autostart.no_cached_config")
        http.Error(w, "Service configuration error", http.StatusInternalServerError)
        return
    }

    // Start the process
    startTime := time.Now()
    err := rr.procMgr.Start(*startReq)
    if err != nil && !strings.Contains(err.Error(), "already starting") {
        slog.Error("autostart.failed", "error", err)
        http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
        return
    }

    // Wait for process to be ready (hold the request)
    ticker := time.NewTicker(200 * time.Millisecond)
    defer ticker.Stop()
    timeout := time.After(60 * time.Second)

    for {
        select {
        case <-timeout:
            slog.Error("autostart.timeout",
                "path", r.URL.Path,
                "method", r.Method)
            http.Error(w, "Service startup timeout", http.StatusGatewayTimeout)
            return

        case <-ticker.C:
            status := rr.procMgr.GetStatus()

            switch status.State {
            case ProcessStateRunning:
                duration := time.Since(startTime)
                slog.Info("autostart.process_ready",
                    "pid", status.PID,
                    "startup_duration_ms", duration.Milliseconds(),
                    "path", r.URL.Path,
                    "method", r.Method)

                // Update activity before forwarding
                rr.procMgr.UpdateActivity()

                // Forward the original request to backend
                rr.proxyHandler.ServeHTTP(w, r)
                return

            case ProcessStateError:
                slog.Error("autostart.process_failed",
                    "error", status.Error,
                    "state", status.State,
                    "path", r.URL.Path)
                http.Error(w, "Service startup failed", http.StatusBadGateway)
                return

            case ProcessStateStarting:
                // Keep waiting
                slog.Debug("autostart.waiting",
                    "pid", status.PID,
                    "state", status.State)
            }
        }
    }
}
```

**Note on WebSocket Handling:**

The same `handleAutoStart` function works for WebSocket upgrade requests. The proxy will hold the connection open, start the process, and forward the upgrade request once the backend is ready. The WebSocket handshake completes normally from the client's perspective.

**HTTPProxy Enable Method:**

```go
type HTTPProxy struct {
    // ... existing fields ...
    procMgr               *ProcessManager
    startOnRequestEnabled bool
}

func (p *HTTPProxy) EnableStartOnRequest(procMgr *ProcessManager, idleTimeout, checkInterval time.Duration) {
    p.procMgr = procMgr
    p.startOnRequestEnabled = true

    // Enable idle monitoring in ProcessManager
    procMgr.EnableStartOnRequest(idleTimeout, checkInterval)

    slog.Info("start_on_request.enabled",
        "idle_timeout", idleTimeout,
        "check_interval", checkInterval)
}
```

**WebSocket Connection Tracking:**

To prevent idle stops during active WebSocket sessions, we wrap the response writer to detect hijacked connections:

```go
// In HTTPProxy.Start(), wrap the reverse proxy's ErrorHandler or ModifyResponse
// to track WebSocket connections

// Custom response writer wrapper that detects Hijack() calls
type webSocketTrackingWriter struct {
    http.ResponseWriter
    procMgr *ProcessManager
    request *http.Request
}

func (w *webSocketTrackingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
    hijacker, ok := w.ResponseWriter.(http.Hijacker)
    if !ok {
        return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
    }

    conn, rw, err := hijacker.Hijack()
    if err != nil {
        return nil, nil, err
    }

    // Register the WebSocket connection
    if w.procMgr != nil && isWebSocketUpgrade(w.request) {
        w.procMgr.RegisterWebSocket(conn)

        // Wrap the connection to detect close
        wrappedConn := &webSocketConn{
            Conn:    conn,
            procMgr: w.procMgr,
        }
        return wrappedConn, rw, nil
    }

    return conn, rw, nil
}

// Wrapper to detect WebSocket close
type webSocketConn struct {
    net.Conn
    procMgr *ProcessManager
    once    sync.Once
}

func (c *webSocketConn) Close() error {
    c.once.Do(func() {
        c.procMgr.UnregisterWebSocket(c.Conn)
    })
    return c.Conn.Close()
}
```

**Alternative (Simpler):** Track WebSocket upgrades in the existing Rewrite function:

```go
// In ReverseProxy.Rewrite (http_proxy.go line 713)
Rewrite: func(r *httputil.ProxyRequest) {
    // ... existing rewrite logic ...

    // Track WebSocket upgrades
    if isWebSocket && p.procMgr != nil && p.startOnRequestEnabled {
        // This is a WebSocket upgrade - we can't directly track the connection here,
        // but we can reset activity time to now + a longer duration to prevent
        // immediate idle timeout after upgrade
        p.procMgr.UpdateActivity()
    }
}
```

**Recommended approach:** Use the simpler alternative initially. If we see WebSocket sessions getting killed, we can add full connection tracking later.

### 4. Wiring in main.go

**Connect Components:**

```go
func (s *Server) startHTTPProxyIfEnabled() error {
    if !s.config.ProxyEnabled {
        return nil
    }

    // ... existing proxy config setup ...

    s.httpProxy = NewHTTPProxy(proxyConfig)

    // Enable start-on-request if configured
    if s.config.StartOnRequestEnabled {
        s.httpProxy.EnableStartOnRequest(
            s.procMgr,
            s.config.IdleTimeout,
            s.config.IdleCheckInterval,
        )
    }

    if err := s.httpProxy.Start(); err != nil {
        slog.Error("failed to start HTTP proxy", "error", err)
        return err
    }

    return nil
}
```

**Pass to RequestRouter in HTTPProxy.Start():**

```go
// In HTTPProxy.Start(), when creating RequestRouter
router := &RequestRouter{
    proxyHandler:          p.reverseProxy,
    staticHandler:         staticHandler,
    spaFallback:           spaFallback,
    apiPrefix:             routingConfig.APIPrefix,
    isProductionMode:      p.config.EnableStaticServing,
    allowedOrigins:        p.config.AllowedOrigins,
    procMgr:               p.procMgr,
    startOnRequestEnabled: p.startOnRequestEnabled,
}
```

## Error Handling

### Race Condition: Multiple Simultaneous Requests

**Problem:** Multiple users visit any path simultaneously when app is stopped.

**Solution:** First request starts the process, subsequent requests get "already starting" error and all wait in their own polling loops for the same process to become ready.

```go
// In ProcessManager.Start()
if status.State == ProcessStateStarting {
    return fmt.Errorf("process is already starting")
}

// In handleAutoStart() - error is ignored, just continue to polling loop
// All requests wait for the same process to reach ProcessStateRunning
```

### Process Crashes Immediately After Start

**Handled by polling loop** - if `status.State == ProcessStateError`, return 502 Bad Gateway.

### Idle Timeout During In-Flight Request

**Graceful shutdown** - `SIGTERM` with 30-second timeout allows in-flight requests to complete.

### Active WebSocket Sessions

**Tracked to prevent idle stop** - WebSocket connections are registered in `ProcessManager.activeWebSockets`. Idle check skips stopping if any WebSocket is active.

### Static Asset Requests Don't Prevent Idle

**Activity only counted for proxied requests** - Static files served directly by the proxy don't update activity time, so apps serving only cached assets will still idle out correctly.

### Goroutine Cleanup

**Idle monitor stopped on shutdown** - `ProcessManager.StopAllProcesses()` calls `StopIdleMonitor()` to cancel the idle monitoring goroutine.

## Local vs Production

### Configuration Differences

| Aspect | Local Development | Production (Nomad) |
|--------|-------------------|-------------------|
| Initial state | App auto-starts on container start | App auto-starts on allocation |
| `NOMAD_TASK_NAME` | Set manually in docker-compose | Auto-set by Nomad |
| Idle timeout | Longer (e.g., 2 hours) | Shorter (e.g., 30 minutes) |
| Opt-in | Optional for local dev | Enabled for cost savings |

### Example Configurations

**docker-compose.yml (local):**

```yaml
services:
  preview:
    environment:
      - NOMAD_TASK_NAME=preview
      - DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=true
      - DEV_SUPERVISOR_IDLE_TIMEOUT=2h

  publish:
    environment:
      - NOMAD_TASK_NAME=publish
      # No start-on-request for publish
```

**Nomad job (production):**

```hcl
task "preview" {
  env {
    DEV_SUPERVISOR_ENABLE_START_ON_REQUEST = "true"
    DEV_SUPERVISOR_IDLE_TIMEOUT            = "30m"
  }
}

task "publish" {
  # No start-on-request configuration
}
```

## Testing Strategy

### Unit Tests

**process_manager_test.go:**
- Test idle timeout stops process
- Test activity updates reset idle timer
- Test stopped process doesn't trigger idle check
- Test concurrent Start() calls return "already starting"
- Test initial start request caching

**http_proxy_test.go:**
- Test `/` triggers auto-start when stopped
- Test `/` proxies normally when running
- Test WebSocket upgrade on `/` when stopped
- Test activity tracking on all request types
- Test non-root paths return 503 when stopped

### Integration Tests

**integration_test.go:**
- End-to-end: start app, wait for idle timeout, request `/`, verify auto-start
- Variant filtering: test with preview/publish/no variant
- Concurrent requests to stopped app
- WebSocket auto-start flow

### Manual Testing Scenarios

1. Basic flow: idle timeout → visit `/` → see loading UI → app loads
2. Concurrent requests: 5 browser tabs to `/` simultaneously
3. WebSocket: connect WS client to `/` when stopped
4. Activity tracking: request every 20 min → verify no timeout
5. Error cases: app fails to start → error shown
6. Publish variant: verify never auto-stops

## Monitoring & Observability

### Structured Logging Events

```go
// Activity
"activity.update" - path, method

// Auto-start
"autostart.triggered" - path, remote_addr, is_websocket
"autostart.process_starting" - command, pid
"autostart.process_ready" - pid, startup_duration_ms
"autostart.failed" - error, state
"autostart.timeout" - is_websocket
"autostart.already_starting" - path, remote_addr
"autostart.no_cached_config"

// Idle monitoring
"idle.check" - idle_duration, threshold, state
"idle.stopping" - idle_duration, threshold, pid
"idle.stopped" - pid, uptime
```

### Metrics (Future)

- `autostart.count` - Number of auto-starts
- `autostart.duration` - Time from start to ready
- `idle_stop.count` - Number of idle stops
- `idle_duration` - Distribution of idle times
- `concurrent_start_attempts` - Race condition frequency

### Health Checks

`/airo/health` endpoint behavior:
- `healthy` - Process running and responding
- `unhealthy` - Process stopped (expected for idle preview)
- `unhealthy` - Process starting (transitional)

## Rollout Strategy

### Phase 1: Local Development (Week 1)
- Implement core functionality
- Test with local Docker Compose
- Developer feedback

### Phase 2: Staging (Week 2)
- Deploy to staging, feature flag off
- Enable for test preview apps
- Monitor logs, measure startup times
- Test concurrent access

### Phase 3: Production (Week 3-4)
- Enable for 10% of preview apps
- Monitor resource usage, success rate
- Gradually increase to 25%, 50%, 100%
- Keep feature flag for rollback

### Rollback Plan

Set `DEV_SUPERVISOR_ENABLE_START_ON_REQUEST=false` → apps return to always-on immediately.

## Implementation Files

### Files to Modify

1. `dev-supervisor/process_manager.go` - Add idle tracking and monitoring
2. `dev-supervisor/http_proxy.go` - Add auto-start handlers to RequestRouter
3. `dev-supervisor/main.go` - Wire components together, add config
4. `dev-supervisor/env.go` - Add environment variable parsing helpers

### Files to Create

1. `dev-supervisor/process_manager_test.go` - Unit tests for idle tracking
2. `dev-supervisor/http_proxy_test.go` - Unit tests for auto-start logic
3. `dev-supervisor/integration_test.go` - End-to-end integration tests

### Configuration Files

1. `docker-compose.yml` - Add start-on-request environment variables
2. Production Nomad job templates - Add start-on-request config

## Summary

This design adds start-on-request by:

1. **Leveraging existing architecture** - ProcessManager, HTTPProxy already handle core functionality
2. **Minimal new code** - Activity tracking (atomic), idle monitor (goroutine), auto-start handlers (hold-and-forward)
3. **Variant-aware** - Only preview auto-stops, publish stays running
4. **Universal client support** - Hold-and-forward works for browsers, APIs, WebSocket, curl, mobile apps
5. **WebSocket-aware** - Tracks active connections to prevent disconnect during sessions
6. **Production-ready** - Handles races, errors, concurrent requests, proper cleanup
7. **Observable** - Structured logging for debugging and monitoring
8. **Opt-in** - Feature flag for gradual rollout with easy rollback

**Key improvements from Codex review:**
- Auto-start on any path (not just `/`), fixing deep link issues
- Simple hold-and-forward preserves all HTTP methods and bodies
- WebSocket tracking prevents idle disconnect during active sessions
- Activity only counted for proxied requests (not static assets)
- Proper goroutine cleanup on shutdown

**Estimated effort:** 1-2 weeks for implementation, testing, and rollout.
