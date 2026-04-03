package tui

import (
	"context"
	"testing"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/pipeline"
)

func TestExtractVersion(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "gh version output",
			input: "gh version 2.87.0 (2026-03-15)",
			want:  "2.87.0",
		},
		{
			name:  "just version number",
			input: "2.87.0",
			want:  "2.87.0",
		},
		{
			name:  "version with v prefix",
			input: "v1.2.3",
			want:  "1.2.3",
		},
		{
			name:  "version at end",
			input: "version 3.0.1",
			want:  "3.0.1",
		},
		{
			name:  "no version number",
			input: "no numbers here",
			want:  "no numbers here",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
		{
			name:  "version with trailing text",
			input: "gh version 2.87.0-beta (build abc123)",
			want:  "2.87.0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractVersion(tt.input); got != tt.want {
				t.Errorf("extractVersion(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsVersionSufficient(t *testing.T) {
	tests := []struct {
		name       string
		versionStr string
		major      int
		minor      int
		patch      int
		want       bool
	}{
		{
			name:       "exact match",
			versionStr: "gh version 2.87.0 (2026-03-15)",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "higher patch",
			versionStr: "gh version 2.87.5",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "higher minor",
			versionStr: "gh version 2.90.0",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "higher major",
			versionStr: "gh version 3.0.0",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "lower patch",
			versionStr: "gh version 2.86.9",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "lower minor",
			versionStr: "gh version 2.80.0",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "lower major",
			versionStr: "gh version 1.99.99",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "just numbers",
			versionStr: "2.87.0",
			major:      2, minor: 87, patch: 0,
			want: true,
		},
		{
			name:       "invalid version string",
			versionStr: "not a version",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "empty string",
			versionStr: "",
			major:      2, minor: 87, patch: 0,
			want: false,
		},
		{
			name:       "exact patch boundary",
			versionStr: "2.87.1",
			major:      2, minor: 87, patch: 1,
			want: true,
		},
		{
			name:       "below patch boundary",
			versionStr: "2.87.0",
			major:      2, minor: 87, patch: 1,
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isVersionSufficient(tt.versionStr, tt.major, tt.minor, tt.patch); got != tt.want {
				t.Errorf("isVersionSufficient(%q, %d, %d, %d) = %v, want %v",
					tt.versionStr, tt.major, tt.minor, tt.patch, got, tt.want)
			}
		})
	}
}

func TestHandleGroupCompleteDuplicateIsNoop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := &config.Config{
		Pipeline: config.PipelineConfig{
			Environments: map[string]*config.EnvironmentConfig{
				"test": {Stages: []config.Stage{{ID: "a"}, {ID: "b"}}},
			},
		},
	}

	m := Model{
		config:          cfg,
		pipeline:        pipeline.New(cfg, nil, true, "main", nil),
		ctx:             ctx,
		cancel:          cancel,
		phase:           phaseRunning,
		envOrder:        []string{"test"},
		currentEnvIdx:   0,
		envGroups:       [][]int{{0, 1}, {2, 3}},
		currentGroupIdx: 0,
		fv:              &formValues{},
	}

	// First groupCompleteMsg for group 0 should advance to group 1.
	result, _ := m.handleGroupComplete(groupCompleteMsg{env: "test", group: 0})
	m = result.(Model)

	if m.currentGroupIdx != 1 {
		t.Fatalf("after first msg: currentGroupIdx = %d, want 1", m.currentGroupIdx)
	}

	// Duplicate groupCompleteMsg for group 0 should be ignored.
	result, cmd := m.handleGroupComplete(groupCompleteMsg{env: "test", group: 0})
	m = result.(Model)

	if m.currentGroupIdx != 1 {
		t.Fatalf("after duplicate msg: currentGroupIdx = %d, want 1", m.currentGroupIdx)
	}
	if cmd != nil {
		t.Fatalf("duplicate msg should return nil cmd, got %v", cmd)
	}
}

func TestHandleRollbackGroupDoneDuplicateIsNoop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	m := Model{
		ctx:              ctx,
		cancel:           cancel,
		phase:            phaseRollbackRunning,
		rollbackGroups:   [][]int{{0}, {1}},
		rollbackGroupIdx: 0,
		fv:               &formValues{},
	}

	// First rollbackGroupDoneMsg for group 0 should advance to group 1.
	result, _ := m.handleRollbackGroupDone(rollbackGroupDoneMsg{group: 0})
	m = result.(Model)

	if m.rollbackGroupIdx != 1 {
		t.Fatalf("after first msg: rollbackGroupIdx = %d, want 1", m.rollbackGroupIdx)
	}

	// Duplicate rollbackGroupDoneMsg for group 0 should be ignored.
	result, cmd := m.handleRollbackGroupDone(rollbackGroupDoneMsg{group: 0})
	m = result.(Model)

	if m.rollbackGroupIdx != 1 {
		t.Fatalf("after duplicate msg: rollbackGroupIdx = %d, want 1", m.rollbackGroupIdx)
	}
	if cmd != nil {
		t.Fatalf("duplicate msg should return nil cmd, got %v", cmd)
	}
}
