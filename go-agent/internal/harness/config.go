package harness

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Config holds the full harness experiment configuration loaded from YAML.
type Config struct {
	Name            string            `yaml:"name"`
	Description     string            `yaml:"description"`
	Model           string            `yaml:"model"`
	Temperature     float64           `yaml:"temperature"`
	MaxOutputTokens int               `yaml:"max_output_tokens"`
	MaxSteps        int               `yaml:"max_steps"`
	Effort          string            `yaml:"effort"`
	PromptFiles     []string          `yaml:"prompt_files"`
	PromptOverrides map[string]string `yaml:"prompt_overrides"`
	TestCasesFile   string            `yaml:"test_cases_file"`
	TestCases       []TestCase        `yaml:"test_cases"`
	Responder       ResponderConfig   `yaml:"responder"`
	Judge           JudgeConfig       `yaml:"judge"`
	RunsPerCase     int               `yaml:"runs_per_case"`

	// configDir is the directory containing the config file, used for path resolution.
	configDir string
}

// TestCase describes a single user prompt scenario.
type TestCase struct {
	ID          string `yaml:"id"`
	UserMessage string `yaml:"user_message"`
	Persona     string `yaml:"persona"`
}

// ResponderConfig holds model settings for the agent under test.
type ResponderConfig struct {
	Model string `yaml:"model"`
}

// JudgeConfig holds settings for the LLM judge.
type JudgeConfig struct {
	Model    string      `yaml:"model"`
	Criteria []Criterion `yaml:"criteria"`
}

// Criterion is a single evaluation dimension used by the judge.
type Criterion struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Scale       string `yaml:"scale"`
}

// LoadConfig reads a YAML config file from path, applies defaults, and validates it.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config YAML: %w", err)
	}

	cfg.configDir = filepath.Dir(path)

	// Load test cases from external file if specified.
	if cfg.TestCasesFile != "" {
		cases, err := loadTestCasesFile(cfg.configDir, cfg.TestCasesFile)
		if err != nil {
			return nil, fmt.Errorf("loading test_cases_file: %w", err)
		}
		cfg.TestCases = append(cfg.TestCases, cases...)
	}

	applyDefaults(&cfg)

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// applyDefaults sets zero-value fields to their default values.
func applyDefaults(cfg *Config) {
	if cfg.MaxOutputTokens == 0 {
		cfg.MaxOutputTokens = 8000
	}
	if cfg.MaxSteps == 0 {
		cfg.MaxSteps = 10
	}
	if cfg.RunsPerCase == 0 {
		cfg.RunsPerCase = 1
	}
	if cfg.Responder.Model == "" {
		cfg.Responder.Model = cfg.Model
	}
}

// validate checks that all required fields are present.
func (c *Config) validate() error {
	if c.Name == "" {
		return errors.New("config validation: name is required")
	}
	if c.Model == "" {
		return errors.New("config validation: model is required")
	}
	if len(c.PromptFiles) == 0 {
		return errors.New("config validation: prompt_files is required")
	}
	if len(c.TestCases) == 0 {
		return errors.New("config validation: test_cases is required")
	}
	if c.Judge.Model == "" {
		return errors.New("config validation: judge.model is required")
	}
	if len(c.Judge.Criteria) == 0 {
		return errors.New("config validation: judge.criteria is required")
	}
	for i, tc := range c.TestCases {
		if tc.ID == "" {
			return fmt.Errorf("config validation: test_cases[%d].id is required", i)
		}
		if tc.UserMessage == "" {
			return fmt.Errorf("config validation: test_cases[%d].user_message is required", i)
		}
	}
	return nil
}

// loadTestCasesFile reads a YAML file containing a list of test cases.
func loadTestCasesFile(configDir, relPath string) ([]TestCase, error) {
	path := relPath
	if !filepath.IsAbs(path) {
		path = filepath.Join(configDir, path)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	var cases []TestCase
	if err := yaml.Unmarshal(data, &cases); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}

	return cases, nil
}

// ResolvePromptPath resolves a prompt file path relative to the config directory.
// If the path has an override configured, the override path is resolved instead.
func (c *Config) ResolvePromptPath(path string) string {
	if override, ok := c.PromptOverrides[path]; ok {
		path = override
	}
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(c.configDir, path)
}
