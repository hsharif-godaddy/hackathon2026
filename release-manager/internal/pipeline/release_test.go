package pipeline

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/config"
	"github.com/airo-ai-builder/release-manager/internal/gh"
)

func releaseConfig() *config.Config {
	cfg := testConfig()
	cfg.Release = config.ReleaseConfig{
		Repo:    "org/repo",
		Enabled: true,
	}
	return cfg
}

func TestGenerateReleaseTagNoExisting(t *testing.T) {
	runner := &mockRunner{}
	p := New(releaseConfig(), runner, false, "main", nil)

	tag, err := p.GenerateReleaseTag(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	today := time.Now().Format("2006.01.02")
	want := "v" + today + ".1"
	if tag != want {
		t.Errorf("got %q, want %q", tag, want)
	}
}

func TestGenerateReleaseTagIncrementsExisting(t *testing.T) {
	today := time.Now().Format("2006.01.02")
	runner := &mockRunner{
		listReleasesFn: func(_ context.Context, _ string, _ int) ([]gh.ReleaseEntry, error) {
			return []gh.ReleaseEntry{
				{TagName: "v" + today + ".3"},
				{TagName: "v" + today + ".1"},
				{TagName: "v" + today + ".2"},
			}, nil
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)

	tag, err := p.GenerateReleaseTag(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if tag != "v"+today+".4" {
		t.Errorf("got %q, want %q", tag, "v"+today+".4")
	}
}

func TestGenerateReleaseTagIgnoresOtherDates(t *testing.T) {
	runner := &mockRunner{
		listReleasesFn: func(_ context.Context, _ string, _ int) ([]gh.ReleaseEntry, error) {
			return []gh.ReleaseEntry{
				{TagName: "v2025.01.01.5"},
				{TagName: "v2025.12.31.10"},
				{TagName: "not-a-version-tag"},
			}, nil
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)

	tag, err := p.GenerateReleaseTag(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	today := time.Now().Format("2006.01.02")
	if tag != "v"+today+".1" {
		t.Errorf("got %q, want %q", tag, "v"+today+".1")
	}
}

func TestGenerateReleaseTagListError(t *testing.T) {
	runner := &mockRunner{
		listReleasesFn: func(_ context.Context, _ string, _ int) ([]gh.ReleaseEntry, error) {
			return nil, fmt.Errorf("network error")
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)

	tag, err := p.GenerateReleaseTag(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	today := time.Now().Format("2006.01.02")
	if tag != "v"+today+".1" {
		t.Errorf("got %q, want %q (should default to .1 on error)", tag, "v"+today+".1")
	}
}

func TestCreateReleaseUsesExtHash(t *testing.T) {
	var capturedTarget string
	runner := &mockRunner{
		createReleaseFn: func(_ context.Context, _, _, target, _, _ string) (string, error) {
			capturedTarget = target
			return "https://github.com/org/repo/releases/tag/v1", nil
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)
	p.Snapshot.AgentImageTag = "pi-abc1234-ext-def5678"

	url, err := p.CreateRelease(context.Background(), "v2026.04.03.1", "v2026.04.03.1", "body")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedTarget != "def5678" {
		t.Errorf("target = %q, want %q (ext hash from image tag)", capturedTarget, "def5678")
	}
	if !strings.Contains(url, "releases/tag") {
		t.Errorf("url = %q, expected release URL", url)
	}
}

func TestCreateReleaseFallsBackToBranch(t *testing.T) {
	var capturedTarget string
	runner := &mockRunner{
		createReleaseFn: func(_ context.Context, _, _, target, _, _ string) (string, error) {
			capturedTarget = target
			return "https://github.com/org/repo/releases/tag/v1", nil
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)
	p.Snapshot.AgentImageTag = ""

	_, err := p.CreateRelease(context.Background(), "v2026.04.03.1", "v2026.04.03.1", "body")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedTarget != "main" {
		t.Errorf("target = %q, want %q (should fall back to branch)", capturedTarget, "main")
	}
}

func TestCreateReleasePassesRepo(t *testing.T) {
	var capturedRepo string
	runner := &mockRunner{
		createReleaseFn: func(_ context.Context, repo, _, _, _, _ string) (string, error) {
			capturedRepo = repo
			return "https://github.com/org/repo/releases/tag/v1", nil
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)

	_, err := p.CreateRelease(context.Background(), "v2026.04.03.1", "v2026.04.03.1", "body")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedRepo != "org/repo" {
		t.Errorf("repo = %q, want %q", capturedRepo, "org/repo")
	}
}

func TestCreateReleaseFallsBackOnResolveError(t *testing.T) {
	var capturedTarget string
	runner := &mockRunner{
		resolveCommitFn: func(_ context.Context, _, _ string) (string, error) {
			return "", fmt.Errorf("API rate limited")
		},
		createReleaseFn: func(_ context.Context, _, _, target, _, _ string) (string, error) {
			capturedTarget = target
			return "https://github.com/org/repo/releases/tag/v1", nil
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)
	p.Snapshot.AgentImageTag = "pi-abc1234-ext-def5678"

	_, err := p.CreateRelease(context.Background(), "v2026.04.03.1", "v2026.04.03.1", "body")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if capturedTarget != "def5678" {
		t.Errorf("target = %q, want %q (should fall back to short hash when resolve fails)", capturedTarget, "def5678")
	}
}

func TestCreateReleaseError(t *testing.T) {
	runner := &mockRunner{
		createReleaseFn: func(_ context.Context, _, _, _, _, _ string) (string, error) {
			return "", fmt.Errorf("permission denied")
		},
	}
	p := New(releaseConfig(), runner, false, "main", nil)

	_, err := p.CreateRelease(context.Background(), "v2026.04.03.1", "v2026.04.03.1", "body")
	if err == nil {
		t.Fatal("expected error from failed CreateRelease")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("error = %q, want it to contain 'permission denied'", err.Error())
	}
}
