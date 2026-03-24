# Landlock Sandbox

dev-supervisor will use [Landlock LSM](https://landlock.io/) to sandbox child processes, restricting filesystem access and network operations at the kernel level. This replaces the previous blocklist-based command validation with allowlist-based enforcement.

> **Status:** The `airo-sandbox` binary and `internal/sandbox` library are implemented. Integration into dev-supervisor's command execution is planned for a follow-up PR.

## Architecture

```
dev-supervisor  ──spawns──>  airo-sandbox  ──applies Landlock──>  execs sh -c <command>
```

Since go-landlock applies restrictions to the calling process (via `runtime.AllThreadsSyscall`), we can't apply per-child rules from dev-supervisor directly. Instead, a separate `airo-sandbox` binary:

1. Reads sandbox config from `AIRO_SANDBOX_CONFIG` environment variable (JSON)
2. Removes that env var from its own environment (don't leak to child)
3. Prepends built-in system defaults (when `defaults=true`)
4. Applies Landlock filesystem and network restrictions with per-path granularity
5. Replaces itself with `sh -c <command>` via `syscall.Exec`

### Components

| Component             | Location                                     | Purpose                                   | Status                 |
| --------------------- | -------------------------------------------- | ----------------------------------------- | ---------------------- |
| `airo-sandbox` binary | `cmd/airo-sandbox/`                          | Applies Landlock then execs the command   | Implemented            |
| `sandbox` package     | `internal/sandbox/`                          | Profile builder and command wrapping      | Implemented            |
| Config loading        | `internal/config/config.go`                  | Reads `DEV_SUPERVISOR_SANDBOX_*` env vars | Planned (follow-up PR) |
| Exec integration      | `cmd/dev-supervisor/command_executor.go`     | Wraps `/exec` commands with sandbox       | Planned (follow-up PR) |
| Process integration   | `internal/processmanager/managed_process.go` | Wraps `/process/start` with sandbox       | Planned (follow-up PR) |

## Permission Modes

Paths use OpenBSD-style unveil permissions (inspired by [nomad-driver-exec2](https://github.com/hashicorp/nomad-driver-exec2)):

| Char | Meaning       | Landlock flags                                                                                                       |
| ---- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `r`  | Read          | `ReadFile`, `ReadDir`                                                                                                |
| `w`  | Write         | `WriteFile`, `Truncate`                                                                                              |
| `x`  | Execute       | `Execute`                                                                                                            |
| `c`  | Create/delete | `MakeReg`, `MakeDir`, `MakeSock`, `MakeFifo`, `MakeBlock`, `MakeSym`, `MakeChar`, `RemoveFile`, `RemoveDir`, `Refer` |

Combinations: `r`, `rx`, `rw`, `rwc`, `rwxc`, etc.

## Configuration

All sandbox settings are configured via environment variables:

| Variable                             | Default                       | Description                                                                      |
| ------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------- |
| `DEV_SUPERVISOR_SANDBOX_ENABLED`     | `true`                        | Enable/disable sandboxing                                                        |
| `DEV_SUPERVISOR_SANDBOX_BINARY_PATH` | `/usr/local/bin/airo-sandbox` | Path to the airo-sandbox binary                                                  |
| `DEV_SUPERVISOR_SANDBOX_PATHS`       | (empty)                       | Comma-separated `mode:path` rules (e.g., `rwc:/app,rx:/usr/bin,r:/etc/hosts`)    |
| `DEV_SUPERVISOR_SANDBOX_DEFAULTS`    | `true`                        | Include built-in system defaults (binaries, libs, DNS, TLS certs, devices, proc) |
| `DEV_SUPERVISOR_SANDBOX_CONNECT_TCP` | (empty)                       | Comma-separated allowed outbound TCP ports                                       |
| `DEV_SUPERVISOR_SANDBOX_BIND_TCP`    | (empty)                       | Comma-separated allowed bind TCP ports                                           |

### Example (Docker Compose)

```yaml
environment:
  DEV_SUPERVISOR_SANDBOX_ENABLED: "true"
  DEV_SUPERVISOR_SANDBOX_PATHS: "rwc:/app,rwc:/tmp,rwc:/dist,rwc:/home/agent,rwc:/git-repo,rx:/node_modules,rx:/management-scripts,r:/alloc,r:/app-template,r:/private"
  DEV_SUPERVISOR_SANDBOX_CONNECT_TCP: "80,443,53,3306,25"
  DEV_SUPERVISOR_SANDBOX_BIND_TCP: "20010"
```

### Built-in Defaults

When `DEV_SUPERVISOR_SANDBOX_DEFAULTS=true` (the default), airo-sandbox automatically includes these system paths before user-specified paths:

```
# Binaries (read + execute)
rx:/bin, rx:/usr/bin, rx:/usr/local/bin, rx:/sbin, rx:/usr/sbin

# Shared libraries (read + execute)
rx:/lib, rx:/lib64, rx:/usr/lib, rx:/usr/lib64, rx:/usr/local/lib
rx:/usr/local/lib64, rx:/usr/libexec

# Dynamic linker config (read)
r:/etc/ld.so.conf, r:/etc/ld.so.cache, r:/etc/ld.so.conf.d

# DNS and networking (read)
r:/etc/hosts, r:/etc/resolv.conf, r:/etc/services, r:/etc/protocols
r:/etc/nsswitch.conf, r:/etc/hostname

# User/group lookup (read)
r:/etc/passwd, r:/etc/group

# TLS certificates and OpenSSL config (read)
r:/etc/ssl                   # Debian/Alpine (includes openssl.cnf, certs/)
r:/etc/pki/tls               # RHEL OpenSSL
r:/etc/pki/ca-trust          # RHEL CA trust store

# System crypto policies (read) — RHEL 8+
r:/etc/crypto-policies, r:/usr/share/crypto-policies

# Timezone/locale (read)
r:/usr/share/zoneinfo, r:/usr/share/locale, r:/usr/share/common-licenses

# Device files (specific files, NOT all of /dev)
rw:/dev/null, rw:/dev/zero, rw:/dev/full, rw:/dev/urandom, rw:/dev/random
# Note: /dev/stdin, /dev/stdout, /dev/stderr are inherited fds, not Landlock-governed paths

# Process information (read)
r:/proc
# Many runtimes (Node.js, Go, Python) read /proc/self/fd, /proc/cpuinfo, etc.
```

Paths are designed for multi-distro compatibility (Debian, Alpine, RHEL, SLES).

Non-existent paths are silently skipped (defaults use debug-level logging; user-specified paths produce a warning).

## Sandbox Profiles

Two profiles are used depending on the execution context:

### Exec Profile (`/exec` one-off commands)

- **Paths:** From config with per-path modes
- **Defaults:** Built-in system paths (when enabled)
- **Connect TCP:** From config (e.g., 80, 443, 53)
- **Bind TCP:** None (one-off commands don't bind ports)

### Process Profile (`/process/start` managed processes)

- **Paths/Defaults:** Same as exec
- **Connect TCP:** Same as exec
- **Bind TCP:** From config, merged with ports declared in the `ProcessStartRequest.Ports` field

## Platform Behavior

| Platform                             | Behavior                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| **Linux (Landlock v6+)**             | Full sandbox enforcement                                                   |
| **Linux (older kernel)**             | Graceful degradation via `BestEffort()` — applies what the kernel supports |
| **macOS (and other non-Linux Unix)** | Logs a warning, executes without sandboxing                                |

Windows is not supported — the fallback requires a POSIX shell (`sh -c`).

The `airo-sandbox` binary uses build tags:

- `//go:build linux` — applies Landlock restrictions
- `//go:build !linux && !windows` — fallback: logs warning and execs directly

## What Landlock Enforces vs. What It Can't

**Landlock enforces (kernel level):**

- Filesystem access — only paths matching configured modes are accessible
- Network — only configured TCP ports for connect/bind

**Landlock can't enforce (handled by other mechanisms):**

- Fork bombs (process creation limits) — detected by regex in `agents/src/tools/terminal.ts`
- Resource exhaustion (CPU, memory) — handled by container cgroup limits
- IPC restrictions — not a Landlock capability; handled by container isolation
- Side-channel attacks, timing attacks — out of scope

## Validation After Sandbox

With Landlock enforcing filesystem and network restrictions, the validation layers are simplified:

### dev-supervisor (`internal/validation/`)

- Empty command check
- Timeout limits (max 3600 seconds)
- Working directory format validation (no `..`, no null bytes, must be absolute)
- Environment variable name/size validation
- Protected env var protection (PATH, HOME, etc.)

### Agent-side (`agents/src/tools/terminal.ts`)

- Empty command / length check (max 1000 chars)
- Fork bomb pattern detection
- Noop command interception (dev server already running)
- Working directory traversal check

## Building

Both binaries are built in the Dockerfile and Makefile:

```bash
# Build both
make build

# Build individually
make build-supervisor
make build-sandbox
```

The Dockerfile produces both `/usr/local/bin/dev-supervisor` and `/usr/local/bin/airo-sandbox`.

## Testing

```bash
# Unit tests (sandbox package + config parsing)
go test ./internal/sandbox/ ./cmd/airo-sandbox/

# All tests
make test

# Docker integration test (verifies Landlock blocks disallowed paths)
make test-docker
```

## Dependencies

- [`go-landlock`](https://github.com/landlock-lsm/go-landlock) v0.7.0 — Go bindings for Landlock LSM
- `kernel.org/pub/linux/libs/security/libcap/psx` — Cross-thread syscall support (pure Go fallback when `CGO_ENABLED=0`)
