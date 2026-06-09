# Landlock Sandbox

dev-supervisor uses [Landlock LSM](https://landlock.io/) to sandbox child processes, restricting filesystem access and network operations at the kernel level.

## Architecture

```
dev-supervisor  --spawns-->  airo-sandbox  --applies Landlock-->  execs sh -c <command>
```

Since go-landlock applies restrictions to the calling process (via `runtime.AllThreadsSyscall`), we can't apply per-child rules from dev-supervisor directly. Instead, a separate `airo-sandbox` binary:

1. Reads sandbox config from `AIRO_SANDBOX_CONFIG` environment variable (JSON)
2. Removes that env var from its own environment (don't leak to child)
3. Prepends built-in system defaults (binaries, libs, DNS, TLS — always applied)
4. Applies Landlock filesystem and network restrictions with per-path granularity
5. Replaces itself with `sh -c <command>` via `syscall.Exec`

### Components

| Component             | Location                                     | Purpose                                 |
| --------------------- | -------------------------------------------- | --------------------------------------- |
| `airo-sandbox` binary | `cmd/airo-sandbox/`                          | Applies Landlock then execs the command |
| `sandbox` package     | `internal/sandbox/`                          | Profile builder and command wrapping    |
| Exec integration      | `cmd/dev-supervisor/command_executor.go`     | Wraps `/exec` commands with sandbox     |
| Process integration   | `internal/processmanager/managed_process.go` | Wraps `/process/start` with sandbox     |

## Configuration

Only one environment variable controls sandbox behavior:

| Variable                         | Default | Description            |
| -------------------------------- | ------- | ---------------------- |
| `DEV_SUPERVISOR_SANDBOX_ENABLED` | `true`  | Enable/disable sandbox |

All other sandbox settings (paths, ports, binary path) are embedded in `internal/sandbox/profile.go`. The `SHARED_STORAGE_DIR` env var is read at runtime for dynamic path resolution.

## Embedded Profiles

Two profiles are used depending on the execution context. Profiles are defined in `internal/sandbox/profile.go`.

### Exec Profile (`/exec` - agent one-off commands)

Used for commands from the AI agent (npm install, git operations, build commands, etc.).

```
rwcx: /app, /node_modules, /app/node_modules
rwc:  /tmp, /dist, /local, /home/agent, /git-repo, /private, /npm-cache
rwc:  $SHARED_STORAGE_DIR/public/assets (if SHARED_STORAGE_DIR set)

Connect TCP: 80, 443, 53, 3306, 25, 2525
Bind TCP:    none
```

- `/exec` is a preview-container-only endpoint
- `/app` has execute so dynamically-created `node_modules/.bin` scripts work for PaaS apps that `npm install` at runtime
- `/dist` needed for publish builds invoked by the agent
- `/local` — NOMAD_TASK_DIR, used as $HOME; git config, npm cache, and tools write here
- `/git-repo` needed for git operations
- `/npm-cache` is writable: `npm install <new-pkg>` needs to populate the cache for packages not already there
- `/node_modules` writable+executable: PaaS apps may `npm install` at runtime; v8 template puts `/node_modules/.bin` on PATH
- `/app/node_modules` — compatibility path for image versions that install deps inside `/app`
- No bind ports (one-off commands don't run servers)

### Process Profile (`/process/start` - customer app)

Two variants selected by `NOMAD_TASK_NAME`: `preview` gets the dev-server layout, anything else gets the publish layout. Variant detection is a single read at startup (`sandbox.DetectProcessVariant`).

**Preview variant** — customer's dev server (e.g. `npm run dev`):

```
rwcx: /app, /node_modules, /app/node_modules
rwc:  /tmp, /local, /home/agent, /private
rwc:  $SHARED_STORAGE_DIR/public/assets (if SHARED_STORAGE_DIR set)

Connect TCP: 80, 443, 53, 3306, 25, 2525
Bind TCP:    from ProcessStartRequest.Ports (dynamic)
```

**Publish variant** — publish entrypoint `/publish/run-app.sh`:

```
rwcx: /app, /app/node_modules
rwc:  /tmp, /local, /home/agent, /private, /dist
rx:   /publish
rwc:  $SHARED_STORAGE_DIR/public/assets (if SHARED_STORAGE_DIR set)

Connect TCP: 80, 443, 53, 3306, 25, 2525
Bind TCP:    from ProcessStartRequest.Ports (dynamic)
```

- Initial startup: dev-supervisor automatically adds `DEV_SUPERVISOR_PROXY_TARGET_PORT` (default 8080) to bind ports; API-initiated `/process/start` requests pass ports via request body.

### Excluded Paths

Neither profile includes:

- `/alloc` - read by dev-supervisor itself before spawning children
- `/app-template` - only used during setup (which runs unsandboxed)
- `/management-scripts` - only used during setup

### System Defaults

airo-sandbox always includes these system paths — the sandbox can't run a shell or load libc without them:

- Binaries: `rx:/bin`, `rx:/usr/bin`, `rx:/usr/local/bin`, `rx:/sbin`, `rx:/usr/sbin`
- Shared libraries: `rx:/lib`, `rx:/lib64`, `rx:/usr/lib`, etc.
- DNS/networking: `r:/etc/hosts`, `r:/etc/resolv.conf`, etc.
- TLS certificates: `r:/etc/ssl`, `r:/etc/pki/tls`, etc.
- Device files: `rw:/dev/null`, `rw:/dev/zero`, `rw:/dev/urandom`, etc.
- Process info: `r:/proc`

Full list in `cmd/airo-sandbox/defaults.go`.

## Permission Modes

Paths use OpenBSD-style unveil permissions:

| Char | Meaning       | Landlock flags                                                       |
| ---- | ------------- | -------------------------------------------------------------------- |
| `r`  | Read          | `ReadFile`, `ReadDir`                                                |
| `w`  | Write         | `WriteFile`, `Truncate`                                              |
| `x`  | Execute       | `Execute`                                                            |
| `c`  | Create/delete | `MakeReg`, `MakeDir`, `MakeSock`, `RemoveFile`, `RemoveDir`, `Refer` |

## Platform Behavior

| Platform                             | Behavior                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| **Linux (Landlock v6+)**             | Full sandbox enforcement                                                   |
| **Linux (older kernel)**             | Graceful degradation via `BestEffort()` - applies what the kernel supports |
| **macOS (and other non-Linux Unix)** | Logs a warning, executes without sandboxing                                |

## What Landlock Enforces vs. What It Can't

**Landlock enforces (kernel level):**

- Filesystem access - only paths matching configured modes are accessible
- Network - only configured TCP ports for connect/bind

**Not enforced by Landlock (handled elsewhere):**

- Fork bombs - detected by regex in `agents/src/tools/terminal.ts`
- Resource exhaustion (CPU, memory) - container cgroup limits
- Workspace destruction - recoverable via git (`.git` on separate bind mount)

## Building

```bash
make build          # Both binaries
make build-supervisor
make build-sandbox
```

## Testing

```bash
go test ./internal/sandbox/ ./cmd/airo-sandbox/
make test           # All tests
make test-docker    # Docker integration (verifies Landlock blocks)
```

## Dependencies

- [`go-landlock`](https://github.com/landlock-lsm/go-landlock) v0.7.0 - Go bindings for Landlock LSM
- `kernel.org/pub/linux/libs/security/libcap/psx` - Cross-thread syscall support
