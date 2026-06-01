package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
)

// fakeProber records the args passed to each Describe* call and returns
// whatever err is mapped for that arg. Missing map entries → nil (success).
type fakeProber struct {
	describeTableCalls  []string
	describeSecretCalls []string
	describeKeyCalls    []string

	tableErr  map[string]error
	secretErr map[string]error
	keyErr    map[string]error
}

func (f *fakeProber) DescribeTable(_ context.Context, name string) error {
	f.describeTableCalls = append(f.describeTableCalls, name)
	return f.tableErr[name]
}
func (f *fakeProber) DescribeSecret(_ context.Context, name string) error {
	f.describeSecretCalls = append(f.describeSecretCalls, name)
	return f.secretErr[name]
}
func (f *fakeProber) DescribeKey(_ context.Context, id string) error {
	f.describeKeyCalls = append(f.describeKeyCalls, id)
	return f.keyErr[id]
}

func newTestServer(prober *fakeProber) *Server {
	return newTestServerEnv(prober, "dev")
}

// newTestServerEnv intentionally hardcodes ResourceNames to the dev
// environment regardless of `env`. Tests can independently flip the verbosity
// gate (via env) while keeping resource names stable so the fakeProber's
// error maps can be keyed off a single source of truth. If ResourceNames ever
// gets derived from env here, update the fakeProber maps in the failure-path
// tests accordingly.
func newTestServerEnv(prober *fakeProber, env string) *Server {
	return &Server{
		Environment:   env,
		Version:       "test",
		Prober:        prober,
		ResourceNames: config.Config{Environment: config.EnvDev}.ResourceNames(),
	}
}

func decodeProbeResponse(t *testing.T, body []byte) probeResponse {
	t.Helper()
	var resp probeResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("unmarshal: %v (body=%q)", err, string(body))
	}
	return resp
}

func TestProbeAllOK(t *testing.T) {
	s := newTestServer(&fakeProber{})
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rr.Code)
	}
	resp := decodeProbeResponse(t, rr.Body.Bytes())
	if resp.Status != "ok" {
		t.Errorf("Status: want ok, got %q", resp.Status)
	}
	if len(resp.Checks) != 5 {
		t.Fatalf("Checks: want 5, got %d", len(resp.Checks))
	}
	for _, c := range resp.Checks {
		if !c.OK {
			t.Errorf("%s: ok=false, error=%q", c.Name, c.Error)
		}
		if c.LatencyMs < 0 {
			t.Errorf("%s: negative latency %d", c.Name, c.LatencyMs)
		}
		if c.Error != "" {
			t.Errorf("%s: error should be empty on success, got %q", c.Name, c.Error)
		}
	}
}

func TestProbeOneTableFailsProdMasksError(t *testing.T) {
	names := config.Config{Environment: config.EnvDev}.ResourceNames()
	s := newTestServerEnv(&fakeProber{
		tableErr: map[string]error{names.EventsTable: errors.New("AccessDeniedException: explicit deny")},
	}, "prod")
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", rr.Code)
	}
	resp := decodeProbeResponse(t, rr.Body.Bytes())
	if resp.Status != "error" {
		t.Errorf("Status: want error, got %q", resp.Status)
	}

	var events probeCheck
	okCount := 0
	for _, c := range resp.Checks {
		if c.Name == "dynamodb.events" {
			events = c
		} else if c.OK {
			okCount++
		}
	}
	if events.OK {
		t.Errorf("dynamodb.events should have failed")
	}
	if events.Error != "probe failed" {
		t.Errorf("dynamodb.events.Error (prod): want %q, got %q", "probe failed", events.Error)
	}
	if okCount != 4 {
		t.Errorf("expected 4 other checks to succeed, got %d", okCount)
	}

	// In prod, raw AWS error text must not leak to the HTTP response.
	if got := rr.Body.String(); strings.Contains(got, "AccessDeniedException") || strings.Contains(got, "explicit deny") {
		t.Errorf("raw AWS error leaked to prod response body: %q", got)
	}
}

func TestProbeNonProdSurfacesError(t *testing.T) {
	names := config.Config{Environment: config.EnvDev}.ResourceNames()
	s := newTestServerEnv(&fakeProber{
		tableErr: map[string]error{names.EventsTable: errors.New("AccessDeniedException: explicit deny")},
	}, "dev")
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	resp := decodeProbeResponse(t, rr.Body.Bytes())
	var events probeCheck
	for _, c := range resp.Checks {
		if c.Name == "dynamodb.events" {
			events = c
		}
	}
	if !strings.Contains(events.Error, "AccessDeniedException") {
		t.Errorf("dev response should contain raw AWS error; got %q", events.Error)
	}
}

func TestProbeAllFail(t *testing.T) {
	names := config.Config{Environment: config.EnvDev}.ResourceNames()
	boom := errors.New("boom")
	s := newTestServer(&fakeProber{
		tableErr:  map[string]error{names.SandboxesTable: boom, names.EventsTable: boom},
		secretErr: map[string]error{names.PlatformKeySecret: boom, names.WebhookSigningSecret: boom},
		keyErr:    map[string]error{names.ManagedKeysAlias: boom},
	})
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", rr.Code)
	}
	resp := decodeProbeResponse(t, rr.Body.Bytes())
	for _, c := range resp.Checks {
		if c.OK {
			t.Errorf("%s: want ok=false, got ok=true", c.Name)
		}
	}
}

func TestProbeResourceNamesPassedThrough(t *testing.T) {
	names := config.Config{Environment: config.EnvDev}.ResourceNames()
	prober := &fakeProber{}
	s := newTestServer(prober)

	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if got, want := prober.describeTableCalls, []string{names.SandboxesTable, names.EventsTable}; !slicesEqual(got, want) {
		t.Errorf("DescribeTable calls: want %v, got %v", want, got)
	}
	if got, want := prober.describeSecretCalls, []string{names.PlatformKeySecret, names.WebhookSigningSecret}; !slicesEqual(got, want) {
		t.Errorf("DescribeSecret calls: want %v, got %v", want, got)
	}
	if got, want := prober.describeKeyCalls, []string{names.ManagedKeysAlias}; !slicesEqual(got, want) {
		t.Errorf("DescribeKey calls: want %v, got %v", want, got)
	}
}

func TestProbeResponseShape(t *testing.T) {
	s := newTestServer(&fakeProber{})
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	var generic struct {
		Status string           `json:"status"`
		Checks []map[string]any `json:"checks"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &generic); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, c := range generic.Checks {
		for _, f := range []string{"name", "ok", "latencyMs"} {
			if _, ok := c[f]; !ok {
				t.Errorf("check missing required field %q: %v", f, c)
			}
		}
	}
}

// fakeHostingProber returns canned values from ProbeAuth/ProbeReach so the
// /v1/_probe handler tests don't need a real HTTP server.
type fakeHostingProber struct {
	authScheme string
	authErr    error

	reachStatus int
	reachBody   string
	reachErr    error
}

func (f *fakeHostingProber) ProbeAuth(context.Context) (string, error) {
	return f.authScheme, f.authErr
}

func (f *fakeHostingProber) ProbeReach(context.Context) (int, string, error) {
	return f.reachStatus, f.reachBody, f.reachErr
}

func TestProbe_SkipsHostingStepsWhenProberNil(t *testing.T) {
	s := newTestServer(&fakeProber{})
	// HostingProber intentionally nil
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	resp := decodeProbeResponse(t, rr.Body.Bytes())
	for _, c := range resp.Checks {
		if strings.HasPrefix(c.Name, "hosting.") {
			t.Errorf("expected no hosting.* checks when HostingProber is nil; got %q", c.Name)
		}
	}
}

func TestProbe_HostingAuthSurfacesScheme(t *testing.T) {
	s := newTestServer(&fakeProber{})
	s.HostingProber = &fakeHostingProber{
		authScheme:  "sso-jwt",
		reachStatus: http.StatusNotFound,
		reachBody:   `{"error":"app not found"}`,
	}
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	resp := decodeProbeResponse(t, rr.Body.Bytes())
	authCheck := findCheck(t, resp, "hosting.auth")
	if !authCheck.OK {
		t.Errorf("hosting.auth.OK: want true, got false (err=%q)", authCheck.Error)
	}
	if !strings.Contains(authCheck.Details, "scheme=sso-jwt") {
		t.Errorf("hosting.auth.Details should expose scheme; got %q", authCheck.Details)
	}
}

func TestProbe_HostingReachTreats4xxAsCallSucceeded(t *testing.T) {
	// 401/404 from mhp-core mean the probe call itself succeeded (we got a
	// clean response) — only 5xx or transport errors mark the step as
	// not-OK. This is what makes the probe useful for diagnosing auth state
	// without flipping the overall /v1/_probe status to 503.
	s := newTestServer(&fakeProber{})
	s.HostingProber = &fakeHostingProber{
		authScheme:  "sso-jwt",
		reachStatus: http.StatusUnauthorized,
		reachBody:   `{"error":"Certificate CN not authorized"}`,
	}
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if rr.Code != http.StatusOK {
		t.Errorf("overall probe status: want 200 (4xx mhp-core is informational), got %d", rr.Code)
	}
	resp := decodeProbeResponse(t, rr.Body.Bytes())
	reachCheck := findCheck(t, resp, "hosting.reach")
	if !reachCheck.OK {
		t.Errorf("hosting.reach.OK: want true on 401 (call succeeded), got false")
	}
	if !strings.Contains(reachCheck.Details, "status=401") {
		t.Errorf("Details should expose status; got %q", reachCheck.Details)
	}
	if !strings.Contains(reachCheck.Details, "CN not authorized") {
		t.Errorf("Details should expose mhp-core's body; got %q", reachCheck.Details)
	}
}

func TestProbe_HostingReachMarks5xxNotOK(t *testing.T) {
	s := newTestServer(&fakeProber{})
	s.HostingProber = &fakeHostingProber{
		authScheme:  "sso-jwt",
		reachStatus: http.StatusInternalServerError,
		reachBody:   "boom",
	}
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("overall probe status: want 503 (5xx mhp-core is real failure), got %d", rr.Code)
	}
	resp := decodeProbeResponse(t, rr.Body.Bytes())
	reachCheck := findCheck(t, resp, "hosting.reach")
	if reachCheck.OK {
		t.Errorf("hosting.reach.OK: want false on 5xx, got true")
	}
}

func TestProbe_HostingAuthFailureIsNotOK(t *testing.T) {
	s := newTestServer(&fakeProber{})
	s.HostingProber = &fakeHostingProber{
		authErr: errors.New("cert mint exploded"),
	}
	rr := httptest.NewRecorder()
	s.getProbe(rr, httptest.NewRequest(http.MethodGet, "/v1/_probe", nil))

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("overall probe status: want 503 on auth failure, got %d", rr.Code)
	}
	resp := decodeProbeResponse(t, rr.Body.Bytes())
	authCheck := findCheck(t, resp, "hosting.auth")
	if authCheck.OK {
		t.Errorf("hosting.auth.OK: want false on auth error, got true")
	}
	if !strings.Contains(authCheck.Error, "cert mint exploded") {
		t.Errorf("hosting.auth.Error should wrap the auth error; got %q", authCheck.Error)
	}
}

func findCheck(t *testing.T, resp probeResponse, name string) probeCheck {
	t.Helper()
	for _, c := range resp.Checks {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("check %q not present in response: %+v", name, resp.Checks)
	return probeCheck{}
}

func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
