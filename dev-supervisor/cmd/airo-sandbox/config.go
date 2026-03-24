package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

// SandboxConfig defines the sandbox restrictions for a child process.
type SandboxConfig struct {
	Paths      []sandbox.PathRule `json:"paths"`       // Filesystem access rules with per-path modes
	Defaults   bool               `json:"defaults"`    // Include built-in system defaults (default: true)
	ConnectTCP []uint16           `json:"connect_tcp"` // Allowed outbound TCP ports
	BindTCP    []uint16           `json:"bind_tcp"`    // Allowed bind TCP ports
	Command    string             `json:"command"`     // Shell command to exec
	WorkDir    string             `json:"work_dir"`    // Working directory
}

// ParseConfig parses a SandboxConfig from JSON bytes.
func ParseConfig(data []byte) (*SandboxConfig, error) {
	var cfg SandboxConfig
	// Defaults is true unless explicitly set to false in JSON
	cfg.Defaults = true
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse sandbox config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Validate checks that the config has all required fields and valid modes.
func (c *SandboxConfig) Validate() error {
	if c.Command == "" {
		return errors.New("sandbox config: command is required")
	}
	if c.WorkDir == "" {
		return errors.New("sandbox config: work_dir is required")
	}
	if !strings.HasPrefix(c.WorkDir, "/") {
		return fmt.Errorf("sandbox config: work_dir must be an absolute path, got %q", c.WorkDir)
	}
	if strings.Contains(c.WorkDir, "..") {
		return fmt.Errorf("sandbox config: work_dir must not contain '..', got %q", c.WorkDir)
	}
	if strings.ContainsRune(c.WorkDir, 0) {
		return errors.New("sandbox config: work_dir must not contain null bytes")
	}
	for _, p := range c.Paths {
		if p.Mode == "" {
			return fmt.Errorf("sandbox config: empty mode for path %q", p.Path)
		}
		if !sandbox.IsValidMode(p.Mode) {
			return fmt.Errorf(
				"sandbox config: invalid mode %q for path %q", p.Mode, p.Path)
		}
		if p.Path == "" {
			return errors.New("sandbox config: empty path in paths list")
		}
		if strings.ContainsRune(p.Path, 0) {
			return fmt.Errorf("sandbox config: path must not contain null bytes: %q", p.Path)
		}
	}
	return nil
}
