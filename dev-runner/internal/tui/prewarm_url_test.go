package tui

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

func TestAppBaseURL(t *testing.T) {
	cfg := &config.Config{Processes: []config.ProcessConfig{
		{Name: "App", HealthCheck: &config.HealthCheck{URL: "https://local.gasket.dev-godaddy.com:8443/api/health", UnhealthyInterval: time.Second}},
	}}
	if got := appBaseURL(cfg); got != "https://local.gasket.dev-godaddy.com:8443" {
		t.Errorf("appBaseURL = %q, want scheme+host", got)
	}
}

func TestAppBaseURLDefault(t *testing.T) {
	cfg := &config.Config{Processes: []config.ProcessConfig{{Name: "Other"}}}
	if got := appBaseURL(cfg); got != "https://local.gasket.dev-godaddy.com:8443" {
		t.Errorf("appBaseURL default = %q", got)
	}
}
