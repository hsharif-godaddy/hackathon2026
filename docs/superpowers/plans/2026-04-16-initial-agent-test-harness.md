# Initial Agent Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Go CLI that runs the initial agent conversation loop against Claude API with simulated tools, measuring cost/latency and scoring outputs via LLM judge.

**Architecture:** New `cmd/harness` binary inside the existing `go-agent/` module. Uses the Anthropic Go SDK's non-streaming `Messages.New()` API directly (no reuse of the existing streaming adapter). Config-driven via YAML files. Results saved as JSON with terminal summary.

**Tech Stack:** Go 1.25, `github.com/anthropics/anthropic-sdk-go` v1.30.0, `gopkg.in/yaml.v3`

---

## File Structure

```
go-agent/
├── cmd/harness/main.go                        # CLI: flag parsing, orchestration
├── internal/harness/config.go                  # YAML config structs + loading
├── internal/harness/config_test.go             # Config loading tests
├── internal/harness/tools.go                   # Tool JSON schemas (matching production)
├── internal/harness/tools_test.go              # Tool schema validation tests
├── internal/harness/runner.go                  # Conversation loop + tool simulation
├── internal/harness/runner_test.go             # Runner tests with mock API
├── internal/harness/judge.go                   # LLM-as-judge evaluation
├── internal/harness/judge_test.go              # Judge tests
├── internal/harness/cost.go                    # Token cost calculation
├── internal/harness/cost_test.go               # Cost calculation tests
├── internal/harness/report.go                  # JSON output + terminal summary
├── internal/harness/report_test.go             # Report formatting tests
├── configs/harness/baseline.yaml               # Default experiment config
└── results/harness/.gitkeep                    # Results output directory
```

---

### Task 1: Config Loading

**Files:**

- Create: `go-agent/internal/harness/config.go`
- Create: `go-agent/internal/harness/config_test.go`
- Create: `go-agent/configs/harness/baseline.yaml`

- [ ] **Step 1: Write the failing test for config loading**

```go
// go-agent/internal/harness/config_test.go
package harness

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")
	err := os.WriteFile(path, []byte(`
name: "test-experiment"
description: "A test"
model: "claude-haiku-4-5-20251001"
temperature: 0.5
max_output_tokens: 8000
max_steps: 10
effort: "low"
prompt_files:
  - "prompts/core.md"
  - "prompts/comm.md"
prompt_overrides:
  "prompts/core.md": "prompts/core-v2.md"
test_cases:
  - id: "bakery"
    user_message: "website for my bakery"
    persona: "Baker in Portland"
  - id: "saas"
    user_message: "Build a SaaS called TaskFlow"
    persona: "Startup founder"
responder:
  model: "claude-haiku-4-5-20251001"
judge:
  model: "claude-sonnet-4-6-20250514"
  criteria:
    - name: "name_quality"
      description: "Is the name good?"
      scale: "1-5"
runs_per_case: 3
`), 0644)
	require.NoError(t, err)

	cfg, err := LoadConfig(path)
	require.NoError(t, err)

	assert.Equal(t, "test-experiment", cfg.Name)
	assert.Equal(t, "claude-haiku-4-5-20251001", cfg.Model)
	assert.InDelta(t, 0.5, cfg.Temperature, 0.001)
	assert.Equal(t, 8000, cfg.MaxOutputTokens)
	assert.Equal(t, 10, cfg.MaxSteps)
	assert.Equal(t, "low", cfg.Effort)
	assert.Len(t, cfg.PromptFiles, 2)
	assert.Equal(t, "prompts/core-v2.md", cfg.PromptOverrides["prompts/core.md"])
	assert.Len(t, cfg.TestCases, 2)
	assert.Equal(t, "bakery", cfg.TestCases[0].ID)
	assert.Equal(t, "Baker in Portland", cfg.TestCases[0].Persona)
	assert.Equal(t, "claude-haiku-4-5-20251001", cfg.Responder.Model)
	assert.Equal(t, "claude-sonnet-4-6-20250514", cfg.Judge.Model)
	assert.Len(t, cfg.Judge.Criteria, 1)
	assert.Equal(t, 3, cfg.RunsPerCase)
}

func TestLoadConfigDefaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "minimal.yaml")
	err := os.WriteFile(path, []byte(`
name: "minimal"
model: "claude-haiku-4-5-20251001"
prompt_files:
  - "core.md"
test_cases:
  - id: "test1"
    user_message: "hello"
    persona: "user"
judge:
  model: "claude-sonnet-4-6-20250514"
  criteria:
    - name: "quality"
      description: "Is it good?"
      scale: "1-5"
`), 0644)
	require.NoError(t, err)

	cfg, err := LoadConfig(path)
	require.NoError(t, err)

	// Defaults
	assert.Equal(t, 8000, cfg.MaxOutputTokens)
	assert.Equal(t, 10, cfg.MaxSteps)
	assert.Equal(t, 1, cfg.RunsPerCase)
	assert.Equal(t, "claude-haiku-4-5-20251001", cfg.Responder.Model)
}

func TestLoadConfigResolvePromptPaths(t *testing.T) {
	dir := t.TempDir()

	// Create prompt files relative to config
	promptDir := filepath.Join(dir, "prompts")
	require.NoError(t, os.MkdirAll(promptDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(promptDir, "core.md"), []byte("# Core"), 0644))

	cfgPath := filepath.Join(dir, "config.yaml")
	err := os.WriteFile(cfgPath, []byte(`
name: "test"
model: "claude-haiku-4-5-20251001"
prompt_files:
  - "prompts/core.md"
test_cases:
  - id: "t1"
    user_message: "hi"
    persona: "user"
judge:
  model: "claude-sonnet-4-6-20250514"
  criteria:
    - name: "q"
      description: "d"
      scale: "1-5"
`), 0644)
	require.NoError(t, err)

	cfg, err := LoadConfig(cfgPath)
	require.NoError(t, err)

	resolved := cfg.ResolvePromptPath("prompts/core.md")
	assert.Equal(t, filepath.Join(dir, "prompts/core.md"), resolved)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd go-agent && go test ./internal/harness/ -run TestLoadConfig -v`
Expected: FAIL — package doesn't exist yet

- [ ] **Step 3: Write the config implementation**

```go
// go-agent/internal/harness/config.go
package harness

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Config represents a test harness experiment configuration.
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
	TestCases       []TestCase        `yaml:"test_cases"`
	Responder       ResponderConfig   `yaml:"responder"`
	Judge           JudgeConfig       `yaml:"judge"`
	RunsPerCase     int               `yaml:"runs_per_case"`

	// configDir is the directory containing the config file, used for resolving relative paths.
	configDir string
}

// TestCase defines a single test scenario.
type TestCase struct {
	ID          string `yaml:"id"`
	UserMessage string `yaml:"user_message"`
	Persona     string `yaml:"persona"`
}

// ResponderConfig configures the LLM used to simulate user answers to askQuestion.
type ResponderConfig struct {
	Model string `yaml:"model"`
}

// JudgeConfig configures the LLM judge.
type JudgeConfig struct {
	Model    string      `yaml:"model"`
	Criteria []Criterion `yaml:"criteria"`
}

// Criterion defines a scoring criterion for the judge.
type Criterion struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Scale       string `yaml:"scale"`
}

// LoadConfig reads and parses a YAML config file, applying defaults.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config %s: %w", path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config %s: %w", path, err)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolving config path: %w", err)
	}
	cfg.configDir = filepath.Dir(absPath)

	// Apply defaults.
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

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// ResolvePromptPath resolves a prompt file path relative to the config file directory.
// If an override exists for this path, the override path is resolved instead.
func (c *Config) ResolvePromptPath(path string) string {
	if override, ok := c.PromptOverrides[path]; ok {
		path = override
	}
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(c.configDir, path)
}

func (c *Config) validate() error {
	if c.Name == "" {
		return fmt.Errorf("config: name is required")
	}
	if c.Model == "" {
		return fmt.Errorf("config: model is required")
	}
	if len(c.PromptFiles) == 0 {
		return fmt.Errorf("config: at least one prompt_file is required")
	}
	if len(c.TestCases) == 0 {
		return fmt.Errorf("config: at least one test_case is required")
	}
	if c.Judge.Model == "" {
		return fmt.Errorf("config: judge.model is required")
	}
	if len(c.Judge.Criteria) == 0 {
		return fmt.Errorf("config: at least one judge criterion is required")
	}
	for i, tc := range c.TestCases {
		if tc.ID == "" {
			return fmt.Errorf("config: test_case[%d].id is required", i)
		}
		if tc.UserMessage == "" {
			return fmt.Errorf("config: test_case[%d].user_message is required", i)
		}
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd go-agent && go test ./internal/harness/ -run TestLoadConfig -v`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Create the baseline config file**

```yaml
# go-agent/configs/harness/baseline.yaml
name: "baseline"
description: "Current production initial agent settings"

model: "claude-haiku-4-5-20251001"
temperature: 0.5
max_output_tokens: 8000
max_steps: 10
effort: "low"

prompt_files:
  - "../../agents/src/prompts/initial/core.md"
  - "../../agents/src/prompts/shared/communication.md"
  - "../../agents/src/prompts/initial/attributes.md"
  - "../../agents/src/prompts/initial/guidelines.md"
  - "../../agents/src/prompts/initial/examples.md"
  - "../../agents/src/prompts/shared/security.md"

prompt_overrides: {}

test_cases:
  - id: "bakery-brief"
    user_message: "I want a website for my bakery"
    persona: "Small bakery owner in Portland, specializing in sourdough"

  - id: "saas-detailed"
    user_message: "Build a project management SaaS called TaskFlow for small dev teams. Clean, minimal design with dark mode."
    persona: "Startup founder, technical background"

  - id: "portfolio-vague"
    user_message: "portfolio site"
    persona: "Freelance photographer, landscape work"

  - id: "ecommerce-rich"
    user_message: "I need an online store for my handmade jewelry brand called Luna & Stone. Target audience is women 25-40 who love artisan accessories."
    persona: "Artisan jewelry maker, active on Instagram, ships nationwide"

  - id: "restaurant-simple"
    user_message: "restaurant website"
    persona: "Family Italian restaurant owner, not tech-savvy"

responder:
  model: "claude-haiku-4-5-20251001"

judge:
  model: "claude-sonnet-4-6-20250514"
  criteria:
    - name: "project_name_quality"
      description: "Is the project name specific, relevant, and 1-3 words? (5=perfect fit, 1=generic/wrong)"
      scale: "1-5"
    - name: "handoff_completeness"
      description: "Does the handoff include all required sections: project details, design direction, layout type, visual direction, visual elements, motion design, section guidance, differentiation, consistency, build order, initial scope, suggested responses?"
      scale: "1-5"
    - name: "design_specificity"
      description: "Is the design direction specific and distinctive rather than generic? Does it name specific fonts, specific color emotions, specific layout approaches rather than vague terms like 'modern and clean'?"
      scale: "1-5"
    - name: "anti_cliche"
      description: "Does the handoff explicitly avoid common AI design patterns (icon grids, purple gradients, centered-band CTAs, empty-right heroes) and suggest specific alternatives?"
      scale: "1-5"

runs_per_case: 1
```

- [ ] **Step 6: Create results directory with .gitkeep**

```bash
mkdir -p go-agent/results/harness
touch go-agent/results/harness/.gitkeep
```

Also add `results/harness/*.json` to `.gitignore` if one exists in `go-agent/`:

```bash
echo 'results/harness/*.json' >> go-agent/.gitignore
```

- [ ] **Step 7: Promote yaml.v3 to direct dependency**

Run: `cd go-agent && go get gopkg.in/yaml.v3`

- [ ] **Step 8: Commit**

```bash
git add go-agent/internal/harness/config.go go-agent/internal/harness/config_test.go \
  go-agent/configs/harness/baseline.yaml go-agent/results/harness/.gitkeep \
  go-agent/go.mod go-agent/go.sum
git commit -m "feat(harness): add config loading and baseline experiment config"
```

---

### Task 2: Tool Schemas

**Files:**

- Create: `go-agent/internal/harness/tools.go`
- Create: `go-agent/internal/harness/tools_test.go`

These are the JSON schemas sent to Claude so it knows how to call each tool. They must match the production TypeScript schemas exactly.

- [ ] **Step 1: Write the failing test**

```go
// go-agent/internal/harness/tools_test.go
package harness

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolDefinitions(t *testing.T) {
	tools := ToolDefinitions()

	// Should have 5 tools
	assert.Len(t, tools, 5)

	names := make(map[string]bool)
	for _, td := range tools {
		names[td.Name] = true
		// Each tool must have a name, description, and valid JSON schema
		assert.NotEmpty(t, td.Name)
		assert.NotEmpty(t, td.Description)

		var schema map[string]any
		err := json.Unmarshal([]byte(td.InputSchemaJSON), &schema)
		require.NoError(t, err, "tool %s has invalid JSON schema", td.Name)
		assert.Equal(t, "object", schema["type"])
	}

	assert.True(t, names["askQuestion"])
	assert.True(t, names["setProjectName"])
	assert.True(t, names["todoList"])
	assert.True(t, names["handoff"])
	assert.True(t, names["websiteRebuild"])
}

func TestAskQuestionSchema(t *testing.T) {
	tools := ToolDefinitions()
	var askQ ToolDefinition
	for _, td := range tools {
		if td.Name == "askQuestion" {
			askQ = td
			break
		}
	}

	var schema map[string]any
	require.NoError(t, json.Unmarshal([]byte(askQ.InputSchemaJSON), &schema))

	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "questions")

	// questions should be an array with items containing question, suggestions, allowOther, multiSelect, metadata
	questions := props["questions"].(map[string]any)
	assert.Equal(t, "array", questions["type"])
}

func TestTodoListSchemaOperations(t *testing.T) {
	tools := ToolDefinitions()
	var todoTool ToolDefinition
	for _, td := range tools {
		if td.Name == "todoList" {
			todoTool = td
			break
		}
	}

	var schema map[string]any
	require.NoError(t, json.Unmarshal([]byte(todoTool.InputSchemaJSON), &schema))

	props := schema["properties"].(map[string]any)
	op := props["operation"].(map[string]any)
	enum := op["enum"].([]any)

	expectedOps := []string{
		"create_list", "get_list", "show_list", "list_all", "delete_list",
		"add_items", "update_items", "delete_items", "mark_done", "mark_undone", "select_list",
	}
	assert.Len(t, enum, len(expectedOps))
	for _, expected := range expectedOps {
		assert.Contains(t, enum, expected)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd go-agent && go test ./internal/harness/ -run TestTool -v`
Expected: FAIL — `ToolDefinitions` not found

- [ ] **Step 3: Write tool definitions**

```go
// go-agent/internal/harness/tools.go
package harness

// ToolDefinition holds a tool name, description, and JSON Schema for its input.
type ToolDefinition struct {
	Name           string
	Description    string
	InputSchemaJSON string
}

// ToolDefinitions returns the tool schemas matching the production initial agent.
// These schemas must match the TypeScript Zod schemas exactly so the LLM
// generates identical tool call arguments.
func ToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		askQuestionTool(),
		setProjectNameTool(),
		todoListTool(),
		handoffTool(),
		websiteRebuildTool(),
	}
}

func askQuestionTool() ToolDefinition {
	return ToolDefinition{
		Name: "askQuestion",
		Description: `Ask the user one or more questions with suggested answers.
Questions are displayed one at a time in the UI. Users can select a suggestion or provide their own answer.
The agent will receive all answers in a formatted response once the user completes all questions.

Use this instead of asking questions directly in your response text.`,
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Array of questions to ask (minimum 1, maximum 10)",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "object",
        "properties": {
          "question": {
            "type": "string",
            "description": "The question to ask the user"
          },
          "suggestions": {
            "type": "array",
            "description": "Array of suggested answers (minimum 1)",
            "minItems": 1,
            "items": {
              "oneOf": [
                { "type": "string" },
                {
                  "type": "object",
                  "properties": {
                    "text": { "type": "string", "description": "The suggestion text to display" },
                    "value": { "type": "string", "description": "Optional: different value to send vs display" }
                  },
                  "required": ["text"]
                }
              ],
              "description": "Suggested answer, either a plain string or an object { text, value? }"
            }
          },
          "allowOther": {
            "type": "boolean",
            "default": true,
            "description": "Whether to show Other option for free text input"
          },
          "multiSelect": {
            "type": "boolean",
            "default": false,
            "description": "Whether to allow selecting multiple answers"
          },
          "metadata": {
            "type": "object",
            "additionalProperties": true,
            "description": "Optional metadata for tracking"
          }
        },
        "required": ["question", "suggestions"]
      }
    }
  },
  "required": ["questions"]
}`,
	}
}

func setProjectNameTool() ToolDefinition {
	return ToolDefinition{
		Name:        "setProjectName",
		Description: "Set the project name after gathering necessary information from the user.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "The project name to set (1-100 characters)"
    }
  },
  "required": ["name"]
}`,
	}
}

func todoListTool() ToolDefinition {
	return ToolDefinition{
		Name:        "todoList",
		Description: "Create and manage todo lists for planning. CRITICAL: Mark items complete IMMEDIATELY after finishing each task - do not wait until end of workflow or git commit. Use show_list to display completed work. Use select_list to switch between todo lists.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "enum": ["create_list", "get_list", "show_list", "list_all", "delete_list", "add_items", "update_items", "delete_items", "mark_done", "mark_undone", "select_list"],
      "description": "The operation to perform. Use show_list to display a completed todo list. Use select_list to switch to a different list."
    },
    "appId": {
      "type": "string",
      "description": "App ID to associate the list with (usually from context)"
    },
    "listId": {
      "type": "string",
      "description": "ID of the todo list (required for get_list, show_list, select_list, delete_list, add_items)"
    },
    "listName": {
      "type": "string",
      "description": "Name of the todo list (required for create_list)"
    },
    "listDescription": {
      "type": "string",
      "description": "Description of the todo list"
    },
    "items": {
      "type": "array",
      "description": "Array of items - for create_list or add_items",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "Title of the item" },
          "description": { "type": "string", "description": "Description of the item" },
          "completed": { "type": "boolean", "description": "Whether the item is completed (default: false)" },
          "order": { "type": "number", "description": "Order/position of the item" }
        },
        "required": ["title"]
      }
    },
    "itemIds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Array of item IDs - for mark_done, mark_undone, delete_items"
    },
    "updates": {
      "type": "array",
      "description": "Array of updates - for update_items operation",
      "items": {
        "type": "object",
        "properties": {
          "itemId": { "type": "string", "description": "ID of the item to update" },
          "title": { "type": "string", "description": "New title" },
          "description": { "type": "string", "description": "New description" },
          "order": { "type": "number", "description": "New order/position" }
        },
        "required": ["itemId"]
      }
    }
  },
  "required": ["operation"]
}`,
	}
}

func handoffTool() ToolDefinition {
	return ToolDefinition{
		Name:        "handoff",
		Description: "Hand off control to another agent to handle the conversation. Don't say anything after the handoff, the next agent will take over.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "targetAgent": {
      "type": "string",
      "description": "ID of the agent to hand off to. Available: develop"
    },
    "prompt": {
      "type": "string",
      "description": "Brief summary of what you completed. Do NOT add new instructions or tasks."
    }
  },
  "required": ["targetAgent", "prompt"]
}`,
	}
}

func websiteRebuildTool() ToolDefinition {
	return ToolDefinition{
		Name:        "websiteRebuild",
		Description: "Rebuild an existing website from a URL. Scrapes the source, downloads assets, and generates build prompts.",
		InputSchemaJSON: `{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "URL of the website to rebuild"
    }
  },
  "required": ["url"]
}`,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd go-agent && go test ./internal/harness/ -run TestTool -v`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add go-agent/internal/harness/tools.go go-agent/internal/harness/tools_test.go
git commit -m "feat(harness): add tool definitions matching production schemas"
```

---

### Task 3: Cost Calculation

**Files:**

- Create: `go-agent/internal/harness/cost.go`
- Create: `go-agent/internal/harness/cost_test.go`

- [ ] **Step 1: Write the failing test**

```go
// go-agent/internal/harness/cost_test.go
package harness

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCalculateCost(t *testing.T) {
	tokens := TokenUsage{
		InputTokens:          1_000_000, // 1M tokens
		OutputTokens:         1_000_000,
		CacheCreationTokens:  1_000_000,
		CacheReadTokens:      1_000_000,
	}

	// Haiku pricing: $1/$5/$1.25/$0.10 per 1M tokens
	cost := CalculateCost("claude-haiku-4-5-20251001", tokens)
	assert.InDelta(t, 1.0, cost.InputCost, 0.001)
	assert.InDelta(t, 5.0, cost.OutputCost, 0.001)
	assert.InDelta(t, 1.25, cost.CacheCreationCost, 0.001)
	assert.InDelta(t, 0.10, cost.CacheReadCost, 0.001)
	assert.InDelta(t, 7.35, cost.Total(), 0.001)
}

func TestCalculateCostSonnet(t *testing.T) {
	tokens := TokenUsage{
		InputTokens:  500_000,
		OutputTokens: 100_000,
	}

	cost := CalculateCost("claude-sonnet-4-6-20250514", tokens)
	assert.InDelta(t, 1.5, cost.InputCost, 0.001)   // 0.5M * $3
	assert.InDelta(t, 1.5, cost.OutputCost, 0.001)   // 0.1M * $15
	assert.InDelta(t, 3.0, cost.Total(), 0.001)
}

func TestCalculateCostUnknownModel(t *testing.T) {
	tokens := TokenUsage{InputTokens: 1000, OutputTokens: 500}
	cost := CalculateCost("unknown-model", tokens)
	// Should use Sonnet pricing as default
	assert.Greater(t, cost.Total(), 0.0)
}

func TestTokenUsageAdd(t *testing.T) {
	a := TokenUsage{InputTokens: 100, OutputTokens: 50, CacheCreationTokens: 200, CacheReadTokens: 300}
	b := TokenUsage{InputTokens: 200, OutputTokens: 100, CacheCreationTokens: 0, CacheReadTokens: 150}
	sum := a.Add(b)
	assert.Equal(t, int64(300), sum.InputTokens)
	assert.Equal(t, int64(150), sum.OutputTokens)
	assert.Equal(t, int64(200), sum.CacheCreationTokens)
	assert.Equal(t, int64(450), sum.CacheReadTokens)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd go-agent && go test ./internal/harness/ -run TestCalculateCost -v`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```go
// go-agent/internal/harness/cost.go
package harness

// TokenUsage tracks token consumption across API calls.
type TokenUsage struct {
	InputTokens         int64
	OutputTokens        int64
	CacheCreationTokens int64
	CacheReadTokens     int64
}

// Add returns the sum of two TokenUsage values.
func (t TokenUsage) Add(other TokenUsage) TokenUsage {
	return TokenUsage{
		InputTokens:         t.InputTokens + other.InputTokens,
		OutputTokens:        t.OutputTokens + other.OutputTokens,
		CacheCreationTokens: t.CacheCreationTokens + other.CacheCreationTokens,
		CacheReadTokens:     t.CacheReadTokens + other.CacheReadTokens,
	}
}

// CostBreakdown shows cost by category.
type CostBreakdown struct {
	InputCost         float64
	OutputCost        float64
	CacheCreationCost float64
	CacheReadCost     float64
}

// Total returns the sum of all costs.
func (c CostBreakdown) Total() float64 {
	return c.InputCost + c.OutputCost + c.CacheCreationCost + c.CacheReadCost
}

// modelPricing holds per-million-token rates.
type modelPricing struct {
	Input         float64
	Output        float64
	CacheCreation float64
	CacheRead     float64
}

var pricing = map[string]modelPricing{
	"claude-haiku-4-5-20251001": {Input: 1.00, Output: 5.00, CacheCreation: 1.25, CacheRead: 0.10},
	"claude-sonnet-4-6-20250514": {Input: 3.00, Output: 15.00, CacheCreation: 3.75, CacheRead: 0.30},
	"claude-opus-4-6-20250901":   {Input: 15.00, Output: 75.00, CacheCreation: 18.75, CacheRead: 1.50},
}

var defaultPricing = pricing["claude-sonnet-4-6-20250514"]

// CalculateCost computes the USD cost for a given model and token usage.
func CalculateCost(model string, tokens TokenUsage) CostBreakdown {
	p, ok := pricing[model]
	if !ok {
		p = defaultPricing
	}

	return CostBreakdown{
		InputCost:         float64(tokens.InputTokens) / 1_000_000 * p.Input,
		OutputCost:        float64(tokens.OutputTokens) / 1_000_000 * p.Output,
		CacheCreationCost: float64(tokens.CacheCreationTokens) / 1_000_000 * p.CacheCreation,
		CacheReadCost:     float64(tokens.CacheReadTokens) / 1_000_000 * p.CacheRead,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd go-agent && go test ./internal/harness/ -run "TestCalculateCost|TestTokenUsage" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add go-agent/internal/harness/cost.go go-agent/internal/harness/cost_test.go
git commit -m "feat(harness): add token cost calculation"
```

---

### Task 4: Conversation Runner

**Files:**

- Create: `go-agent/internal/harness/runner.go`
- Create: `go-agent/internal/harness/runner_test.go`

This is the core component — the multi-turn conversation loop with tool simulation.

- [ ] **Step 1: Write the failing test for a simple handoff flow**

```go
// go-agent/internal/harness/runner_test.go
package harness

import (
	"context"
	"encoding/json"
	"testing"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockAPIFunc captures calls and returns canned responses.
type mockAPIFunc func(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error)

func (f mockAPIFunc) Call(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
	return f(ctx, params)
}

func TestRunnerSimpleHandoff(t *testing.T) {
	// Simulate an agent that calls setProjectName, todoList, handoff in one response.
	callCount := 0
	mock := mockAPIFunc(func(_ context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
		callCount++
		switch callCount {
		case 1:
			// First call: agent calls all 3 tools
			return makeToolUseMessage(
				toolUse("tool_1", "setProjectName", `{"name": "TaskFlow"}`),
				toolUse("tool_2", "todoList", `{"operation":"create_list","listName":"TaskFlow Website","items":[{"title":"Homepage"}]}`),
				toolUse("tool_3", "handoff", `{"targetAgent":"develop","prompt":"Build homepage with dark theme"}`),
			), nil
		default:
			t.Fatal("unexpected API call")
			return nil, nil
		}
	})

	r := NewRunner(RunnerConfig{
		MaxSteps:     10,
		StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
		SystemPrompt: "You are a test agent.",
		APICall:      mock.Call,
	})

	result, err := r.Run(context.Background(), "Build a SaaS called TaskFlow")
	require.NoError(t, err)

	assert.Equal(t, "TaskFlow", result.ProjectName)
	assert.Equal(t, "develop", result.HandoffTarget)
	assert.Contains(t, result.HandoffPrompt, "dark theme")
	assert.True(t, result.Complete)
	assert.Equal(t, 1, result.Turns)
}

func TestRunnerAskQuestionFlow(t *testing.T) {
	// Agent calls askQuestion, responder answers, then agent calls tools + handoff.
	callCount := 0
	mock := mockAPIFunc(func(_ context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
		callCount++
		switch callCount {
		case 1:
			// Agent asks questions
			return makeToolUseMessage(
				toolUse("tool_1", "askQuestion", `{"questions":[{"question":"What is your bakery name?","suggestions":["My Bakery"]}]}`),
			), nil
		case 2:
			// After receiving answers, agent proceeds
			return makeToolUseMessage(
				toolUse("tool_2", "setProjectName", `{"name": "Portland Sourdough"}`),
				toolUse("tool_3", "todoList", `{"operation":"create_list","listName":"Portland Sourdough","items":[{"title":"Homepage"}]}`),
				toolUse("tool_4", "handoff", `{"targetAgent":"develop","prompt":"Build bakery site"}`),
			), nil
		default:
			t.Fatal("unexpected API call")
			return nil, nil
		}
	})

	responderCalled := false
	responder := func(_ context.Context, questions json.RawMessage, persona, userMsg string) (string, *TokenUsage, error) {
		responderCalled = true
		return "My bakery is called Portland Sourdough, we specialize in artisan bread.", &TokenUsage{InputTokens: 100, OutputTokens: 50}, nil
	}

	r := NewRunner(RunnerConfig{
		MaxSteps:     10,
		StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
		SystemPrompt: "You are a test agent.",
		APICall:      mock.Call,
		Responder:    responder,
		Persona:      "Baker in Portland",
		UserMessage:  "website for my bakery",
	})

	result, err := r.Run(context.Background(), "website for my bakery")
	require.NoError(t, err)

	assert.True(t, responderCalled)
	assert.Equal(t, "Portland Sourdough", result.ProjectName)
	assert.True(t, result.AskedQuestions)
	assert.Equal(t, 2, result.Turns)
	assert.Equal(t, int64(100), result.ResponderTokens.InputTokens)
}

func TestRunnerMaxSteps(t *testing.T) {
	// Agent never calls handoff — should stop at max steps.
	mock := mockAPIFunc(func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		return makeToolUseMessage(
			toolUse("t1", "setProjectName", `{"name": "Test"}`),
		), nil
	})

	r := NewRunner(RunnerConfig{
		MaxSteps:     3,
		StopAfter:    []string{"handoff"},
		SystemPrompt: "You are a test agent.",
		APICall:      mock.Call,
	})

	result, err := r.Run(context.Background(), "test")
	require.NoError(t, err)

	assert.False(t, result.Complete)
	assert.Equal(t, 3, result.Turns)
}

// --- test helpers ---

type testToolUse struct {
	id    string
	name  string
	input string
}

func toolUse(id, name, input string) testToolUse {
	return testToolUse{id: id, name: name, input: input}
}

func makeToolUseMessage(tools ...testToolUse) *sdk.Message {
	msg := &sdk.Message{
		StopReason: sdk.MessageStopReasonToolUse,
		Usage: sdk.Usage{
			InputTokens:  1000,
			OutputTokens: 500,
		},
	}
	for _, tu := range tools {
		msg.Content = append(msg.Content, sdk.ContentBlockUnion{
			Type: "tool_use",
			// The SDK uses AsToolUse() to get the ToolUseBlock fields.
			// We need to set the fields that the runner reads.
			ID:    tu.id,
			Name:  tu.name,
			Input: json.RawMessage(tu.input),
		})
	}
	return msg
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd go-agent && go test ./internal/harness/ -run TestRunner -v`
Expected: FAIL — `NewRunner` not found

- [ ] **Step 3: Write the runner implementation**

```go
// go-agent/internal/harness/runner.go
package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
)

// APICallFunc is the function signature for making Claude API calls.
type APICallFunc func(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error)

// ResponderFunc simulates user answers to askQuestion calls.
// It receives the raw questions JSON, the persona, and the original user message.
// Returns the simulated answer text and token usage from the responder LLM call.
type ResponderFunc func(ctx context.Context, questions json.RawMessage, persona, userMessage string) (string, *TokenUsage, error)

// RunnerConfig configures the conversation runner.
type RunnerConfig struct {
	MaxSteps     int
	StopAfter    []string
	SystemPrompt string
	Model        string
	Temperature  float64
	MaxTokens    int
	Effort       string
	APICall      APICallFunc
	Responder    ResponderFunc
	Persona      string
	UserMessage  string
}

// RunResult captures the outputs of a single test run.
type RunResult struct {
	ProjectName     string
	HandoffTarget   string
	HandoffPrompt   string
	TodoList        json.RawMessage
	AskedQuestions  bool
	QuestionsAsked  []string
	Complete        bool
	Turns           int
	LatencyMs       int64
	AgentTokens     TokenUsage
	ResponderTokens TokenUsage
}

// NewRunner creates a conversation runner with the given config.
type Runner struct {
	cfg     RunnerConfig
	stopSet map[string]bool
}

func NewRunner(cfg RunnerConfig) *Runner {
	stopSet := make(map[string]bool, len(cfg.StopAfter))
	for _, name := range cfg.StopAfter {
		stopSet[name] = true
	}
	return &Runner{cfg: cfg, stopSet: stopSet}
}

// Run executes the conversation loop for a single test case.
func (r *Runner) Run(ctx context.Context, userMessage string) (*RunResult, error) {
	start := time.Now()
	result := &RunResult{}

	tools := ToolDefinitions()

	// Build system prompt blocks with cache control on all blocks.
	systemBlocks := []sdk.TextBlockParam{{
		Text:         r.cfg.SystemPrompt,
		CacheControl: sdk.NewCacheControlEphemeralParam(),
	}}

	// Build initial messages.
	messages := []sdk.MessageParam{{
		Role:    sdk.MessageParamRoleUser,
		Content: []sdk.ContentBlockParamUnion{sdk.NewTextBlock(userMessage)},
	}}

	for turn := 0; turn < r.cfg.MaxSteps; turn++ {
		// Build params.
		params := sdk.MessageNewParams{
			Model:     sdk.Model(r.cfg.Model),
			System:    systemBlocks,
			Messages:  messages,
			MaxTokens: int64(r.cfg.MaxTokens),
		}

		if r.cfg.Temperature > 0 {
			params.Temperature = sdk.Float(r.cfg.Temperature)
		}

		if r.cfg.Effort != "" {
			params.OutputConfig = sdk.OutputConfigParam{
				Effort: sdk.OutputConfigEffort(r.cfg.Effort),
			}
		}

		// Add tool definitions.
		for _, td := range tools {
			var schema map[string]any
			if err := json.Unmarshal([]byte(td.InputSchemaJSON), &schema); err != nil {
				return nil, fmt.Errorf("invalid tool schema for %s: %w", td.Name, err)
			}
			params.Tools = append(params.Tools, sdk.ToolUnionParam{
				OfTool: &sdk.ToolParam{
					Name:        td.Name,
					Description: sdk.String(td.Description),
					InputSchema: sdk.ToolInputSchemaParam{
						Properties: schema["properties"],
						Required:   toStringSlice(schema["required"]),
					},
				},
			})
		}

		// Make the API call.
		msg, err := r.cfg.APICall(ctx, params)
		if err != nil {
			return nil, fmt.Errorf("API call on turn %d: %w", turn, err)
		}

		// Track token usage.
		result.AgentTokens = result.AgentTokens.Add(TokenUsage{
			InputTokens:         msg.Usage.InputTokens,
			OutputTokens:        msg.Usage.OutputTokens,
			CacheCreationTokens: msg.Usage.CacheCreationInputTokens,
			CacheReadTokens:     msg.Usage.CacheReadInputTokens,
		})

		// Extract tool calls from response.
		var toolCalls []toolCall
		for _, block := range msg.Content {
			if block.Type == "tool_use" {
				toolCalls = append(toolCalls, toolCall{
					ID:    block.ID,
					Name:  block.Name,
					Input: block.Input,
				})
			}
		}

		result.Turns = turn + 1

		// No tool calls — end of conversation.
		if len(toolCalls) == 0 {
			result.Complete = true
			break
		}

		// Process tool calls and build response messages.
		var assistantBlocks []sdk.ContentBlockParamUnion
		var toolResultBlocks []sdk.ContentBlockParamUnion

		// Add any text from the assistant response.
		for _, block := range msg.Content {
			if block.Type == "text" {
				assistantBlocks = append(assistantBlocks, sdk.NewTextBlock(block.Text))
			}
		}

		shouldStop := false
		var askQuestionInput json.RawMessage

		for _, tc := range toolCalls {
			// Add tool_use block to assistant message.
			var inputAny any
			_ = json.Unmarshal(tc.Input, &inputAny)
			assistantBlocks = append(assistantBlocks, sdk.NewToolUseBlock(tc.ID, inputAny, tc.Name))

			// Simulate tool execution.
			toolResult := r.simulateTool(tc, result)
			toolResultBlocks = append(toolResultBlocks, sdk.NewToolResultBlock(tc.ID, toolResult, false))

			if r.stopSet[tc.Name] {
				shouldStop = true
			}
			if tc.Name == "askQuestion" {
				askQuestionInput = tc.Input
			}
		}

		// Append assistant message with tool use blocks.
		messages = append(messages, sdk.MessageParam{
			Role:    sdk.MessageParamRoleAssistant,
			Content: assistantBlocks,
		})

		// Append tool results.
		messages = append(messages, sdk.MessageParam{
			Role:    sdk.MessageParamRoleUser,
			Content: toolResultBlocks,
		})

		// Handle askQuestion: invoke responder and add user answer as a new message.
		if askQuestionInput != nil && r.cfg.Responder != nil {
			answer, respTokens, err := r.cfg.Responder(ctx, askQuestionInput, r.cfg.Persona, userMessage)
			if err != nil {
				return nil, fmt.Errorf("responder failed: %w", err)
			}
			if respTokens != nil {
				result.ResponderTokens = result.ResponderTokens.Add(*respTokens)
			}

			// Extract question texts for recording.
			var parsed struct {
				Questions []struct {
					Question string `json:"question"`
				} `json:"questions"`
			}
			_ = json.Unmarshal(askQuestionInput, &parsed)
			for _, q := range parsed.Questions {
				result.QuestionsAsked = append(result.QuestionsAsked, q.Question)
			}
			result.AskedQuestions = true

			// Add the simulated user answer as a new user message (this continues the loop).
			messages = append(messages, sdk.MessageParam{
				Role:    sdk.MessageParamRoleUser,
				Content: []sdk.ContentBlockParamUnion{sdk.NewTextBlock(answer)},
			})

			// Don't stop — askQuestion is a stop-after in production but we
			// continue by feeding the answer back.
			shouldStop = false
			continue
		}

		if shouldStop {
			result.Complete = true
			break
		}
	}

	result.LatencyMs = time.Since(start).Milliseconds()
	return result, nil
}

type toolCall struct {
	ID    string
	Name  string
	Input json.RawMessage
}

// simulateTool executes a mock tool and captures outputs in the result.
func (r *Runner) simulateTool(tc toolCall, result *RunResult) string {
	switch tc.Name {
	case "setProjectName":
		var input struct {
			Name string `json:"name"`
		}
		_ = json.Unmarshal(tc.Input, &input)
		result.ProjectName = input.Name
		return fmt.Sprintf(`{"success":true,"message":"Project name set to: %s"}`, input.Name)

	case "todoList":
		result.TodoList = tc.Input
		var input struct {
			Operation string `json:"operation"`
			Items     []any  `json:"items"`
		}
		_ = json.Unmarshal(tc.Input, &input)
		count := len(input.Items)
		return fmt.Sprintf(`{"success":true,"listId":"mock-list-1","message":"List created with %d items"}`, count)

	case "handoff":
		var input struct {
			TargetAgent string `json:"targetAgent"`
			Prompt      string `json:"prompt"`
		}
		_ = json.Unmarshal(tc.Input, &input)
		result.HandoffTarget = input.TargetAgent
		result.HandoffPrompt = input.Prompt
		return `{"success":true}`

	case "websiteRebuild":
		return `{"success":true,"message":"Website rebuild initiated"}`

	case "askQuestion":
		return `{"success":true,"widgetType":"ask-question","message":"Asked questions"}`

	default:
		return `{"success":true}`
	}
}

func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd go-agent && go test ./internal/harness/ -run TestRunner -v`
Expected: PASS (all 3 tests)

Note: The `ContentBlockUnion` fields used in the test helper (`makeToolUseMessage`) may need adjustment depending on exactly how the SDK v1.30.0 populates them. If the tests fail due to how the mock message is constructed, check the SDK's `ContentBlockUnion` struct fields and adjust `makeToolUseMessage` accordingly. The key fields the runner reads are `.Type`, `.ID`, `.Name`, `.Input`, and `.Text`.

- [ ] **Step 5: Commit**

```bash
git add go-agent/internal/harness/runner.go go-agent/internal/harness/runner_test.go
git commit -m "feat(harness): add conversation runner with tool simulation"
```

---

### Task 5: LLM Judge

**Files:**

- Create: `go-agent/internal/harness/judge.go`
- Create: `go-agent/internal/harness/judge_test.go`

- [ ] **Step 1: Write the failing test**

```go
// go-agent/internal/harness/judge_test.go
package harness

import (
	"context"
	"testing"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJudgeParseScores(t *testing.T) {
	// Mock judge API that returns a valid JSON response.
	mock := mockAPIFunc(func(_ context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
		return &sdk.Message{
			Content: []sdk.ContentBlockUnion{{
				Type: "text",
				Text: `{"scores":{"name_quality":{"score":4,"reasoning":"Good name"},"completeness":{"score":5,"reasoning":"All sections present"}}}`,
			}},
			Usage: sdk.Usage{InputTokens: 3000, OutputTokens: 200},
		}, nil
	})

	judge := NewJudge(JudgeConfig{
		APICall: mock.Call,
		Model:   "claude-sonnet-4-6-20250514",
		Criteria: []Criterion{
			{Name: "name_quality", Description: "Is the name good?", Scale: "1-5"},
			{Name: "completeness", Description: "Is it complete?", Scale: "1-5"},
		},
	})

	scores, tokens, err := judge.Evaluate(context.Background(), JudgeInput{
		UserMessage:   "Build a bakery site",
		ProjectName:   "Portland Sourdough",
		HandoffPrompt: "Build homepage with warm colors...",
	})
	require.NoError(t, err)

	assert.Len(t, scores, 2)
	assert.Equal(t, 4, scores["name_quality"].Score)
	assert.Equal(t, "Good name", scores["name_quality"].Reasoning)
	assert.Equal(t, 5, scores["completeness"].Score)
	assert.Equal(t, int64(3000), tokens.InputTokens)
	assert.Equal(t, int64(200), tokens.OutputTokens)
}

func TestJudgeHandlesInvalidJSON(t *testing.T) {
	mock := mockAPIFunc(func(_ context.Context, _ sdk.MessageNewParams) (*sdk.Message, error) {
		return &sdk.Message{
			Content: []sdk.ContentBlockUnion{{
				Type: "text",
				Text: "This is not JSON at all",
			}},
			Usage: sdk.Usage{InputTokens: 100, OutputTokens: 50},
		}, nil
	})

	judge := NewJudge(JudgeConfig{
		APICall: mock.Call,
		Model:   "claude-sonnet-4-6-20250514",
		Criteria: []Criterion{
			{Name: "quality", Description: "Is it good?", Scale: "1-5"},
		},
	})

	_, _, err := judge.Evaluate(context.Background(), JudgeInput{
		UserMessage:   "test",
		ProjectName:   "Test",
		HandoffPrompt: "test",
	})
	assert.Error(t, err)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd go-agent && go test ./internal/harness/ -run TestJudge -v`
Expected: FAIL

- [ ] **Step 3: Write the judge implementation**

````go
// go-agent/internal/harness/judge.go
package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	sdk "github.com/anthropics/anthropic-sdk-go"
)

// JudgeConfig configures the LLM judge.
type JudgeConfigRuntime struct {
	APICall  APICallFunc
	Model    string
	Criteria []Criterion
}

// JudgeInput is the data sent to the judge for evaluation.
type JudgeInput struct {
	UserMessage   string
	ProjectName   string
	HandoffPrompt string
}

// JudgeScore is a single criterion score.
type JudgeScore struct {
	Score     int    `json:"score"`
	Reasoning string `json:"reasoning"`
}

// Judge evaluates agent outputs using an LLM.
type Judge struct {
	cfg JudgeConfigRuntime
}

// NewJudge creates a new judge evaluator.
func NewJudge(cfg JudgeConfigRuntime) *Judge {
	return &Judge{cfg: cfg}
}

// Evaluate sends the agent outputs to the judge LLM and parses the scores.
// Returns a map of criterion name to score, the token usage, and any error.
func (j *Judge) Evaluate(ctx context.Context, input JudgeInput) (map[string]JudgeScore, *TokenUsage, error) {
	prompt := j.buildPrompt(input)

	params := sdk.MessageNewParams{
		Model:     sdk.Model(j.cfg.Model),
		MaxTokens: 2000,
		System:    []sdk.TextBlockParam{{Text: "You are a strict evaluator of AI agent outputs. Always respond with valid JSON only, no markdown fences."}},
		Messages: []sdk.MessageParam{{
			Role:    sdk.MessageParamRoleUser,
			Content: []sdk.ContentBlockParamUnion{sdk.NewTextBlock(prompt)},
		}},
	}

	msg, err := j.cfg.APICall(ctx, params)
	if err != nil {
		return nil, nil, fmt.Errorf("judge API call: %w", err)
	}

	tokens := &TokenUsage{
		InputTokens:         msg.Usage.InputTokens,
		OutputTokens:        msg.Usage.OutputTokens,
		CacheCreationTokens: msg.Usage.CacheCreationInputTokens,
		CacheReadTokens:     msg.Usage.CacheReadInputTokens,
	}

	// Extract text from response.
	var responseText string
	for _, block := range msg.Content {
		if block.Type == "text" {
			responseText += block.Text
		}
	}

	// Parse JSON — handle possible markdown code fences.
	responseText = strings.TrimSpace(responseText)
	responseText = strings.TrimPrefix(responseText, "```json")
	responseText = strings.TrimPrefix(responseText, "```")
	responseText = strings.TrimSuffix(responseText, "```")
	responseText = strings.TrimSpace(responseText)

	var parsed struct {
		Scores map[string]JudgeScore `json:"scores"`
	}
	if err := json.Unmarshal([]byte(responseText), &parsed); err != nil {
		return nil, tokens, fmt.Errorf("parsing judge response: %w\nraw: %s", err, responseText)
	}

	return parsed.Scores, tokens, nil
}

func (j *Judge) buildPrompt(input JudgeInput) string {
	var sb strings.Builder
	sb.WriteString("You are evaluating the output of an AI website planning agent.\n\n")
	sb.WriteString(fmt.Sprintf("User's original request: %s\n\n", input.UserMessage))
	sb.WriteString(fmt.Sprintf("Project name set by agent: %s\n\n", input.ProjectName))
	sb.WriteString("Handoff prompt generated by agent:\n---\n")
	sb.WriteString(input.HandoffPrompt)
	sb.WriteString("\n---\n\n")
	sb.WriteString("Score each criterion on a 1-5 scale. For each, provide brief reasoning (1-2 sentences) then a numeric score.\n\nCriteria:\n")
	for _, c := range j.cfg.Criteria {
		sb.WriteString(fmt.Sprintf("- %s: %s (scale: %s)\n", c.Name, c.Description, c.Scale))
	}
	sb.WriteString("\nRespond with ONLY this JSON (no markdown fences, no extra text):\n")
	sb.WriteString(`{"scores":{"criterion_name":{"score":N,"reasoning":"..."},...}}`)
	return sb.String()
}
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd go-agent && go test ./internal/harness/ -run TestJudge -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add go-agent/internal/harness/judge.go go-agent/internal/harness/judge_test.go
git commit -m "feat(harness): add LLM judge for evaluating agent outputs"
```

---

### Task 6: Report (JSON output + terminal summary)

**Files:**

- Create: `go-agent/internal/harness/report.go`
- Create: `go-agent/internal/harness/report_test.go`

- [ ] **Step 1: Write the failing test**

```go
// go-agent/internal/harness/report_test.go
package harness

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSaveResult(t *testing.T) {
	dir := t.TempDir()

	result := &FullResult{
		ConfigName:  "baseline",
		TestCaseID:  "bakery",
		RunNumber:   1,
		Model:       "claude-haiku-4-5-20251001",
		Temperature: 0.5,
		Effort:      "low",
		Turns:       3,
		LatencyMs:   3200,
		AgentTokens: TokenUsage{
			InputTokens:  4500,
			OutputTokens: 2100,
		},
		AgentCostUSD:    0.003,
		ProjectName:     "Portland Sourdough",
		HandoffPrompt:   "Build homepage...",
		Complete:        true,
	}

	err := SaveResult(dir, result)
	require.NoError(t, err)

	// Verify file was created at the right path.
	expectedPath := filepath.Join(dir, "baseline", "bakery", "1.json")
	_, err = os.Stat(expectedPath)
	require.NoError(t, err)

	// Verify content is valid JSON.
	data, err := os.ReadFile(expectedPath)
	require.NoError(t, err)

	var loaded FullResult
	require.NoError(t, json.Unmarshal(data, &loaded))
	assert.Equal(t, "Portland Sourdough", loaded.ProjectName)
	assert.Equal(t, "baseline", loaded.ConfigName)
}

func TestPrintSummary(t *testing.T) {
	results := []*FullResult{
		{
			ConfigName:   "baseline",
			TestCaseID:   "bakery",
			RunNumber:    1,
			Model:        "claude-haiku-4-5-20251001",
			Temperature:  0.5,
			Effort:       "low",
			Turns:        3,
			LatencyMs:    3200,
			AgentCostUSD: 0.003,
			ProjectName:  "Portland Sourdough",
			Complete:     true,
			JudgeScores: map[string]JudgeScore{
				"name_quality": {Score: 4, Reasoning: "Good"},
				"completeness": {Score: 5, Reasoning: "All sections"},
			},
		},
		{
			ConfigName:   "baseline",
			TestCaseID:   "saas",
			RunNumber:    1,
			Model:        "claude-haiku-4-5-20251001",
			Temperature:  0.5,
			Effort:       "low",
			Turns:        2,
			LatencyMs:    2100,
			AgentCostUSD: 0.002,
			ProjectName:  "TaskFlow",
			Complete:     true,
			JudgeScores: map[string]JudgeScore{
				"name_quality": {Score: 5, Reasoning: "Perfect"},
				"completeness": {Score: 5, Reasoning: "Complete"},
			},
		},
	}

	var buf bytes.Buffer
	PrintSummary(&buf, "baseline", results)
	output := buf.String()

	assert.Contains(t, output, "baseline")
	assert.Contains(t, output, "bakery")
	assert.Contains(t, output, "Portland Sourdough")
	assert.Contains(t, output, "TaskFlow")
	assert.Contains(t, output, "4/5")
	assert.Contains(t, output, "5/5")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd go-agent && go test ./internal/harness/ -run "TestSaveResult|TestPrintSummary" -v`
Expected: FAIL

- [ ] **Step 3: Write the report implementation**

```go
// go-agent/internal/harness/report.go
package harness

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// FullResult is the complete output of a single harness run, saved as JSON.
type FullResult struct {
	ConfigName      string                `json:"config_name"`
	TestCaseID      string                `json:"test_case_id"`
	RunNumber       int                   `json:"run_number"`
	Timestamp       time.Time             `json:"timestamp"`
	Model           string                `json:"model"`
	Temperature     float64               `json:"temperature"`
	Effort          string                `json:"effort"`
	Turns           int                   `json:"turns"`
	LatencyMs       int64                 `json:"latency_ms"`
	AgentTokens     TokenUsage            `json:"agent_tokens"`
	AgentCostUSD    float64               `json:"agent_cost_usd"`
	ResponderTokens TokenUsage            `json:"responder_tokens"`
	ResponderCostUSD float64              `json:"responder_cost_usd"`
	JudgeTokens     TokenUsage            `json:"judge_tokens"`
	JudgeCostUSD    float64               `json:"judge_cost_usd"`
	ProjectName     string                `json:"project_name"`
	AskedQuestions  bool                  `json:"asked_questions"`
	QuestionsAsked  []string              `json:"questions_asked,omitempty"`
	TodoList        json.RawMessage       `json:"todo_list,omitempty"`
	HandoffPrompt   string                `json:"handoff_prompt"`
	HandoffTarget   string                `json:"handoff_target"`
	JudgeScores     map[string]JudgeScore `json:"judge_scores,omitempty"`
	Complete        bool                  `json:"complete"`
}

// SaveResult writes a FullResult as JSON to results/harness/{config}/{testCase}/{run}.json.
func SaveResult(baseDir string, result *FullResult) error {
	dir := filepath.Join(baseDir, result.ConfigName, result.TestCaseID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating results dir: %w", err)
	}

	path := filepath.Join(dir, fmt.Sprintf("%d.json", result.RunNumber))
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling result: %w", err)
	}

	return os.WriteFile(path, data, 0644)
}

// PrintSummary prints a formatted summary table of results.
func PrintSummary(w io.Writer, configName string, results []*FullResult) {
	if len(results) == 0 {
		return
	}

	first := results[0]
	fmt.Fprintf(w, "\nExperiment: %s (%d results)\n", configName, len(results))
	fmt.Fprintf(w, "Model: %s | Temp: %.1f | Effort: %s\n\n", first.Model, first.Temperature, first.Effort)

	// Collect all criterion names from the first result that has scores.
	var criteriaNames []string
	for _, r := range results {
		if len(r.JudgeScores) > 0 {
			for name := range r.JudgeScores {
				criteriaNames = append(criteriaNames, name)
			}
			break
		}
	}

	// Build header.
	header := fmt.Sprintf(" %-20s | %7s | %7s | %-20s", "Test Case", "Latency", "Cost", "Name")
	for _, cn := range criteriaNames {
		// Truncate criterion name to 10 chars for column header.
		display := cn
		if len(display) > 10 {
			display = display[:10]
		}
		header += fmt.Sprintf(" | %10s", display)
	}
	fmt.Fprintln(w, header)
	fmt.Fprintln(w, strings.Repeat("-", len(header)))

	// Print rows.
	var totalLatency int64
	var totalCost float64
	scoreSums := make(map[string]int)
	scoreCounts := make(map[string]int)

	for _, r := range results {
		name := r.ProjectName
		if len(name) > 20 {
			name = name[:17] + "..."
		}

		row := fmt.Sprintf(" %-20s | %5.1fs  | $%.4f | %-20s",
			r.TestCaseID, float64(r.LatencyMs)/1000, r.AgentCostUSD, name)

		for _, cn := range criteriaNames {
			if score, ok := r.JudgeScores[cn]; ok {
				row += fmt.Sprintf(" | %7d/5 ", score.Score)
				scoreSums[cn] += score.Score
				scoreCounts[cn]++
			} else {
				row += fmt.Sprintf(" | %10s", "-")
			}
		}
		fmt.Fprintln(w, row)
		totalLatency += r.LatencyMs
		totalCost += r.AgentCostUSD
	}

	// Averages.
	n := len(results)
	fmt.Fprintln(w, strings.Repeat("-", len(header)))
	avg := fmt.Sprintf(" %-20s | %5.1fs  | $%.4f | %-20s",
		"Averages", float64(totalLatency)/float64(n)/1000, totalCost/float64(n), "")
	for _, cn := range criteriaNames {
		if scoreCounts[cn] > 0 {
			avgScore := float64(scoreSums[cn]) / float64(scoreCounts[cn])
			avg += fmt.Sprintf(" | %7.1f/5 ", avgScore)
		} else {
			avg += fmt.Sprintf(" | %10s", "-")
		}
	}
	fmt.Fprintln(w, avg)

	// Total cost breakdown.
	var totalResp, totalJudge float64
	for _, r := range results {
		totalResp += r.ResponderCostUSD
		totalJudge += r.JudgeCostUSD
	}
	fmt.Fprintf(w, "\nTotal cost: $%.4f (agent) + $%.4f (responder) + $%.4f (judge) = $%.4f\n",
		totalCost, totalResp, totalJudge, totalCost+totalResp+totalJudge)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd go-agent && go test ./internal/harness/ -run "TestSaveResult|TestPrintSummary" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add go-agent/internal/harness/report.go go-agent/internal/harness/report_test.go
git commit -m "feat(harness): add JSON result saving and terminal summary"
```

---

### Task 7: CLI Entry Point

**Files:**

- Create: `go-agent/cmd/harness/main.go`

This wires everything together — loads config, builds the system prompt from markdown files, creates the Anthropic client, runs experiments, judges results, saves output.

- [ ] **Step 1: Write the main.go**

```go
// go-agent/cmd/harness/main.go
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/joho/godotenv"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/harness"
)

func main() {
	// Load .env file if present (same pattern as cmd/agent).
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("warning: loading .env: %v", err)
	}

	caseFilter := flag.String("case", "", "Run only this test case ID")
	runsOverride := flag.Int("runs", 0, "Override runs_per_case from config")
	resultsDir := flag.String("results", "results/harness", "Base directory for results")
	flag.Parse()

	configPaths := flag.Args()
	if len(configPaths) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: harness [flags] <config1.yaml> [config2.yaml ...]")
		flag.PrintDefaults()
		os.Exit(1)
	}

	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		log.Fatal("ANTHROPIC_API_KEY environment variable is required (set in environment or .env file)")
	}

	client := sdk.NewClient(option.WithAPIKey(apiKey))

	for _, cfgPath := range configPaths {
		if err := runExperiment(client, cfgPath, *caseFilter, *runsOverride, *resultsDir); err != nil {
			log.Fatalf("experiment %s failed: %v", cfgPath, err)
		}
	}
}

func runExperiment(client sdk.Client, cfgPath, caseFilter string, runsOverride int, resultsDir string) error {
	cfg, err := harness.LoadConfig(cfgPath)
	if err != nil {
		return err
	}

	fmt.Printf("Running experiment: %s (%s)\n", cfg.Name, cfg.Description)

	// Build system prompt from markdown files.
	systemPrompt, err := buildSystemPrompt(cfg)
	if err != nil {
		return fmt.Errorf("building system prompt: %w", err)
	}
	fmt.Printf("System prompt: %d chars from %d files\n", len(systemPrompt), len(cfg.PromptFiles))

	runsPerCase := cfg.RunsPerCase
	if runsOverride > 0 {
		runsPerCase = runsOverride
	}

	// Filter test cases if -case flag is set.
	testCases := cfg.TestCases
	if caseFilter != "" {
		var filtered []harness.TestCase
		for _, tc := range testCases {
			if tc.ID == caseFilter {
				filtered = append(filtered, tc)
			}
		}
		if len(filtered) == 0 {
			return fmt.Errorf("test case %q not found", caseFilter)
		}
		testCases = filtered
	}

	apiCall := func(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
		return client.Messages.New(ctx, params)
	}

	// Build responder function.
	responder := func(ctx context.Context, questions json.RawMessage, persona, userMsg string) (string, *harness.TokenUsage, error) {
		return callResponder(ctx, apiCall, cfg.Responder.Model, questions, persona, userMsg)
	}

	// Build judge.
	judge := harness.NewJudge(harness.JudgeConfigRuntime{
		APICall:  apiCall,
		Model:    cfg.Judge.Model,
		Criteria: cfg.Judge.Criteria,
	})

	var allResults []*harness.FullResult

	for _, tc := range testCases {
		for run := 1; run <= runsPerCase; run++ {
			fmt.Printf("  [%s] run %d/%d... ", tc.ID, run, runsPerCase)

			runner := harness.NewRunner(harness.RunnerConfig{
				MaxSteps:     cfg.MaxSteps,
				StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
				SystemPrompt: systemPrompt,
				Model:        cfg.Model,
				Temperature:  cfg.Temperature,
				MaxTokens:    cfg.MaxOutputTokens,
				Effort:       cfg.Effort,
				APICall:      apiCall,
				Responder:    responder,
				Persona:      tc.Persona,
				UserMessage:  tc.UserMessage,
			})

			result, err := runner.Run(context.Background(), tc.UserMessage)
			if err != nil {
				fmt.Printf("FAILED: %v\n", err)
				continue
			}

			fmt.Printf("name=%q turns=%d latency=%dms ", result.ProjectName, result.Turns, result.LatencyMs)

			// Run judge.
			var judgeScores map[string]harness.JudgeScore
			var judgeTokens *harness.TokenUsage
			if result.HandoffPrompt != "" {
				judgeScores, judgeTokens, err = judge.Evaluate(context.Background(), harness.JudgeInput{
					UserMessage:   tc.UserMessage,
					ProjectName:   result.ProjectName,
					HandoffPrompt: result.HandoffPrompt,
				})
				if err != nil {
					fmt.Printf("(judge failed: %v) ", err)
				}
			}

			// Build full result.
			agentCost := harness.CalculateCost(cfg.Model, result.AgentTokens)
			respCost := harness.CalculateCost(cfg.Responder.Model, result.ResponderTokens)

			full := &harness.FullResult{
				ConfigName:       cfg.Name,
				TestCaseID:       tc.ID,
				RunNumber:        run,
				Timestamp:        time.Now().UTC(),
				Model:            cfg.Model,
				Temperature:      cfg.Temperature,
				Effort:           cfg.Effort,
				Turns:            result.Turns,
				LatencyMs:        result.LatencyMs,
				AgentTokens:      result.AgentTokens,
				AgentCostUSD:     agentCost.Total(),
				ResponderTokens:  result.ResponderTokens,
				ResponderCostUSD: respCost.Total(),
				ProjectName:      result.ProjectName,
				AskedQuestions:   result.AskedQuestions,
				QuestionsAsked:   result.QuestionsAsked,
				TodoList:         result.TodoList,
				HandoffPrompt:    result.HandoffPrompt,
				HandoffTarget:    result.HandoffTarget,
				JudgeScores:      judgeScores,
				Complete:         result.Complete,
			}

			if judgeTokens != nil {
				judgeCost := harness.CalculateCost(cfg.Judge.Model, *judgeTokens)
				full.JudgeTokens = *judgeTokens
				full.JudgeCostUSD = judgeCost.Total()
			}

			// Save result.
			if err := harness.SaveResult(resultsDir, full); err != nil {
				fmt.Printf("(save failed: %v) ", err)
			}

			// Print scores inline.
			if judgeScores != nil {
				for name, score := range judgeScores {
					fmt.Printf("%s=%d/5 ", name, score.Score)
				}
			}
			fmt.Println()

			allResults = append(allResults, full)
		}
	}

	// Print summary table.
	harness.PrintSummary(os.Stdout, cfg.Name, allResults)
	fmt.Printf("Results saved to: %s/%s/\n", resultsDir, cfg.Name)

	return nil
}

// buildSystemPrompt reads and concatenates markdown files listed in the config.
func buildSystemPrompt(cfg *harness.Config) (string, error) {
	var parts []string
	for _, pf := range cfg.PromptFiles {
		resolved := cfg.ResolvePromptPath(pf)
		data, err := os.ReadFile(resolved)
		if err != nil {
			return "", fmt.Errorf("reading prompt file %s (resolved: %s): %w", pf, resolved, err)
		}
		parts = append(parts, string(data))
	}
	return strings.Join(parts, "\n\n"), nil
}

// callResponder uses an LLM to simulate user answers to askQuestion.
func callResponder(
	ctx context.Context,
	apiCall harness.APICallFunc,
	model string,
	questionsJSON json.RawMessage,
	persona, userMessage string,
) (string, *harness.TokenUsage, error) {
	// Build a readable question list from the JSON.
	var questionList strings.Builder
	var parsed struct {
		Questions []struct {
			Question    string `json:"question"`
			Suggestions []any  `json:"suggestions"`
		} `json:"questions"`
	}
	if err := json.Unmarshal(questionsJSON, &parsed); err == nil {
		for i, q := range parsed.Questions {
			questionList.WriteString(fmt.Sprintf("\n%d. %s\n", i+1, q.Question))
			if len(q.Suggestions) > 0 {
				questionList.WriteString("   Suggestions: ")
				for j, s := range q.Suggestions {
					if j > 0 {
						questionList.WriteString(", ")
					}
					questionList.WriteString(fmt.Sprintf("%v", s))
				}
				questionList.WriteString("\n")
			}
		}
	} else {
		questionList.WriteString(string(questionsJSON))
	}

	system := fmt.Sprintf(`You are a potential customer being asked questions about a website you want built.
Your persona: %s
Your original request: %s

Answer each question concisely. Pick from the suggestions when they fit your persona, otherwise provide a custom answer. Format your answers clearly, one per question.`, persona, userMessage)

	params := sdk.MessageNewParams{
		Model:     sdk.Model(model),
		MaxTokens: 1000,
		System:    []sdk.TextBlockParam{{Text: system}},
		Messages: []sdk.MessageParam{{
			Role:    sdk.MessageParamRoleUser,
			Content: []sdk.ContentBlockParamUnion{sdk.NewTextBlock("Please answer these questions:" + questionList.String())},
		}},
	}

	msg, err := apiCall(ctx, params)
	if err != nil {
		return "", nil, err
	}

	tokens := &harness.TokenUsage{
		InputTokens:  msg.Usage.InputTokens,
		OutputTokens: msg.Usage.OutputTokens,
	}

	var answer string
	for _, block := range msg.Content {
		if block.Type == "text" {
			answer += block.Text
		}
	}

	return answer, tokens, nil
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd go-agent && go build ./cmd/harness/`
Expected: Compiles without errors

- [ ] **Step 3: Run a quick smoke test with the baseline config**

Run: `cd go-agent && ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY go run ./cmd/harness -case bakery-brief configs/harness/baseline.yaml`

Expected: Runs the bakery-brief test case, prints results. Verify:

- Project name is set (non-empty)
- Handoff prompt contains design direction
- Judge scores are printed
- JSON result saved to `results/harness/baseline/bakery-brief/1.json`

- [ ] **Step 4: Fix any issues found during smoke test**

Adjust code based on any SDK type mismatches, JSON parsing errors, or API errors discovered during the real run.

- [ ] **Step 5: Commit**

```bash
git add go-agent/cmd/harness/main.go
git commit -m "feat(harness): add CLI entry point wiring config, runner, judge, and report"
```

---

### Task 8: Integration Smoke Test

**Files:**

- No new files — this validates everything works end-to-end

- [ ] **Step 1: Run full baseline experiment**

```bash
cd go-agent && ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY go run ./cmd/harness configs/harness/baseline.yaml
```

Expected: All 5 test cases run, each producing:

- A project name
- A handoff prompt
- Judge scores for all 4 criteria
- JSON result files

- [ ] **Step 2: Verify result JSON files**

```bash
ls -la go-agent/results/harness/baseline/*/
cat go-agent/results/harness/baseline/bakery-brief/1.json | python3 -m json.tool | head -30
```

Verify the JSON structure matches the spec.

- [ ] **Step 3: Run all tests**

```bash
cd go-agent && go test ./internal/harness/ -v
```

Expected: All tests pass.

- [ ] **Step 4: Final commit with any fixes**

```bash
git add -A go-agent/
git commit -m "feat(harness): complete initial agent test harness"
```
