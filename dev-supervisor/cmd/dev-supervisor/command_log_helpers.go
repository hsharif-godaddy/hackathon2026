package main

import (
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/logs"
)

const commandLogPreviewLength = 120

var commandWhitespaceReplacer = strings.NewReplacer("\n", " ", "\r", " ", "\t", " ")

func commandLogPreview(command string) string {
	if command == "" {
		return ""
	}

	normalized := commandWhitespaceReplacer.Replace(strings.TrimSpace(command))
	normalized = strings.Join(strings.Fields(normalized), " ")

	runes := []rune(normalized)
	if len(runes) <= commandLogPreviewLength {
		return normalized
	}

	return string(runes[:commandLogPreviewLength]) + "…"
}

// truncate returns s truncated to maxLen runes with an ellipsis suffix.
// Rune-safe so multi-byte UTF-8 characters aren't bisected.
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}

// Per-command caps for /exec output teed into the ring buffer. Prevents one
// chatty command (e.g. `pnpm install` producing thousands of lines) from
// evicting the managed process's own output.
const (
	maxExecLogLines     = 1000
	maxExecLogLineBytes = 4096
)

// execLogSource is the Source value stamped on every ring-buffer entry
// mirrored from /exec. Distinct from the managed process's "stdout"/"stderr"
// so consumers of GET /logs can filter orchestration output in or out — in
// particular, the agents service's CustomerLogsService defaults to omitting
// this source from customer-facing views.
const execLogSource = "exec"

// recordExecOutput mirrors the stdout and stderr of a completed /exec
// command into the ring buffer so /exec commands are observable via
// GET /logs just like the long-running managed child. Both streams land
// under Source="exec" — a single GET /logs?source=exec&command_id=N
// retrieves everything for the command. The HTTP response body remains
// the authoritative copy.
func (s *Server) recordExecOutput(result *CommandResult, cmdID uint64) {
	if s == nil || s.logMgr == nil || result == nil {
		return
	}
	addExecLines(s.logMgr, result.Stdout, cmdID)
	addExecLines(s.logMgr, result.Stderr, cmdID)
}

func addExecLines(logMgr *logs.Manager, raw string, cmdID uint64) {
	if raw == "" {
		return
	}
	lines := strings.Split(strings.TrimRight(raw, "\n"), "\n")
	// Tail-keep: failure signals (non-zero exit messages, error summaries,
	// stack traces) cluster at the end of a command's output, so head-
	// truncation preserves what consumers actually need when triaging.
	if len(lines) > maxExecLogLines {
		lines = lines[len(lines)-maxExecLogLines:]
	}
	ts := time.Now()
	for _, line := range lines {
		if len(line) > maxExecLogLineBytes {
			line = line[:maxExecLogLineBytes] + "…"
		}
		logMgr.AddLog(logs.LogEntry{
			Timestamp: ts,
			Source:    execLogSource,
			Message:   line,
			CommandID: cmdID,
		})
	}
}
