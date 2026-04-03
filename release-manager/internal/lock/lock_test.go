package lock

import (
	"context"
	"encoding/json"
	"os/exec"
	"testing"
	"time"
)

func TestInfoMarshalRoundTrip(t *testing.T) {
	original := Info{
		Operator:  "testuser",
		Branch:    "main",
		StartedAt: time.Now().UTC().Truncate(time.Second),
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}

	var parsed Info
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}

	if parsed.Operator != original.Operator {
		t.Errorf("Operator = %q, want %q", parsed.Operator, original.Operator)
	}
	if parsed.Branch != original.Branch {
		t.Errorf("Branch = %q, want %q", parsed.Branch, original.Branch)
	}
	if !parsed.StartedAt.Equal(original.StartedAt) {
		t.Errorf("StartedAt = %v, want %v", parsed.StartedAt, original.StartedAt)
	}
}

func TestInfoMarshalFormat(t *testing.T) {
	info := Info{
		Operator:  "matkinson",
		Branch:    "feature-branch",
		StartedAt: time.Date(2026, 4, 2, 13, 0, 0, 0, time.UTC),
	}

	data, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("Marshal() error: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Unmarshal() error: %v", err)
	}

	if raw["operator"] != "matkinson" {
		t.Errorf("operator = %v, want %q", raw["operator"], "matkinson")
	}
	if raw["branch"] != "feature-branch" {
		t.Errorf("branch = %v, want %q", raw["branch"], "feature-branch")
	}
	if _, ok := raw["started_at"]; !ok {
		t.Error("started_at field missing from JSON")
	}
}

func skipWithoutAWS(t *testing.T) {
	t.Helper()
	if err := exec.Command("aws", "--version").Run(); err != nil {
		t.Skip("aws CLI not available")
	}
}

func TestCheckParameterNotFound(t *testing.T) {
	skipWithoutAWS(t)

	info, err := Check(context.Background(), "/nonexistent/test/parameter-12345", "")
	if err != nil {
		t.Skipf("skipping (AWS credentials not configured): %v", err)
	}
	if info != nil {
		t.Errorf("expected nil info for nonexistent parameter, got %+v", info)
	}
}

func TestReleaseNonexistentParameter(t *testing.T) {
	skipWithoutAWS(t)

	Release(context.Background(), "/nonexistent/test/parameter-12345", "")
}
