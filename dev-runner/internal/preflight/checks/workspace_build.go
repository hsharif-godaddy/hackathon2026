package checks

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// devServiceManifests are the package.json files for the services dev launches.
// Their transitive workspace-dependency closure defines which internal
// libraries must be built; packages outside it (e.g. @airo/design-extractor,
// which nothing dev runs imports) are intentionally ignored so preflight never
// forces an unrelated build.
//
// Discovery approach contributed by Ying Han (yhan1-godaddy) in PR review.
var devServiceManifests = []string{
	filepath.Join("app", "package.json"),
	filepath.Join("agents", "package.json"),
}

// WorkspaceBuildCheck verifies that the internal library packages dev actually
// loads have been built. The app (Next) and agents (tsx) resolve these
// workspace libs through their package.json entry points, which point into
// ./dist (e.g. @airo-ux/pattern-library/chat/thinker/styles ->
// ./dist/chat/thinker/styles.css). dist/ is gitignored and neither
// `pnpm install` (no prepare/postinstall on the libs) nor the dev launch builds
// them, so a fresh clone or a `pnpm clean` leaves dist/ absent and the app
// fails to compile with a "no valid target file was found" error. Turbo builds
// these as a side effect of `pnpm build`/typecheck/test, which is why
// steady-state machines don't notice the gap.
type WorkspaceBuildCheck struct{}

func (c *WorkspaceBuildCheck) Name() string     { return "Workspace Build" }
func (c *WorkspaceBuildCheck) Category() string { return preflight.CategoryEnvironment }

func (c *WorkspaceBuildCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	missing, err := UnbuiltDistPackages(projectRoot)
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "could not scan workspace packages: " + err.Error(),
		}
	}

	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "missing built output (dist/): " + strings.Join(missing, ", "),
			InstallHint:  "Run the fixer to build (pnpm exec turbo run build --filter=…)",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "all required workspace libraries built",
	}
}

// pkgManifest is the subset of package.json this check inspects. Exports is kept
// raw because its shape varies (string, object, nested conditions); we only need
// to know whether any entry string mentions dist/.
type pkgManifest struct {
	Name            string            `json:"name"`
	Scripts         map[string]string `json:"scripts"`
	Main            string            `json:"main"`
	Module          string            `json:"module"`
	Types           string            `json:"types"`
	Exports         json.RawMessage   `json:"exports"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
}

// pkgRef pairs a workspace package's name with its directory.
type pkgRef struct {
	Name string
	Dir  string
}

// UnbuiltDistPackages returns the names of the dev-required library packages
// whose built output is absent or empty, sorted (inherited from
// devDistPackages) for stable output.
func UnbuiltDistPackages(projectRoot string) ([]string, error) {
	pkgs, err := devDistPackages(projectRoot)
	if err != nil {
		return nil, err
	}

	var missing []string
	for _, p := range pkgs {
		if !distPopulated(filepath.Join(p.Dir, "dist")) {
			missing = append(missing, p.Name)
		}
	}
	return missing, nil
}

// DevDistPackageNames returns the names of every dev-required library package
// that publishes built output, sorted. The fixer builds exactly this set.
func DevDistPackageNames(projectRoot string) ([]string, error) {
	pkgs, err := devDistPackages(projectRoot)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(pkgs))
	for _, p := range pkgs {
		names = append(names, p.Name)
	}
	return names, nil
}

// devDistPackages returns the workspace packages under packages/ that are in the
// transitive workspace-dependency closure of the dev services AND publish built
// output (a build script plus an entry point resolving into dist/). Packages
// consumed from source, config-only packages without a build script, and
// packages no dev service depends on are excluded — so the check never demands a
// build that wouldn't produce the dist/ it's looking for, nor one for code dev
// doesn't run. A missing packages/ directory yields no results and no error.
func devDistPackages(projectRoot string) ([]pkgRef, error) {
	index, err := indexWorkspacePackages(projectRoot)
	if err != nil {
		return nil, err
	}

	roots, err := devServiceRoots(projectRoot)
	if err != nil {
		return nil, err
	}

	// BFS the workspace-dependency graph from the service roots, keeping only
	// names that resolve to a package under packages/.
	visited := make(map[string]bool)
	queue := roots
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		entry, ok := index[name]
		if !ok || visited[name] {
			continue
		}
		visited[name] = true
		queue = append(queue, workspaceDeps(entry.manifest)...)
	}

	var refs []pkgRef
	for name := range visited {
		entry := index[name]
		if publishesDist(entry.manifest) {
			refs = append(refs, pkgRef{Name: name, Dir: entry.dir})
		}
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].Name < refs[j].Name })
	return refs, nil
}

type indexedPkg struct {
	dir      string
	manifest pkgManifest
}

// indexWorkspacePackages maps package name -> {dir, manifest} for every package
// under packages/ that has a package.json.
func indexWorkspacePackages(projectRoot string) (map[string]indexedPkg, error) {
	packagesDir := filepath.Join(projectRoot, "packages")
	entries, err := os.ReadDir(packagesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]indexedPkg{}, nil
		}
		return nil, err
	}

	index := make(map[string]indexedPkg)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(packagesDir, entry.Name())
		manifest, err := readManifest(filepath.Join(dir, "package.json"))
		if err != nil {
			if os.IsNotExist(err) {
				continue // not a package
			}
			return nil, fmt.Errorf("reading %s/package.json: %w", entry.Name(), err)
		}
		if manifest.Name == "" {
			continue
		}
		index[manifest.Name] = indexedPkg{dir: dir, manifest: manifest}
	}
	return index, nil
}

// devServiceRoots returns the workspace dependency names declared by the dev
// service manifests (app/, agents/). A missing manifest is skipped so the check
// degrades to a no-op outside the standard monorepo layout.
func devServiceRoots(projectRoot string) ([]string, error) {
	var roots []string
	for _, rel := range devServiceManifests {
		manifest, err := readManifest(filepath.Join(projectRoot, rel))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("reading %s: %w", rel, err)
		}
		roots = append(roots, workspaceDeps(manifest)...)
	}
	return roots, nil
}

func readManifest(path string) (pkgManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return pkgManifest{}, err
	}
	var m pkgManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return pkgManifest{}, fmt.Errorf("parsing %s: %w", path, err)
	}
	return m, nil
}

// workspaceDeps returns the names of dependencies (prod + dev) declared with a
// workspace: specifier — the edges of the intra-repo dependency graph.
func workspaceDeps(m pkgManifest) []string {
	var deps []string
	for _, set := range []map[string]string{m.Dependencies, m.DevDependencies} {
		for name, spec := range set {
			if strings.HasPrefix(spec, "workspace:") {
				deps = append(deps, name)
			}
		}
	}
	return deps
}

// publishesDist reports whether a package both has a build script and resolves
// consumers into dist/ via main/module/types/exports. Packages consumed from
// source (no dist in their entry points) and config-only packages without a
// build script are skipped.
func publishesDist(m pkgManifest) bool {
	if strings.TrimSpace(m.Scripts["build"]) == "" {
		return false
	}
	entries := m.Main + "\n" + m.Module + "\n" + m.Types + "\n" + string(m.Exports)
	return strings.Contains(entries, "dist")
}

// distPopulated reports whether dist exists and contains at least one entry.
// An empty dist/ (e.g. a build interrupted after `rm -rf dist`) is treated as
// missing so the fixer re-runs the build. It reads a single entry rather than
// the whole directory — a built dist/ can hold 100+ files.
func distPopulated(distDir string) bool {
	f, err := os.Open(distDir)
	if err != nil {
		return false
	}
	defer f.Close()
	entries, err := f.ReadDir(1)
	return err == nil && len(entries) > 0
}
