package agent

import (
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/prompt"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/run"
)

// DevelopAgent returns the agent config for the AI Developer agent.
// This matches the TS agent's develop-agent.ts configuration.
func DevelopAgent() run.AgentConfig {
	return run.AgentConfig{
		ID:    "develop",
		Model: "claude-sonnet-4-6",
		PromptConfig: prompt.Config{
			BasePrompt: "develop/core.md",
			Fragments: []string{
				"develop/claude-behavior.md",
				"develop/font-theme.md",
				"develop/handoff.md",
				"develop/backend.md",
				"develop/secrets.md",
				"shared/communication.md",
				"shared/filesystem.md",
				"shared/publishing.md",
				"shared/security.md",
			},
		},
		Tools: []string{
			"directoryListing",
			"terminalCommand",
			"str_replace_based_edit_tool",
			"readFile",
			"grepSearch",
			"todoList",
			"setProjectName",
			"skill",
			"serverRestart",
			"viewLogs",
			"publishClient",
			"publishStatus",
			"media",
			"qrCode",
			"websiteScraper",
			"colorScheme",
			"fontTheme",
			"rebuildPageSelector",
			"suggestedResponse",
			"requestSecrets",
			"oauthConnect",
			"domainPurchase",
		},
		StopAfter: []string{"suggestedResponse"},
	}
}

// AllAgents returns all agent configs keyed by agent ID.
func AllAgents() map[string]run.AgentConfig {
	agents := make(map[string]run.AgentConfig)
	for _, cfg := range []run.AgentConfig{DevelopAgent()} {
		agents[cfg.ID] = cfg
	}
	return agents
}
