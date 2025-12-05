package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"
)

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

// Helper functions

func (s *Server) sendError(w http.ResponseWriter, statusCode int, errorType, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(ErrorResponse{
		Error:   errorType,
		Message: message,
	}); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}
