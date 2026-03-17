package docker

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"

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

// ensureImages builds template and publish images if they don't already exist.
func (m *Manager) ensureImages() error {
	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}

	// Build template image
	if err := m.buildImageIfNeeded("aab-template-v8:latest", projectRoot); err != nil {
		return err
	}

	// Build publish image
	if err := m.buildPublishImageIfNeeded(projectRoot); err != nil {
		return err
	}

	return nil
}

func (m *Manager) buildImageIfNeeded(imageName, projectRoot string) error {
	// Check if image already exists
	cmd := exec.Command("docker", "image", "inspect", imageName)
	if cmd.Run() == nil {
		return nil
	}

	slog.Info("docker.image.build", "image", imageName)

	templateDir := os.Getenv("APP_TEMPLATE_DIR")
	if templateDir == "" {
		templateDir = filepath.Join(projectRoot, "app-templates", "v8")
	}

	uid, gid := hostUserIDs()

	cmd = exec.Command("docker", "buildx", "build",
		"-t", imageName,
		"--load",
		"--build-arg", fmt.Sprintf("HOST_UID=%d", uid),
		"--build-arg", fmt.Sprintf("HOST_GID=%d", gid),
		"--build-context", "dev-ca="+filepath.Join(projectRoot, ".dev-ca"),
		"--build-context", "dev-supervisor="+filepath.Join(projectRoot, "dev-supervisor"),
		"--build-context", "container-scripts="+filepath.Join(projectRoot, "container-scripts"),
		"-f", filepath.Join(templateDir, "Dockerfile.dev"),
		templateDir,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

func (m *Manager) buildPublishImageIfNeeded(projectRoot string) error {
	imageName := "aab-publish:latest"

	cmd := exec.Command("docker", "image", "inspect", imageName)
	if cmd.Run() == nil {
		return nil
	}

	slog.Info("docker.image.build", "image", imageName)

	uid, gid := hostUserIDs()
	publishDir := filepath.Join(projectRoot, "app-publish")

	cmd = exec.Command("docker", "buildx", "build",
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

	return cmd.Run()
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
