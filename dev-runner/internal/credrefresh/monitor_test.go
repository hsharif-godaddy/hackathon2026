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

	mon := NewMonitor(cfg, runner, homeDir)
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
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.calls) != 0 {
		t.Errorf("expected no refresh calls, got %d", len(runner.calls))
	}
}

func TestMonitor_NearExpiry_RefreshSuccess(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(8*time.Minute))

	runner := &mockRunner{}
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

	mon := NewMonitor(cfg, runner, homeDir)
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
		t.Error("expected RefreshedMsg after near-expiry silent refresh")
	}

	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.calls) == 0 {
		t.Error("expected at least one STS call")
	}
}

func TestMonitor_NearExpiry_RefreshFails(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(8*time.Minute))

	runner := &mockRunner{failNext: true}
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

	mon := NewMonitor(cfg, runner, homeDir)
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

func TestMonitor_ContextCancelled(t *testing.T) {
	homeDir := t.TempDir()
	writeTestConfig(t, homeDir, "test-prof", "test-sess")
	writeTestToken(t, homeDir, "test-sess", time.Now().Add(45*time.Minute))

	runner := &mockRunner{}
	cfg := Config{
		CheckInterval:    1 * time.Second,
		RefreshThreshold: 10 * time.Minute,
		Profiles:         []string{"test-prof"},
		ProjectRoot:      homeDir,
	}

	ctx, cancel := context.WithCancel(context.Background())
	mon := NewMonitor(cfg, runner, homeDir)

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
