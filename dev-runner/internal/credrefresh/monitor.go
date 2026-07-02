package credrefresh

import (
	"context"
	"fmt"
	"os/exec"
	"sync/atomic"
	"time"
)

// CommandRunner abstracts command execution for testability.
type CommandRunner interface {
	Run(ctx context.Context, name string, args ...string) error
}

// ExecRunner is the production CommandRunner using os/exec.
type ExecRunner struct{}

func (r ExecRunner) Run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...) //nolint:gosec
	return cmd.Run()
}

// Msg is the sealed interface for messages emitted by the Monitor.
type Msg interface {
	credrefreshMsg()
}

// StatusMsg is emitted on each check cycle with the current token state.
type StatusMsg struct {
	Statuses []Status
	Bracket  Bracket
}

func (StatusMsg) credrefreshMsg() {}

// RefreshedMsg is emitted after a successful silent refresh.
type RefreshedMsg struct {
	Profile string
	TTL     time.Duration
}

func (RefreshedMsg) credrefreshMsg() {}

// ExpiredMsg is emitted when silent refresh fails and interactive login is needed.
type ExpiredMsg struct {
	Profile string
	Err     error
}

func (ExpiredMsg) credrefreshMsg() {}

// Monitor periodically checks AWS SSO token validity and refreshes as needed.
type Monitor struct {
	cfg     Config
	runner  CommandRunner
	homeDir string // override for testing; "" uses os.UserHomeDir
	paused  atomic.Bool
}

// NewMonitor creates a new credential refresh monitor.
// Pass homeDir="" for production (uses os.UserHomeDir).
func NewMonitor(cfg Config, runner CommandRunner, homeDir string) *Monitor {
	return &Monitor{
		cfg:     cfg,
		runner:  runner,
		homeDir: homeDir,
	}
}

// Pause stops the monitor from emitting ExpiredMsg (used while login overlay is active).
func (m *Monitor) Pause() {
	m.paused.Store(true)
}

// Resume re-enables normal monitoring after a login attempt.
func (m *Monitor) Resume() {
	m.paused.Store(false)
}

// Start runs the monitor loop until ctx is cancelled. It blocks, so call in a goroutine.
func (m *Monitor) Start(ctx context.Context, send func(Msg)) {
	if _, err := exec.LookPath("aws"); err != nil {
		send(StatusMsg{
			Statuses: []Status{{Profile: "unknown", OK: false}},
			Bracket:  BracketCritical,
		})
		return
	}

	m.check(ctx, send)

	ticker := time.NewTicker(m.cfg.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.check(ctx, send)
		}
	}
}

func (m *Monitor) check(ctx context.Context, send func(Msg)) {
	var statuses []Status
	worstBracket := BracketHealthy

	for _, profile := range m.cfg.Profiles {
		status := CheckToken(profile, m.homeDir)
		statuses = append(statuses, status)

		bracket := BracketFor(status.TTL)
		if bracket > worstBracket {
			worstBracket = bracket
		}

		// Attempt silent refresh if within threshold
		if status.OK && status.TTL <= m.cfg.RefreshThreshold && status.TTL > 0 {
			err := m.runner.Run(ctx, "aws", "sts", "get-caller-identity", "--profile", profile)
			if err == nil {
				refreshed := CheckToken(profile, m.homeDir)
				send(RefreshedMsg{Profile: profile, TTL: refreshed.TTL})
				statuses[len(statuses)-1] = refreshed
				continue
			}
			if !m.paused.Load() {
				send(ExpiredMsg{Profile: profile, Err: fmt.Errorf("silent refresh failed: %w", err)})
			}
			return
		}

		// Token already expired
		if !status.OK && !m.paused.Load() {
			send(ExpiredMsg{Profile: profile, Err: fmt.Errorf("token expired for profile %q", profile)})
			return
		}
	}

	send(StatusMsg{Statuses: statuses, Bracket: worstBracket})
}
