package probe

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeCmdRunner returns a cmdRunner that responds with canned output.
// exitCode 0 and the provided stdout bytes simulate a successful subprocess.
func fakeCmdRunner(stdout []byte, stderr []byte, exitCode int, err error) cmdRunner {
	return func(_ context.Context, _ string, _ ...string) ([]byte, []byte, int, error) {
		return stdout, stderr, exitCode, err
	}
}

// ── ListScenarios ─────────────────────────────────────────────────────────────

func TestListScenarios_ParsesValidJSON(t *testing.T) {
	infos := []ScenarioInfo{
		{Name: "simple-portfolio", Suite: "golden-light", Trials: 3, StabilityLevel: "low", ExecutionMode: "standard", Evaluators: []string{"jtbd-completion"}},
		{Name: "business-site", Suite: "golden-light", Trials: 3, StabilityLevel: "low", ExecutionMode: "standard", Evaluators: []string{"jtbd-completion"}},
	}
	stdout, _ := json.Marshal(infos)

	got, err := listScenariosWithRunner(context.Background(), "/probe", nil, fakeCmdRunner(stdout, nil, 0, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 scenarios, got %d", len(got))
	}
	if got[0].Name != "simple-portfolio" {
		t.Errorf("got[0].Name = %q, want %q", got[0].Name, "simple-portfolio")
	}
	if got[1].Suite != "golden-light" {
		t.Errorf("got[1].Suite = %q, want %q", got[1].Suite, "golden-light")
	}
}

func TestListScenarios_EmptyArrayInput(t *testing.T) {
	got, err := listScenariosWithRunner(context.Background(), "/probe", nil,
		fakeCmdRunner([]byte("[]"), nil, 0, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %d elements", len(got))
	}
}

func TestListScenarios_MalformedJSON(t *testing.T) {
	_, err := listScenariosWithRunner(context.Background(), "/probe", nil,
		fakeCmdRunner([]byte("NOT JSON{{{"), nil, 0, nil))
	if err == nil {
		t.Fatal("expected error for malformed JSON, got nil")
	}
	if !strings.Contains(err.Error(), "JSON parse error") {
		t.Errorf("error = %q, want it to mention 'JSON parse error'", err.Error())
	}
}

func TestListScenarios_NonZeroExit(t *testing.T) {
	stderrMsg := "missing OPENAI_API_KEY"
	_, err := listScenariosWithRunner(context.Background(), "/probe", nil,
		fakeCmdRunner(nil, []byte(stderrMsg), 1, nil))
	if err == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
	if !strings.Contains(err.Error(), stderrMsg) {
		t.Errorf("error = %q, want it to include stderr text %q", err.Error(), stderrMsg)
	}
}

func TestListScenarios_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancelled before call

	// The fake runner honours the context by checking ctx.Err.
	run := func(ctx context.Context, _ string, _ ...string) ([]byte, []byte, int, error) {
		if err := ctx.Err(); err != nil {
			return nil, nil, 1, err
		}
		return []byte("[]"), nil, 0, nil
	}

	_, err := listScenariosWithRunner(ctx, "/probe", nil, run)
	if err == nil {
		t.Fatal("expected error for cancelled context, got nil")
	}
}

// ── DiscoveryCache ────────────────────────────────────────────────────────────

func TestDiscoveryCache_ReturnsCachedScenarios(t *testing.T) {
	cache := &DiscoveryCache{}
	infos := []ScenarioInfo{{Name: "s1", Suite: "test"}}
	stdout, _ := json.Marshal(infos)

	callCount := 0
	run := func(_ context.Context, _ string, _ ...string) ([]byte, []byte, int, error) {
		callCount++
		return stdout, nil, 0, nil
	}

	// First call: populates cache.
	if _, err := listScenariosWithRunner(context.Background(), "/probe", cache, run); err != nil {
		t.Fatalf("first call error: %v", err)
	}
	// Second call: should return from cache without hitting runner.
	if _, err := listScenariosWithRunner(context.Background(), "/probe", cache, run); err != nil {
		t.Fatalf("second call error: %v", err)
	}

	if callCount != 1 {
		t.Errorf("runner called %d times, want 1 (second call should be cached)", callCount)
	}
}

func TestDiscoveryCache_Invalidate_RefetchesOnNextCall(t *testing.T) {
	cache := &DiscoveryCache{}
	infos := []ScenarioInfo{{Name: "s1"}}
	stdout, _ := json.Marshal(infos)

	callCount := 0
	run := func(_ context.Context, _ string, _ ...string) ([]byte, []byte, int, error) {
		callCount++
		return stdout, nil, 0, nil
	}

	if _, err := listScenariosWithRunner(context.Background(), "/probe", cache, run); err != nil {
		t.Fatalf("first call error: %v", err)
	}

	cache.Invalidate()

	if _, err := listScenariosWithRunner(context.Background(), "/probe", cache, run); err != nil {
		t.Fatalf("post-invalidate call error: %v", err)
	}

	if callCount != 2 {
		t.Errorf("runner called %d times after invalidate, want 2", callCount)
	}
}

// ── ListBaselines ─────────────────────────────────────────────────────────────

func TestListBaselines_ParsesValidJSON(t *testing.T) {
	entries := []BaselineEntry{
		{ScenarioName: "simple-portfolio", RunID: "abc-123", CreatedAt: time.Now()},
	}
	stdout, _ := json.Marshal(entries)

	got, err := listBaselinesWithRunner(context.Background(), "/probe", nil,
		fakeCmdRunner(stdout, nil, 0, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(got))
	}
	if got[0].ScenarioName != "simple-portfolio" {
		t.Errorf("got[0].ScenarioName = %q, want %q", got[0].ScenarioName, "simple-portfolio")
	}
	if got[0].RunID != "abc-123" {
		t.Errorf("got[0].RunID = %q, want %q", got[0].RunID, "abc-123")
	}
}

func TestListBaselines_EmptyDir(t *testing.T) {
	got, err := listBaselinesWithRunner(context.Background(), "/probe", nil,
		fakeCmdRunner([]byte("[]"), nil, 0, nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %d elements", len(got))
	}
}

func TestListBaselines_NonZeroExit(t *testing.T) {
	_, err := listBaselinesWithRunner(context.Background(), "/probe", nil,
		fakeCmdRunner(nil, []byte("baselines dir error"), 1, nil))
	if err == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
}

// ── HasBaseline ───────────────────────────────────────────────────────────────

func TestHasBaseline_TrueWhenAllSuiteScenarios(t *testing.T) {
	scenarios := []ScenarioInfo{
		{Name: "s1", Suite: "golden-light"},
		{Name: "s2", Suite: "golden-light"},
		{Name: "other", Suite: "other-suite"},
	}
	baselines := []BaselineEntry{
		{ScenarioName: "s1", RunID: "r1", CreatedAt: time.Now()},
		{ScenarioName: "s2", RunID: "r2", CreatedAt: time.Now()},
	}

	scenariosJSON, _ := json.Marshal(scenarios)
	baselinesJSON, _ := json.Marshal(baselines)

	callNum := 0
	run := func(_ context.Context, _ string, args ...string) ([]byte, []byte, int, error) {
		callNum++
		if callNum == 1 {
			return scenariosJSON, nil, 0, nil // --list
		}
		return baselinesJSON, nil, 0, nil // --list-baselines
	}

	got, err := hasBaselineWithRunners(context.Background(), "/probe", "golden-light", nil, run, run)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Error("expected HasBaseline to return true, got false")
	}
}

func TestHasBaseline_FalseWhenScenarioMissingBaseline(t *testing.T) {
	scenarios := []ScenarioInfo{
		{Name: "s1", Suite: "golden-light"},
		{Name: "s2", Suite: "golden-light"},
	}
	baselines := []BaselineEntry{
		{ScenarioName: "s1", RunID: "r1", CreatedAt: time.Now()}, // s2 missing
	}

	scenariosJSON, _ := json.Marshal(scenarios)
	baselinesJSON, _ := json.Marshal(baselines)

	callNum := 0
	run := func(_ context.Context, _ string, args ...string) ([]byte, []byte, int, error) {
		callNum++
		if callNum == 1 {
			return scenariosJSON, nil, 0, nil
		}
		return baselinesJSON, nil, 0, nil
	}

	got, err := hasBaselineWithRunners(context.Background(), "/probe", "golden-light", nil, run, run)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got {
		t.Error("expected HasBaseline to return false (s2 has no baseline), got true")
	}
}

func TestHasBaseline_FalseWhenNoScenariosInSuite(t *testing.T) {
	scenarios := []ScenarioInfo{
		{Name: "s1", Suite: "other-suite"},
	}
	scenariosJSON, _ := json.Marshal(scenarios)
	baselinesJSON, _ := json.Marshal([]BaselineEntry{})

	callNum := 0
	run := func(_ context.Context, _ string, args ...string) ([]byte, []byte, int, error) {
		callNum++
		if callNum == 1 {
			return scenariosJSON, nil, 0, nil
		}
		return baselinesJSON, nil, 0, nil
	}

	got, err := hasBaselineWithRunners(context.Background(), "/probe", "golden-light", nil, run, run)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got {
		t.Error("expected HasBaseline to return false (no scenarios in suite), got true")
	}
}

// ── ListRunsDirect ──────────────────────────────────────────────────────────

func TestListRunsDirect_ParsesIndex(t *testing.T) {
	dir := t.TempDir()
	runsDir := filepath.Join(dir, "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	index := RunIndexFile{
		Runs: []RunIndexFileEntry{
			{RunID: "aaa-111", Timestamp: "2026-05-27T03:56:08Z", Dir: "20260527_aaa-111"},
			{RunID: "bbb-222", Timestamp: "2026-05-26T10:00:00Z", Dir: "20260526_bbb-222", Kind: "graduation"},
		},
	}
	data, _ := json.Marshal(index)
	if err := os.WriteFile(filepath.Join(runsDir, ".run-index.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := ListRunsDirect(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(got))
	}
	if got[0].RunID != "aaa-111" {
		t.Errorf("got[0].RunID = %q, want %q", got[0].RunID, "aaa-111")
	}
	if got[1].Kind != "graduation" {
		t.Errorf("got[1].Kind = %q, want %q", got[1].Kind, "graduation")
	}
}

func TestListRunsDirect_MissingIndexReturnsEmpty(t *testing.T) {
	dir := t.TempDir()

	got, err := ListRunsDirect(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %d entries", len(got))
	}
}

func TestListRunsDirect_MalformedJSON(t *testing.T) {
	dir := t.TempDir()
	runsDir := filepath.Join(dir, "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, ".run-index.json"), []byte("NOT JSON"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := ListRunsDirect(dir)
	if err == nil {
		t.Fatal("expected error for malformed JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse run index") {
		t.Errorf("error = %q, want it to mention 'parse run index'", err.Error())
	}
}

func TestListRunsDirect_EmptyRunsList(t *testing.T) {
	dir := t.TempDir()
	runsDir := filepath.Join(dir, "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, ".run-index.json"), []byte(`{"runs":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := ListRunsDirect(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %d entries", len(got))
	}
}

// ── GetRunSummary ───────────────────────────────────────────────────────────

func TestGetRunSummary_ReadsSummaryFile(t *testing.T) {
	dir := t.TempDir()
	runDir := filepath.Join(dir, "runs", "20260527_aaa-111")
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}
	summaryContent := "# Eval Run: aaa-111\n\nSome results here.\n"
	if err := os.WriteFile(filepath.Join(runDir, "summary.md"), []byte(summaryContent), 0o644); err != nil {
		t.Fatal(err)
	}

	path, content, err := GetRunSummary(dir, "20260527_aaa-111")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if path == "" {
		t.Error("expected non-empty path")
	}
	if !strings.Contains(path, "summary.md") {
		t.Errorf("path = %q, want it to contain 'summary.md'", path)
	}
	if content != summaryContent {
		t.Errorf("content = %q, want %q", content, summaryContent)
	}
}

func TestGetRunSummary_MissingSummaryReturnsFallback(t *testing.T) {
	dir := t.TempDir()
	runDir := filepath.Join(dir, "runs", "20260527_aaa-111")
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}

	path, content, err := GetRunSummary(dir, "20260527_aaa-111")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if path != "" {
		t.Errorf("expected empty path for missing summary, got %q", path)
	}
	if !strings.Contains(content, "No summary available") {
		t.Errorf("content = %q, want fallback message", content)
	}
}
