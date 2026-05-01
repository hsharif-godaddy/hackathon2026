package harness_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/harness"
)

const fullConfigYAML = `
name: full-test
description: Full test config
model: claude-haiku-4-5-20251001
temperature: 0.7
max_output_tokens: 4000
max_steps: 5
effort: low
prompt_files:
  - prompts/system.md
  - prompts/guidelines.md
prompt_overrides:
  prompts/system.md: overrides/custom-system.md
test_cases:
  - id: tc-1
    user_message: "Hello, build me a site"
    persona: "Small business owner"
  - id: tc-2
    user_message: "I need a portfolio"
    persona: "Freelancer"
responder:
  model: claude-haiku-4-5-20251001
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: relevance
      description: Does the response address the user's request?
      scale: "1-5"
    - name: quality
      description: Is the output high quality?
      scale: "1-10"
runs_per_case: 3
`

const minimalConfigYAML = `
name: minimal-test
model: claude-haiku-4-5-20251001
prompt_files:
  - prompts/system.md
test_cases:
  - id: tc-1
    user_message: "Build me something"
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
	return path
}

func TestLoadConfig(t *testing.T) {
	path := writeTempConfig(t, fullConfigYAML)
	cfg, err := harness.LoadConfig(path)
	require.NoError(t, err)

	assert.Equal(t, "full-test", cfg.Name)
	assert.Equal(t, "Full test config", cfg.Description)
	assert.Equal(t, "claude-haiku-4-5-20251001", cfg.Model)
	assert.InDelta(t, 0.7, cfg.Temperature, 0.001)
	assert.Equal(t, 4000, cfg.MaxOutputTokens)
	assert.Equal(t, 5, cfg.MaxSteps)
	assert.Equal(t, "low", cfg.Effort)
	assert.Equal(t, []string{"prompts/system.md", "prompts/guidelines.md"}, cfg.PromptFiles)
	assert.Equal(t, map[string]string{"prompts/system.md": "overrides/custom-system.md"}, cfg.PromptOverrides)
	assert.Equal(t, 3, cfg.RunsPerCase)

	require.Len(t, cfg.TestCases, 2)
	assert.Equal(t, "tc-1", cfg.TestCases[0].ID)
	assert.Equal(t, "Hello, build me a site", cfg.TestCases[0].UserMessage)
	assert.Equal(t, "Small business owner", cfg.TestCases[0].Persona)
	assert.Equal(t, "tc-2", cfg.TestCases[1].ID)

	assert.Equal(t, "claude-haiku-4-5-20251001", cfg.Responder.Model)
	assert.Equal(t, "claude-sonnet-4-6-20250514", cfg.Judge.Model)
	require.Len(t, cfg.Judge.Criteria, 2)
	assert.Equal(t, "relevance", cfg.Judge.Criteria[0].Name)
	assert.Equal(t, "Does the response address the user's request?", cfg.Judge.Criteria[0].Description)
	assert.Equal(t, "1-5", cfg.Judge.Criteria[0].Scale)
}

func TestLoadConfigDefaults(t *testing.T) {
	path := writeTempConfig(t, minimalConfigYAML)
	cfg, err := harness.LoadConfig(path)
	require.NoError(t, err)

	// Defaults applied
	assert.Equal(t, 8000, cfg.MaxOutputTokens)
	assert.Equal(t, 10, cfg.MaxSteps)
	assert.Equal(t, 1, cfg.RunsPerCase)

	// Responder.Model defaults to Config.Model when not set
	assert.Equal(t, "claude-haiku-4-5-20251001", cfg.Responder.Model)

	// Optional fields stay zero/empty
	assert.Empty(t, cfg.Description)
	assert.InDelta(t, 0.0, cfg.Temperature, 0.001)
	assert.Empty(t, cfg.Effort)
	assert.Nil(t, cfg.PromptOverrides)
}

func TestLoadConfigResolvePromptPaths(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	yamlContent := `
name: path-test
model: claude-haiku-4-5-20251001
prompt_files:
  - prompts/system.md
  - prompts/guidelines.md
prompt_overrides:
  prompts/guidelines.md: overrides/custom-guidelines.md
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`
	err := os.WriteFile(path, []byte(yamlContent), 0644)
	require.NoError(t, err)

	cfg, err := harness.LoadConfig(path)
	require.NoError(t, err)

	// Non-overridden path resolves relative to config dir
	resolved := cfg.ResolvePromptPath("prompts/system.md")
	assert.Equal(t, filepath.Join(dir, "prompts/system.md"), resolved)

	// Overridden path resolves override relative to config dir
	resolvedOverride := cfg.ResolvePromptPath("prompts/guidelines.md")
	assert.Equal(t, filepath.Join(dir, "overrides/custom-guidelines.md"), resolvedOverride)
}

func TestLoadConfigCriteriaFile(t *testing.T) {
	dir := t.TempDir()

	// Write criteria file.
	criteriaDir := filepath.Join(dir, "criteria")
	require.NoError(t, os.MkdirAll(criteriaDir, 0750))
	criteriaYAML := `
- name: quality
  description: Is it good?
  scale: "1-5"
- name: speed
  description: Is it fast?
  scale: "1-5"
`
	require.NoError(t, os.WriteFile(filepath.Join(criteriaDir, "standard.yaml"), []byte(criteriaYAML), 0644))

	// Write config that references criteria_file.
	configYAML := `
name: criteria-file-test
model: claude-haiku-4-5-20251001
prompt_files: [prompts/system.md]
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
  criteria_file: criteria/standard.yaml
`
	configPath := filepath.Join(dir, "config.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(configYAML), 0644))

	cfg, err := harness.LoadConfig(configPath)
	require.NoError(t, err)

	require.Len(t, cfg.Judge.Criteria, 2)
	assert.Equal(t, "quality", cfg.Judge.Criteria[0].Name)
	assert.Equal(t, "speed", cfg.Judge.Criteria[1].Name)
}

func TestLoadConfigCriteriaFilePlusInline(t *testing.T) {
	dir := t.TempDir()

	// Write criteria file.
	criteriaDir := filepath.Join(dir, "criteria")
	require.NoError(t, os.MkdirAll(criteriaDir, 0750))
	criteriaYAML := `
- name: quality
  description: Is it good?
  scale: "1-5"
`
	require.NoError(t, os.WriteFile(filepath.Join(criteriaDir, "base.yaml"), []byte(criteriaYAML), 0644))

	// Config with both inline criteria and criteria_file — they should merge.
	configYAML := `
name: merge-test
model: claude-haiku-4-5-20251001
prompt_files: [prompts/system.md]
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: inline_criterion
      description: Inline only
      scale: "1-5"
  criteria_file: criteria/base.yaml
`
	configPath := filepath.Join(dir, "config.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(configYAML), 0644))

	cfg, err := harness.LoadConfig(configPath)
	require.NoError(t, err)

	require.Len(t, cfg.Judge.Criteria, 2)
	assert.Equal(t, "inline_criterion", cfg.Judge.Criteria[0].Name)
	assert.Equal(t, "quality", cfg.Judge.Criteria[1].Name)
}

func TestLoadConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		yaml    string
		wantErr string
	}{
		{
			name: "missing name",
			yaml: `
model: claude-haiku-4-5-20251001
prompt_files: [prompts/system.md]
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`,
			wantErr: "name",
		},
		{
			name: "missing model",
			yaml: `
name: test
prompt_files: [prompts/system.md]
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`,
			wantErr: "model",
		},
		{
			name: "missing prompt_files",
			yaml: `
name: test
model: claude-haiku-4-5-20251001
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`,
			wantErr: "prompt_files",
		},
		{
			name: "missing test_cases",
			yaml: `
name: test
model: claude-haiku-4-5-20251001
prompt_files: [prompts/system.md]
judge:
  model: claude-sonnet-4-6-20250514
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`,
			wantErr: "test_cases",
		},
		{
			name: "missing judge model",
			yaml: `
name: test
model: claude-haiku-4-5-20251001
prompt_files: [prompts/system.md]
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  criteria:
    - name: quality
      description: Is it good?
      scale: "1-5"
`,
			wantErr: "judge.model",
		},
		{
			name: "missing judge criteria",
			yaml: `
name: test
model: claude-haiku-4-5-20251001
prompt_files: [prompts/system.md]
test_cases:
  - id: tc-1
    user_message: "Test"
judge:
  model: claude-sonnet-4-6-20250514
`,
			wantErr: "judge.criteria",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := writeTempConfig(t, tt.yaml)
			_, err := harness.LoadConfig(path)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}
