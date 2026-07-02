package credrefresh

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type mockRunner struct {
	mu       sync.Mutex
	calls    [][]string
	failNext bool
}

func (r *mockRunner) Run(ctx context.Context, name string, args ...string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, append([]string{name}, args...))
	if r.failNext {
		return fmt.Errorf("mock: command failed")
	}
	return nil
}

type mockRefresher struct {
	mu       sync.Mutex
	calls    int
	failNext bool
	newTTL   time.Duration
	homeDir  string
	session  string
}

func (r *mockRefresher) Refresh(ctx context.Context, profile string) (time.Duration, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	if r.failNext {
		return 0, fmt.Errorf("mock: OIDC refresh failed")
	}
	// Write a new token to disk so CheckToken sees the refreshed TTL
	if r.homeDir != "" && r.session != "" {
		writeTokenToCache(r.homeDir, r.session, time.Now().Add(r.newTTL))
	}
	return r.newTTL, nil
}

func writeTokenToCache(homeDir string, sessionName string, expiresAt time.Time) {
	cacheDir := filepath.Join(homeDir, ".aws", "sso", "cache")
	_ = os.MkdirAll(cacheDir, 0755)
	hash := fmt.Sprintf("%x", sha1.Sum([]byte(sessionName)))
	token := map[string]string{"expiresAt": expiresAt.UTC().Format(time.RFC3339)}
	data, _ := json.Marshal(token)
	_ = os.WriteFile(filepath.Join(cacheDir, hash+".json"), data, 0644)
}

func writeTestToken(t *testing.T, homeDir string, sessionName string, expiresAt time.Time) {
	t.Helper()
	cacheDir := filepath.Join(homeDir, ".aws", "sso", "cache")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatal(err)
	}
	hash := fmt.Sprintf("%x", sha1.Sum([]byte(sessionName)))
	token := map[string]string{"expiresAt": expiresAt.UTC().Format(time.RFC3339)}
	data, _ := json.Marshal(token)
	if err := os.WriteFile(filepath.Join(cacheDir, hash+".json"), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func writeTestConfig(t *testing.T, homeDir string, profile string, sessionName string) {
	t.Helper()
	configDir := filepath.Join(homeDir, ".aws")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatal(err)
	}
	content := fmt.Sprintf(`[profile %s]
sso_session = %s
sso_account_id = 123456789
sso_role_name = PowerUser
region = us-west-2

[sso-session %s]
sso_start_url = https://example.awsapps.com/start
sso_region = us-west-2
`, profile, sessionName, sessionName)
	if err := os.WriteFile(filepath.Join(configDir, "config"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestMonitor_HealthyToken(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(45*time.Minute))

	runner := &mockRunner{}
	refresher := &mockRefresher{newTTL: 8 * time.Hour, homeDir: homeDir, session: "test-sess"}
	cfg := Config{
		CheckInterval:    50 * time.Millisecond,
		RefreshThreshold: 10 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	var msgs []Msg
	var mu sync.Mutex
	send := func(m Msg) {
		mu.Lock()
		msgs = append(msgs, m)
		mu.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)
	mon.Start(ctx, send)

	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if len(msgs) == 0 {
		t.Fatal("expected at least one StatusMsg")
	}
	if _, ok := msgs[0].(StatusMsg); !ok {
		t.Errorf("expected StatusMsg, got %T", msgs[0])
	}
	// No refresh should have been attempted
	refresher.mu.Lock()
	defer refresher.mu.Unlock()
	if refresher.calls != 0 {
		t.Errorf("expected no refresh calls, got %d", refresher.calls)
	}
}

func TestMonitor_NearExpiry_RefreshSuccess(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(8*time.Minute))

	runner := &mockRunner{}
	refresher := &mockRefresher{newTTL: 8 * time.Hour, homeDir: homeDir, session: "test-sess"}
	cfg := Config{
		CheckInterval:    50 * time.Millisecond,
		RefreshThreshold: 10 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	var msgs []Msg
	var mu sync.Mutex
	send := func(m Msg) {
		mu.Lock()
		msgs = append(msgs, m)
		mu.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)
	mon.Start(ctx, send)

	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	hasRefreshed := false
	for _, m := range msgs {
		if _, ok := m.(RefreshedMsg); ok {
			hasRefreshed = true
		}
	}
	if !hasRefreshed {
		t.Error("expected RefreshedMsg after near-expiry OIDC refresh")
	}

	refresher.mu.Lock()
	defer refresher.mu.Unlock()
	if refresher.calls == 0 {
		t.Error("expected at least one OIDC refresh call")
	}
}

func TestMonitor_NearExpiry_RefreshFails(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(8*time.Minute))

	// Both OIDC refresh and CLI fallback fail
	runner := &mockRunner{failNext: true}
	refresher := &mockRefresher{failNext: true, homeDir: homeDir, session: "test-sess"}
	cfg := Config{
		CheckInterval:    50 * time.Millisecond,
		RefreshThreshold: 10 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	var msgs []Msg
	var mu sync.Mutex
	send := func(m Msg) {
		mu.Lock()
		msgs = append(msgs, m)
		mu.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)
	mon.Start(ctx, send)

	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	hasExpired := false
	for _, m := range msgs {
		if _, ok := m.(ExpiredMsg); ok {
			hasExpired = true
		}
	}
	if !hasExpired {
		t.Error("expected ExpiredMsg after failed refresh")
	}
}

func writeTestConfigMulti(t *testing.T, homeDir string, profiles []struct{ Profile, Session string }) {
	t.Helper()
	configDir := filepath.Join(homeDir, ".aws")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatal(err)
	}
	var content string
	for _, p := range profiles {
		content += fmt.Sprintf(`[profile %s]
sso_session = %s
sso_account_id = 123456789
sso_role_name = PowerUser
region = us-west-2

[sso-session %s]
sso_start_url = https://%s.awsapps.com/start
sso_region = us-west-2

`, p.Profile, p.Session, p.Session, p.Session)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestMonitor_PostRefreshLowTTL_ReasonRefreshFailed(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(8*time.Minute))

	runner := &mockRunner{}
	// OIDC refresh "succeeds" but only extends to 8 minutes (below MinUsableTTL of 15m)
	refresher := &mockRefresher{newTTL: 8 * time.Minute, homeDir: homeDir, session: "test-sess"}
	cfg := Config{
		CheckInterval:    50 * time.Millisecond,
		RefreshThreshold: 10 * time.Minute,
		MinUsableTTL:     15 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	var msgs []Msg
	var mu sync.Mutex
	send := func(m Msg) {
		mu.Lock()
		msgs = append(msgs, m)
		mu.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)
	mon.Start(ctx, send)

	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	for _, m := range msgs {
		if _, ok := m.(RefreshedMsg); ok {
			t.Error("should not emit RefreshedMsg when post-refresh TTL is below MinUsableTTL")
		}
	}

	hasExpired := false
	for _, m := range msgs {
		if _, ok := m.(ExpiredMsg); ok {
			hasExpired = true
		}
	}
	if !hasExpired {
		t.Error("expected ExpiredMsg when post-refresh TTL is below MinUsableTTL")
	}

	var statusMsg StatusMsg
	for _, m := range msgs {
		if s, ok := m.(StatusMsg); ok {
			statusMsg = s
			break
		}
	}
	if len(statusMsg.Statuses) == 0 {
		t.Fatal("expected StatusMsg with statuses")
	}
	if statusMsg.Statuses[0].Reason != ReasonRefreshFailed {
		t.Errorf("expected Reason=ReasonRefreshFailed, got %d", statusMsg.Statuses[0].Reason)
	}
	if statusMsg.Statuses[0].TTL == 0 {
		t.Error("expected non-zero TTL preserved in failed status")
	}
}

func TestMonitor_MultiProfile_NoEarlyReturn(t *testing.T) {
	homeDir := t.TempDir()
	profiles := []struct{ Profile, Session string }{
		{"expired-prof", "expired-sess"},
		{"healthy-prof", "healthy-sess"},
	}
	writeTestConfigMulti(t, homeDir, profiles)
	writeTestToken(t, homeDir, "expired-sess", time.Now().Add(-5*time.Minute))
	writeTestToken(t, homeDir, "healthy-sess", time.Now().Add(45*time.Minute))

	runner := &mockRunner{}
	refresher := &mockRefresher{failNext: true, homeDir: homeDir, session: "expired-sess"}
	cfg := Config{
		CheckInterval:    50 * time.Millisecond,
		RefreshThreshold: 10 * time.Minute,
		MinUsableTTL:     5 * time.Minute,
		Profiles:         []string{"expired-prof", "healthy-prof"},
		ProjectRoot:      homeDir,
	}

	var msgs []Msg
	var mu sync.Mutex
	send := func(m Msg) {
		mu.Lock()
		msgs = append(msgs, m)
		mu.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)
	mon.Start(ctx, send)

	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	var statusMsg StatusMsg
	for _, m := range msgs {
		if s, ok := m.(StatusMsg); ok {
			statusMsg = s
			break
		}
	}
	if len(statusMsg.Statuses) != 2 {
		t.Fatalf("expected 2 statuses (both profiles), got %d", len(statusMsg.Statuses))
	}

	hasExpired := false
	for _, m := range msgs {
		if _, ok := m.(ExpiredMsg); ok {
			hasExpired = true
		}
	}
	if !hasExpired {
		t.Error("expected ExpiredMsg for the expired profile")
	}
}

func TestMonitor_ContextCancelled(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(45*time.Minute))

	runner := &mockRunner{}
	refresher := &mockRefresher{newTTL: 8 * time.Hour, homeDir: homeDir, session: "test-sess"}
	cfg := Config{
		CheckInterval:    1 * time.Second,
		RefreshThreshold: 10 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	ctx, cancel := context.WithCancel(context.Background())
	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)

	done := make(chan struct{})
	go func() {
		mon.Start(ctx, func(Msg) {})
		close(done)
	}()

	cancel()
	select {
	case <-done:
		// goroutine exited
	case <-time.After(1 * time.Second):
		t.Fatal("monitor did not exit after context cancel")
	}
}

func TestMonitor_NearExpiry_OIDCFails_CLINoExtend_ReportsFailure(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(8*time.Minute))

	// OIDC fails; CLI succeeds but cannot extend the SSO token TTL
	runner := &mockRunner{}
	refresher := &mockRefresher{failNext: true, homeDir: homeDir, session: "test-sess"}
	cfg := Config{
		CheckInterval:    50 * time.Millisecond,
		RefreshThreshold: 10 * time.Minute,
		MinUsableTTL:     5 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	var msgs []Msg
	var mu sync.Mutex
	send := func(m Msg) {
		mu.Lock()
		msgs = append(msgs, m)
		mu.Unlock()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	mon := NewMonitorWithRefresher(cfg, runner, refresher, homeDir)
	mon.Start(ctx, send)

	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	// CLI did not extend the token, so no RefreshedMsg should be emitted
	for _, m := range msgs {
		if _, ok := m.(RefreshedMsg); ok {
			t.Error("should not emit RefreshedMsg when CLI did not extend token TTL")
		}
	}

	// Should report the OIDC failure via ExpiredMsg
	hasExpired := false
	for _, m := range msgs {
		if _, ok := m.(ExpiredMsg); ok {
			hasExpired = true
		}
	}
	if !hasExpired {
		t.Error("expected ExpiredMsg surfacing the OIDC refresh failure")
	}
}
