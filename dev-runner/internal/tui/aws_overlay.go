package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/credrefresh"
)

type awsOverlayMode int

const (
	awsOverlayInfo awsOverlayMode = iota
	awsOverlayExpired
)

// awsAuthMsg wraps a credrefresh.Msg for delivery into the Bubble Tea Update loop.
type awsAuthMsg struct {
	Inner credrefresh.Msg
}

// awsLoginDoneMsg is sent when the interactive aws sso login completes.
type awsLoginDoneMsg struct {
	Err error
}

// startCredMonitor launches the background monitor goroutine and returns
// the initial Cmd that listens for its first message.
func (m *Model) startCredMonitor() tea.Cmd {
	if len(m.credProfiles) == 0 {
		return nil
	}

	// Cancel any existing monitor to prevent double-start on process restart.
	if m.credMonitorCancel != nil {
		m.credMonitorCancel()
	}

	cfg := credrefresh.DefaultConfig(m.credProfiles, m.projectRoot)
	runner := credrefresh.ExecRunner{}
	monitor := credrefresh.NewMonitor(cfg, runner, "")
	m.credMonitor = monitor

	ctx, cancel := context.WithCancel(context.Background())
	m.credMonitorCancel = cancel

	ch := make(chan credrefresh.Msg, 8)

	for _, profile := range m.credProfiles {
		m.logToAllPane(fmt.Sprintf("[aws] monitoring token for profile %q", profile))
	}

	go monitor.Start(ctx, func(msg credrefresh.Msg) {
		select {
		case ch <- msg:
		case <-ctx.Done():
		}
	})

	m.credMsgCh = ch
	return waitForCredMsg(ch)
}

// waitForCredMsg returns a Cmd that blocks on the next monitor message.
func waitForCredMsg(ch <-chan credrefresh.Msg) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-ch
		if !ok {
			return nil
		}
		return awsAuthMsg{Inner: msg}
	}
}

// handleAwsAuthMsg processes credential monitor messages.
func (m *Model) handleAwsAuthMsg(msg awsAuthMsg) tea.Cmd {
	switch inner := msg.Inner.(type) {
	case credrefresh.StatusMsg:
		m.credStatuses = inner.Statuses
		newBracket := inner.Bracket
		if newBracket != m.credLastBracket {
			m.credLastBracket = newBracket
			if len(inner.Statuses) > 0 {
				ttl := inner.Statuses[0].TTL.Truncate(time.Minute)
				m.logToAllPane(fmt.Sprintf("[aws] token valid, %s remaining", ttl))
			}
		}
		m.credBracket = newBracket

	case credrefresh.RefreshedMsg:
		ttl := inner.TTL.Truncate(time.Minute)
		m.logToAllPane(fmt.Sprintf("[aws] token refreshed, valid %s", ttl))
		if m.credOverlayActive && m.credOverlayMode == awsOverlayExpired {
			m.credOverlayActive = false
			m.credLoginRunning = false
		}

	case credrefresh.ExpiredMsg:
		m.logToAllPane("[aws] session expired — press A to re-login")
		if !m.credOverlayActive {
			m.credOverlayActive = true
			m.credOverlayMode = awsOverlayExpired
			m.credLoginErr = nil
			if m.credMonitor != nil {
				m.credMonitor.Pause()
			}
		}
	}

	return nil
}

// openAwsOverlay opens the AWS auth overlay in info mode.
func (m *Model) openAwsOverlay() tea.Cmd {
	m.credOverlayActive = true
	m.credOverlayMode = awsOverlayInfo
	m.credLoginErr = nil
	return nil
}

// updateAwsOverlay handles keys while the AWS overlay is active.
func (m *Model) updateAwsOverlay(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "enter":
		if m.credLoginRunning {
			return nil
		}
		if m.credOverlayMode == awsOverlayInfo {
			return m.runSilentRefresh()
		}
		return m.runInteractiveLogin()

	case "esc":
		if m.credLoginRunning {
			return nil
		}
		m.credOverlayActive = false
		if m.credOverlayMode == awsOverlayExpired {
			m.logToAllPane("[aws] login cancelled — auth will fail")
		}
		if m.credMonitor != nil {
			m.credMonitor.Resume()
		}
		return nil
	}
	return nil
}

// runSilentRefresh attempts a force-refresh from the info overlay.
func (m *Model) runSilentRefresh() tea.Cmd {
	m.credLoginRunning = true
	profiles := m.credProfiles
	return func() tea.Msg {
		for _, profile := range profiles {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := credrefresh.ExecRunner{}.Run(ctx, "aws", "sts", "get-caller-identity", "--profile", profile)
			cancel()
			if err != nil {
				return awsLoginDoneMsg{Err: fmt.Errorf("refresh failed for %s: %w", profile, err)}
			}
		}
		return awsLoginDoneMsg{Err: nil}
	}
}

// runInteractiveLogin spawns `aws sso login` for the first profile.
func (m *Model) runInteractiveLogin() tea.Cmd {
	if len(m.credProfiles) == 0 {
		return func() tea.Msg {
			return awsLoginDoneMsg{Err: fmt.Errorf("no profiles configured")}
		}
	}
	m.credLoginRunning = true
	profile := m.credProfiles[0]
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		err := credrefresh.ExecRunner{}.Run(ctx, "aws", "sso", "login", "--profile", profile)
		if err != nil {
			return awsLoginDoneMsg{Err: err}
		}
		deadline := time.Now().Add(120 * time.Second)
		for time.Now().Before(deadline) {
			status := credrefresh.CheckToken(profile, "")
			if status.OK && status.TTL > 5*time.Minute {
				return awsLoginDoneMsg{Err: nil}
			}
			time.Sleep(2 * time.Second)
		}
		return awsLoginDoneMsg{Err: fmt.Errorf("timed out waiting for login")}
	}
}

// handleAwsLoginDone processes the result of an interactive or forced refresh.
func (m *Model) handleAwsLoginDone(msg awsLoginDoneMsg) tea.Cmd {
	m.credLoginRunning = false
	if msg.Err != nil {
		m.credLoginErr = msg.Err
		if m.credOverlayMode == awsOverlayInfo {
			m.credOverlayMode = awsOverlayExpired
		}
		return nil
	}
	m.credOverlayActive = false
	m.credLoginErr = nil
	if m.credMonitor != nil {
		m.credMonitor.Resume()
	}
	if len(m.credProfiles) > 0 {
		status := credrefresh.CheckToken(m.credProfiles[0], "")
		m.logToAllPane(fmt.Sprintf("[aws] token refreshed (manual), valid %s", status.TTL.Truncate(time.Minute)))
	}
	return nil
}

// logToAllPane writes a system log line to the first process output buffer
// so it appears in the "All" pane.
func (m *Model) logToAllPane(msg string) {
	if len(m.manager.Processes) > 0 {
		m.manager.Processes[0].AddSystemLine(msg)
	}
}

// renderAwsOverlay renders the AWS auth modal.
func (m Model) renderAwsOverlay() string {
	width := min(m.width-10, 60)
	bg := lipgloss.NewStyle().Background(modalBg).Foreground(modalFg)
	hint := lipgloss.NewStyle().Background(modalBg).Foreground(lipgloss.Color("244"))
	panel := lipgloss.NewStyle().Width(width).Background(modalBg).Foreground(modalFg)

	var b strings.Builder

	switch m.credOverlayMode {
	case awsOverlayInfo:
		b.WriteString(bg.Bold(true).Render("AWS SSO Status"))
		b.WriteString("\n\n")
		for _, s := range m.credStatuses {
			icon := "✓"
			if !s.OK {
				icon = "✗"
			}
			ttl := s.TTL.Truncate(time.Minute)
			b.WriteString(bg.Render(fmt.Sprintf("  %s %s: %s remaining", icon, s.Profile, ttl)))
			b.WriteString("\n")
		}
		b.WriteString("\n")
		if m.credLoginRunning {
			b.WriteString(bg.Render(m.spinner.View() + " Refreshing…"))
		} else if m.credLoginErr != nil {
			b.WriteString(bg.Foreground(statusErrored).Render("✗ " + m.credLoginErr.Error()))
			b.WriteString("\n\n")
			b.WriteString(hint.Render("Enter = try browser login · Esc = dismiss"))
		} else {
			b.WriteString(hint.Render("Enter = force refresh · Esc = dismiss"))
		}

	case awsOverlayExpired:
		b.WriteString(bg.Foreground(statusErrored).Bold(true).Render("⚠ AWS Session Expired"))
		b.WriteString("\n\n")
		if m.credLoginRunning {
			b.WriteString(bg.Render(m.spinner.View() + " Waiting for browser login…"))
		} else if m.credLoginErr != nil {
			b.WriteString(bg.Foreground(statusErrored).Render("✗ " + m.credLoginErr.Error()))
			b.WriteString("\n\n")
			b.WriteString(hint.Render("Enter = retry · Esc = dismiss (auth will fail)"))
		} else {
			b.WriteString(bg.Render("Your AWS SSO session has expired and cannot be silently refreshed."))
			b.WriteString("\n")
			b.WriteString(bg.Render("A browser window will open for re-authentication."))
			b.WriteString("\n\n")
			b.WriteString(hint.Render("Enter = open browser login · Esc = dismiss (auth will fail)"))
		}
	}

	return settingsBoxStyle.Render(panel.Render(b.String()))
}
