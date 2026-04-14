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
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

// Manager handles Docker Compose operations for app containers.
type Manager struct {
	ports *PortAllocator
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

func (m *Manager) basePath(appID string) string {
	base := os.Getenv("APPS_BASE_DIR")
	if base == "" {
		base = "/tmp/airo-app-builder"
	}
	return filepath.Join(base, appID)
}

// Up generates docker-compose.yml and starts the compose stack.
func (m *Manager) Up(app *store.App) error {
	base := m.basePath(app.ID)
	composeContent := GenerateComposeFile(app, base)

	composePath := filepath.Join(base, "docker-compose.yml")
	if err := os.WriteFile(composePath, []byte(composeContent), 0644); err != nil {
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
		exec.Command("docker", "stop", name).Run()
		exec.Command("docker", "rm", name).Run()
	}

	return nil
}

// ensureImages builds template and publish images.
// Always runs docker buildx build; Docker's layer caching makes unchanged
// builds complete in ~1s while properly rebuilding when source files
// (dev-supervisor, container-scripts, Dockerfiles) have changed.
func (m *Manager) ensureImages() error {
	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}

	if err := m.buildImage("aab-template-v8:latest", projectRoot); err != nil {
		return err
	}

	return m.buildPublishImage(projectRoot)
}

func (m *Manager) buildImage(imageName, projectRoot string) error {
	slog.Info("docker.image.build", "image", imageName)
	start := time.Now()

	templateDir := os.Getenv("APP_TEMPLATE_DIR")
	if templateDir == "" {
		templateDir = filepath.Join(projectRoot, "app-templates", "v8")
	}

	uid, gid := hostUserIDs()

	cmd := exec.Command("docker", "buildx", "build",
		"-t", imageName,
		"--load",
		"--build-arg", fmt.Sprintf("HOST_UID=%d", uid),
		"--build-arg", fmt.Sprintf("HOST_GID=%d", gid),
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

func (m *Manager) buildPublishImage(projectRoot string) error {
	imageName := "aab-publish:latest"
	slog.Info("docker.image.build", "image", imageName)
	start := time.Now()

	uid, gid := hostUserIDs()
	publishDir := filepath.Join(projectRoot, "app-publish")

	cmd := exec.Command("docker", "buildx", "build",
		"-t", imageName,
		"--load",
		"--build-arg", fmt.Sprintf("HOST_UID=%d", uid),
		"--build-arg", fmt.Sprintf("HOST_GID=%d", gid),
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
		m.cleanupApp(appID, nil)
		result.Orphaned++
	}

	slog.Info("reconcile.complete",
		"running", result.Running,
		"cleaned", result.Cleaned,
		"orphaned", result.Orphaned,
	)
	return result
}

// cleanupApp tears down containers, drops the MySQL database, removes
// the filesystem, and optionally deletes the DB record. Returns true if
// container teardown succeeded (safe to consider fully cleaned).
func (m *Manager) cleanupApp(appID string, db *store.DB) bool {
	downOK := true
	if err := m.Down(appID); err != nil {
		slog.Warn("reconcile.down.failed", "app_id", appID, "error", err)
		downOK = false
	}

	if err := DropDatabase(appID); err != nil {
		slog.Warn("reconcile.drop_db.failed", "app_id", appID, "error", err)
	}

	if err := os.RemoveAll(m.basePath(appID)); err != nil {
		slog.Warn("reconcile.remove_files.failed", "app_id", appID, "error", err)
	}

	if db != nil {
		if err := db.DeleteApp(appID); err != nil {
			slog.Warn("reconcile.delete_app.failed", "app_id", appID, "error", err)
		}
	}

	slog.Info("reconcile.app.cleaned", "app_id", appID)
	return downOK
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
			if isValidAppID(candidate) {
				return candidate
			}
		}
	}
	return ""
}

// isValidAppID checks that an app ID is a 10-character nanoid consisting of
// lowercase letters a-z and digits 0-9, matching the format generated by
// internal/store/db.go.
func isValidAppID(id string) bool {
	if len(id) != 10 {
		return false
	}
	for _, ch := range id {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'z') {
			return false
		}
	}
	return true
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
