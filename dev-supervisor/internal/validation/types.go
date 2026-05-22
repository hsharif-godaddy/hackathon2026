package validation

// ProcessStartRequest represents a request to start a process
type ProcessStartRequest struct {
	Command    string            `json:"command"`
	Env        map[string]string `json:"env,omitempty"`
	WorkingDir string            `json:"working_dir,omitempty"`
	Ports      []int             `json:"ports,omitempty"` // Explicit port specification
}

// CommandRequest represents a request to execute a command
type CommandRequest struct {
	Command       string            `json:"command"`
	Timeout       int               `json:"timeout,omitempty"`
	CaptureOutput bool              `json:"capture_output,omitempty"`
	WorkingDir    string            `json:"working_dir,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
}

// EnvironmentSetRequest represents a request to set environment variables
type EnvironmentSetRequest struct {
	Variables      map[string]string `json:"variables"`
	RestartProcess bool              `json:"restart_process,omitempty"`
}
