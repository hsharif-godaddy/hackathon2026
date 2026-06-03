package clean

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// Selection chooses which groups of generated state to remove.
//
// The four groups are mutually independent:
//
//   - BuildArtifacts: rebuildable from source (Go service dist/, JS package dist/,
//     app/.next, .turbo caches, *.tsbuildinfo, Playwright artifacts, etc.)
//   - RuntimeData: state created when services first run (control-plane SQLite DB,
//     .dev-bms preflight seed marker)
//   - EnvFiles: generated .env files and certs that re-fetch secrets when regenerated
//   - NodeModules: every node_modules/ in the workspace. Slow to regenerate (full
//     pnpm install afterwards). Omitted from the legacy `pnpm run clean` default
//     scope (Default()) for backward compatibility, even though the TUI picker
//     pre-checks it.
type Selection struct {
	BuildArtifacts bool
	RuntimeData    bool
	EnvFiles       bool
	NodeModules    bool
}

// All returns a Selection with every group enabled (the --clean-all behavior).
func All() Selection {
	return Selection{BuildArtifacts: true, RuntimeData: true, EnvFiles: true, NodeModules: true}
}

// Default returns the legacy `pnpm run clean` scope: build + runtime + env, no node_modules.
func Default() Selection {
	return Selection{BuildArtifacts: true, RuntimeData: true, EnvFiles: true}
}

// Empty reports whether no groups are selected.
func (s Selection) Empty() bool {
	return !s.BuildArtifacts && !s.RuntimeData && !s.EnvFiles && !s.NodeModules
}

// envFiles is the full list of generated env files written by dev-runner preflight.
var envFiles = []string{
	"agents/.env",
	"agents/.env.local.dev",
	"agents/.env.local.test",
	"agents/.env.local.prod",
	"app/.env",
	"app/.env.local.dev",
	"app/.env.local.test",
	"app/.env.local.prod",
	"design-rag/.env",
	"image-search-service/.env",
	"image-search-service/certs/client.crt",
	"image-search-service/certs/client.key",
	"local-control-plane/.env",
}

var runtimeDataFiles = []string{
	"local-control-plane/local-control-plane.db",
	"local-control-plane/local-control-plane.db-shm",
	"local-control-plane/local-control-plane.db-wal",
}

var runtimeDataDirs = []string{
	".dev-bms",
}

// jsPackageDistDirs lists workspace `dist/` directories produced by the
// root `pnpm build` filter chain. The Workspace Build preflight check
// discovers its set dynamically (see checks/workspace_build.go); we keep
// this hand-maintained list because clean's scope is broader — it
// includes the services (agents/dist, app/dist) that the dev-runtime
// preflight intentionally excludes — and we want to remove those too
// when the user picks "Build artifacts".
var jsPackageDistDirs = []string{
	"agents/dist",
	"app/dist",
	"packages/ai-common/dist",
	"packages/ai-grants/dist",
	"packages/ai-lib/dist",
	"packages/ai-skills/dist",
	"packages/ai-transport/dist",
	"packages/pattern-library/dist",
	"packages/shared/dist",
}

var staticBuildDirs = []string{
	"app/.next",
	"playwright-report",
	"test-results",
	"app/playwright-report",
	"app/test-results",
	".playwright-cli",
	"packages/design-extractor/output",
	".docker-cache",
}

type goService struct {
	dir       string
	artifacts []string
}

// goServices lists each Go service alongside the specific artifacts its
// Makefile clean target removes, so the confirmation output is unambiguous.
var goServices = []goService{
	{"dev-runner", []string{"dist/"}},
	{"dev-supervisor", []string{"dist/"}},
	{"local-control-plane", []string{"dist/"}},
	{"budget-service", []string{"bin/", "tmp/"}},
	{"image-search-service", []string{"dist/"}},
	{"knowledge-service", []string{"dist/"}},
	{"go-agent", []string{"dist/", "coverage.out", "coverage.html"}},
	{"release-manager", []string{"dist/"}},
	{"cli-agent-client", []string{"bin/"}},
}

type plan struct {
	files      []string
	dirs       []string
	goServices []goService
}

// Run removes generated files and build artifacts according to sel, after user
// confirmation. Pass skipConfirm=true to suppress the [y/N] prompt.
func Run(projectRoot string, sel Selection, skipConfirm bool) error {
	return run(projectRoot, sel, skipConfirm, os.Stdout, os.Stderr, os.Stdin)
}

// RunWithStreams is like Run but lets the caller redirect output and confirmation
// streams. The TUI uses this to capture progress into its own viewport instead of
// scribbling onto the alternate screen.
func RunWithStreams(projectRoot string, sel Selection, skipConfirm bool, out, errOut io.Writer, in io.Reader) error {
	return run(projectRoot, sel, skipConfirm, out, errOut, in)
}

func run(projectRoot string, sel Selection, skipConfirm bool, out, errOut io.Writer, in io.Reader) error {
	if sel.Empty() {
		fmt.Fprintln(out, "Nothing selected.")
		return nil
	}

	p, err := buildPlan(projectRoot, sel, errOut)
	if err != nil {
		return err
	}

	if len(p.files) == 0 && len(p.dirs) == 0 && len(p.goServices) == 0 {
		fmt.Fprintln(out, "Nothing to clean.")
		return nil
	}

	printPlan(out, p)

	if sel.EnvFiles {
		fmt.Fprintln(out, "Note: /etc/hosts entry for local.gasket.dev-godaddy.com must be removed manually.")
		fmt.Fprintln(out)
	}

	if !skipConfirm {
		proceed, err := confirm(out, in)
		if err != nil {
			return err
		}
		if !proceed {
			return nil
		}
	}

	return execute(projectRoot, p, out, errOut)
}

func buildPlan(projectRoot string, sel Selection, errOut io.Writer) (*plan, error) {
	p := &plan{}
	add := makeAdder(projectRoot, p, errOut)

	if sel.BuildArtifacts {
		for _, rel := range staticBuildDirs {
			add(rel)
		}
		for _, rel := range jsPackageDistDirs {
			add(rel)
		}
		for _, svc := range goServices {
			info, err := os.Stat(filepath.Join(projectRoot, svc.dir, "Makefile"))
			if err == nil && !info.IsDir() {
				p.goServices = append(p.goServices, svc)
				continue
			}
			if err != nil && !errors.Is(err, fs.ErrNotExist) {
				fmt.Fprintf(errOut, "  warning: cannot stat %s/Makefile: %v (skipping)\n", svc.dir, err)
			}
		}
		// The walker still has to scan packages/*, agents/, app/ for .turbo
		// and *.tsbuildinfo, but once it enters a directory we're already
		// going to RemoveAll (e.g. app/.next/cache/ — millions of files), the
		// scan is wasted. Prune those subtrees.
		prune := make(map[string]struct{}, len(p.dirs))
		for _, d := range p.dirs {
			prune[d] = struct{}{}
		}
		if err := walkBuildArtifacts(projectRoot, p, prune, errOut); err != nil {
			return nil, err
		}
	}

	if sel.RuntimeData {
		for _, rel := range runtimeDataFiles {
			add(rel)
		}
		for _, rel := range runtimeDataDirs {
			add(rel)
		}
	}

	if sel.EnvFiles {
		for _, rel := range envFiles {
			add(rel)
		}
	}

	if sel.NodeModules {
		if err := walkNodeModules(projectRoot, p, errOut); err != nil {
			return nil, err
		}
	}

	return p, nil
}

// makeAdder returns a closure that stats projectRoot/rel, classifies it as a
// file or directory, and appends to the appropriate plan slice. Missing entries
// are silently skipped; other stat errors are logged as warnings.
func makeAdder(projectRoot string, p *plan, errOut io.Writer) func(string) {
	return func(rel string) {
		info, err := os.Stat(filepath.Join(projectRoot, rel))
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				fmt.Fprintf(errOut, "  warning: cannot stat %s: %v (skipping)\n", rel, err)
			}
			return
		}
		if info.IsDir() {
			p.dirs = append(p.dirs, rel)
		} else {
			p.files = append(p.files, rel)
		}
	}
}

// walkBuildArtifacts traverses projectRoot to discover .turbo/ directories
// and *.tsbuildinfo files. node_modules and .git are pruned to avoid the
// dependency long tail; entries in pruneAlreadyPlanned (paths already on
// the deletion list, e.g. app/.next, packages/*/dist) are also pruned so
// we don't recurse into subtrees that are about to be removed wholesale.
func walkBuildArtifacts(projectRoot string, p *plan, pruneAlreadyPlanned map[string]struct{}, errOut io.Writer) error {
	return filepath.WalkDir(projectRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			fmt.Fprintf(errOut, "  warning: walk error at %s: %v\n", path, err)
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			switch d.Name() {
			case "node_modules", ".git":
				return fs.SkipDir
			case ".turbo":
				rel, _ := filepath.Rel(projectRoot, path)
				p.dirs = append(p.dirs, rel)
				return fs.SkipDir
			}
			rel, _ := filepath.Rel(projectRoot, path)
			if _, alreadyPlanned := pruneAlreadyPlanned[rel]; alreadyPlanned {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(d.Name(), ".tsbuildinfo") {
			rel, _ := filepath.Rel(projectRoot, path)
			p.files = append(p.files, rel)
		}
		return nil
	})
}

// walkNodeModules collects every node_modules/ directory under projectRoot,
// skipping into them once found so we don't recurse through ~2500 nested copies.
func walkNodeModules(projectRoot string, p *plan, errOut io.Writer) error {
	return filepath.WalkDir(projectRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			fmt.Fprintf(errOut, "  warning: walk error at %s: %v\n", path, err)
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		if d.Name() == ".git" {
			return fs.SkipDir
		}
		if d.Name() == "node_modules" {
			rel, _ := filepath.Rel(projectRoot, path)
			p.dirs = append(p.dirs, rel)
			return fs.SkipDir
		}
		return nil
	})
}

func printPlan(out io.Writer, p *plan) {
	if len(p.files) > 0 {
		fmt.Fprintln(out, "Files to delete:")
		for _, f := range p.files {
			fmt.Fprintf(out, "  %s\n", f)
		}
		fmt.Fprintln(out)
	}
	if len(p.dirs) > 0 {
		fmt.Fprintln(out, "Directories to delete:")
		for _, d := range p.dirs {
			fmt.Fprintf(out, "  %s/\n", d)
		}
		fmt.Fprintln(out)
	}
	if len(p.goServices) > 0 {
		fmt.Fprintln(out, "Build artifacts to delete (via 'make clean'):")
		for _, svc := range p.goServices {
			fmt.Fprintf(out, "  %s/{%s}\n", svc.dir, strings.Join(svc.artifacts, ", "))
		}
		fmt.Fprintln(out)
	}
}

// confirm prompts the user [y/N]. Returns proceed=true only if the user typed y/yes.
// EOF is treated as a "no" with no error so piped/empty stdin doesn't surface
// a confusing failure.
func confirm(out io.Writer, in io.Reader) (bool, error) {
	fmt.Fprint(out, "Are you sure? [y/N]: ")
	reader := bufio.NewReader(in)
	answer, err := reader.ReadString('\n')
	if err != nil {
		if errors.Is(err, io.EOF) {
			fmt.Fprintln(out, "Cancelled (no confirmation received).")
			return false, nil
		}
		return false, fmt.Errorf("reading confirmation: %w", err)
	}
	answer = strings.TrimSpace(strings.ToLower(answer))
	if answer != "y" && answer != "yes" {
		fmt.Fprintln(out, "Cancelled.")
		return false, nil
	}
	return true, nil
}

// SafeBuffer is a goroutine-safe wrapper around bytes.Buffer for the
// case where a single capture sink is plumbed into both cmd.Stdout and
// cmd.Stderr — os/exec drives those from independent copier goroutines,
// so unsynchronized writes race. The TUI uses this for the live capture
// buffer it later renders on a failed clean.
type SafeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *SafeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

// String returns the buffer's accumulated bytes as a string. Safe to
// call concurrently with Write, though typical use is "drain after
// cmd.Run() returns" (no concurrent writers remain).
func (b *SafeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// failureReasonMaxLen caps the per-service failure reason embedded into
// the joined error string. Make-clean output can be arbitrarily long
// (compiler stack traces, etc.); leaving it raw blows up the size of the
// final error and renders badly when joined into a comma-separated list.
const failureReasonMaxLen = 200

// normalizeFailureReason collapses captured make-clean stdout+stderr into
// a single line and truncates to failureReasonMaxLen, falling back to
// err.Error() when the command produced no output of its own (the common
// case for a `make: *** [target] Error N` on its own line).
func normalizeFailureReason(captured string, err error) string {
	reason := strings.Join(strings.Fields(captured), " ")
	if reason == "" {
		return err.Error()
	}
	if len(reason) > failureReasonMaxLen {
		reason = reason[:failureReasonMaxLen] + "…"
	}
	return reason
}

func execute(projectRoot string, p *plan, out, errOut io.Writer) error {
	var failed int
	var failedNames []string

	for _, rel := range p.files {
		full := filepath.Join(projectRoot, rel)
		if err := os.Remove(full); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			fmt.Fprintf(errOut, "  error removing %s: %v\n", rel, err)
			failed++
			failedNames = append(failedNames, rel)
			continue
		}
		fmt.Fprintf(out, "  removed %s\n", rel)
	}

	for _, rel := range p.dirs {
		full := filepath.Join(projectRoot, rel)
		if err := os.RemoveAll(full); err != nil {
			fmt.Fprintf(errOut, "  error removing %s: %v\n", rel, err)
			failed++
			failedNames = append(failedNames, rel)
			continue
		}
		fmt.Fprintf(out, "  removed %s/\n", rel)
	}

	for _, svc := range p.goServices {
		fmt.Fprintf(out, "  cleaning %s/{%s}\n", svc.dir, strings.Join(svc.artifacts, ", "))
		cmd := exec.Command("make", "clean")
		cmd.Dir = filepath.Join(projectRoot, svc.dir)
		cmd.Env = append(os.Environ(), "GOPROXY=off")
		// Capture stdout+stderr alongside the parent writers so the per-service
		// failure reason travels with the returned error — `*exec.ExitError`
		// alone is just "exit status N", which is useless when the TUI reports
		// the error without showing the full output stream. SafeBuffer wraps
		// the capture in a mutex so the stdout/stderr copier goroutines that
		// os/exec spawns don't race on it.
		var captured SafeBuffer
		cmd.Stdout = io.MultiWriter(out, &captured)
		cmd.Stderr = io.MultiWriter(errOut, &captured)
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(errOut, "  error cleaning %s: %v\n", svc.dir, err)
			failed++
			failedNames = append(failedNames, fmt.Sprintf("%s (%s)", svc.dir, normalizeFailureReason(captured.String(), err)))
		}
	}

	if failed > 0 {
		return fmt.Errorf("%d item(s) could not be cleaned: %s", failed, strings.Join(failedNames, ", "))
	}

	fmt.Fprintln(out)
	fmt.Fprintln(out, "Done. Run 'pnpm run dev' to regenerate.")
	return nil
}
