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
	cfg       Config
	runner    CommandRunner
	refresher TokenRefresher
	homeDir   string // override for testing; "" uses os.UserHomeDir
	paused    atomic.Bool
}

// NewMonitor creates a new credential refresh monitor.
// Pass homeDir="" for production (uses os.UserHomeDir).
func NewMonitor(cfg Config, runner CommandRunner, homeDir string) *Monitor {
	return &Monitor{
		cfg:       cfg,
		runner:    runner,
		refresher: NewOIDCRefresher(homeDir),
		homeDir:   homeDir,
	}
}

// NewMonitorWithRefresher creates a monitor with a custom TokenRefresher (for testing).
func NewMonitorWithRefresher(cfg Config, runner CommandRunner, refresher TokenRefresher, homeDir string) *Monitor {
	return &Monitor{
		cfg:       cfg,
		runner:    runner,
		refresher: refresher,
		homeDir:   homeDir,
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
			Statuses: []Status{{Profile: "unknown", OK: false, Reason: ReasonNoData, Message: "aws CLI not found"}},
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
	var expiredProfiles []string
	worstBracket := BracketHealthy

	for _, profile := range m.cfg.Profiles {
		status := CheckToken(profile, m.homeDir)

		if status.Reason == ReasonNotSSO {
			statuses = append(statuses, status)
			continue
		}

		// Attempt silent OIDC token refresh if within threshold
		if status.OK && status.TTL <= m.cfg.RefreshThreshold && status.TTL > 0 {
			preTTL := status.TTL
			newTTL, refreshErr := m.refresher.Refresh(ctx, profile)
			if refreshErr == nil {
				status = CheckToken(profile, m.homeDir)
				if status.TTL <= m.cfg.MinUsableTTL {
					expiredProfiles = append(expiredProfiles, profile)
					status = Status{Profile: profile, OK: false, Reason: ReasonRefreshFailed, TTL: status.TTL, Message: fmt.Sprintf("refreshed but TTL still too low (%s)", status.TTL.Truncate(time.Minute))}
				} else {
					send(RefreshedMsg{Profile: profile, TTL: newTTL})
				}
			} else {
				// OIDC refresh failed — fall back to CLI (may trigger SDK-level refresh if token is expired)
				cliErr := m.runner.Run(ctx, "aws", "sts", "get-caller-identity", "--profile", profile)
				if cliErr == nil {
					status = CheckToken(profile, m.homeDir)
					if status.TTL > preTTL {
						send(RefreshedMsg{Profile: profile, TTL: status.TTL})
					} else {
						// CLI succeeded but did not extend the token — OIDC is the real problem
						expiredProfiles = append(expiredProfiles, profile)
						status = Status{Profile: profile, OK: false, Reason: ReasonRefreshFailed, TTL: status.TTL, Message: fmt.Sprintf("OIDC refresh failed (%s), CLI did not extend token", refreshErr)}
					}
				} else {
					expiredProfiles = append(expiredProfiles, profile)
					status = Status{Profile: profile, OK: false, Reason: ReasonRefreshFailed, Message: fmt.Sprintf("silent refresh failed: %s", refreshErr)}
				}
			}
		} else if !status.OK {
			expiredProfiles = append(expiredProfiles, profile)
		}

		statuses = append(statuses, status)
		bracket := BracketFor(status.TTL)
		if bracket > worstBracket {
			worstBracket = bracket
		}
	}

	// Always emit status so the TUI stays current
	send(StatusMsg{Statuses: statuses, Bracket: worstBracket})

	// After reporting status, notify about expired profiles
	if len(expiredProfiles) > 0 && !m.paused.Load() {
		send(ExpiredMsg{
			Profile: expiredProfiles[0],
			Err:     fmt.Errorf("token expired for profile %q", expiredProfiles[0]),
		})
	}
}
