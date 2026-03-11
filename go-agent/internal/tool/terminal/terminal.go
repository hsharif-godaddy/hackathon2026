package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

const defaultTimeoutSec = 30

// Command implements the terminalCommand tool via the dev-supervisor API.
type Command struct {
	factory *supervisor.ClientFactory
}

// NewCommand creates a terminalCommand tool that resolves the supervisor client
// per-request from context via the factory.
func NewCommand(factory *supervisor.ClientFactory) *Command {
	return &Command{factory: factory}
}

func (*Command) Name() string        { return "terminalCommand" }
func (*Command) Description() string { return "Execute a shell command" }
func (*Command) InputSchema() json.RawMessage {
	return json.RawMessage(`{
	"type": "object",
	"properties": {
		"command": {"type": "string", "description": "The command to execute"},
		"workingDir": {"type": "string", "description": "Working directory relative to app root"},
		"timeout": {"type": "integer", "minimum": 100, "description": "Timeout in milliseconds"}
	},
	"required": ["command"]
}`)
}

type terminalInput struct {
	Cmd        string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Timeout    int    `json:"timeout"`
}

func (tc *Command) Execute(ctx context.Context, input json.RawMessage, out tool.OutputStream) error {
	var in terminalInput
	if err := json.Unmarshal(input, &in); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}
	if in.Cmd == "" {
		return errors.New("command is required")
	}

	scope, err := tool.ScopeFrom(ctx)
	if err != nil {
		return err
	}

	timeoutSec := defaultTimeoutSec
	if in.Timeout > 0 {
		timeoutSec = max(in.Timeout/1000, 1)
	}

	workDir := scope.AppRoot
	if in.WorkingDir != "" {
		resolved, pathErr := tool.ValidatePath(scope.AppRoot, in.WorkingDir)
		if pathErr != nil {
			return pathErr
		}
		workDir = resolved
	}

	client, clientErr := tc.factory.Get(scope.SupervisorAddr)
	if clientErr != nil {
		return fmt.Errorf("supervisor client: %w", clientErr)
	}
	result, err := client.Exec(ctx, supervisor.ExecRequest{
		Command:    in.Cmd,
		Timeout:    timeoutSec,
		WorkingDir: workDir,
	})
	if err != nil {
		return fmt.Errorf("supervisor exec failed: %w", err)
	}

	if result.Stdout != "" {
		out.Write(result.Stdout)
	}
	if result.Stderr != "" {
		out.WriteError(result.Stderr)
	}

	if result.TimedOut {
		return fmt.Errorf("command timed out after %ds", timeoutSec)
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("command failed with exit code %d", result.ExitCode)
	}

	return nil
}
