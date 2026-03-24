// Package sandbox provides sandbox profile construction and command wrapping
// for Landlock-based process isolation via the airo-sandbox binary.
package sandbox

import (
	"fmt"
	"strings"
)

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

// ParsePathRulesString parses a comma-separated string of "mode:path" entries.
// Example: "rx:/usr/bin,r:/etc/hosts,rwc:/app"
// Returns an error if any entry has an invalid format, mode, or empty path.
func ParsePathRulesString(value string) ([]PathRule, error) {
	if value == "" {
		return nil, nil
	}
	var rules []PathRule
	for entry := range strings.SplitSeq(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		mode, path, ok := strings.Cut(entry, ":")
		if !ok {
			return nil, fmt.Errorf(
				"invalid path rule %q: expected mode:path format", entry)
		}
		mode = strings.TrimSpace(mode)
		path = strings.TrimSpace(path)
		if !IsValidMode(mode) {
			return nil, fmt.Errorf(
				"invalid mode %q in path rule %q", mode, entry)
		}
		if path == "" {
			return nil, fmt.Errorf("empty path in path rule %q", entry)
		}
		rules = append(rules, PathRule{Mode: mode, Path: path})
	}
	return rules, nil
}

// Config holds the sandbox configuration loaded from environment variables.
type Config struct {
	Enabled    bool       // Whether sandboxing is enabled
	BinaryPath string     // Path to the airo-sandbox binary
	Paths      []PathRule // Filesystem access rules with per-path modes
	Defaults   bool       // Include built-in system defaults (default: true)
	ConnectTCP []uint16   // Allowed outbound TCP ports
	BindTCP    []uint16   // Allowed bind TCP ports
}

// Spec is the JSON config passed to the airo-sandbox binary via AIRO_SANDBOX_CONFIG.
type Spec struct {
	Paths      []PathRule `json:"paths"`
	Defaults   bool       `json:"defaults"`
	ConnectTCP []uint16   `json:"connect_tcp"`
	BindTCP    []uint16   `json:"bind_tcp"`
	Command    string     `json:"command"`
	WorkDir    string     `json:"work_dir"`
}

// BuildExecProfile builds a Spec for a one-off /exec command.
func BuildExecProfile(cfg Config, command, workDir string) Spec {
	return Spec{
		Paths:      cfg.Paths,
		Defaults:   cfg.Defaults,
		ConnectTCP: cfg.ConnectTCP,
		BindTCP:    nil, // One-off commands don't bind ports
		Command:    command,
		WorkDir:    workDir,
	}
}

// BuildProcessProfile builds a Spec for a /process/start managed process.
// Additional bind ports (e.g., the app's listening port) are merged with the base config.
func BuildProcessProfile(cfg Config, command, workDir string, extraBindPorts []uint16) Spec {
	bindPorts := mergeUint16(cfg.BindTCP, extraBindPorts)
	return Spec{
		Paths:      cfg.Paths,
		Defaults:   cfg.Defaults,
		ConnectTCP: cfg.ConnectTCP,
		BindTCP:    bindPorts,
		Command:    command,
		WorkDir:    workDir,
	}
}

// mergeUint16 combines two uint16 slices, deduplicating values.
func mergeUint16(a, b []uint16) []uint16 {
	seen := make(map[uint16]bool, len(a)+len(b))
	var result []uint16
	for _, v := range a {
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	for _, v := range b {
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	return result
}
