package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDevelopAgent_HasExpectedID(t *testing.T) {
	cfg := DevelopAgent()
	assert.Equal(t, "develop", cfg.ID)
}

func TestDevelopAgent_HasModel(t *testing.T) {
	cfg := DevelopAgent()
	assert.Equal(t, "claude-sonnet-4-6", cfg.Model)
}

func TestDevelopAgent_HasCoreTools(t *testing.T) {
	cfg := DevelopAgent()

	coreTools := []string{
		"readFile",
		"str_replace_based_edit_tool",
		"directoryListing",
		"terminalCommand",
		"grepSearch",
		"suggestedResponse",
		"skill",
	}

	for _, tool := range coreTools {
		assert.Contains(t, cfg.Tools, tool, "missing core tool: %s", tool)
	}
}

func TestDevelopAgent_HasPromptConfig(t *testing.T) {
	cfg := DevelopAgent()
	assert.Equal(t, "develop/core.md", cfg.PromptConfig.BasePrompt)
	assert.NotEmpty(t, cfg.PromptConfig.Fragments)

	// Verify key fragments are present.
	assert.Contains(t, cfg.PromptConfig.Fragments, "shared/security.md")
	assert.Contains(t, cfg.PromptConfig.Fragments, "shared/filesystem.md")
	assert.Contains(t, cfg.PromptConfig.Fragments, "shared/communication.md")
}

func TestDevelopAgent_StopAfterSuggestedResponse(t *testing.T) {
	cfg := DevelopAgent()
	assert.Equal(t, []string{"suggestedResponse"}, cfg.StopAfter)
}

func TestAllAgents_ContainsDevelop(t *testing.T) {
	agents := AllAgents()
	require.Contains(t, agents, "develop")
	assert.Equal(t, "develop", agents["develop"].ID)
}

func TestAllAgents_NoEmptyIDs(t *testing.T) {
	for id, cfg := range AllAgents() {
		assert.Equal(t, id, cfg.ID, "agent map key should match config ID")
		assert.NotEmpty(t, cfg.Model, "agent %s has no model", id)
		assert.NotEmpty(t, cfg.Tools, "agent %s has no tools", id)
	}
}
