package httpproxy

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	_ "github.com/go-sql-driver/mysql" // MySQL driver registration

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
)

const (
	healthCheckTimeout  = 5 * time.Second
	healthCheckFileName = ".health-check-%d"
)

// runCanaryChecks executes all canary health checks and returns results.
func runCanaryChecks() map[string]*CheckResult {
	checks := make(map[string]*CheckResult)

	checks["ceph"] = checkCephFilesystem()
	checks["mysql"] = checkMySQL()

	return checks
}

// checkCephFilesystem verifies read/write access to the Ceph filesystem.
func checkCephFilesystem() *CheckResult {
	start := time.Now()

	appDir := os.Getenv("CUSTOMER_APP_DIR")
	if appDir == "" {
		slog.Error("canary.ceph.env_missing", "var", "CUSTOMER_APP_DIR")
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "CUSTOMER_APP_DIR not set",
		}
	}

	testFile := filepath.Join(appDir, fmt.Sprintf(healthCheckFileName, time.Now().UnixNano()))
	testData := fmt.Appendf(nil, "health-check-%d", time.Now().UnixNano())

	// Write test file
	if err := os.WriteFile(testFile, testData, 0600); err != nil {
		slog.Error("canary.ceph.write_failed", "path", testFile, "error", err)
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "write failed",
		}
	}

	// Ensure cleanup
	defer func() {
		if removeErr := os.Remove(testFile); removeErr != nil {
			slog.Error("canary.ceph.cleanup_failed", "path", testFile, "error", removeErr)
		}
	}()

	// Read and verify
	readData, err := os.ReadFile(testFile)
	if err != nil {
		slog.Error("canary.ceph.read_failed", "path", testFile, "error", err)
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "read failed",
		}
	}

	if string(readData) != string(testData) {
		slog.Error("canary.ceph.verify_failed", "path", testFile)
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "data verification failed",
		}
	}

	slog.Debug("canary.ceph.success", "latency", time.Since(start))
	return &CheckResult{
		Status:  "healthy",
		Latency: time.Since(start).Round(time.Millisecond).String(),
	}
}

// checkMySQL verifies MySQL connectivity using credentials from /alloc/config.json.
func checkMySQL() *CheckResult {
	start := time.Now()

	// Load config using allocconfig package
	loader := allocconfig.NewLoader("")
	config, err := loader.Load()
	if err != nil {
		slog.Error("canary.mysql.config_failed", "error", err)
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "config load failed",
		}
	}

	if !config.HasDatabase() {
		slog.Error("canary.mysql.not_configured")
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "DATABASE not configured",
		}
	}

	// GetDatabaseConfig() cannot error here - HasDatabase() guarantees Database is non-nil
	dbVal, _ := config.GetDatabaseConfig()

	if dbVal.IP == "" || dbVal.Username == "" {
		slog.Error("canary.mysql.incomplete_credentials")
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "incomplete database credentials",
		}
	}

	// Build DSN: username:password@tcp(host:port)/dbname?timeout=5s&tls=skip-verify
	// tls=skip-verify required for MySQL 8.0 with require_secure_transport=ON
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?timeout=%s&tls=skip-verify",
		dbVal.Username,
		dbVal.Password,
		dbVal.IP,
		dbVal.Port,
		dbVal.Name,
		healthCheckTimeout.String(),
	)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		slog.Error("canary.mysql.open_failed", "error", err)
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "connection failed",
		}
	}
	defer db.Close()

	// Set connection limits for health check
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(0)
	db.SetConnMaxLifetime(healthCheckTimeout)

	ctx, cancel := context.WithTimeout(context.Background(), healthCheckTimeout)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		slog.Error("canary.mysql.ping_failed", "error", err)
		return &CheckResult{
			Status:  "unhealthy",
			Latency: time.Since(start).Round(time.Millisecond).String(),
			Error:   "connection failed",
		}
	}

	slog.Debug("canary.mysql.success", "latency", time.Since(start))
	return &CheckResult{
		Status:  "healthy",
		Latency: time.Since(start).Round(time.Millisecond).String(),
	}
}

// isCanaryDeployment returns true if this is a canary deployment.
func isCanaryDeployment() bool {
	return os.Getenv("NOMAD_META_PROVISIONTYPE") == "canary"
}

// handleCanaryChecks handles canary check requests at /airo/canary_checks.
// This endpoint runs infrastructure checks (Ceph filesystem, MySQL) for canary deployments.
// Returns 404 if not a canary deployment.
func handleCanaryChecks(w http.ResponseWriter, r *http.Request) {
	if !isCanaryDeployment() {
		http.NotFound(w, r)
		return
	}

	slog.Debug("canary.checks.start", "remote_addr", r.RemoteAddr)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	checks := runCanaryChecks()

	// Determine overall status
	status := "healthy"
	for name, check := range checks {
		if check.Status == "unhealthy" {
			slog.Debug("canary.checks.failed", "check", name)
			status = "unhealthy"
			break
		}
	}

	resp := CanaryCheckResponse{
		Status: status,
		Checks: checks,
	}

	if status == "healthy" {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("canary.checks.encode_error", "error", err)
	}

	slog.Debug("canary.checks.complete", "status", status)
}
