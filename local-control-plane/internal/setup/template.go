package setup

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/airo-ai-builder/local-control-plane/internal/projectenv"
)

// validCommitRef bounds the reset target to git-ref-shaped strings (SHAs,
// branch/tag names, HEAD~n, etc.). exec.Command already avoids shell injection,
// but this rejects obvious garbage early and keeps the trusted surface explicit
// — defense-in-depth on a value that flows from an HTTP body into git. The
// first char may not be '-' so the target can never be misread as a git flag.
var validCommitRef = regexp.MustCompile(`^[A-Za-z0-9._/~^@{}][A-Za-z0-9._/~^@{}-]{0,254}$`)

// DBCredentials holds MySQL database credentials from provisioning.
type DBCredentials struct {
	Name     string
	Username string
	Password string
}

// TemplateSetup handles app workspace provisioning:
// template copying, git init, directory structure, and config.json.
type TemplateSetup struct {
	appsBaseDir string
	templateDir string
}

func NewTemplateSetup() *TemplateSetup {
	appsBaseDir := os.Getenv("APPS_BASE_DIR")
	if appsBaseDir == "" {
		appsBaseDir = "/tmp/airo-app-builder"
	}

	templateDir := os.Getenv("APP_TEMPLATE_DIR")
	if templateDir == "" {
		projectRoot := os.Getenv("PROJECT_ROOT")
		if projectRoot == "" {
			projectRoot = ".."
		}
		templateDir = filepath.Join(projectRoot, "app-templates", "v8")
	}

	return &TemplateSetup{
		appsBaseDir: appsBaseDir,
		templateDir: templateDir,
	}
}

// GetBasePath returns the base directory for an app.
func (t *TemplateSetup) GetBasePath(appID string) string {
	return filepath.Join(t.appsBaseDir, appID)
}

// Provision creates the full app workspace:
// directories, template copy, git init, SSL certs, config.json.
func (t *TemplateSetup) Provision(appID string, previewPort, publishPort, supervisorPort int, dbCreds *DBCredentials) error {
	base := t.GetBasePath(appID)

	slog.Info("setup.provision.start", "app_id", appID, "base", base)

	previewPath := filepath.Join(base, "preview")
	gitRepoPath := filepath.Join(base, "git-repo")
	assetsPath := filepath.Join(base, "assets")

	// Create directory structure matching V4 layout
	dirs := []string{
		previewPath,
		filepath.Join(base, "publish"),
		gitRepoPath,
		filepath.Join(assetsPath, "public"),
		// Pre-create subdirs inside assets/public so Docker Desktop's VirtioFS bind mount
		// is non-empty at container start — otherwise new files written after startup are
		// not visible inside the container (/shared-storage/public/assets/*).
		filepath.Join(assetsPath, "public", "media"),
		filepath.Join(assetsPath, "public", "images"),
		filepath.Join(assetsPath, "public", "uploads"),
		filepath.Join(assetsPath, "private"),
		filepath.Join(base, "dist"),
		filepath.Join(base, "alloc", ".ssl"),
		filepath.Join(base, "local", "preview"),
		filepath.Join(base, "local", "publish"),
		filepath.Join(base, "tmp"),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create directory %s: %w", dir, err)
		}
	}

	// Copy template to preview workspace (if template exists)
	if _, err := os.Stat(t.templateDir); err == nil {
		if err := t.copyTemplate(previewPath); err != nil {
			slog.Warn("setup.template_copy.failed", "app_id", appID, "error", err)
		}
	}

	// Create .is_ready file to signal template is ready for Docker container
	if err := os.WriteFile(filepath.Join(previewPath, ".is_ready"), []byte{}, 0o644); err != nil {
		return fmt.Errorf("write .is_ready: %w", err)
	}

	// Initialize git in preview, commit template files, then move .git to git-repo
	if err := t.initGitWithTemplate(appID, previewPath, gitRepoPath); err != nil {
		slog.Warn("setup.git_init.failed", "app_id", appID, "error", err)
	}

	// Generate SSL certificates for HTTPS (preview needs /app/.ssl, publish needs /alloc/.ssl)
	if err := t.generateSSLCerts(appID, base); err != nil {
		slog.Warn("setup.ssl.failed", "app_id", appID, "error", err)
	}

	// Write config.json files (database config for the app)
	if err := t.writeConfigFiles(base, appID, dbCreds); err != nil {
		return fmt.Errorf("write config files: %w", err)
	}

	// Write auth.json for IDP OAuth credentials (if configured)
	if err := t.writeAuthFile(base); err != nil {
		slog.Warn("setup.auth_file.failed", "app_id", appID, "error", err)
	}

	slog.Info("setup.provision.complete", "app_id", appID)
	return nil
}

func (t *TemplateSetup) copyTemplate(destPath string) error {
	cmd := exec.Command("cp", "-a", t.templateDir+"/.", destPath+"/")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// initGitWithTemplate initializes git in preview/, commits template files,
// then moves .git to git-repo/. Inside the preview container, git-repo/.git
// is bind-mounted directly at /app/.git (see docker/compose.go), so no host
// symlink in preview/ is required — every consumer of git state goes through
// dev-supervisor against the in-container /app workdir.
func (t *TemplateSetup) initGitWithTemplate(appID, previewPath, gitRepoPath string) error {
	// Initialize git in preview workspace
	cmd := exec.Command("git", "init", "--initial-branch=main")
	cmd.Dir = previewPath
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git init: %w", err)
	}

	// Configure git user
	for _, args := range [][]string{
		{"config", "user.email", "ai@airo.dev"},
		{"config", "user.name", "Airo AI Builder"},
	} {
		cmd = exec.Command("git", args...)
		cmd.Dir = previewPath
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("git %s: %w", args[0], err)
		}
	}

	// Add dev-supervisor to .gitignore
	gitignorePath := filepath.Join(previewPath, ".gitignore")
	devSupervisorEntries := "\n# Dev supervisor binary\ndev-supervisor\ndev-supervisor/\ndev-supervisor/dev-supervisor\n"
	if existing, err := os.ReadFile(gitignorePath); err == nil {
		if err := os.WriteFile(gitignorePath, append(existing, []byte(devSupervisorEntries)...), 0o644); err != nil {
			return fmt.Errorf("write .gitignore: %w", err)
		}
	} else {
		if err := os.WriteFile(gitignorePath, []byte(devSupervisorEntries), 0o644); err != nil {
			return fmt.Errorf("write .gitignore: %w", err)
		}
	}

	// Create initial commit with template files
	cmd = exec.Command("git", "add", "-A")
	cmd.Dir = previewPath
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git add: %w", err)
	}

	cmd = exec.Command("git", "commit", "-m", "Initial commit\n\nGenerated by Airo AI Builder with template files.")
	cmd.Dir = previewPath
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git commit: %w", err)
	}

	// Move .git from preview/ to git-repo/. The container bind-mounts
	// git-repo/.git at /app/.git, so no preview/.git symlink is needed.
	previewGit := filepath.Join(previewPath, ".git")
	gitRepoGit := filepath.Join(gitRepoPath, ".git")

	if _, err := os.Stat(previewGit); err == nil {
		// Remove any existing .git in git-repo (from earlier failed attempt). Best-effort.
		_ = os.RemoveAll(gitRepoGit)

		if err := os.Rename(previewGit, gitRepoGit); err != nil {
			return fmt.Errorf("move .git to git-repo: %w", err)
		}

		slog.Info("setup.git.moved", "app_id", appID, "from", previewGit, "to", gitRepoGit)
	}

	return nil
}

// ResetWorkspace hard-resets an app's git working tree to the given commit
// (or HEAD when commit is empty) and removes untracked files, returning the
// workspace to a known state. Used by eval stateful-injection to reuse one
// pre-built app across trials without re-provisioning.
//
// The repo's .git lives in git-repo/ while the working tree is preview/ (see
// initGitWithTemplate), so every git invocation is explicit about both via
// --git-dir / --work-tree. This does NOT restart the container or restore
// node_modules — the caller is responsible for DockerManager.Restart, which
// triggers the container's existing dependency re-sync path.
func (t *TemplateSetup) ResetWorkspace(appID, commit string) error {
	base := t.GetBasePath(appID)
	gitDir := filepath.Join(base, "git-repo", ".git")
	workTree := filepath.Join(base, "preview")

	if _, err := os.Stat(gitDir); err != nil {
		return fmt.Errorf("git repo not found for app %s at %s: %w", appID, gitDir, err)
	}

	target := commit
	if target == "" {
		target = "HEAD"
	} else if !validCommitRef.MatchString(target) {
		return fmt.Errorf("invalid commit ref for app %s: %q", appID, target)
	}

	gitArgs := [][]string{
		{"reset", "--hard", target},
		// Drop untracked files/dirs the agent created (e.g. new routes). Use
		// -fd, NOT -fdx: gitignored paths (node_modules/, .env, .ssl/*.pem) are
		// deliberately preserved so the reset doesn't wipe deps/certs that the
		// container restart would otherwise have to rebuild. Consequence:
		// gitignored build artifacts (e.g. .next/) also survive — DockerManager
		// .Restart re-syncs them, so the tracked tree (not the whole dir) is
		// what's restored to the target commit.
		{"clean", "-fd"},
	}
	for _, args := range gitArgs {
		full := append([]string{"--git-dir=" + gitDir, "--work-tree=" + workTree}, args...)
		cmd := exec.Command("git", full...)
		var stderr strings.Builder
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("git %s (app %s): %w: %s", args[0], appID, err, stderr.String())
		}
	}

	slog.Info("setup.workspace.reset", "app_id", appID, "commit", target)
	return nil
}

func (t *TemplateSetup) writeConfigFiles(basePath, appID string, dbCreds *DBCredentials) error {
	allocPath := filepath.Join(basePath, "alloc")
	previewLocalPath := filepath.Join(basePath, "local", "preview")
	publishLocalPath := filepath.Join(basePath, "local", "publish")

	// Use provisioned credentials if available, otherwise use fallback
	dbName := "airo_" + sanitizeForDB(appID)
	dbUser := "airo_" + sanitizeForDB(appID)
	dbPassword := "devpassword"
	if dbCreds != nil && dbCreds.Name != "" {
		dbName = dbCreds.Name
		dbUser = dbCreds.Username
		dbPassword = dbCreds.Password
	}

	config := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE": map[string]any{
				"NAME":               dbName,
				"HOST":               "airo-app-mysql",
				"IP":                 "airo-app-mysql",
				"PORT":               3306,
				"USERNAME":           dbUser,
				"PASSWORD":           dbPassword,
				"READ_ONLY_USERNAME": dbUser + "_readonly",
				"READ_ONLY_PASSWORD": "",
				"VARIANT":            "local",
			},
		},
	}

	// Add OAuth credentials if available in process env or project env files
	if clientID := projectenv.Resolve("GODADDY_OAUTH_CLIENT_ID"); clientID != "" {
		config["GODADDY_OAUTH_CLIENT_ID"] = map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE":          clientID,
		}
	}
	if clientSecret := projectenv.Resolve("GODADDY_OAUTH_CLIENT_SECRET"); clientSecret != "" {
		config["GODADDY_OAUTH_CLIENT_SECRET"] = map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE":          clientSecret,
		}
	}

	// Add JWT redirect URL for dev-supervisor auth failure redirects
	appURL := os.Getenv("NEXT_PUBLIC_APP_URL")
	if appURL == "" {
		appURL = "https://local.gasket.dev-godaddy.com:8443"
	}
	config["JWT_REDIRECT_URL"] = map[string]any{
		"SYSTEM_MANAGED": true,
		"VALUE":          fmt.Sprintf("%s/develop/%s?siteId=%s", appURL, appID, appID),
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	paths := []string{
		filepath.Join(allocPath, "preview-config.json"),
		filepath.Join(allocPath, "publish-config.json"),
		filepath.Join(previewLocalPath, "config.json"),
		filepath.Join(publishLocalPath, "config.json"),
	}

	for _, p := range paths {
		if err := os.WriteFile(p, data, 0o600); err != nil {
			return fmt.Errorf("write %s: %w", p, err)
		}
	}

	return nil
}

// writeAuthFile writes auth.json to the alloc directory for IDP OAuth credentials.
// Mirrors the production auth.json three-row format from backends/hosting:
//   - SSO_OAUTH_CONFIG — cache row with IDP metadata, deployment config, and pointer keys
//   - <clientIdKey>    — row whose VALUE is the raw client ID
//   - <clientSecretKey> — row whose VALUE is the raw client secret
//
// All IDP-related config (issuer, redirectUri, credentials) lives in this file. dev-supervisor reads everything from auth.json — no separate
// env vars needed for IDP config.
//
// Only written when DEV_SUPERVISOR_IDP_CLIENT_ID is set in the environment.
func (t *TemplateSetup) writeAuthFile(basePath string) error {
	clientID := os.Getenv("DEV_SUPERVISOR_IDP_CLIENT_ID")
	if clientID == "" {
		return nil // IDP auth not configured — skip
	}

	clientSecret := os.Getenv("DEV_SUPERVISOR_IDP_CLIENT_SECRET")
	issuer := os.Getenv("DEV_SUPERVISOR_IDP_ISSUER")
	if issuer == "" {
		issuer = "https://godaddy.okta.com"
	}

	// Pointer key names — match the convention used by airo-go's SSOOAuthConfigMirror.
	clientIDKey := "SSO_CLIENT_ID_local"
	clientSecretKey := "SSO_CLIENT_SECRET_local" //nolint:gosec // JSON key name, not a credential

	authConfig := map[string]any{
		// Cache row: IDP metadata, deployment config, and pointer keys to the credential rows below.
		"SSO_OAUTH_CONFIG": map[string]any{
			"SYSTEM_MANAGED": true,
			"AUTH":           true,
			"VALUE": map[string]any{
				"idpType":          "godaddy_employee",
				"issuer":           issuer,
				"jwksUrl":          issuer + "/oauth2/v1/keys",
				"expectedAudience": clientID,
				"ssoRequired":      true,
				"clientIdKey":      clientIDKey,
				"clientSecretKey":  clientSecretKey,
			},
		},
		// Client ID row (customer-writable in production).
		clientIDKey: map[string]any{
			"SYSTEM_MANAGED": false,
			"AUTH":           true,
			"VALUE":          clientID,
		},
		// Client secret row (customer-writable in production).
		clientSecretKey: map[string]any{
			"SYSTEM_MANAGED": false,
			"AUTH":           true,
			"VALUE":          clientSecret,
		},
	}

	data, err := json.MarshalIndent(authConfig, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal auth config: %w", err)
	}

	authDir := filepath.Join(basePath, "alloc", "hosting")
	if err := os.MkdirAll(authDir, 0o755); err != nil {
		return fmt.Errorf("create hosting dir %s: %w", authDir, err)
	}

	authPath := filepath.Join(authDir, "auth.json")
	if err := os.WriteFile(authPath, data, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", authPath, err)
	}

	slog.Info("setup.auth_file.written", "path", authPath, "issuer", issuer)
	return nil
}

// sanitizeForDB makes an app ID safe for use in MySQL database/user names.
func sanitizeForDB(appID string) string {
	result := make([]byte, 0, len(appID))
	for _, c := range []byte(appID) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			result = append(result, c)
		}
	}
	return string(result)
}

// generateSSLCerts copies Gasket dev certs for dev-supervisor HTTPS proxy.
// Writes cert.pem (leaf + intermediate chain) and key.pem to both {preview}/.ssl/ and {alloc}/.ssl/.
func (t *TemplateSetup) generateSSLCerts(appID, basePath string) error {
	previewSSL := filepath.Join(basePath, "preview", ".ssl")
	allocSSL := filepath.Join(basePath, "alloc", ".ssl")

	for _, dir := range []string{previewSSL, allocSSL} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}

	// Check if certs already exist in both directories
	allPresent := true
	for _, dir := range []string{previewSSL, allocSSL} {
		for _, name := range []string{"cert.pem", "key.pem"} {
			if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
				allPresent = false
				break
			}
		}
		if !allPresent {
			break
		}
	}
	if allPresent {
		slog.Info("setup.ssl.skip", "app_id", appID, "reason", "certs already exist")
		return nil
	}

	certPEM, keyPEM, err := loadGasketCert()
	if err != nil {
		return fmt.Errorf("load gasket cert: %w", err)
	}

	// Write to both locations (preview mounts /app, publish mounts /alloc/.ssl)
	for _, dir := range []string{previewSSL, allocSSL} {
		if err := os.WriteFile(filepath.Join(dir, "cert.pem"), certPEM, 0o644); err != nil {
			return fmt.Errorf("write cert to %s: %w", dir, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "key.pem"), keyPEM, 0o600); err != nil {
			return fmt.Errorf("write key to %s: %w", dir, err)
		}
	}

	slog.Info("setup.ssl.success", "app_id", appID)
	return nil
}

// gasketCertDir returns the path to the Gasket dev cert directory.
func gasketCertDir() string {
	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}
	return filepath.Join(projectRoot, "app", "node_modules", "@godaddy", "gasket-plugin-dev-certs", "certs")
}

// loadGasketCert reads the Gasket wildcard dev cert files and returns
// certPEM (leaf + intermediate chain concatenated) and keyPEM.
func loadGasketCert() (certPEM, keyPEM []byte, err error) {
	dir := gasketCertDir()

	leafCert, err := os.ReadFile(filepath.Join(dir, "_.gasket.dev-godaddy.com.crt"))
	if err != nil {
		return nil, nil, fmt.Errorf("read leaf cert: %w (run pnpm install first)", err)
	}

	chain, err := os.ReadFile(filepath.Join(dir, "_.gasket.dev-godaddy.com_intermediate_chain.crt"))
	if err != nil {
		return nil, nil, fmt.Errorf("read intermediate chain: %w (run pnpm install first)", err)
	}

	keyPEM, err = os.ReadFile(filepath.Join(dir, "_.gasket.dev-godaddy.com.key"))
	if err != nil {
		return nil, nil, fmt.Errorf("read key: %w (run pnpm install first)", err)
	}

	// Concatenate leaf + chain for full cert PEM, ensuring newline separator
	certPEM = append([]byte{}, leafCert...)
	if len(certPEM) > 0 && certPEM[len(certPEM)-1] != '\n' {
		certPEM = append(certPEM, '\n')
	}
	certPEM = append(certPEM, chain...)

	return certPEM, keyPEM, nil
}
