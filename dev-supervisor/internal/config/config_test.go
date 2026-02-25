package config_test

import (
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
