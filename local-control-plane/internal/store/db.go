package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const nanoidAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

// appIDLength is the length of a generated app id (see generateAppID).
const appIDLength = 10

func generateNanoid(length int) (string, error) {
	b := make([]byte, length)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(nanoidAlphabet))))
		if err != nil {
			return "", fmt.Errorf("generate random index: %w", err)
		}
		b[i] = nanoidAlphabet[n.Int64()]
	}
	return string(b), nil
}

func generateAppID() (string, error) {
	return generateNanoid(appIDLength)
}

// IsValidAppID reports whether id has the canonical app-id shape: an
// appIDLength-character string drawn from nanoidAlphabet. It is the single
// source of truth for app-id validation — shared by the docker reconcile and
// agents-cleanup paths — so their gates can't drift from what generateAppID
// emits.
func IsValidAppID(id string) bool {
	if len(id) != appIDLength {
		return false
	}
	for _, ch := range id {
		if !strings.ContainsRune(nanoidAlphabet, ch) {
			return false
		}
	}
	return true
}

func generateJobID() (string, error) {
	return generateNanoid(8)
}

func generateDeploymentID() (string, error) {
	return generateNanoid(10)
}

type DB struct {
	db *sql.DB
	mu sync.RWMutex
}

func Open(path string) (*DB, error) {
	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	sqlDB.SetMaxOpenConns(1)

	if _, err := sqlDB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("set journal_mode: %w", err)
	}
	if _, err := sqlDB.Exec("PRAGMA busy_timeout=5000"); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("set busy_timeout: %w", err)
	}

	d := &DB{db: sqlDB}
	if err := d.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	slog.Info("database.open", "path", path)
	return d, nil
}

func (d *DB) Close() error {
	return d.db.Close()
}

func (d *DB) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS apps (
			id TEXT PRIMARY KEY,
			subscription_id TEXT NOT NULL,
			system_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			variables TEXT DEFAULT '{}',
			variants TEXT DEFAULT '["preview"]',
			preview_port INTEGER DEFAULT 0,
			publish_port INTEGER DEFAULT 0,
			supervisor_port INTEGER DEFAULT 0,
			publish_supervisor_port INTEGER DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS jobs (
			id TEXT PRIMARY KEY,
			app_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			error TEXT DEFAULT '',
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS secrets (
			app_id TEXT NOT NULL,
			variant TEXT NOT NULL,
			name TEXT NOT NULL,
			value TEXT NOT NULL DEFAULT '',
			system_managed INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (app_id, variant, name)
		)`,
	}

	for _, m := range migrations {
		if _, err := d.db.Exec(m); err != nil {
			return fmt.Errorf("exec migration: %w", err)
		}
	}

	// Column migrations for existing databases — ignore "duplicate column" errors
	if _, err := d.db.Exec(`ALTER TABLE apps ADD COLUMN publish_supervisor_port INTEGER DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add publish_supervisor_port column: %w", err)
		}
	}

	if _, err := d.db.Exec(`ALTER TABLE apps ADD COLUMN image_digest TEXT NOT NULL DEFAULT ''`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add image_digest column: %w", err)
		}
	}

	if _, err := d.db.Exec(`ALTER TABLE apps ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'running'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add lifecycle_state column: %w", err)
		}
	}

	if _, err := d.db.Exec(`ALTER TABLE jobs ADD COLUMN job_type TEXT DEFAULT 'airo-job'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add job_type column: %w", err)
		}
	}

	if _, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS subscriptions (
		id TEXT PRIMARY KEY,
		product_id TEXT NOT NULL DEFAULT 'aab-v1',
		owner_product TEXT NOT NULL DEFAULT 'AiroAppBuilder',
		customer_id TEXT NOT NULL DEFAULT 'local-customer-001',
		status TEXT NOT NULL DEFAULT 'active',
		reason TEXT NOT NULL DEFAULT '',
		is_trial INTEGER NOT NULL DEFAULT 1,
		had_airo_plus INTEGER NOT NULL DEFAULT 0,
		token_budget_id TEXT NOT NULL DEFAULT 'trial',
		bms_budget_id TEXT NOT NULL DEFAULT '',
		plan TEXT NOT NULL DEFAULT 'professional',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create subscriptions table: %w", err)
	}

	// Add reason column to existing subscriptions tables (idempotent)
	if _, err := d.db.Exec(`ALTER TABLE subscriptions ADD COLUMN reason TEXT NOT NULL DEFAULT ''`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add reason column: %w", err)
		}
	}

	// Add bms_budget_id column to existing subscriptions tables (idempotent)
	if _, err := d.db.Exec(`ALTER TABLE subscriptions ADD COLUMN bms_budget_id TEXT NOT NULL DEFAULT ''`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add bms_budget_id column: %w", err)
		}
	}

	if _, err := d.db.Exec(`ALTER TABLE subscriptions ADD COLUMN customer_id TEXT NOT NULL DEFAULT 'local-customer-001'`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("add customer_id column: %w", err)
		}
	}

	// Migrate existing free-plan subscriptions to professional so local publishing works
	// out of the box now that paywall feature flags have been removed.
	if _, err := d.db.Exec(`UPDATE subscriptions SET plan = 'professional' WHERE plan = 'free'`); err != nil {
		return fmt.Errorf("migrate free subscriptions to professional: %w", err)
	}

	if _, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS deployments (
		id TEXT PRIMARY KEY,
		app_id TEXT NOT NULL,
		git_hash TEXT NOT NULL DEFAULT 'local',
		variant TEXT NOT NULL DEFAULT 'publish',
		status TEXT NOT NULL DEFAULT 'pending',
		status_job_id TEXT NOT NULL DEFAULT '',
		attempts INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create deployments table: %w", err)
	}

	if _, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS automations (
		id TEXT PRIMARY KEY,
		app_id TEXT NOT NULL,
		name TEXT NOT NULL,
		defn_type TEXT NOT NULL DEFAULT 'file',
		defn_location TEXT NOT NULL DEFAULT '.airo/jobs',
		defn_ref TEXT NOT NULL,
		trigger_type TEXT NOT NULL DEFAULT 'cron',
		cron_expr TEXT NOT NULL DEFAULT '',
		enabled INTEGER NOT NULL DEFAULT 1,
		deleted INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create automations table: %w", err)
	}

	if _, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS automation_runs (
		id TEXT PRIMARY KEY,
		automation_id TEXT NOT NULL,
		app_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'dispatched',
		trigger_type TEXT NOT NULL DEFAULT 'manual',
		summary_ref TEXT NOT NULL DEFAULT '',
		error_message TEXT NOT NULL DEFAULT '',
		started_at TEXT NOT NULL,
		finished_at TEXT
	)`); err != nil {
		return fmt.Errorf("create automation_runs table: %w", err)
	}

	return nil
}

// CreateApp inserts a new app record and returns the generated ID.
func (d *DB) CreateApp(subscriptionID, systemID string, variables map[string]any, variants []string) (*App, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	id, err := generateAppID()
	if err != nil {
		return nil, fmt.Errorf("generate app ID: %w", err)
	}
	now := time.Now().UTC()

	if variants == nil {
		variants = []string{"preview"}
	}

	varsJSON, err := json.Marshal(variables)
	if err != nil {
		return nil, fmt.Errorf("marshal app variables: %w", err)
	}
	variantsJSON, err := json.Marshal(variants)
	if err != nil {
		return nil, fmt.Errorf("marshal app variants: %w", err)
	}

	_, err = d.db.Exec(
		`INSERT INTO apps (id, subscription_id, system_id, status, variables, variants, lifecycle_state, created_at, updated_at)
		 VALUES (?, ?, ?, 'provisioning', ?, ?, ?, ?, ?)`,
		id, subscriptionID, systemID, string(varsJSON), string(variantsJSON),
		LifecycleStateProvisioning,
		now.Format(time.RFC3339), now.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("insert app: %w", err)
	}

	app := &App{
		ID:             id,
		SubscriptionID: subscriptionID,
		SystemID:       systemID,
		Status:         "provisioning",
		Variables:      variables,
		Variants:       variants,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	app.LifecycleState = LifecycleStateProvisioning
	return app, nil
}

// GetApp retrieves an app by ID.
func (d *DB) GetApp(id string) (*App, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	return d.getAppUnlocked(id)
}

func (d *DB) getAppUnlocked(id string) (*App, error) {
	var (
		app          App
		varsJSON     string
		variantsJSON string
		createdAt    string
		updatedAt    string
	)

	err := d.db.QueryRow(
		`SELECT id, subscription_id, system_id, status, variables, variants,
		        preview_port, publish_port, supervisor_port, publish_supervisor_port,
		        image_digest, lifecycle_state, created_at, updated_at
		 FROM apps WHERE id = ?`, id,
	).Scan(
		&app.ID, &app.SubscriptionID, &app.SystemID, &app.Status,
		&varsJSON, &variantsJSON,
		&app.PreviewPort, &app.PublishPort, &app.SupervisorPort, &app.PublishSupervisorPort,
		&app.ImageDigest, &app.LifecycleState,
		&createdAt, &updatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query app: %w", err)
	}

	if err := json.Unmarshal([]byte(varsJSON), &app.Variables); err != nil {
		return nil, fmt.Errorf("unmarshal app variables: %w", err)
	}
	if err := json.Unmarshal([]byte(variantsJSON), &app.Variants); err != nil {
		return nil, fmt.Errorf("unmarshal app variants: %w", err)
	}
	app.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	app.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)

	return &app, nil
}

// ListApps returns all apps for a given subscription and system.
func (d *DB) ListApps(subscriptionID, systemID string) ([]*App, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(
		`SELECT id, subscription_id, system_id, status, variables, variants,
		        preview_port, publish_port, supervisor_port, publish_supervisor_port,
		        image_digest, lifecycle_state, created_at, updated_at
		 FROM apps WHERE subscription_id = ? AND system_id = ?
		 ORDER BY created_at DESC`, subscriptionID, systemID,
	)
	if err != nil {
		return nil, fmt.Errorf("query apps: %w", err)
	}
	defer rows.Close()

	return d.scanApps(rows)
}

// ListAllApps returns all apps.
func (d *DB) ListAllApps() ([]*App, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(
		`SELECT id, subscription_id, system_id, status, variables, variants,
		        preview_port, publish_port, supervisor_port, publish_supervisor_port,
		        image_digest, lifecycle_state, created_at, updated_at
		 FROM apps ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("query all apps: %w", err)
	}
	defer rows.Close()

	return d.scanApps(rows)
}

func (d *DB) ListAppsByCustomer(customerID string) ([]*App, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(
		`SELECT a.id, a.subscription_id, a.system_id, a.status, a.variables, a.variants,
		        a.preview_port, a.publish_port, a.supervisor_port, a.publish_supervisor_port,
		        a.image_digest, a.lifecycle_state, a.created_at, a.updated_at
		 FROM apps a
		 JOIN subscriptions s ON a.subscription_id = s.id
		 WHERE s.customer_id = ?
		 ORDER BY a.created_at DESC`, customerID,
	)
	if err != nil {
		return nil, fmt.Errorf("query apps by customer: %w", err)
	}
	defer rows.Close()

	return d.scanApps(rows)
}

func (d *DB) scanApps(rows *sql.Rows) ([]*App, error) {
	var apps []*App
	for rows.Next() {
		var (
			app          App
			varsJSON     string
			variantsJSON string
			createdAt    string
			updatedAt    string
		)

		if err := rows.Scan(
			&app.ID, &app.SubscriptionID, &app.SystemID, &app.Status,
			&varsJSON, &variantsJSON,
			&app.PreviewPort, &app.PublishPort, &app.SupervisorPort, &app.PublishSupervisorPort,
			&app.ImageDigest, &app.LifecycleState,
			&createdAt, &updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan app: %w", err)
		}

		if err := json.Unmarshal([]byte(varsJSON), &app.Variables); err != nil {
			return nil, fmt.Errorf("unmarshal app variables: %w", err)
		}
		if err := json.Unmarshal([]byte(variantsJSON), &app.Variants); err != nil {
			return nil, fmt.Errorf("unmarshal app variants: %w", err)
		}
		app.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		app.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)

		apps = append(apps, &app)
	}
	return apps, nil
}

// UpdateApp updates an app's status, variables, and/or variants.
func (d *DB) UpdateApp(id string, status *string, variables map[string]any, variants []string) (*App, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	app, err := d.getAppUnlocked(id)
	if err != nil {
		return nil, fmt.Errorf("query app %s: %w", id, err)
	}
	if app == nil {
		return nil, fmt.Errorf("app not found: %s", id)
	}

	if status != nil {
		app.Status = *status
	}

	if variables != nil {
		if app.Variables == nil {
			app.Variables = make(map[string]any)
		}
		for k, v := range variables {
			app.Variables[k] = v
		}
	}

	if variants != nil {
		app.Variants = variants
	}

	app.UpdatedAt = time.Now().UTC()
	varsJSON, err := json.Marshal(app.Variables)
	if err != nil {
		return nil, fmt.Errorf("marshal app variables: %w", err)
	}
	variantsJSON, err := json.Marshal(app.Variants)
	if err != nil {
		return nil, fmt.Errorf("marshal app variants: %w", err)
	}

	_, err = d.db.Exec(
		`UPDATE apps SET status = ?, variables = ?, variants = ?, updated_at = ? WHERE id = ?`,
		app.Status, string(varsJSON), string(variantsJSON), app.UpdatedAt.Format(time.RFC3339), id,
	)
	if err != nil {
		return nil, fmt.Errorf("update app: %w", err)
	}

	return app, nil
}

// UpdateAppPorts stores port allocations for an app.
func (d *DB) UpdateAppPorts(id string, previewPort, publishPort, supervisorPort, publishSupervisorPort int) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(
		`UPDATE apps SET preview_port = ?, publish_port = ?, supervisor_port = ?, publish_supervisor_port = ? WHERE id = ?`,
		previewPort, publishPort, supervisorPort, publishSupervisorPort, id,
	)
	return err
}

// UpdateAppImageDigest sets the image_digest for an app.
func (d *DB) UpdateAppImageDigest(appID, digest string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	res, err := d.db.Exec(
		`UPDATE apps SET image_digest = ?, updated_at = ? WHERE id = ?`,
		digest,
		time.Now().UTC().Format(time.RFC3339),
		appID,
	)
	if err != nil {
		return fmt.Errorf("update app image_digest: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if n == 0 {
		return ErrAppNotFound
	}
	return nil
}

// UpdateAppLifecycleState sets the lifecycle_state for an app.
func (d *DB) UpdateAppLifecycleState(appID, state string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	res, err := d.db.Exec(
		`UPDATE apps SET lifecycle_state = ?, updated_at = ? WHERE id = ?`,
		state,
		time.Now().UTC().Format(time.RFC3339),
		appID,
	)
	if err != nil {
		return fmt.Errorf("update app lifecycle_state: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if n == 0 {
		return ErrAppNotFound
	}
	return nil
}

// DeleteApp removes an app by ID.
func (d *DB) DeleteApp(id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(`DELETE FROM apps WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete app: %w", err)
	}

	// Also delete associated jobs and secrets (best-effort cleanup; the app row is already gone).
	if _, err := d.db.Exec(`DELETE FROM jobs WHERE app_id = ?`, id); err != nil {
		slog.Warn("delete app jobs failed", "app_id", id, "error", err)
	}
	if _, err := d.db.Exec(`DELETE FROM secrets WHERE app_id = ?`, id); err != nil {
		slog.Warn("delete app secrets failed", "app_id", id, "error", err)
	}

	return nil
}

// CreateJob inserts a new job record with pending status.
func (d *DB) CreateJob(appID, jobType string) (*Job, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	id, err := generateJobID()
	if err != nil {
		return nil, fmt.Errorf("generate job ID: %w", err)
	}
	now := time.Now().UTC()

	_, err = d.db.Exec(
		`INSERT INTO jobs (id, app_id, status, job_type, created_at) VALUES (?, ?, 'pending', ?, ?)`,
		id, appID, jobType, now.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("insert job: %w", err)
	}

	return &Job{
		ID:        id,
		AppID:     appID,
		Status:    "pending",
		JobType:   jobType,
		CreatedAt: now,
	}, nil
}

// UpdateJobStatus sets the status and optional error message for a job.
func (d *DB) UpdateJobStatus(jobID, status, errMsg string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(
		`UPDATE jobs SET status = ?, error = ? WHERE id = ?`,
		status, errMsg, jobID,
	)
	return err
}

// GetJob retrieves a job by ID.
func (d *DB) GetJob(id string) (*Job, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var (
		job       Job
		createdAt string
	)

	err := d.db.QueryRow(
		`SELECT id, app_id, status, error, job_type, created_at FROM jobs WHERE id = ?`, id,
	).Scan(&job.ID, &job.AppID, &job.Status, &job.Error, &job.JobType, &createdAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query job: %w", err)
	}

	job.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	return &job, nil
}

// GetSecrets returns all secrets for an app and optional variant filter.
func (d *DB) GetSecrets(appID string, variant *string) ([]Secret, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var rows *sql.Rows
	var err error

	if variant != nil {
		rows, err = d.db.Query(
			`SELECT app_id, variant, name, value, system_managed
			 FROM secrets WHERE app_id = ? AND (variant = ? OR variant = 'shared')
			 ORDER BY name`, appID, *variant,
		)
	} else {
		rows, err = d.db.Query(
			`SELECT app_id, variant, name, value, system_managed
			 FROM secrets WHERE app_id = ? ORDER BY name`, appID,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("query secrets: %w", err)
	}
	defer rows.Close()

	var secrets []Secret
	for rows.Next() {
		var s Secret
		if err := rows.Scan(&s.AppID, &s.Variant, &s.Name, &s.Value, &s.SystemManaged); err != nil {
			return nil, fmt.Errorf("scan secret: %w", err)
		}
		secrets = append(secrets, s)
	}
	return secrets, nil
}

// UpsertSecret creates or updates a secret.
func (d *DB) UpsertSecret(appID, variant, name, value string, systemManaged bool) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	sm := 0
	if systemManaged {
		sm = 1
	}

	_, err := d.db.Exec(
		`INSERT INTO secrets (app_id, variant, name, value, system_managed)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(app_id, variant, name)
		 DO UPDATE SET value = excluded.value, system_managed = excluded.system_managed`,
		appID, variant, name, value, sm,
	)
	return err
}

// DeleteSecret removes a secret by app ID, variant, and name.
func (d *DB) DeleteSecret(appID, variant, name string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(
		`DELETE FROM secrets WHERE app_id = ? AND variant = ? AND name = ?`,
		appID, variant, name,
	)
	return err
}

// CreateDeployment inserts a new deployment record.
func (d *DB) CreateDeployment(appID, jobID, gitHash string) (*Deployment, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if gitHash == "" {
		gitHash = "local"
	}

	id, err := generateDeploymentID()
	if err != nil {
		return nil, fmt.Errorf("generate deployment ID: %w", err)
	}

	now := time.Now().UTC()
	dep := &Deployment{
		ID:          id,
		AppID:       appID,
		GitHash:     gitHash,
		Variant:     "publish",
		Status:      "pending",
		StatusJobID: jobID,
		Attempts:    1,
		CreatedAt:   now.Format(time.RFC3339),
		UpdatedAt:   now.Format(time.RFC3339),
	}

	_, err = d.db.Exec(
		`INSERT INTO deployments (id, app_id, git_hash, variant, status, status_job_id, attempts, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		dep.ID, dep.AppID, dep.GitHash, dep.Variant, dep.Status, dep.StatusJobID, dep.Attempts, dep.CreatedAt, dep.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return dep, nil
}

// UpdateDeploymentStatus updates a deployment status by ID.
func (d *DB) UpdateDeploymentStatus(id, status string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(
		`UPDATE deployments SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now().UTC().Format(time.RFC3339), id,
	)
	return err
}

// GetDeployments returns deployments for an app, most recent first.
func (d *DB) GetDeployments(appID string, limit int) ([]Deployment, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 {
		limit = 20
	}

	rows, err := d.db.Query(
		`SELECT id, app_id, git_hash, variant, status, status_job_id, attempts, created_at, updated_at
		 FROM deployments WHERE app_id = ? ORDER BY created_at DESC LIMIT ?`,
		appID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var deps []Deployment
	for rows.Next() {
		var dep Deployment
		if err := rows.Scan(&dep.ID, &dep.AppID, &dep.GitHash, &dep.Variant, &dep.Status, &dep.StatusJobID, &dep.Attempts, &dep.CreatedAt, &dep.UpdatedAt); err != nil {
			return nil, err
		}
		deps = append(deps, dep)
	}

	return deps, nil
}

func readDevBMSBudgetID() string {
	projectRoot := os.Getenv("PROJECT_ROOT")
	if projectRoot == "" {
		projectRoot = ".."
	}
	data, err := os.ReadFile(filepath.Join(projectRoot, ".dev-bms", "budget-id")) //nolint:gosec // PROJECT_ROOT is dev-only env var
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(string(data))
	if !uuidPattern.MatchString(id) {
		return ""
	}
	return id
}

func (d *DB) EnsureSubscription(id, customerID string) (*Subscription, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	sub, err := d.getSubscriptionUnlocked(id)
	if err != nil {
		return nil, err
	}
	if sub != nil {
		if sub.CustomerID != customerID {
			return nil, ErrSubscriptionNotOwned
		}
		// Reconcile bmsBudgetId from file (handles budget recreate or first-run seed failure recovery)
		if fileID := readDevBMSBudgetID(); fileID != "" && fileID != sub.BMSBudgetID {
			now := time.Now().UTC().Format(time.RFC3339)
			_, _ = d.db.Exec(`UPDATE subscriptions SET bms_budget_id = ?, updated_at = ? WHERE id = ?`, fileID, now, id)
			sub.BMSBudgetID = fileID
		}
		return sub, nil
	}

	bmsBudgetID := readDevBMSBudgetID()

	now := time.Now().UTC().Format(time.RFC3339)
	_, err = d.db.Exec(
		`INSERT INTO subscriptions (id, customer_id, bms_budget_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		id, customerID, bmsBudgetID, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert subscription: %w", err)
	}

	return d.getSubscriptionUnlocked(id)
}

func (d *DB) getSubscriptionUnlocked(id string) (*Subscription, error) {
	var sub Subscription
	var isTrial, hadAiroPlus int

	err := d.db.QueryRow(
		`SELECT id, product_id, owner_product, customer_id, status, reason, is_trial, had_airo_plus,
		        token_budget_id, bms_budget_id, plan, created_at, updated_at
		 FROM subscriptions WHERE id = ?`, id,
	).Scan(
		&sub.ID, &sub.ProductID, &sub.OwnerProduct, &sub.CustomerID, &sub.Status, &sub.Reason,
		&isTrial, &hadAiroPlus, &sub.TokenBudgetID, &sub.BMSBudgetID, &sub.Plan, &sub.CreatedAt, &sub.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query subscription: %w", err)
	}

	sub.IsTrial = isTrial != 0
	sub.HadAiroPlus = hadAiroPlus != 0
	return &sub, nil
}

// GetSubscription retrieves a subscription by ID. Returns nil if not found.
func (d *DB) GetSubscription(id string) (*Subscription, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.getSubscriptionUnlocked(id)
}

// ListSubscriptions returns all subscriptions.
func (d *DB) ListSubscriptions() ([]*Subscription, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(
		`SELECT id, product_id, owner_product, customer_id, status, reason, is_trial, had_airo_plus,
		        token_budget_id, bms_budget_id, plan, created_at, updated_at
		 FROM subscriptions ORDER BY created_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("query subscriptions: %w", err)
	}
	defer rows.Close()

	var subs []*Subscription
	for rows.Next() {
		var sub Subscription
		var isTrial, hadAiroPlus int
		if err := rows.Scan(
			&sub.ID, &sub.ProductID, &sub.OwnerProduct, &sub.CustomerID, &sub.Status, &sub.Reason,
			&isTrial, &hadAiroPlus, &sub.TokenBudgetID, &sub.BMSBudgetID, &sub.Plan, &sub.CreatedAt, &sub.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan subscription: %w", err)
		}
		sub.IsTrial = isTrial != 0
		sub.HadAiroPlus = hadAiroPlus != 0
		subs = append(subs, &sub)
	}
	return subs, nil
}

// UpdateSubscription applies partial updates to a subscription.
func (d *DB) UpdateSubscription(id string, fields map[string]any) (*Subscription, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	sub, err := d.getSubscriptionUnlocked(id)
	if err != nil {
		return nil, err
	}
	if sub == nil {
		return nil, fmt.Errorf("subscription not found: %s", id)
	}

	if v, ok := fields["status"]; ok {
		if s, ok := v.(string); ok {
			sub.Status = s
		}
	}
	if v, ok := fields["isTrial"]; ok {
		if b, ok := v.(bool); ok {
			sub.IsTrial = b
		}
	}
	if v, ok := fields["plan"]; ok {
		if s, ok := v.(string); ok {
			sub.Plan = s
		}
	}
	if v, ok := fields["tokenBudgetId"]; ok {
		if s, ok := v.(string); ok {
			sub.TokenBudgetID = s
		}
	}
	if v, ok := fields["reason"]; ok {
		if s, ok := v.(string); ok {
			sub.Reason = s
		}
	}
	if v, ok := fields["hadAiroPlus"]; ok {
		if b, ok := v.(bool); ok {
			sub.HadAiroPlus = b
		}
	}
	if v, ok := fields["bmsBudgetId"]; ok {
		if s, ok := v.(string); ok {
			sub.BMSBudgetID = s
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	isTrial := 0
	if sub.IsTrial {
		isTrial = 1
	}
	hadAiroPlus := 0
	if sub.HadAiroPlus {
		hadAiroPlus = 1
	}

	_, err = d.db.Exec(
		`UPDATE subscriptions SET status = ?, reason = ?, is_trial = ?, had_airo_plus = ?, plan = ?, token_budget_id = ?, bms_budget_id = ?, updated_at = ? WHERE id = ?`,
		sub.Status, sub.Reason, isTrial, hadAiroPlus, sub.Plan, sub.TokenBudgetID, sub.BMSBudgetID, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("update subscription: %w", err)
	}

	sub.UpdatedAt = now
	return sub, nil
}

// ─── Automation store methods ─────────────────────────────────────────────────

func (d *DB) ListAutomations(appID string) ([]*Automation, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(
		`SELECT id, app_id, name, defn_type, defn_location, defn_ref, trigger_type, cron_expr, enabled, created_at, updated_at
		 FROM automations WHERE app_id = ? AND deleted = 0 ORDER BY created_at ASC`,
		appID,
	)
	if err != nil {
		return nil, fmt.Errorf("list automations: %w", err)
	}
	defer rows.Close()

	var result []*Automation
	for rows.Next() {
		a, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

func (d *DB) CreateAutomation(appID, name, defnType, defnLocation, defnRef, triggerType, cronExpr string, enabled bool) (*Automation, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	id, err := generateNanoid(21)
	if err != nil {
		return nil, fmt.Errorf("generate automation ID: %w", err)
	}
	now := time.Now().UTC()

	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	_, err = d.db.Exec(
		`INSERT INTO automations (id, app_id, name, defn_type, defn_location, defn_ref, trigger_type, cron_expr, enabled, deleted, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		id, appID, name, defnType, defnLocation, defnRef, triggerType, cronExpr, enabledInt,
		now.Format(time.RFC3339), now.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("insert automation: %w", err)
	}

	return &Automation{
		ID: id, AppID: appID, Name: name,
		DefnType: defnType, DefnLocation: defnLocation, DefnRef: defnRef,
		TriggerType: triggerType, CronExpr: cronExpr, Enabled: enabled,
		CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (d *DB) UpdateAutomation(id, appID string, triggerType *string, cronExpr *string, enabled *bool) (*Automation, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	row := d.db.QueryRow(
		`SELECT id, app_id, name, defn_type, defn_location, defn_ref, trigger_type, cron_expr, enabled, created_at, updated_at
		 FROM automations WHERE id = ? AND app_id = ? AND deleted = 0`, id, appID,
	)
	a, err := scanAutomation(row)
	if err != nil {
		return nil, fmt.Errorf("automation not found: %w", err)
	}

	if triggerType != nil {
		a.TriggerType = *triggerType
	}
	if cronExpr != nil {
		a.CronExpr = *cronExpr
	}
	if enabled != nil {
		a.Enabled = *enabled
	}
	now := time.Now().UTC()
	a.UpdatedAt = now

	enabledInt := 0
	if a.Enabled {
		enabledInt = 1
	}
	_, err = d.db.Exec(
		`UPDATE automations SET trigger_type = ?, cron_expr = ?, enabled = ?, updated_at = ? WHERE id = ? AND app_id = ?`,
		a.TriggerType, a.CronExpr, enabledInt, now.Format(time.RFC3339), id, appID,
	)
	if err != nil {
		return nil, fmt.Errorf("update automation: %w", err)
	}
	return a, nil
}

func (d *DB) GetAutomation(id, appID string) (*Automation, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	row := d.db.QueryRow(
		`SELECT id, app_id, name, defn_type, defn_location, defn_ref, trigger_type, cron_expr, enabled, created_at, updated_at
		 FROM automations WHERE id = ? AND app_id = ? AND deleted = 0`, id, appID,
	)
	return scanAutomation(row)
}

func (d *DB) DeleteAutomation(id, appID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	res, err := d.db.Exec(
		`UPDATE automations SET deleted = 1, updated_at = ? WHERE id = ? AND app_id = ? AND deleted = 0`,
		time.Now().UTC().Format(time.RFC3339), id, appID,
	)
	if err != nil {
		return fmt.Errorf("delete automation: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("automation not found")
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanAutomation(row scannable) (*Automation, error) {
	var a Automation
	var enabledInt int
	var createdAt, updatedAt string
	err := row.Scan(
		&a.ID, &a.AppID, &a.Name, &a.DefnType, &a.DefnLocation, &a.DefnRef,
		&a.TriggerType, &a.CronExpr, &enabledInt, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, err
	}
	a.Enabled = enabledInt == 1
	a.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	a.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)
	return &a, nil
}

// ─── Automation run store methods ─────────────────────────────────────────────

func (d *DB) CreateAutomationRun(runID, automationID, appID, triggerType string) (*AutomationRun, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().UTC()
	_, err := d.db.Exec(
		`INSERT INTO automation_runs (id, automation_id, app_id, status, trigger_type, started_at)
		 VALUES (?, ?, ?, 'dispatched', ?, ?)`,
		runID, automationID, appID, triggerType, now.Format(time.RFC3339),
	)
	if err != nil {
		return nil, fmt.Errorf("insert automation run: %w", err)
	}
	return &AutomationRun{
		ID:           runID,
		AutomationID: automationID,
		AppID:        appID,
		Status:       "dispatched",
		TriggerType:  triggerType,
		StartedAt:    now,
	}, nil
}

func (d *DB) UpdateAutomationRun(runID, status, summaryRef, errorMessage string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.db.Exec(
		`UPDATE automation_runs SET status = ?, summary_ref = ?, error_message = ?, finished_at = ? WHERE id = ?`,
		status, summaryRef, errorMessage, now, runID,
	)
	return err
}

func (d *DB) ListAutomationRuns(automationID, appID string, limit, offset int) ([]*AutomationRun, int, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var total int
	err := d.db.QueryRow(
		`SELECT COUNT(*) FROM automation_runs WHERE automation_id = ? AND app_id = ?`,
		automationID, appID,
	).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count automation runs: %w", err)
	}

	rows, err := d.db.Query(
		`SELECT id, automation_id, app_id, status, trigger_type, summary_ref, error_message, started_at, finished_at
		 FROM automation_runs WHERE automation_id = ? AND app_id = ?
		 ORDER BY started_at DESC LIMIT ? OFFSET ?`,
		automationID, appID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list automation runs: %w", err)
	}
	defer rows.Close()

	var runs []*AutomationRun
	for rows.Next() {
		var r AutomationRun
		var finishedAt sql.NullString
		var startedAt string
		if err := rows.Scan(
			&r.ID, &r.AutomationID, &r.AppID, &r.Status, &r.TriggerType,
			&r.SummaryRef, &r.ErrorMessage, &startedAt, &finishedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan automation run: %w", err)
		}
		r.StartedAt, _ = time.Parse(time.RFC3339, startedAt)
		if finishedAt.Valid && finishedAt.String != "" {
			t, _ := time.Parse(time.RFC3339, finishedAt.String)
			r.FinishedAt = &t
		}
		runs = append(runs, &r)
	}
	return runs, total, rows.Err()
}
