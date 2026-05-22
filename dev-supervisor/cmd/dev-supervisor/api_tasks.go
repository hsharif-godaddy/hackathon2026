package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

const errMsgTaskNotFound = "task not found"

type TaskSubmitRequest struct {
	Command       string            `json:"command"`
	Timeout       int               `json:"timeout,omitempty"`
	CaptureOutput bool              `json:"capture_output,omitempty"`
	WorkingDir    string            `json:"working_dir,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
	WaitSeconds   int               `json:"wait_seconds,omitempty"`
}

type TaskCompletedResponse struct {
	Kind            string `json:"kind"`
	TaskID          string `json:"task_id"`
	ExitCode        int    `json:"exit_code"`
	Stdout          string `json:"stdout"`
	Stderr          string `json:"stderr"`
	ExecutionTimeMs int64  `json:"execution_time_ms"`
	TimedOut        bool   `json:"timed_out"`
	CommandID       uint64 `json:"command_id"`
}

type TaskAcceptedResponse struct {
	Kind   string    `json:"kind"`
	TaskID string    `json:"task_id"`
	State  TaskState `json:"state"`
}

type TaskStatusResponse struct {
	TaskID          string    `json:"task_id"`
	State           TaskState `json:"state"`
	Command         string    `json:"command"`
	ExitCode        int       `json:"exit_code"`
	Error           string    `json:"error,omitempty"`
	TimedOut        bool      `json:"timed_out"`
	StartedAt       string    `json:"started_at,omitempty"`
	FinishedAt      string    `json:"finished_at,omitempty"`
	ExecutionTimeMs int64     `json:"execution_time_ms"`
	CommandID       uint64    `json:"command_id"`
}

type TaskOutputResponse struct {
	Stdout           string `json:"stdout"`
	Stderr           string `json:"stderr"`
	NextOffset       int    `json:"next_offset"`
	NextStderrOffset int    `json:"next_stderr_offset"`
	Complete         bool   `json:"complete"`
}

type TaskCancelResponse struct {
	State string `json:"state"`
}

func (s *Server) handleTaskSubmit(w http.ResponseWriter, r *http.Request) {
	var req TaskSubmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON payload")
		return
	}

	cmdReq := validation.CommandRequest{
		Command:       req.Command,
		Timeout:       req.Timeout,
		CaptureOutput: true,
		WorkingDir:    req.WorkingDir,
		Env:           req.Env,
	}

	if err := validation.ValidateCommandRequest(cmdReq); err != nil {
		slog.Warn("tasks.submit.validation.failed",
			"error", err,
			"command_preview", commandLogPreview(req.Command),
		)
		s.sendError(w, http.StatusBadRequest, "validation_failed", err.Error())
		return
	}

	cmdReq.Command = validation.SanitizeCommand(cmdReq.Command)
	s.procMgr.UpdateActivity()

	taskID, err := s.taskMgr.Submit(cmdReq)
	if err != nil {
		if errors.Is(err, ErrTooManyTasks) {
			s.sendError(w, http.StatusTooManyRequests, "too_many_tasks", err.Error())
			return
		}
		s.sendError(w, http.StatusInternalServerError, "submit_failed", err.Error())
		return
	}

	waitSeconds := req.WaitSeconds
	if waitSeconds > cmdReq.Timeout && cmdReq.Timeout > 0 {
		waitSeconds = cmdReq.Timeout
	}
	if waitSeconds > maxTaskTimeout {
		waitSeconds = maxTaskTimeout
	}

	if waitSeconds > 0 {
		deadline := time.Duration(waitSeconds) * time.Second
		task, waitErr := s.taskMgr.Wait(taskID, deadline)
		if waitErr != nil {
			s.sendError(w, http.StatusInternalServerError, "wait_failed", waitErr.Error())
			return
		}

		info := task.Info()
		if isTaskTerminal(info.State) {
			out, _ := s.taskMgr.Output(taskID, 0, 0, 0)
			stdout := ""
			stderr := ""
			if out != nil {
				stdout = out.Stdout
				stderr = out.Stderr
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(TaskCompletedResponse{
				Kind:            "completed",
				TaskID:          info.ID,
				ExitCode:        info.ExitCode,
				Stdout:          stdout,
				Stderr:          stderr,
				ExecutionTimeMs: info.ExecutionTimeMs,
				TimedOut:        info.TimedOut,
				CommandID:       info.CommandID,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(TaskAcceptedResponse{
			Kind:   "accepted",
			TaskID: info.ID,
			State:  info.State,
		})
		return
	}

	task, _ := s.taskMgr.Get(taskID)
	info := task.Info()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(TaskAcceptedResponse{
		Kind:   "accepted",
		TaskID: info.ID,
		State:  info.State,
	})
}

func (s *Server) handleTaskGet(w http.ResponseWriter, r *http.Request) {
	taskID := mux.Vars(r)["id"]

	task, err := s.taskMgr.Get(taskID)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			s.sendError(w, http.StatusNotFound, "not_found", errMsgTaskNotFound)
			return
		}
		s.sendError(w, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}

	info := task.Info()
	resp := TaskStatusResponse{
		TaskID:          info.ID,
		State:           info.State,
		Command:         info.Command,
		ExitCode:        info.ExitCode,
		Error:           info.Error,
		TimedOut:        info.TimedOut,
		ExecutionTimeMs: info.ExecutionTimeMs,
		CommandID:       info.CommandID,
	}
	if !info.StartedAt.IsZero() {
		resp.StartedAt = info.StartedAt.Format(time.RFC3339)
	}
	if !info.FinishedAt.IsZero() {
		resp.FinishedAt = info.FinishedAt.Format(time.RFC3339)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleTaskOutput(w http.ResponseWriter, r *http.Request) {
	taskID := mux.Vars(r)["id"]

	since := 0
	sinceStderr := 0
	maxLines := 0
	if v := r.URL.Query().Get("since"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			since = n
		}
	}
	if v := r.URL.Query().Get("since_stderr"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			sinceStderr = n
		}
	} else {
		sinceStderr = since
	}
	if v := r.URL.Query().Get("max"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			maxLines = n
		}
	}

	out, err := s.taskMgr.Output(taskID, since, sinceStderr, maxLines)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			s.sendError(w, http.StatusNotFound, "not_found", errMsgTaskNotFound)
			return
		}
		s.sendError(w, http.StatusInternalServerError, "output_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TaskOutputResponse{
		Stdout:           out.Stdout,
		Stderr:           out.Stderr,
		NextOffset:       out.NextOffset,
		NextStderrOffset: out.NextStderrOffset,
		Complete:         out.Complete,
	})
}

func (s *Server) handleTaskCancel(w http.ResponseWriter, r *http.Request) {
	taskID := mux.Vars(r)["id"]

	state, err := s.taskMgr.Cancel(taskID)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			s.sendError(w, http.StatusNotFound, "not_found", errMsgTaskNotFound)
			return
		}
		s.sendError(w, http.StatusInternalServerError, "cancel_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TaskCancelResponse{State: state})
}
