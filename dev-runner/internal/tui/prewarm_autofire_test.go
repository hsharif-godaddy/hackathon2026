package tui

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/config"
)

func healthyModel(t *testing.T) Model {
	t.Helper()
	cfg := &config.Config{Processes: []config.ProcessConfig{
		{Name: "App", Command: "x", Dir: ".", HealthCheck: &config.HealthCheck{URL: "https://h/health", UnhealthyInterval: time.Second}},
		{Name: "Agents", Command: "x", Dir: ".", HealthCheck: &config.HealthCheck{URL: "http://h2/health", UnhealthyInterval: time.Second}},
	}}
	return NewModel(cfg, ".", false, false, false, nil)
}

func TestAllHealthCheckedHealthy(t *testing.T) {
	m := healthyModel(t)
	if m.allHealthCheckedHealthy() {
		t.Error("expected not-all-healthy before any health results")
	}
	yes := true
	for i := range m.manager.Processes {
		m.manager.Processes[i].Healthy = &yes
	}
	if !m.allHealthCheckedHealthy() {
		t.Error("expected all-healthy once every process is healthy")
	}
}
