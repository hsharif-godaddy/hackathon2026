package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	tea "charm.land/bubbletea/v2"

	"github.com/airo-ai-builder/cli-agent-client/internal/client"
	"github.com/airo-ai-builder/cli-agent-client/internal/renderer"
	"github.com/airo-ai-builder/cli-agent-client/internal/tui"
)

func main() {
	url := flag.String("url", "ws://localhost:4000/ws", "go-agent WebSocket endpoint")
	appID := flag.String("app-id", "", "application ID (ignored by default local server; used when server supports multi-tenant auth)")
	conversationID := flag.String("conversation-id", "", "resume existing conversation")
	agentID := flag.String("agent-id", "develop", "agent to use")
	flag.Parse()

	// Create renderer registry with built-in renderers
	reg := renderer.NewRegistry()
	reg.Register("readFile", &renderer.FileReadRenderer{})
	reg.Register("str_replace_based_edit_tool", &renderer.FileEditRenderer{})
	reg.Register("grepSearch", &renderer.GrepRenderer{})
	reg.Register("directoryListing", &renderer.DirectoryRenderer{})

	// Create WebSocket client
	wsClient := client.NewWSClient(*url, *appID, *agentID, *conversationID)

	// Create TUI model
	model := tui.NewModel(wsClient, reg)

	// Create Bubble Tea program
	p := tea.NewProgram(model)

	// Connect WebSocket in background — pass program for message dispatching
	ctx := context.Background()
	if err := wsClient.Connect(ctx, p); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer wsClient.Close()

	// Send initial connect message
	if err := wsClient.SendConnect(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to send connect: %v\n", err)
		os.Exit(1)
	}

	// Run TUI
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
