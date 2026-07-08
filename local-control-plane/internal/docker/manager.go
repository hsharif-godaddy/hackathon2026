package docker

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

// Manager handles Docker Compose operations for app containers.
type Manager struct {
	ports *PortAllocator
	// imgMu serializes ensureImages() across concurrent provisions.
	// Provisioning runs one goroutine per app (see api/apps.go), and each
	// calls Up()->ensureImages(), which runs `docker buildx build --load`
	// on the shared aab-template-v8 / aab-publish tags. Without this lock,
	// a concurrent fan-out (e.g. gosym-probe --graduate --fan-out on a cold
	// cache) fires N simultaneous builds of the same --load tag, which race
	// and fail with "exit status 1". Serializing makes the first build warm
	// the buildx layer cache so the rest are ~1s cache hits.
	imgMu sync.Mutex
	// buildFn overrides the real buildx builds in tests; nil in production.
	buildFn func() error
}

func NewManager() *Manager {
	return &Manager{
		ports: NewPortAllocator(),
	}
}

// AllocatePorts returns available preview, publish, supervisor, and publish supervisor ports.
func (m *Manager) AllocatePorts() (preview, publish, supervisor, publishSupervisor int, err error) {
	return m.ports.Allocate()
}

func (m *Manager) appsBaseDir() string {
	base := os.Getenv("APPS_BASE_DIR")
	if base == "" {
		base = "/tmp/airo-app-builder"
	}
	return base
}

func (m *Manager) basePath(appID string) string {
	return filepath.Join(m.appsBaseDir(), appID)
}

// Up generates docker-compose.yml and starts the compose stack.
func (m *Manager) Up(app *store.App) error {
	base := m.basePath(app.ID)
	composeContent := GenerateComposeFile(app, base)

	composePath := filepath.Join(base, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte(composeContent), 0o644); err != nil {
		return fmt.Errorf("write compose file: %w", err)
	}

	slog.Info("docker.compose.up", "app_id", app.ID, "path", base)

	// Ensure template images exist
	if err := m.ensureImages(); err != nil {
		return fmt.Errorf("ensure images: %w", err)
	}

	cmd := exec.Command("docker", "compose", "--project-name", "airo-app-"+app.ID, "up", "-d", "--remove-orphans")
	cmd.Dir = base
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker compose up: %w", err)
	}

	slog.Info("docker.compose.up.success", "app_id", app.ID)
	return nil
}

// Down stops and removes the compose stack for an app.
func (m *Manager) Down(appID string) error {
	base := m.basePath(appID)

	composePath := filepath.Join(base, "docker-compose.yml")
	if _, err := os.Stat(composePath); os.IsNotExist(err) {
		// No compose file, try direct container removal
		return m.forceRemoveContainers(appID)
	}

	slog.Info("docker.compose.down", "app_id", appID, "path", base)

	cmd := exec.Command("docker", "compose", "--project-name", "airo-app-"+appID, "down", "--volumes", "--remove-orphans")
	cmd.Dir = base
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		slog.Warn("docker.compose.down.failed", "app_id", appID, "error", err)
		return m.forceRemoveContainers(appID)
	}

	return nil
}

// Restart restarts the compose stack for an app.
func (m *Manager) Restart(appID string) error {
	base := m.basePath(appID)

	cmd := exec.Command("docker", "compose", "--project-name", "airo-app-"+appID, "restart")
	cmd.Dir = base
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

func (m *Manager) forceRemoveContainers(appID string) error {
	names := []string{
		fmt.Sprintf("preview-%s-1", appID),
		fmt.Sprintf("publish-%s-1", appID),
	}

	for _, name := range names {
		// Best-effort cleanup; ignore errors when containers don't exist.
		_ = exec.Command("docker", "stop", name).Run()
		_ = exec.Command("docker", "rm", name).Run()
	}

	return nil
}

// ensureImages builds template and publish images.
// Always runs docker buildx build; Docker's layer caching makes unchanged
// builds complete in ~1s while properly rebuilding when source files
// (dev-supervisor, container-scripts, Dockerfiles) have changed.
func (m *Manager) ensureImages() error {
	// Serialize image builds: concurrent `buildx build --load` of the same
	// tag race and fail. The lock holds only for the build step; once the
	// first provision warms the cache, the rest are fast cache hits.
	m.imgMu.Lock()
	defer m.imgMu.Unlock()

	// buildFn is injectable for tests; nil means run the real buildx builds.
	if m.buildFn != nil {
		return m.buildFn()
	}
	return m.buildImages()
}

func (m *Manager) buildImages() error {
	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}
	version := resolveDevSupervisorVersion(projectRoot)

	if err := m.buildImage("aab-template-v8:latest", projectRoot, version); err != nil {
		return err
	}

	return m.buildPublishImage(projectRoot, version)
}

// PrewarmImages builds the template + publish images, warming the Docker layer
// cache so a subsequent per-app Up()->ensureImages() is a cache hit. It runs
// the identical buildx invocation ensureImages() uses, guaranteeing the same
// cache key.
func (m *Manager) PrewarmImages() error {
	return m.ensureImages()
}

func (m *Manager) buildImage(imageName, projectRoot, version string) error {
	slog.Info("docker.image.build", "image", imageName)
	start := time.Now()

	templateDir := os.Getenv("APP_TEMPLATE_DIR")
	if templateDir == "" {
		templateDir = filepath.Join(projectRoot, "app-templates", "v8")
	}

	uid, gid := hostUserIDs()

	cmd := exec.Command(
		"docker", "buildx", "build",
		"-t", imageName,
		"--load",
		"--build-arg", fmt.Sprintf("HOST_UID=%d", uid),
		"--build-arg", fmt.Sprintf("HOST_GID=%d", gid),
		"--build-arg", "VERSION="+version,
		"--build-context", "dev-supervisor="+filepath.Join(projectRoot, "dev-supervisor"),
		"--build-context", "container-scripts="+filepath.Join(projectRoot, "container-scripts"),
		"-f", filepath.Join(templateDir, "Dockerfile.dev"),
		templateDir,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("build image %s: %w", imageName, err)
	}

	slog.Info("docker.image.build.success", "image", imageName, "duration_ms", time.Since(start).Milliseconds())
	return nil
}

func (m *Manager) buildPublishImage(projectRoot, version string) error {
	imageName := "aab-publish:latest"
	slog.Info("docker.image.build", "image", imageName)
	start := time.Now()

	uid, gid := hostUserIDs()
	publishDir := filepath.Join(projectRoot, "app-publish")

	cmd := exec.Command(
		"docker", "buildx", "build",
		"-t", imageName,
		"--load",
		"--build-arg", fmt.Sprintf("HOST_UID=%d", uid),
		"--build-arg", fmt.Sprintf("HOST_GID=%d", gid),
		"--build-arg", "VERSION="+version,
		"--build-context", "dev-supervisor="+filepath.Join(projectRoot, "dev-supervisor"),
		"--build-context", "container-scripts="+filepath.Join(projectRoot, "container-scripts"),
		"-f", filepath.Join(publishDir, "Dockerfile.dev"),
		publishDir,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("build image %s: %w", imageName, err)
	}

	slog.Info("docker.image.build.success", "image", imageName, "duration_ms", time.Since(start).Milliseconds())
	return nil
}

// IsDockerAvailable checks whether the Docker daemon is reachable.
func IsDockerAvailable() bool {
	return exec.Command("docker", "info").Run() == nil
}

// ReconcileResult summarises what happened during startup reconciliation.
type ReconcileResult struct {
	Running  int
	Cleaned  int
	Orphaned int
	// Failed counts orphans whose cleanup did not fully succeed (e.g. a
	// workspace dir that couldn't be removed) — a persistent leak, not a clean.
	Failed int
}

// Reconcile checks every app in the database against its actual Docker state
// and scans for orphaned containers that have no database record.
//
// Phase 1: For each DB app, verify its containers are running. Stale DB
// entries (containers stopped/missing) are fully cleaned up. If cleanup
// fails (containers may still be running), the ID is excluded from
// knownIDs so Phase 2 can still detect it.
//
// Phase 2: List all Docker containers matching airo naming patterns and
// remove any whose app ID has no corresponding DB record.
//
// Phase 3: Scan APPS_BASE_DIR for workspace directories and remove any whose
// app ID has no DB record. The template live-sync (internal/templatesync)
// discovers apps by scanning this directory, not the DB, so a directory left
// behind after deletion (with no container to flag it in Phase 2) would be
// synced forever.
func (m *Manager) Reconcile(db *store.DB) ReconcileResult {
	var result ReconcileResult

	if !IsDockerAvailable() {
		slog.Error("reconcile.skip", "reason", "docker daemon not available")
		return result
	}

	apps, err := db.ListAllApps()
	if err != nil {
		slog.Error("reconcile.list_apps.failed", "error", err)
		return result
	}

	slog.Info("reconcile.start", "db_app_count", len(apps))

	// Phase 1: verify DB apps have running containers
	knownIDs := make(map[string]bool, len(apps))
	for _, app := range apps {
		if m.isStackRunning(app.ID) {
			knownIDs[app.ID] = true
			result.Running++
			continue
		}

		slog.Info("reconcile.stale_app.cleaning", "app_id", app.ID)
		if m.cleanupApp(app.ID, db) {
			knownIDs[app.ID] = true
			result.Cleaned++
		}
	}

	// Phase 2: find orphaned containers with no DB record
	for _, appID := range m.listContainerAppIDs() {
		if knownIDs[appID] {
			continue
		}

		slog.Info("reconcile.orphan.cleaning", "app_id", appID)
		if m.cleanupApp(appID, nil) {
			result.Orphaned++
		} else {
			result.Failed++
		}
		knownIDs[appID] = true // mark handled so Phase 3 doesn't clean it again
	}

	// Phase 3: find orphaned workspace directories with no DB record (and no
	// container, else Phase 2 already handled them).
	for _, appID := range m.listWorkspaceAppIDs() {
		if knownIDs[appID] {
			continue
		}

		slog.Info("reconcile.orphan_dir.cleaning", "app_id", appID)
		if m.cleanupApp(appID, nil) {
			result.Orphaned++
		} else {
			result.Failed++
		}
		knownIDs[appID] = true
	}

	logComplete := slog.Info
	if result.Failed > 0 {
		logComplete = slog.Warn
	}
	logComplete(
		"reconcile.complete",
		"running", result.Running,
		"cleaned", result.Cleaned,
		"orphaned", result.Orphaned,
		"failed", result.Failed,
	)
	return result
}

// cleanupApp tears down containers, drops the MySQL database, removes
// the filesystem, and optionally deletes the DB record. Returns true only if
// both container teardown AND workspace-dir removal succeeded — a dir that
// can't be removed keeps getting synced by templatesync (the exact leak
// Phase 3 prevents), so it must not be reported as a clean success.
func (m *Manager) cleanupApp(appID string, db *store.DB) bool {
	ok := true
	if err := m.Down(appID); err != nil {
		slog.Warn("reconcile.down.failed", "app_id", appID, "error", err)
		ok = false
	}

	if err := DropDatabase(appID); err != nil {
		slog.Warn("reconcile.drop_db.failed", "app_id", appID, "error", err)
	}

	if err := os.RemoveAll(m.basePath(appID)); err != nil {
		slog.Warn("reconcile.remove_files.failed", "app_id", appID, "error", err)
		ok = false
	}

	if db != nil {
		if err := db.DeleteApp(appID); err != nil {
			slog.Warn("reconcile.delete_app.failed", "app_id", appID, "error", err)
		}
	}

	if ok {
		slog.Info("reconcile.app.cleaned", "app_id", appID)
	} else {
		slog.Warn("reconcile.app.cleanup_incomplete", "app_id", appID)
	}
	return ok
}

// isStackRunning checks whether a compose stack has any running containers.
// Returns true on errors to avoid destructive cleanup when Docker state
// cannot be determined.
func (m *Manager) isStackRunning(appID string) bool {
	cmd := exec.Command("docker", "compose", "--project-name", "airo-app-"+appID, "ps", "-q")

	output, err := cmd.CombinedOutput()
	if err != nil {
		slog.Warn("docker.stack_status.failed", "app_id", appID, "error", err, "output", strings.TrimSpace(string(output)))
		return true
	}

	return len(strings.TrimSpace(string(output))) > 0
}

// listContainerAppIDs returns unique app IDs extracted from all Docker
// containers matching airo naming patterns (preview-{id}-1, publish-{id}-1).
func (m *Manager) listContainerAppIDs() []string {
	cmd := exec.Command("docker", "ps", "-a",
		"--filter", "name=^(preview|publish)-",
		"--format", "{{.Names}}")
	output, err := cmd.Output()
	if err != nil {
		slog.Warn("reconcile.list_containers.failed", "error", err)
		return nil
	}

	return parseContainerAppIDs(string(output))
}

// listWorkspaceAppIDs returns app IDs that have a workspace directory directly
// under APPS_BASE_DIR. Only valid 10-char nanoid directory names are returned,
// so template/scratch folders are ignored.
func (m *Manager) listWorkspaceAppIDs() []string {
	entries, err := os.ReadDir(m.appsBaseDir())
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("reconcile.list_workspaces.failed", "error", err)
		}
		return nil
	}

	var ids []string
	for _, entry := range entries {
		if entry.IsDir() && store.IsValidAppID(entry.Name()) {
			ids = append(ids, entry.Name())
		}
	}

	return ids
}

// parseContainerAppIDs extracts unique app IDs from Docker container name
// output. Container names follow the pattern preview-{appID}-1 or
// publish-{appID}-1.
func parseContainerAppIDs(output string) []string {
	seen := make(map[string]bool)
	var ids []string

	for _, name := range strings.Split(strings.TrimSpace(output), "\n") {
		if name == "" {
			continue
		}

		appID := extractAppID(name)
		if appID != "" && !seen[appID] {
			seen[appID] = true
			ids = append(ids, appID)
		}
	}

	return ids
}

// extractAppID parses an app ID from a container name like preview-{id}-1
// or publish-{id}-1. Returns empty string if the name doesn't match or the
// extracted ID is not a valid 10-char nanoid.
func extractAppID(containerName string) string {
	for _, prefix := range []string{"preview-", "publish-"} {
		if strings.HasPrefix(containerName, prefix) && strings.HasSuffix(containerName, "-1") {
			candidate := strings.TrimSuffix(strings.TrimPrefix(containerName, prefix), "-1")
			if store.IsValidAppID(candidate) {
				return candidate
			}
		}
	}
	return ""
}

func hostUserIDs() (uid, gid int) {
	u, err := user.Current()
	if err != nil {
		slog.Warn("docker.host_user.failed", "error", err, "fallback_uid", 790, "fallback_gid", 790)
		return 790, 790
	}
	uid, _ = strconv.Atoi(u.Uid)
	gid, _ = strconv.Atoi(u.Gid)
	if uid == 0 {
		uid = 790
	}
	if gid == 0 {
		gid = 790
	}
	return uid, gid
}

// resolveDevSupervisorVersion returns the short SHA of the project's git HEAD,
// stamped into the dev-supervisor binary at build time so operators can
// correlate `dev-supervisor --version` with the local source tree.
func resolveDevSupervisorVersion(projectRoot string) string {
	cmd := exec.Command("git", "rev-parse", "--short", "HEAD")
	cmd.Dir = projectRoot
	out, err := cmd.Output()
	if err != nil {
		slog.Warn("docker.version.resolve.failed", "project_root", projectRoot, "error", err)
		return "dev"
	}
	return strings.TrimSpace(string(out))
}
