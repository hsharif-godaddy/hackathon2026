// Package sandbox provides sandbox profile construction and command wrapping
// for Landlock-based process isolation via the airo-sandbox binary.
package sandbox

import (
	"os"
	"path/filepath"
)

// binaryPath is the path to the airo-sandbox binary inside the container.
// A package-level var (not const) so BinaryPathForTesting can point it at a
// temp binary under test control. Normal callers read it via BinaryPath().
var binaryPath = "/usr/local/bin/airo-sandbox"

// BinaryPath returns the airo-sandbox binary path used by WrapCommand.
func BinaryPath() string { return binaryPath }

// BinaryPathForTesting overrides BinaryPath for the duration of the test
// and restores it via t.Cleanup. Kept in production code (not _test.go) so
// tests in other packages can call it.
func BinaryPathForTesting(tb interface {
	Helper()
	Cleanup(func())
}, path string) {
	tb.Helper()
	prev := binaryPath
	binaryPath = path
	tb.Cleanup(func() { binaryPath = prev })
}

// ProcessVariant selects which filesystem paths a managed process gets.
// Preview and publish containers ship different runtimes (preview keeps deps
// at /node_modules, publish extracts to /dist and execs /publish/run-app.sh),
// so they need distinct profiles rather than a union.
type ProcessVariant string

const (
	VariantPreview ProcessVariant = "preview"
	VariantPublish ProcessVariant = "publish"
)

// DetectProcessVariant returns the variant for the current container based on
// NOMAD_TASK_NAME (the same signal used to gate SMTP proxy / start-on-request).
// Anything other than "preview" is treated as publish.
func DetectProcessVariant() ProcessVariant {
	if os.Getenv("NOMAD_TASK_NAME") == "preview" {
		return VariantPreview
	}
	return VariantPublish
}

// ConnectTCPPorts lists the TCP ports that sandboxed processes may connect to.
// Applied uniformly to every sandboxed process (agent /exec commands and the
// managed app process). These are the default outbound ports for this
// environment — customer apps routinely need all of them:
//   - 80/443  — HTTP(S) to package registries, APIs, CDNs
//   - 53      — DNS resolution
//   - 3306    — MySQL (customer apps connecting to their provisioned DB)
//   - 25      — SMTP (dev-supervisor's SMTP proxy on localhost:2525 forwards here)
//
// Narrowing this list further (e.g. per-skill or per-command allowlists) would
// require a more expressive profile system and is not part of the current
// threat model.
var ConnectTCPPorts = []uint16{80, 443, 53, 3306, 25}

// ExecPaths returns filesystem access rules for agent one-off commands (/exec).
// Only relevant in preview containers — publish containers don't expose /exec.
// sharedStorageDir is the SHARED_STORAGE_DIR env var value (e.g. "/shared-storage").
func ExecPaths(sharedStorageDir string) []PathRule {
	paths := []PathRule{
		{Mode: "rwc", Path: "/app"},
		{Mode: "rwc", Path: "/tmp"},
		{Mode: "rwc", Path: "/dist"},
		{Mode: "rwc", Path: "/home/agent"},
		{Mode: "rwc", Path: "/git-repo"},
		{Mode: "rwc", Path: "/private"},
		// npm writes its cache when fetching packages not already in the pre-populated
		// store (e.g. agent-driven `npm install <new-pkg>`), so it must be writable.
		{Mode: "rwc", Path: "/npm-cache"},
		// Preview image stores dependencies at /node_modules (not /app/node_modules)
		// and puts /node_modules/.bin on PATH (vite, tsc, etc.).
		{Mode: "rx", Path: "/node_modules"},
	}
	if sharedStorageDir != "" {
		paths = append(paths, PathRule{Mode: "rwc", Path: filepath.Join(sharedStorageDir, "public", "assets")})
	}
	return paths
}

// PreviewProcessPaths returns filesystem access rules for the preview container's
// managed app process (the customer's `npm run dev` or similar).
func PreviewProcessPaths(sharedStorageDir string) []PathRule {
	paths := []PathRule{
		{Mode: "rwc", Path: "/app"},
		{Mode: "rwc", Path: "/tmp"},
		{Mode: "rwc", Path: "/home/agent"},
		{Mode: "rwc", Path: "/private"},
		// v8 template dependency store; /node_modules/.bin is on PATH (vite, tsc, etc.).
		{Mode: "rx", Path: "/node_modules"},
	}
	if sharedStorageDir != "" {
		paths = append(paths, PathRule{Mode: "rwc", Path: filepath.Join(sharedStorageDir, "public", "assets")})
	}
	return paths
}

// PublishProcessPaths returns filesystem access rules for the publish container's
// managed app process. The entrypoint is /publish/run-app.sh, which extracts the
// archive into /dist and execs the app from there.
func PublishProcessPaths(sharedStorageDir string) []PathRule {
	paths := []PathRule{
		{Mode: "rwc", Path: "/app"},
		{Mode: "rwc", Path: "/tmp"},
		{Mode: "rwc", Path: "/home/agent"},
		{Mode: "rwc", Path: "/private"},
		{Mode: "rwc", Path: "/dist"},
		{Mode: "rx", Path: "/publish"},
	}
	if sharedStorageDir != "" {
		paths = append(paths, PathRule{Mode: "rwc", Path: filepath.Join(sharedStorageDir, "public", "assets")})
	}
	return paths
}

// ProcessPaths returns the filesystem access rules for the given container variant.
func ProcessPaths(variant ProcessVariant, sharedStorageDir string) []PathRule {
	if variant == VariantPublish {
		return PublishProcessPaths(sharedStorageDir)
	}
	return PreviewProcessPaths(sharedStorageDir)
}

// PathRule defines a filesystem path with its access mode.
// Mode uses OpenBSD-style unveil permissions: r (read), w (write), x (execute), c (create/delete).
type PathRule struct {
	Mode string `json:"mode"` // e.g. "r", "rx", "rwc"
	Path string `json:"path"`
}

// IsValidMode returns true if mode contains only valid unveil permission characters
// (r, w, x, c) with no duplicates.
func IsValidMode(mode string) bool {
	if mode == "" {
		return false
	}
	seen := uint8(0)
	for _, c := range mode {
		var bit uint8
		switch c {
		case 'r':
			bit = 1
		case 'w':
			bit = 2
		case 'x':
			bit = 4
		case 'c':
			bit = 8
		default:
			return false
		}
		if seen&bit != 0 {
			return false // duplicate
		}
		seen |= bit
	}
	return true
}

// Spec is the JSON config passed to the airo-sandbox binary via AIRO_SANDBOX_CONFIG.
// System defaults (binaries, libs, DNS, TLS, etc. — see cmd/airo-sandbox/defaults.go)
// are always prepended to Paths by airo-sandbox.
type Spec struct {
	Paths      []PathRule `json:"paths"`
	ConnectTCP []uint16   `json:"connect_tcp"`
	BindTCP    []uint16   `json:"bind_tcp"`
	Command    string     `json:"command"`
	WorkDir    string     `json:"work_dir"`
}

// BuildExecProfile builds a Spec for a one-off /exec command.
func BuildExecProfile(sharedStorageDir, command, workDir string) Spec {
	return Spec{
		Paths:      ExecPaths(sharedStorageDir),
		ConnectTCP: ConnectTCPPorts,
		BindTCP:    nil,
		Command:    command,
		WorkDir:    workDir,
	}
}

// BuildProcessProfile builds a Spec for a /process/start managed process.
// bindPorts are the ports the process needs to listen on (from ProcessStartRequest.Ports).
// variant selects the preview vs publish filesystem layout.
func BuildProcessProfile(variant ProcessVariant, sharedStorageDir, command, workDir string, bindPorts []uint16) Spec {
	return Spec{
		Paths:      ProcessPaths(variant, sharedStorageDir),
		ConnectTCP: ConnectTCPPorts,
		BindTCP:    bindPorts,
		Command:    command,
		WorkDir:    workDir,
	}
}
