package config_test

import (
	"os"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

func TestLoadConfig_SetupScript_PreviewTask(t *testing.T) {
	tests := []struct {
		name            string
		taskName        string
		envSetupScript  string
		wantSetupScript string
	}{
		{
			name:            "preview task gets default setup script",
			taskName:        "preview",
			wantSetupScript: config.DefaultPreviewSetupScript,
		},
		{
			name:            "non-preview task gets empty setup script",
			taskName:        "publish",
			wantSetupScript: "",
		},
		{
			name:            "empty task name gets empty setup script",
			taskName:        "",
			wantSetupScript: "",
		},
		{
			name:            "preview task with explicit env override",
			taskName:        "preview",
			envSetupScript:  "/custom/setup.sh",
			wantSetupScript: "/custom/setup.sh",
		},
		{
			name:            "non-preview task with explicit env override",
			taskName:        "publish",
			envSetupScript:  "/custom/setup.sh",
			wantSetupScript: "/custom/setup.sh",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("NOMAD_TASK_NAME", tt.taskName)
			if tt.envSetupScript != "" {
				t.Setenv("DEV_SUPERVISOR_SETUP_SCRIPT", tt.envSetupScript)
			}

			cfg := config.LoadConfig()

			if cfg.SetupScript != tt.wantSetupScript {
				t.Errorf("SetupScript = %q, want %q", cfg.SetupScript, tt.wantSetupScript)
			}
		})
	}
}

func TestLoadConfig_AiroPreviewEnvVar(t *testing.T) {
	tests := []struct {
		name     string
		taskName string
		wantSet  bool
	}{
		{
			name:     "set for preview task",
			taskName: "preview",
			wantSet:  true,
		},
		{
			name:     "not set for publish task",
			taskName: "publish",
			wantSet:  false,
		},
		{
			name:     "not set for empty task name",
			taskName: "",
			wantSet:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("NOMAD_TASK_NAME", tt.taskName)
			// Clear AIRO_PREVIEW before each test so previous runs don't leak
			t.Setenv("AIRO_PREVIEW", "")

			config.LoadConfig()

			got := os.Getenv("AIRO_PREVIEW")
			if tt.wantSet && got != "true" {
				t.Errorf("AIRO_PREVIEW = %q, want %q", got, "true")
			}
			if !tt.wantSet && got == "true" {
				t.Errorf("AIRO_PREVIEW = %q, want empty or unset", got)
			}
		})
	}
}

func TestLoadConfig_StartOnRequest_DisabledForNonPreview(t *testing.T) {
	tests := []struct {
		name     string
		taskName string
		wantSOR  bool
	}{
		{
			name:     "enabled for preview task",
			taskName: "preview",
			wantSOR:  true,
		},
		{
			name:     "disabled for publish task",
			taskName: "publish",
			wantSOR:  false,
		},
		{
			name:     "disabled for empty task name",
			taskName: "",
			wantSOR:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("NOMAD_TASK_NAME", tt.taskName)
			t.Setenv("DEV_SUPERVISOR_ENABLE_START_ON_REQUEST", "true")

			cfg := config.LoadConfig()

			if cfg.StartOnRequestEnabled != tt.wantSOR {
				t.Errorf("StartOnRequestEnabled = %v, want %v", cfg.StartOnRequestEnabled, tt.wantSOR)
			}
		})
	}
}
