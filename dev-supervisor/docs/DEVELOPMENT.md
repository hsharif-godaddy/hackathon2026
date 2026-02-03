# dev-supervisor Development Guide

This guide provides comprehensive information for developing, testing, and contributing to dev-supervisor.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Architecture Overview](#architecture-overview)
- [Cross-Platform Development](#cross-platform-development)
- [Testing Strategy](#testing-strategy)
- [Build Tags and Platform-Specific Code](#build-tags-and-platform-specific-code)
- [CI/CD Pipeline](#cicd-pipeline)
- [Contributing Guidelines](#contributing-guidelines)

## Development Environment Setup

### Prerequisites

**Required:**

- Go 1.21 or later
- Git

**Optional (for full development experience):**

- Docker (for integration tests)
- golangci-lint (for linting)
- Python 3 (for some port discovery tests)

### Setup Instructions

#### macOS

```bash
# Install Go
brew install go

# Install golangci-lint (optional)
brew install golangci-lint

# Install Docker (optional, for integration tests)
brew install --cask docker

# Clone repository
git clone <repository-url>
cd dev-supervisor

# Install dependencies
make deps

# Verify setup
make test
```

#### Linux

```bash
# Install Go (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install golang-go

# Or use snap
sudo snap install go --classic

# Install golangci-lint (optional)
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin

# Install Docker (optional)
sudo apt-get install docker.io
sudo usermod -aG docker $USER

# Clone repository
git clone <repository-url>
cd dev-supervisor

# Install dependencies
make deps

# Verify setup
make test
```

#### Windows/WSL

```bash
# Use WSL (Windows Subsystem for Linux)
# Follow Linux instructions inside WSL

# Or install Go for Windows
choco install golang

# Use WSL for development (recommended)
```

## Architecture Overview

### Core Components

1. **Process Manager** (`process_manager.go`)
   - Manages lifecycle of the supervised process
   - Handles start, stop, restart operations
   - Integrates with PID1 manager and port discovery

2. **PID1 Manager** (`pid1_manager*.go`)
   - Provides proper init process behavior in containers
   - Orphan reaping (Linux only)
   - Signal forwarding
   - Zombie process cleanup

3. **Port Discovery** (`port_discovery*.go`)
   - Interface-based design for platform abstraction
   - Linux implementation reads `/proc/net/tcp`
   - Fallback implementation for other platforms

4. **API Server** (`api.go`)
   - HTTP API over Unix domain socket
   - RESTful endpoints for process control
   - Health monitoring and configuration

5. **Health Monitor** (`internal/health/`)
   - Configurable health checks (command, HTTP, TCP)
   - Automatic restart policies with exponential backoff
   - Zero internal dependencies (stdlib only)

### Platform Abstraction Pattern

dev-supervisor uses Go's build tags for platform-specific functionality:

```
Interface (platform-agnostic)
    ↓
Implementation Files:
    ├── *_linux.go       (Linux-specific, build tag: //go:build linux)
    ├── *_fallback.go    (Non-Linux, build tag: //go:build !linux)
    └── *.go             (Cross-platform, no build tag)
```

**Benefits:**

- Clean separation of platform-specific code
- No runtime conditionals for platform detection
- Easy to test and maintain
- Compiler enforces correctness

## Cross-Platform Development

### Target Platforms

| Platform    | Status               | Notes                               |
| ----------- | -------------------- | ----------------------------------- |
| linux/amd64 | ✅ Production target | Full feature support                |
| macOS       | ✅ Development only  | Limited features, full test support |
| Windows/WSL | ✅ Development only  | Use WSL for best compatibility      |
| linux/arm64 | ⚠️ Experimental      | Builds work, not production-tested  |

### Platform-Specific Features

#### Linux-Only Features

1. **Port Discovery**
   - **Why Linux-only:** Reads `/proc/net/tcp` and `/proc/PID/fd`
   - **Fallback behavior:** Returns empty list (restarts still work)
   - **Implementation:** `port_discovery_linux.go`

2. **PID 1 Orphan Reaping**
   - **Why Linux-only:** Uses `waitid()` syscall with specific flags
   - **Fallback behavior:** Not needed outside containers
   - **Implementation:** `pid1_orphan_reaper_linux.go`

3. **Process Signals**
   - **Why Linux-only:** Container-specific signal semantics
   - **Fallback behavior:** Go's cross-platform signal handling
   - **Implementation:** `pid1_manager_unix.go`

#### Cross-Platform Features

These work on all platforms:

- HTTP API server
- Unix socket communication
- Process lifecycle (start/stop/restart)
- Command execution
- Environment management
- Health monitoring
- Log streaming
- Configuration

## Testing Strategy

### Three-Tier Testing Approach

```
┌─────────────────────────────────────────────────────┐
│ Tier 3: Docker Integration Tests                    │
│ - Tests actual linux/amd64 binary as PID 1          │
│ - Validates production behavior                     │
│ - Runs from any platform with Docker                │
└─────────────────────────────────────────────────────┘
                         ▲
┌─────────────────────────────────────────────────────┐
│ Tier 2: Linux-Specific Unit Tests                   │
│ - Port discovery, orphan reaping                    │
│ - Only runs on Linux (via build tags)               │
│ - Automatic skip on macOS/Windows                   │
└─────────────────────────────────────────────────────┘
                         ▲
┌─────────────────────────────────────────────────────┐
│ Tier 1: Cross-Platform Unit Tests                   │
│ - API, process management, health checks            │
│ - Runs on macOS, Windows, Linux                     │
│ - 90%+ of test coverage                             │
└─────────────────────────────────────────────────────┘
```

### Running Tests

#### Tier 1: Cross-Platform Tests

```bash
# Run all cross-platform tests
make test

# With coverage
make test-coverage

# Verbose output
go test -v ./...

# Specific test
go test -v -run TestProcessManager_Start
```

**On macOS/Windows:**

- Linux-specific tests are automatically skipped
- No runtime checks or skip messages needed
- Files like `*_linux_test.go` won't appear in output

**On Linux:**

- All tests run, including Linux-specific ones
- No special flags needed

#### Tier 2: Linux-Specific Tests

These tests automatically run on Linux, skip on other platforms:

```bash
# On Linux - includes Linux-specific tests
make test

# Check which tests run
go test -v ./... | grep "=== RUN"
```

**Test Files:**

- `port_discovery_linux_test.go` - Port discovery tests
- `pid1_linux_test.go` - PID 1 orphan reaping tests
- `integration_test.go` - Unix socket integration tests

#### Tier 3: Docker Integration Tests

Run from any platform with Docker installed:

```bash
# Run via Makefile (recommended)
make test-docker

# Run via Go test wrapper
make test-docker-go

# Run bash script directly
./test/run-docker-tests.sh
```

**What it does:**

1. Builds Docker image with linux/amd64 binary
2. Runs container with dev-supervisor as PID 1
3. Executes comprehensive test suite:
   - PID 1 verification
   - API health check
   - Process lifecycle (start/stop)
   - Orphan reaping
   - Signal handling

**Exit codes:**

- 0: All tests passed
- 1-5: Specific test failure (number = test number)
- 99: Setup failure

### Writing Tests

#### Cross-Platform Tests

No build tags needed, works everywhere:

```go
// process_manager_test.go
package main

import "testing"

func TestProcessManager_Start(t *testing.T) {
    // This test runs on all platforms
    pm := NewProcessManager(nil, nil)
    // ... test logic
}
```

#### Linux-Specific Tests

Use `//go:build linux` tag:

```go
//go:build linux

// port_discovery_linux_test.go
package main

import "testing"

func TestLinuxPortDiscovery(t *testing.T) {
    // This test only runs on Linux
    discovery := NewPortDiscovery()
    // ... Linux-specific test logic
}
```

#### Docker Integration Tests

Use `//go:build docker_integration` tag:

```go
//go:build docker_integration

// docker_integration_test.go
package main

import (
    "os/exec"
    "testing"
)

func TestDockerIntegration(t *testing.T) {
    // Runs Docker test suite
    cmd := exec.Command("./test/run-docker-tests.sh")
    // ... execute and validate
}
```

## Build Tags and Platform-Specific Code

### Understanding Build Tags

Build tags tell the Go compiler which files to include in a build:

```go
//go:build linux
// This file only compiles on Linux

//go:build !linux
// This file compiles on all platforms EXCEPT Linux

//go:build docker_integration
// This file only compiles when explicitly requested
```

### Platform-Specific File Naming

Follow these conventions:

| Pattern                 | Purpose                       | Build Tag Required |
| ----------------------- | ----------------------------- | ------------------ |
| `feature.go`            | Cross-platform code           | No                 |
| `feature_linux.go`      | Linux-specific implementation | Yes                |
| `feature_fallback.go`   | Non-Linux implementation      | Yes                |
| `feature_test.go`       | Cross-platform tests          | No                 |
| `feature_linux_test.go` | Linux-specific tests          | Yes                |

### Build Tag Syntax

**Modern syntax (preferred):**

```go
//go:build linux
//go:build !linux
//go:build linux && amd64
```

**Old syntax (deprecated):**

```go
// +build linux
```

Always use the modern `//go:build` syntax for new code.

### Platform-Specific vs Custom Tags

| Tag Type | Example                  | Usage                                |
| -------- | ------------------------ | ------------------------------------ |
| Platform | `//go:build linux`       | Automatic, no `-tags` flag needed    |
| Custom   | `//go:build integration` | Requires `go test -tags=integration` |

### Creating Platform-Specific Code

#### Step 1: Define Interface

```go
// port_discovery.go
package main

type PortDiscovery interface {
    GetProcessPorts(pid int) ([]int, error)
}
```

#### Step 2: Linux Implementation

```go
//go:build linux

// port_discovery_linux.go
package main

type LinuxPortDiscovery struct{}

func NewPortDiscovery() PortDiscovery {
    return &LinuxPortDiscovery{}
}

func (d *LinuxPortDiscovery) GetProcessPorts(pid int) ([]int, error) {
    // Linux-specific implementation
    // Read /proc/net/tcp, etc.
}
```

#### Step 3: Fallback Implementation

```go
//go:build !linux

// port_discovery_fallback.go
package main

type FallbackPortDiscovery struct{}

func NewPortDiscovery() PortDiscovery {
    return &FallbackPortDiscovery{}
}

func (d *FallbackPortDiscovery) GetProcessPorts(pid int) ([]int, error) {
    // Graceful fallback
    return []int{}, nil
}
```

#### Step 4: Use in Cross-Platform Code

```go
// process_manager.go
package main

type ProcessManager struct {
    portDiscovery PortDiscovery
}

func NewProcessManager() *ProcessManager {
    return &ProcessManager{
        portDiscovery: NewPortDiscovery(), // Correct implementation selected at compile time
    }
}
```

## CI/CD Pipeline

### GitHub Actions Workflow

Located at: `.github/workflows/dev-supervisor.yml`

#### Jobs Overview

```
┌──────────┐     ┌──────────┐
│   lint   │     │   test   │
└────┬─────┘     └────┬─────┘
     │                │
     └────────┬───────┘
              ▼
        ┌──────────────┐
        │  test-docker │
        └──────┬───────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
  ┌───────┐       ┌──────────────┐
  │ build │       │ docker-build │
  └───────┘       └──────────────┘
```

#### Job Details

**1. lint** (parallel with test)

- Runs golangci-lint
- Checks formatting (gofmt)
- Runs go vet
- Fast feedback (~1-2 min)

**2. test** (parallel with lint)

- Runs all unit tests
- Linux-specific tests included automatically
- Race detection enabled
- Coverage uploaded to Codecov
- ~2-3 minutes

**3. test-docker** (after test passes)

- Builds Docker image with linux/amd64 binary
- Runs comprehensive integration test suite
- Tests PID 1 behavior, orphan reaping, signals
- ~3-5 minutes
- **Fail-fast:** Only runs if unit tests pass

**4. build** (after all tests pass)

- Cross-compiles for multiple platforms
- Matrix build: linux/darwin/windows × amd64/arm64
- Uploads artifacts
- ~2-3 minutes per platform

**5. docker-build** (after all tests pass)

- Builds multi-platform Docker images
- linux/amd64 and linux/arm64
- ~5-7 minutes

#### Total CI Time

- **Fast path (lint + test fail):** ~2-3 minutes
- **Full pipeline:** ~15-20 minutes
- **Docker tests add:** ~3-5 minutes (but only after unit tests pass)

### Running CI Locally

Simulate CI checks locally:

```bash
# Run all checks that CI runs
make check

# Individual checks
make lint
make test
make test-docker

# Full build
make build-all
```

## Contributing Guidelines

### Before Submitting

1. **Run tests:**

   ```bash
   make test
   make test-docker  # If Docker available
   ```

2. **Run linting:**

   ```bash
   make lint
   make fmt
   ```

3. **Check formatting:**

   ```bash
   make fmt-fix
   ```

4. **Run full check:**
   ```bash
   make check
   ```

### Code Style

- Follow standard Go conventions
- Use `gofmt` for formatting
- Keep functions focused and small
- Add comments for exported functions
- Use meaningful variable names

### Platform-Specific Code Guidelines

When adding platform-specific features:

1. **Define interface first** (in non-tagged file)
2. **Create Linux implementation** (`*_linux.go` with build tag)
3. **Create fallback implementation** (`*_fallback.go` with build tag)
4. **Add tests for both** (`*_linux_test.go` for Linux-specific)
5. **Document platform differences** in code comments
6. **Update README** with feature availability

### Testing Requirements

All PRs must:

- Pass all existing tests
- Add tests for new functionality
- Maintain or improve code coverage
- Pass linting checks
- Include Docker integration tests for PID 1 features

### Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test changes
- `refactor`: Code refactoring
- `chore`: Build/tooling changes

**Example:**

```
feat: add port discovery for Linux

Implements port discovery by reading /proc/net/tcp and /proc/PID/fd.
Includes graceful fallback for non-Linux platforms.

Closes #123
```

### Pull Request Process

1. Create feature branch from `main`
2. Make changes with tests
3. Run `make check` locally
4. Push and create PR
5. Wait for CI to pass
6. Request review
7. Address feedback
8. Merge when approved

### Getting Help

- Check existing issues and PRs
- Read this development guide
- Review code comments
- Ask in PR discussions

## Writing Cross-Platform Tests

### Unix Socket Path Length Limits

**Important:** macOS has a 104-character limit for Unix domain socket paths (Linux has 108).

**Problem:** Using default temp directories creates long paths:

```go
// ❌ BAD - Creates long paths on macOS
tempDir := t.TempDir()  // /var/folders/xx/...long path.../TestName/
socketPath := filepath.Join(tempDir, "my-socket.sock")
// Results in: "bind: invalid argument" on macOS
```

**Solution:** Use `/tmp` directly with short names:

```go
// ✅ GOOD - Short paths work on all platforms
tempDir, _ := os.MkdirTemp("/tmp", "ds-*")
t.Cleanup(func() { os.RemoveAll(tempDir) })
socketPath := filepath.Join(tempDir, "test.sock")
```

**Best Practice:** Use a helper function:

```go
func shortTempDir(t testing.TB) string {
    tempDir, err := os.MkdirTemp("/tmp", "ds-*")
    if err != nil {
        t.Fatalf("Failed to create temp directory: %v", err)
    }
    t.Cleanup(func() {
        os.RemoveAll(tempDir)
    })
    return tempDir
}

// Usage
tempDir := shortTempDir(t)
socketPath := filepath.Join(tempDir, "test.sock")
```

**Why this works:**

- `/tmp` is shorter than OS default temp paths
- Short prefix (`ds-*`) vs descriptive (`dev-supervisor-test-*`)
- Short socket name (`test.sock` vs `test-dev-supervisor.sock`)
- Typical path: `/tmp/ds-a1b2c3/test.sock` (~25 chars vs 100+ chars)

## Troubleshooting

### Build Issues

**"build constraints exclude all Go files"**

- You're on a platform where no files match build tags
- This shouldn't happen with proper fallback files
- Check that `*_fallback.go` files have `//go:build !linux`

**"undefined: NewPortDiscovery"**

- Missing platform-specific implementation file
- Ensure both `*_linux.go` and `*_fallback.go` exist
- Check build tag syntax

### Test Issues

**"Tests are failing on my Mac"**

- Linux-specific tests should auto-skip, they won't fail
- If tests fail, it's likely a cross-platform test
- Check test output for actual failure

**"bind: invalid argument" on Unix socket tests (macOS)**

- Socket path is too long (macOS limit: 104 characters)
- Use `/tmp` with short names instead of `t.TempDir()`
- See "Writing Cross-Platform Tests" section above for solution
- Example fix: Change `t.TempDir()` to `shortTempDir(t)` helper

**"Docker tests won't run"**

- Ensure Docker is installed and running
- Check Docker permissions (`docker ps` should work)
- Try `make test-docker` instead of Go directly

**"Port discovery tests fail on Linux"**

- Tests may require Python 3 for HTTP server
- Check that `/proc/net/tcp` is readable
- Run as normal user (not root)

### Platform Issues

**"Feature doesn't work on macOS"**

- Check platform compatibility matrix in README
- Some features are Linux-only by design
- Use Docker tests to validate Linux functionality

**"Signal handling behaves differently"**

- Signal semantics vary by platform
- Linux has most accurate behavior
- Use Docker tests for production validation

## Additional Resources

- [Go Build Constraints](https://pkg.go.dev/cmd/go#hdr-Build_constraints)
- [Testing in Go](https://go.dev/doc/tutorial/add-a-test)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
