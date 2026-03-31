package config

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Processes []ProcessConfig `yaml:"processes"`
	Hooks     HooksConfig     `yaml:"hooks"`
}

type ProcessConfig struct {
	Name          string       `yaml:"name"`
	Command       string       `yaml:"command"`
	Dir           string       `yaml:"dir"`
	ErrorPatterns []string     `yaml:"errorPatterns"`
	HealthCheck   *HealthCheck `yaml:"healthCheck"`
}

type HealthCheck struct {
	URL               string        `yaml:"url"`
	UnhealthyInterval time.Duration `yaml:"unhealthyInterval"`
	HealthyInterval   time.Duration `yaml:"healthyInterval"`
	Insecure          bool          `yaml:"insecure"`
}

type HooksConfig struct {
	PreStart []HookConfig `yaml:"preStart"`
}

type HookConfig struct {
	Name     string `yaml:"name"`
	Command  string `yaml:"command"`
	Dir      string `yaml:"dir"`
	Optional bool   `yaml:"optional"`
}

func Load(path string, projectRoot string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file %s: %w", path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	if err := cfg.validate(projectRoot); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return &cfg, nil
}

func (c *Config) validate(projectRoot string) error {
	if len(c.Processes) == 0 {
		return fmt.Errorf("at least one process must be defined")
	}

	names := make(map[string]bool)
	for i, p := range c.Processes {
		if p.Name == "" {
			return fmt.Errorf("process[%d]: name is required", i)
		}
		if names[p.Name] {
			return fmt.Errorf("process[%d]: duplicate name %q", i, p.Name)
		}
		names[p.Name] = true

		if p.Command == "" {
			return fmt.Errorf("process[%d] (%s): command is required", i, p.Name)
		}
		if p.Dir == "" {
			return fmt.Errorf("process[%d] (%s): dir is required", i, p.Name)
		}

		absDir := filepath.Join(projectRoot, p.Dir)
		if info, err := os.Stat(absDir); err != nil || !info.IsDir() {
			return fmt.Errorf("process[%d] (%s): dir %q does not exist (resolved: %s)", i, p.Name, p.Dir, absDir)
		}

		if p.HealthCheck != nil {
			if p.HealthCheck.URL == "" {
				return fmt.Errorf("process[%d] (%s): healthCheck.url is required", i, p.Name)
			}
			if p.HealthCheck.UnhealthyInterval <= 0 {
				c.Processes[i].HealthCheck.UnhealthyInterval = 10 * time.Second
			}
			if p.HealthCheck.HealthyInterval <= 0 {
				c.Processes[i].HealthCheck.HealthyInterval = 60 * time.Second
			}
		}
	}

	for i, h := range c.Hooks.PreStart {
		if h.Command == "" {
			return fmt.Errorf("hooks.preStart[%d]: command is required", i)
		}
	}

	return nil
}
