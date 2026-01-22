package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Archive extension used for published version files
const tarGzExtension = ".tar.gz"

// API endpoint handlers

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	uptime := time.Since(s.startTime)
	response := HealthResponse{
		Status:  "healthy",
		Version: Version,
		Uptime:  uptime.String(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode health response", "error", err)
	}
}

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	uptime := time.Since(s.startTime)
	processStatus := s.procMgr.GetStatus()
	logStats := s.logMgr.GetStats()
	healthStatus := s.procMgr.GetHealthStatus()
	restartStats := s.procMgr.GetRestartStats()

	info := map[string]interface{}{
		"name":                    AppName,
		"version":                 Version,
		"pid":                     os.Getpid(),
		"is_pid1":                 os.Getpid() == 1,
		"socket_path":             s.getConfiguredAddress(),
		"uptime":                  uptime.String(),
		"process":                 processStatus,
		"health":                  healthStatus,
		"restarts":                restartStats,
		"logs":                    logStats,
		"process_logging_enabled": s.procMgr.GetProcessLogging(),
		"child_count":             s.pid1Mgr.GetChildProcessCount(),
		"shutting_down":           s.pid1Mgr.IsShuttingDown(),
		"http_proxy_enabled":      s.config != nil && s.config.ProxyEnabled,
		"http_proxy_running":      s.httpProxy != nil,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(info); err != nil {
		slog.Error("failed to encode info response", "error", err)
	}
}

func (s *Server) handleProcessStart(w http.ResponseWriter, r *http.Request) {
	var req ProcessStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	// Validate request
	if err := validateProcessStartRequest(req); err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	// Sanitize command
	req.Command = sanitizeCommand(req.Command)

	if err := s.procMgr.Start(req); err != nil {
		s.sendError(w, http.StatusBadRequest, "start_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "started"}); err != nil {
		slog.Error("failed to encode process start response", "error", err)
	}
}

func (s *Server) handleProcessStop(w http.ResponseWriter, r *http.Request) {
	var req ProcessStopRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	if err := s.procMgr.Stop(req); err != nil {
		s.sendError(w, http.StatusBadRequest, "stop_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "stopped"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleProcessRestart(w http.ResponseWriter, r *http.Request) {
	var req ProcessRestartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Error("restart request decode failed", "error", err)
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	if err := s.procMgr.Restart(req); err != nil {
		slog.Error("restart failed", "error", err)
		s.sendError(w, http.StatusBadRequest, "restart_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "restarted"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleProcessStatus(w http.ResponseWriter, _ *http.Request) {
	status := s.procMgr.GetStatus()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleExec(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()
	var req CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	// Validate request
	if err := validateCommandRequest(req); err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	// Sanitize command
	req.Command = sanitizeCommand(req.Command)
	commandPreview := commandLogPreview(req.Command)

	// Always capture output for LLM usage
	req.CaptureOutput = true
	slog.Debug("exec.command.execution.start",
		"command_preview", commandPreview,
		"requested_timeout_seconds", req.Timeout,
		"working_dir", req.WorkingDir,
		"capture_output", req.CaptureOutput,
	)

	result, err := s.cmdExec.Execute(req)
	if err != nil {
		s.sendError(w, http.StatusInternalServerError, "execution_failed", err.Error())
		return
	}

	requestDurationMs := time.Since(startTime).Milliseconds()

	if result.TimedOut {
		slog.Warn("exec.command.execution.timeout",
			"command_preview", commandPreview,
			"requested_timeout_seconds", req.Timeout,
			"exit_code", result.ExitCode,
			"executor_duration_ms", result.Duration,
			"request_duration_ms", requestDurationMs,
			"stdout_length", len(result.Stdout),
			"stderr_length", len(result.Stderr),
		)
	} else {
		slog.Debug("exec.command.execution.completed",
			"command_preview", commandPreview,
			"exit_code", result.ExitCode,
			"timed_out", result.TimedOut,
			"executor_duration_ms", result.Duration,
			"request_duration_ms", requestDurationMs,
			"stdout_length", len(result.Stdout),
			"stderr_length", len(result.Stderr),
			"requested_timeout_seconds", req.Timeout,
		)
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleEnvironmentGet(w http.ResponseWriter, _ *http.Request) {
	response := s.envMgr.GetVariables()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleEnvironmentSet(w http.ResponseWriter, r *http.Request) {
	var req EnvironmentSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	// Validate request
	if err := validateEnvironmentSetRequest(req); err != nil {
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	if err := s.envMgr.SetVariables(req); err != nil {
		s.sendError(w, http.StatusBadRequest, "set_failed", err.Error())
		return
	}

	// Restart process if requested
	if req.RestartProcess {
		restartReq := ProcessRestartRequest{Graceful: true}
		if err := s.procMgr.Restart(restartReq); err != nil {
			s.sendError(w, http.StatusInternalServerError, "restart_failed", err.Error())
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "updated"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleEnvironmentReset(w http.ResponseWriter, _ *http.Request) {
	if err := s.envMgr.ResetToDefaults(); err != nil {
		s.sendError(w, http.StatusInternalServerError, "reset_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "reset"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	req := s.logMgr.parseLogsGetRequest(r)
	response, err := s.logMgr.GetLogs(req)
	if err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleLogsStream(w http.ResponseWriter, _ *http.Request) {
	s.sendError(w, http.StatusNotImplemented, "not_implemented", "Real-time log streaming removed - use GET /logs for log retrieval")
}

func (s *Server) handleHealthConfigGet(w http.ResponseWriter, _ *http.Request) {
	status := s.procMgr.GetHealthStatus()
	stats := s.procMgr.GetRestartStats()

	response := map[string]interface{}{
		"health_status": status,
		"restart_stats": stats,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleHealthConfigSet(w http.ResponseWriter, r *http.Request) {
	slog.Info("health config set request received", "method", r.Method, "content_type", r.Header.Get("Content-Type"))

	var req struct {
		HealthCheck   *HealthCheck   `json:"health_check,omitempty"`
		RestartPolicy *RestartPolicy `json:"restart_policy,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Error("failed to decode health config request", "error", err)
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload: "+err.Error())
		return
	}

	// Log the parsed request for debugging
	if req.HealthCheck != nil {
		slog.Info("health check config received",
			"type", req.HealthCheck.Type,
			"url", req.HealthCheck.URL,
			"command", req.HealthCheck.Command,
			"address", req.HealthCheck.Address,
			"interval", req.HealthCheck.Interval,
			"timeout", req.HealthCheck.Timeout,
			"retries", req.HealthCheck.Retries,
			"start_period", req.HealthCheck.StartPeriod,
			"success_threshold", req.HealthCheck.SuccessThreshold,
			"failure_threshold", req.HealthCheck.FailureThreshold)
	}

	if req.RestartPolicy != nil {
		slog.Info("restart policy config received",
			"enabled", req.RestartPolicy.Enabled,
			"max_restarts", req.RestartPolicy.MaxRestarts,
			"restart_window", req.RestartPolicy.RestartWindow,
			"backoff_multiplier", req.RestartPolicy.BackoffMultiplier,
			"max_backoff", req.RestartPolicy.MaxBackoff,
			"initial_delay", req.RestartPolicy.InitialDelay)
	}

	// Validate health check configuration
	if req.HealthCheck != nil {
		if req.HealthCheck.Type == "" {
			slog.Error("health check validation failed", "error", "type is required")
			s.sendError(w, http.StatusBadRequest, "invalid_request", "Health check type is required")
			return
		}

		if req.HealthCheck.Type == HealthCheckTypeHTTP && req.HealthCheck.URL == "" {
			slog.Error("health check validation failed", "error", "URL is required for HTTP health check")
			s.sendError(w, http.StatusBadRequest, "invalid_request", "URL is required for HTTP health check")
			return
		}

		if req.HealthCheck.Type == HealthCheckTypeCommand && req.HealthCheck.Command == "" {
			slog.Error("health check validation failed", "error", "command is required for command health check")
			s.sendError(w, http.StatusBadRequest, "invalid_request", "Command is required for command health check")
			return
		}

		if req.HealthCheck.Type == HealthCheckTypeTCP && req.HealthCheck.Address == "" {
			slog.Error("health check validation failed", "error", "address is required for TCP health check")
			s.sendError(w, http.StatusBadRequest, "invalid_request", "Address is required for TCP health check")
			return
		}
	}

	slog.Info("configuring health check and restart policy")
	s.procMgr.ConfigureHealthCheck(req.HealthCheck, req.RestartPolicy)
	slog.Info("health check and restart policy configured successfully")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "configured"}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleHealthStatus(w http.ResponseWriter, _ *http.Request) {
	status := s.procMgr.GetHealthStatus()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleRestartStats(w http.ResponseWriter, _ *http.Request) {
	stats := s.procMgr.GetRestartStats()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(stats); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleLogsConfigGet(w http.ResponseWriter, _ *http.Request) {
	enabled := s.procMgr.GetProcessLogging()
	response := map[string]interface{}{
		"process_logging_enabled": enabled,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleLogsConfigSet(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProcessLoggingEnabled bool `json:"process_logging_enabled"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_json", "Invalid JSON in request body")
		return
	}

	// Update the process manager configuration
	s.procMgr.SetProcessLogging(req.ProcessLoggingEnabled)

	// Update the server configuration
	s.processLogging = req.ProcessLoggingEnabled
	if s.config != nil {
		s.config.ProcessLogging = req.ProcessLoggingEnabled
	}

	slog.Info("process logging configuration updated", "enabled", req.ProcessLoggingEnabled)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"status":                  "configured",
		"process_logging_enabled": req.ProcessLoggingEnabled,
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleProxyStatus(w http.ResponseWriter, _ *http.Request) {
	if s.httpProxy == nil {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"enabled": false,
			"running": false,
		}); err != nil {
			slog.Error("failed to encode JSON response", "error", err)
		}
		return
	}

	status := s.httpProxy.GetStatus()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handleProxyConfig(w http.ResponseWriter, _ *http.Request) {
	if s.httpProxy == nil || s.config == nil {
		s.sendError(w, http.StatusNotFound, "proxy_not_enabled", "HTTP proxy is not enabled")
		return
	}

	config := map[string]interface{}{
		"enabled":       s.config.ProxyEnabled,
		"listen_port":   s.config.ProxyPort,
		"target_host":   s.config.ProxyTargetHost,
		"target_port":   s.config.ProxyTargetPort,
		"tls_cert_path": s.config.ProxyCertPath,
		"tls_key_path":  s.config.ProxyKeyPath,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(config); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handlePublish(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CommitHash           string `json:"commitHash"`
		Force                bool   `json:"force"`
		WaitForHealthy       bool   `json:"waitForHealthy"`
		HealthTimeoutSeconds int    `json:"healthTimeoutSeconds"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	if req.CommitHash == "" {
		s.sendError(w, http.StatusBadRequest, "validation_failed", "commitHash is required")
		return
	}

	// Default health timeout to 60 seconds
	if req.HealthTimeoutSeconds <= 0 {
		req.HealthTimeoutSeconds = 60
	}

	slog.Info("publish.request.received",
		"commit_hash", req.CommitHash,
		"force", req.Force,
		"wait_for_healthy", req.WaitForHealthy,
		"health_timeout_seconds", req.HealthTimeoutSeconds)

	// Get dist directory from environment
	distDir := getEnvStringWithDefault("DIST_DIR", "/dist")

	// Construct the commit hash path (archive file)
	commitHashPath := fmt.Sprintf("%s/%s.tar.gz", distDir, req.CommitHash)

	// Check if commit hash archive file exists
	if _, err := os.Stat(commitHashPath); os.IsNotExist(err) {
		slog.Error("publish.version.not_found", "commit_hash", req.CommitHash, "path", commitHashPath)
		s.sendError(w, http.StatusNotFound, "version_not_found", fmt.Sprintf("Version %s not found", req.CommitHash))
		return
	}

	// Update the 'current' symlink to point to the archive file
	currentSymlink := fmt.Sprintf("%s/current", distDir)

	// Remove existing symlink if it exists
	if _, err := os.Lstat(currentSymlink); err == nil {
		if err := os.Remove(currentSymlink); err != nil {
			slog.Error("publish.symlink.remove_failed", "error", err)
			s.sendError(w, http.StatusInternalServerError, "symlink_failed", "Failed to remove existing symlink")
			return
		}
	}

	// Create new symlink pointing to the archive file
	if err := os.Symlink(commitHashPath, currentSymlink); err != nil {
		slog.Error("publish.symlink.create_failed", "error", err, "target", commitHashPath)
		s.sendError(w, http.StatusInternalServerError, "symlink_failed", "Failed to create symlink to new version")
		return
	}

	slog.Info("publish.symlink.updated", "commit_hash", req.CommitHash, "symlink", currentSymlink)

	// Restart the Node.js application to load the new version
	slog.Info("publish.restart.begin", "commit_hash", req.CommitHash)
	restartReq := ProcessRestartRequest{Graceful: true}

	restartStartTime := time.Now()
	if err := s.procMgr.Restart(restartReq); err != nil {
		slog.Error("publish.restart.failed", "error", err, "commit_hash", req.CommitHash)
		s.sendError(w, http.StatusInternalServerError, "restart_failed", fmt.Sprintf("Symlink updated but process restart failed: %s", err.Error()))
		return
	}

	restartDuration := time.Since(restartStartTime)
	slog.Info("publish.restart.success",
		"commit_hash", req.CommitHash,
		"restart_duration", restartDuration.String())

	// If waitForHealthy is requested, poll the app until healthy or timeout
	var healthStatus string
	var healthCheckDuration time.Duration
	if req.WaitForHealthy {
		// Give the process a moment to start before health checking
		// Node.js apps typically take 1-3 seconds to bind to a port
		initialDelay := 2 * time.Second
		slog.Debug("publish.health_check.initial_delay", "delay", initialDelay.String())
		time.Sleep(initialDelay)

		healthCheckURL := s.getPublishHealthCheckURL()
		slog.Info("publish.health_check.begin",
			"commit_hash", req.CommitHash,
			"target", healthCheckURL,
			"timeout_seconds", req.HealthTimeoutSeconds)

		healthCheckStart := time.Now()
		healthy, healthErr := s.waitForAppHealthy(healthCheckURL, time.Duration(req.HealthTimeoutSeconds)*time.Second)
		healthCheckDuration = time.Since(healthCheckStart)

		if !healthy {
			healthStatus = string(HealthStatusUnhealthy)
			if healthErr != nil && healthErr.Error() == "timeout" {
				healthStatus = "timeout"
			}

			// Get recent logs to help diagnose the issue
			logsReq := LogsGetRequest{Lines: 200}
			logsResp, logsErr := s.logMgr.GetLogs(logsReq)
			if logsErr != nil {
				slog.Warn("publish.health_check.logs_error", "error", logsErr)
			}

			slog.Error("publish.health_check.failed",
				"commit_hash", req.CommitHash,
				"health_status", healthStatus,
				"duration", healthCheckDuration.String(),
				"error", healthErr)

			response := map[string]interface{}{
				"status":              "error",
				"error":               "Health check failed after restart",
				"version":             req.CommitHash,
				"healthStatus":        healthStatus,
				"healthCheckDuration": healthCheckDuration.String(),
				"startupTime":         restartDuration.String(),
			}

			if logsResp != nil && len(logsResp.Logs) > 0 {
				// Convert logs to simple format for response
				logMessages := make([]map[string]string, 0, len(logsResp.Logs))
				for _, log := range logsResp.Logs {
					logMessages = append(logMessages, map[string]string{
						"timestamp": log.Timestamp.Format(time.RFC3339),
						"source":    log.Source,
						"message":   log.Message,
					})
				}
				response["logs"] = logMessages
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(response); err != nil {
				slog.Error("failed to encode JSON response", "error", err)
			}
			return
		}

		healthStatus = string(HealthStatusHealthy)
		slog.Info("publish.health_check.success",
			"commit_hash", req.CommitHash,
			"duration", healthCheckDuration.String())
	}

	response := map[string]interface{}{
		"status":      "success",
		"version":     req.CommitHash,
		"startupTime": restartDuration.String(),
	}

	if req.WaitForHealthy {
		response["healthStatus"] = healthStatus
		response["healthCheckDuration"] = healthCheckDuration.String()
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

func (s *Server) handlePublishStatus(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	linesParam := r.URL.Query().Get("lines")
	includeLogsParam := r.URL.Query().Get("includeLogs")

	// Default: 200 lines, includeLogs=true
	lines := 200
	if linesParam != "" {
		if parsed, err := strconv.Atoi(linesParam); err == nil && parsed > 0 {
			lines = parsed
		}
	}

	includeLogs := true
	if includeLogsParam == "false" {
		includeLogs = false
	}

	// Get dist directory from environment
	distDir := getEnvStringWithDefault("DIST_DIR", "/dist")
	currentSymlink := filepath.Join(distDir, "current")

	// Build response
	response := make(map[string]interface{})
	warnings := []string{}

	// Get version from symlink
	var version interface{}
	symlinkTarget, err := os.Readlink(currentSymlink)
	if err != nil {
		if os.IsNotExist(err) {
			warnings = append(warnings, "no_current_symlink")
			slog.Debug("publish.status.no_symlink", "path", currentSymlink)
		} else {
			warnings = append(warnings, "symlink_read_error")
			slog.Warn("publish.status.symlink_error", "error", err)
		}
	} else {
		// Extract commit hash from archive filename (e.g., /dist/abc123.tar.gz -> abc123)
		archiveFilename := filepath.Base(symlinkTarget)
		if strings.HasSuffix(archiveFilename, tarGzExtension) {
			commitHash := strings.TrimSuffix(archiveFilename, tarGzExtension)
			version = commitHash

			// Check if archive exists
			archivePath := symlinkTarget
			if !filepath.IsAbs(symlinkTarget) {
				archivePath = filepath.Join(distDir, symlinkTarget)
			}
			if _, err := os.Stat(archivePath); os.IsNotExist(err) {
				warnings = append(warnings, "missing_archive")
				slog.Warn("publish.status.missing_archive", "path", archivePath)
			}
		}
	}
	response["version"] = version

	// Get process status first (needed for health check decision)
	processInfo := s.procMgr.GetStatus()

	// Perform active health check if process is running
	var healthStatus string
	var healthMessage string
	if processInfo.State == ProcessStateRunning {
		healthCheckURL := s.getPublishHealthCheckURL()
		client := &http.Client{Timeout: healthCheckInitialTimeout}
		ctx, cancel := context.WithTimeout(context.Background(), healthCheckInitialTimeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthCheckURL, nil)
		if err != nil {
			cancel()
			healthStatus = string(HealthStatusUnhealthy)
			healthMessage = fmt.Sprintf("Request creation failed: %v", err)
		} else {
			resp, err := client.Do(req)
			cancel()
			if err != nil {
				healthStatus = string(HealthStatusUnhealthy)
				healthMessage = fmt.Sprintf("Connection failed: %v", err)
			} else {
				resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					healthStatus = string(HealthStatusHealthy)
					healthMessage = fmt.Sprintf("HTTP %d", resp.StatusCode)
				} else {
					healthStatus = string(HealthStatusUnhealthy)
					healthMessage = fmt.Sprintf("HTTP %d", resp.StatusCode)
				}
			}
		}
	} else {
		healthStatus = "stopped"
		healthMessage = fmt.Sprintf("Process is %s", processInfo.State)
	}

	response["health"] = map[string]interface{}{
		"status":  healthStatus,
		"message": healthMessage,
	}
	uptime := ""
	if processInfo.State == ProcessStateRunning && !processInfo.StartTime.IsZero() {
		uptime = time.Since(processInfo.StartTime).Round(time.Second).String()
	}
	response["process"] = map[string]interface{}{
		"state":  string(processInfo.State),
		"pid":    processInfo.PID,
		"uptime": uptime,
	}

	// Get logs if requested
	if includeLogs {
		logsReq := LogsGetRequest{Lines: lines}
		logsResp, err := s.logMgr.GetLogs(logsReq)
		if err != nil {
			slog.Warn("publish.status.logs_error", "error", err)
			response["logs"] = []interface{}{}
		} else if logsResp != nil && len(logsResp.Logs) > 0 {
			logEntries := make([]map[string]string, 0, len(logsResp.Logs))
			for _, log := range logsResp.Logs {
				logEntries = append(logEntries, map[string]string{
					"timestamp": log.Timestamp.Format(time.RFC3339),
					"source":    log.Source,
					"message":   log.Message,
				})
			}
			response["logs"] = logEntries
		} else {
			response["logs"] = []interface{}{}
		}
	}

	// Add warnings if any
	if len(warnings) > 0 {
		response["warnings"] = warnings
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("failed to encode publish status response", "error", err)
	}
}

// getPublishHealthCheckURL returns the URL to use for health checking the published app
// Uses proxy target config if proxy is enabled, otherwise falls back to localhost:20001
func (s *Server) getPublishHealthCheckURL() string {
	proxyEnabled := getEnvBoolWithDefault("DEV_SUPERVISOR_ENABLE_PROXY", false)

	if proxyEnabled {
		host, hostSet := os.LookupEnv("DEV_SUPERVISOR_PROXY_TARGET_HOST")
		portValue, portSet := os.LookupEnv("DEV_SUPERVISOR_PROXY_TARGET_PORT")
		if hostSet && portSet {
			port, err := strconv.Atoi(portValue)
			if err == nil && host != "" && port > 0 {
				url := fmt.Sprintf("http://%s:%d/", host, port)
				slog.Debug("publish.health_check.target", "url", url, "source", "proxy_config")
				return url
			}
		}
	}

	// Fallback for non-proxy mode - use PORT env var (standard for app listening port)
	port := getEnvIntWithDefault("PORT", 20000)
	url := fmt.Sprintf("http://localhost:%d/", port)
	slog.Debug("publish.health_check.target", "url", url, "source", "PORT_env")
	return url
}

// Health check timeout configuration
const (
	healthCheckInitialTimeout  = 5 * time.Second // Initial per-request timeout
	healthCheckTimeoutIncrease = 5 * time.Second // Increase per retry
	healthCheckInterval        = 1 * time.Second // Time between retries
)

// waitForAppHealthy polls the given URL until it returns a 2xx status or timeout
// Uses increasing per-request timeouts to give slower apps time to respond
func (s *Server) waitForAppHealthy(targetURL string, timeout time.Duration) (bool, error) {
	deadline := time.Now().Add(timeout)
	currentTimeout := healthCheckInitialTimeout
	attempt := 0

	for time.Now().Before(deadline) {
		attempt++
		client := &http.Client{
			Timeout: currentTimeout,
		}

		ctx, cancel := context.WithTimeout(context.Background(), currentTimeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
		if err != nil {
			cancel()
			slog.Debug("publish.health_check.attempt",
				"attempt", attempt,
				"error", err.Error(),
				"timeout", currentTimeout.String(),
				"healthy", false)
		} else {
			resp, err := client.Do(req)
			cancel()
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					slog.Debug("publish.health_check.success",
						"attempt", attempt,
						"timeout", currentTimeout.String())
					return true, nil
				}
				slog.Debug("publish.health_check.attempt",
					"attempt", attempt,
					"status_code", resp.StatusCode,
					"timeout", currentTimeout.String(),
					"healthy", false)
			} else {
				slog.Debug("publish.health_check.attempt",
					"attempt", attempt,
					"error", err.Error(),
					"timeout", currentTimeout.String(),
					"healthy", false)
			}
		}

		// Increase timeout for next attempt
		currentTimeout += healthCheckTimeoutIncrease

		time.Sleep(healthCheckInterval)
	}

	return false, fmt.Errorf("timeout")
}

// Helper functions

func (s *Server) sendError(w http.ResponseWriter, statusCode int, errorType, message string) {
	// Note: CORS headers not set here as the API endpoints are typically accessed
	// via Unix socket or localhost, not cross-origin. If cross-origin access is needed,
	// uncomment the following line:
	// SetCORSHeaders(w, r) // Note: would need to pass r as parameter
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(ErrorResponse{
		Error:   errorType,
		Message: message,
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}
