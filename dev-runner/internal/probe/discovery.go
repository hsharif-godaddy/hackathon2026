package probe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	discoveryTimeout = 10 * time.Second
	cacheTTL         = 30 * time.Second
)

// cmdRunner abstracts subprocess execution for testability.
// It returns (stdout, stderr, exitCode, error).
type cmdRunner func(ctx context.Context, dir string, args ...string) ([]byte, []byte, int, error)

// DiscoveryCache holds cached results from TS subprocess discovery calls.
// All methods are safe for concurrent use.
type DiscoveryCache struct {
	mu          sync.Mutex
	scenarios   []ScenarioInfo
	baselines   []BaselineEntry
	scenariosAt time.Time
	baselinesAt time.Time

	// invalidations counts Invalidate calls. Exported via InvalidateCount()
	// for cross-package test assertions.
	invalidations atomic.Int64
}

// Invalidate clears all cached results, forcing the next call to re-fetch.
// Called by the TUI after a run completes.
func (c *DiscoveryCache) Invalidate() {
	c.mu.Lock()
	c.scenariosAt = time.Time{}
	c.baselinesAt = time.Time{}
	c.mu.Unlock()
	c.invalidations.Add(1)
}

// InvalidateCount returns the number of times Invalidate has been called.
// Used by cross-package tests to assert cache invalidation behavior.
func (c *DiscoveryCache) InvalidateCount() int64 {
	return c.invalidations.Load()
}

// execPnpm is the production cmdRunner. It runs `pnpm <args>` in dir and
// returns the combined stdout, stderr, exit code, and any exec error.
func execPnpm(ctx context.Context, dir string, args ...string) ([]byte, []byte, int, error) {
	cmd := exec.CommandContext(ctx, "pnpm", args...) //nolint:gosec // hardcoded program; args from validated inputs
	cmd.Dir = dir

	var stdout, stderr strings.Builder
	stdoutBuf := &concatWriter{b: &stdout}
	stderrBuf := &concatWriter{b: &stderr}
	cmd.Stdout = stdoutBuf
	cmd.Stderr = stderrBuf

	err := cmd.Run()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return []byte(stdout.String()), []byte(stderr.String()), ee.ExitCode(), nil
		}
		return []byte(stdout.String()), []byte(stderr.String()), 1, err
	}
	return []byte(stdout.String()), []byte(stderr.String()), 0, nil
}

// concatWriter is a simple io.Writer backed by a strings.Builder.
type concatWriter struct{ b *strings.Builder }

func (w *concatWriter) Write(p []byte) (int, error) { return w.b.Write(p) }

// ListScenarios calls `pnpm run eval --list` in probeDir and returns parsed
// ScenarioInfo. Results are cached for cacheTTL; pass nil cache to disable.
func ListScenarios(ctx context.Context, probeDir string, cache *DiscoveryCache) ([]ScenarioInfo, error) {
	return listScenariosWithRunner(ctx, probeDir, cache, execPnpm)
}

func listScenariosWithRunner(
	ctx context.Context,
	probeDir string,
	cache *DiscoveryCache,
	run cmdRunner,
) ([]ScenarioInfo, error) {
	if cache != nil {
		cache.mu.Lock()
		if !cache.scenariosAt.IsZero() && time.Since(cache.scenariosAt) < cacheTTL {
			out := make([]ScenarioInfo, len(cache.scenarios))
			copy(out, cache.scenarios)
			cache.mu.Unlock()
			return out, nil
		}
		cache.mu.Unlock()
	}

	tctx, cancel := context.WithTimeout(ctx, discoveryTimeout)
	defer cancel()

	stdout, stderr, exitCode, err := run(tctx, probeDir, "run", "--silent", "eval", "--list")
	if err != nil {
		return nil, fmt.Errorf("probe list: exec error: %w", err)
	}
	if exitCode != 0 {
		return nil, fmt.Errorf("probe list: exited %d: %s", exitCode, strings.TrimSpace(string(stderr)))
	}

	var scenarios []ScenarioInfo
	if jsonErr := json.Unmarshal(stdout, &scenarios); jsonErr != nil {
		return nil, fmt.Errorf("probe list: JSON parse error: %w", jsonErr)
	}
	if scenarios == nil {
		scenarios = []ScenarioInfo{}
	}

	if cache != nil {
		cache.mu.Lock()
		cache.scenarios = scenarios
		cache.scenariosAt = time.Now()
		cache.mu.Unlock()
	}

	result := make([]ScenarioInfo, len(scenarios))
	copy(result, scenarios)
	return result, nil
}

// ListSuites groups ListScenarios results by suite name. Scenarios without a
// suite are omitted. Uses the same cache as ListScenarios.
func ListSuites(ctx context.Context, probeDir string, cache *DiscoveryCache) (map[string][]ScenarioInfo, error) {
	scenarios, err := ListScenarios(ctx, probeDir, cache)
	if err != nil {
		return nil, err
	}
	suites := make(map[string][]ScenarioInfo)
	for _, s := range scenarios {
		if s.Suite != "" {
			suites[s.Suite] = append(suites[s.Suite], s)
		}
	}
	return suites, nil
}

// ListBaselines calls `pnpm run eval --list-baselines` and returns parsed
// BaselineEntry. Results are cached for cacheTTL; pass nil cache to disable.
func ListBaselines(ctx context.Context, probeDir string, cache *DiscoveryCache) ([]BaselineEntry, error) {
	return listBaselinesWithRunner(ctx, probeDir, cache, execPnpm)
}

func listBaselinesWithRunner(
	ctx context.Context,
	probeDir string,
	cache *DiscoveryCache,
	run cmdRunner,
) ([]BaselineEntry, error) {
	if cache != nil {
		cache.mu.Lock()
		if !cache.baselinesAt.IsZero() && time.Since(cache.baselinesAt) < cacheTTL {
			out := make([]BaselineEntry, len(cache.baselines))
			copy(out, cache.baselines)
			cache.mu.Unlock()
			return out, nil
		}
		cache.mu.Unlock()
	}

	tctx, cancel := context.WithTimeout(ctx, discoveryTimeout)
	defer cancel()

	stdout, stderr, exitCode, err := run(tctx, probeDir, "run", "--silent", "eval", "--list-baselines")
	if err != nil {
		return nil, fmt.Errorf("probe list-baselines: exec error: %w", err)
	}
	if exitCode != 0 {
		return nil, fmt.Errorf("probe list-baselines: exited %d: %s", exitCode, strings.TrimSpace(string(stderr)))
	}

	var entries []BaselineEntry
	if jsonErr := json.Unmarshal(stdout, &entries); jsonErr != nil {
		return nil, fmt.Errorf("probe list-baselines: JSON parse error: %w", jsonErr)
	}
	if entries == nil {
		entries = []BaselineEntry{}
	}

	if cache != nil {
		cache.mu.Lock()
		cache.baselines = entries
		cache.baselinesAt = time.Now()
		cache.mu.Unlock()
	}

	result := make([]BaselineEntry, len(entries))
	copy(result, entries)
	return result, nil
}

// HasBaseline returns true if every scenario in the given suite has at least
// one saved baseline entry. Returns false (not an error) when the suite is
// empty or no scenarios are found.
func HasBaseline(ctx context.Context, probeDir, suiteName string, cache *DiscoveryCache) (bool, error) {
	return hasBaselineWithRunners(ctx, probeDir, suiteName, cache, execPnpm, execPnpm)
}

// hasBaselineWithRunners is the testable version of HasBaseline.
// scenariosRun and baselinesRun are separate to allow independent injection in tests.
func hasBaselineWithRunners(
	ctx context.Context,
	probeDir string,
	suiteName string,
	cache *DiscoveryCache,
	scenariosRun cmdRunner,
	baselinesRun cmdRunner,
) (bool, error) {
	scenarios, err := listScenariosWithRunner(ctx, probeDir, cache, scenariosRun)
	if err != nil {
		return false, fmt.Errorf("HasBaseline: %w", err)
	}

	suiteScenarios := make([]string, 0)
	for _, s := range scenarios {
		if s.Suite == suiteName {
			suiteScenarios = append(suiteScenarios, s.Name)
		}
	}
	if len(suiteScenarios) == 0 {
		return false, nil
	}

	baselines, err := listBaselinesWithRunner(ctx, probeDir, cache, baselinesRun)
	if err != nil {
		return false, fmt.Errorf("HasBaseline: %w", err)
	}

	covered := make(map[string]bool, len(baselines))
	for _, b := range baselines {
		covered[b.ScenarioName] = true
	}

	for _, name := range suiteScenarios {
		if !covered[name] {
			return false, nil
		}
	}
	return true, nil
}

// --- Direct file-read functions (no subprocess) ---

// ListRunsDirect reads runs/.run-index.json from disk and returns the entries.
// Returns an empty slice (not error) when the index file does not exist.
func ListRunsDirect(probeDir string) ([]RunIndexFileEntry, error) {
	indexPath := filepath.Join(probeDir, "runs", ".run-index.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []RunIndexFileEntry{}, nil
		}
		return nil, fmt.Errorf("read run index: %w", err)
	}

	var index RunIndexFile
	if err := json.Unmarshal(data, &index); err != nil {
		return nil, fmt.Errorf("parse run index: %w", err)
	}
	if index.Runs == nil {
		return []RunIndexFileEntry{}, nil
	}
	return index.Runs, nil
}

// GetRunSummary reads <probeDir>/runs/<dir>/summary.md from disk.
// Returns the absolute file path and the file contents.
// If summary.md does not exist, returns empty path and a fallback message.
func GetRunSummary(probeDir string, dir string) (string, string, error) {
	summaryPath := filepath.Join(probeDir, "runs", dir, "summary.md")
	data, err := os.ReadFile(summaryPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", "No summary available for this run.\n", nil
		}
		return "", "", fmt.Errorf("read summary: %w", err)
	}
	return summaryPath, string(data), nil
}
