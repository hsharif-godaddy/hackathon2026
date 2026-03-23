package setup

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

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
// directories, template copy, git init, SSL certs, symlinks, config.json.
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
		filepath.Join(assetsPath, "private"),
		filepath.Join(base, "dist"),
		filepath.Join(base, "alloc", ".ssl"),
		filepath.Join(base, "local", "preview"),
		filepath.Join(base, "local", "publish"),
		filepath.Join(base, "tmp"),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
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
	if err := os.WriteFile(filepath.Join(previewPath, ".is_ready"), []byte{}, 0644); err != nil {
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
// moves .git to git-repo/, and creates a symlink preview/.git → ../git-repo/.git.
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
		if err := os.WriteFile(gitignorePath, append(existing, []byte(devSupervisorEntries)...), 0644); err != nil {
			return fmt.Errorf("write .gitignore: %w", err)
		}
	} else {
		if err := os.WriteFile(gitignorePath, []byte(devSupervisorEntries), 0644); err != nil {
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

	// Move .git from preview to git-repo
	previewGit := filepath.Join(previewPath, ".git")
	gitRepoGit := filepath.Join(gitRepoPath, ".git")

	if _, err := os.Stat(previewGit); err == nil {
		// Remove any existing .git in git-repo (from earlier failed attempt)
		os.RemoveAll(gitRepoGit)

		if err := os.Rename(previewGit, gitRepoGit); err != nil {
			return fmt.Errorf("move .git to git-repo: %w", err)
		}

		// Create symlink: preview/.git → ../git-repo/.git
		if err := os.Symlink("../git-repo/.git", previewGit); err != nil {
			return fmt.Errorf("create git symlink: %w", err)
		}

		slog.Info("setup.git.linked", "app_id", appID,
			"link", previewGit, "target", "../git-repo/.git")
	}

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

	// Add OAuth credentials if available in environment
	if clientID := os.Getenv("GODADDY_OAUTH_CLIENT_ID"); clientID != "" {
		config["GODADDY_OAUTH_CLIENT_ID"] = map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE":          clientID,
		}
	}
	if clientSecret := os.Getenv("GODADDY_OAUTH_CLIENT_SECRET"); clientSecret != "" {
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
		if err := os.WriteFile(p, data, 0600); err != nil {
			return fmt.Errorf("write %s: %w", p, err)
		}
	}

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

// generateSSLCerts creates TLS certificates for dev-supervisor HTTPS proxy.
// Writes cert.pem + key.pem to both {preview}/.ssl/ and {alloc}/.ssl/.
// Uses the project-level CA from .dev-ca/ if available; otherwise generates self-signed.
func (t *TemplateSetup) generateSSLCerts(appID, basePath string) error {
	previewSSL := filepath.Join(basePath, "preview", ".ssl")
	allocSSL := filepath.Join(basePath, "alloc", ".ssl")

	for _, dir := range []string{previewSSL, allocSSL} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}

	// Check if certs already exist in preview
	if _, err := os.Stat(filepath.Join(previewSSL, "cert.pem")); err == nil {
		slog.Info("setup.ssl.skip", "app_id", appID, "reason", "certs already exist")
		return nil
	}

	certPEM, keyPEM, err := t.createCertificate()
	if err != nil {
		return fmt.Errorf("create certificate: %w", err)
	}

	// Write to both locations (preview mounts /app, publish mounts /alloc/.ssl)
	for _, dir := range []string{previewSSL, allocSSL} {
		if err := os.WriteFile(filepath.Join(dir, "cert.pem"), certPEM, 0644); err != nil {
			return fmt.Errorf("write cert to %s: %w", dir, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "key.pem"), keyPEM, 0600); err != nil {
			return fmt.Errorf("write key to %s: %w", dir, err)
		}
	}

	slog.Info("setup.ssl.success", "app_id", appID)
	return nil
}

// createCertificate generates a TLS cert+key pair.
// If a project CA exists at {PROJECT_ROOT}/.dev-ca/, uses it to sign the cert.
// Otherwise creates a self-signed certificate.
func (t *TemplateSetup) createCertificate() (certPEM, keyPEM []byte, err error) {
	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}

	caDir := filepath.Join(projectRoot, ".dev-ca")
	caCertPath := filepath.Join(caDir, "ca-cert.pem")
	caKeyPath := filepath.Join(caDir, "ca-key.pem")

	// Generate leaf key
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("generate key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, fmt.Errorf("generate serial number: %w", err)
	}

	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}

	var certDER []byte

	// Try CA-signed first
	if caCertPEM, err := os.ReadFile(caCertPath); err == nil {
		if caKeyPEMData, err := os.ReadFile(caKeyPath); err == nil {
			certDER, err = signWithCA(template, leafKey, caCertPEM, caKeyPEMData)
			if err != nil {
				slog.Warn("setup.ssl.ca_sign_failed", "error", err, "fallback", "self-signed")
			}
		}
	}

	// Fallback to self-signed
	if certDER == nil {
		template.IsCA = false
		template.BasicConstraintsValid = true
		certDER, err = x509.CreateCertificate(rand.Reader, template, template, &leafKey.PublicKey, leafKey)
		if err != nil {
			return nil, nil, fmt.Errorf("self-sign: %w", err)
		}
		slog.Info("setup.ssl.self_signed")
	}

	keyDER, err := x509.MarshalECPrivateKey(leafKey)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal key: %w", err)
	}

	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	return certPEM, keyPEM, nil
}

func signWithCA(template *x509.Certificate, leafKey *ecdsa.PrivateKey, caCertPEM, caKeyPEM []byte) ([]byte, error) {
	caBlock, _ := pem.Decode(caCertPEM)
	if caBlock == nil {
		return nil, fmt.Errorf("decode CA cert PEM")
	}
	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse CA cert: %w", err)
	}

	keyBlock, _ := pem.Decode(caKeyPEM)
	if keyBlock == nil {
		return nil, fmt.Errorf("decode CA key PEM")
	}

	// The TypeScript version uses node-forge which generates RSA keys
	caKey, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	if err != nil {
		// Try PKCS8 as fallback
		caKeyAny, err2 := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
		if err2 != nil {
			return nil, fmt.Errorf("parse CA key (PKCS1: %v, PKCS8: %v)", err, err2)
		}
		return x509.CreateCertificate(rand.Reader, template, caCert, &leafKey.PublicKey, caKeyAny)
	}

	return x509.CreateCertificate(rand.Reader, template, caCert, &leafKey.PublicKey, caKey)
}
