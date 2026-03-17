package api

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gorilla/mux"
)

func newTestDB(t *testing.T) *store.DB {
	t.Helper()
	db, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	return &Server{DB: newTestDB(t)}
}

// setMuxVars creates a request with gorilla/mux URL vars set.
func setMuxVars(r *http.Request, vars map[string]string) *http.Request {
	return mux.SetURLVars(r, vars)
}

func decodeJSON(t *testing.T, w *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(w.Body).Decode(v); err != nil {
		t.Fatalf("decode response JSON: %v", err)
	}
}

// --- GetApp ---

func TestGetAppHandler(t *testing.T) {
	srv := newTestServer(t)

	app, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/"+app.ID, nil)
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID})

	w := httptest.NewRecorder()
	srv.GetApp(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["id"] != app.ID {
		t.Errorf("expected id %s, got %v", app.ID, resp["id"])
	}
	if resp["status"] != "provisioning" {
		t.Errorf("expected status provisioning, got %v", resp["status"])
	}
}

func TestGetAppHandlerNotFound(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/apps/nonexistent", nil)
	req = setMuxVars(req, map[string]string{"appId": "nonexistent"})

	w := httptest.NewRecorder()
	srv.GetApp(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// --- ListApps ---

func TestListAppsHandler(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-1", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/apps", nil)
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "sysId": "sys-1"})

	w := httptest.NewRecorder()
	srv.ListApps(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	apps := resp["apps"].([]any)
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(apps))
	}
}

// --- GetAllApps ---

func TestGetAllAppsHandler(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-2", "sys-2", nil, nil)

	req := httptest.NewRequest("GET", "/customers/me/apps", nil)
	w := httptest.NewRecorder()
	srv.GetAllApps(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	apps := resp["apps"].([]any)
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(apps))
	}
}

// --- UpdateApp ---

func TestUpdateAppHandler(t *testing.T) {
	srv := newTestServer(t)

	app, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)

	body, _ := json.Marshal(map[string]any{"status": "active"})
	req := httptest.NewRequest("PATCH", "/apps/"+app.ID, bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": app.ID})

	w := httptest.NewRecorder()
	srv.UpdateApp(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["status"] != "active" {
		t.Errorf("expected active, got %v", resp["status"])
	}
}

func TestUpdateAppHandlerNotFound(t *testing.T) {
	srv := newTestServer(t)

	body, _ := json.Marshal(map[string]any{"status": "active"})
	req := httptest.NewRequest("PATCH", "/apps/nonexistent", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "nonexistent"})

	w := httptest.NewRecorder()
	srv.UpdateApp(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// --- Secrets ---

func TestGetSecretsHandlerEmpty(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/apps/app1/secrets", nil)
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.GetSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["appId"] != "app1" {
		t.Errorf("expected appId app1, got %v", resp["appId"])
	}

	shared := resp["shared"].(map[string]any)
	secrets := shared["secrets"].([]any)
	if len(secrets) != 0 {
		t.Errorf("expected empty shared secrets, got %d", len(secrets))
	}
}

func TestGetSecretsHandlerGrouped(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.UpsertSecret("app1", "shared", "SHARED_KEY", "s", false)
	srv.DB.UpsertSecret("app1", "preview", "PREVIEW_KEY", "p", false)
	srv.DB.UpsertSecret("app1", "publish", "PUBLISH_KEY", "pub", true)

	req := httptest.NewRequest("GET", "/apps/app1/secrets", nil)
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.GetSecrets(w, req)

	var resp map[string]any
	decodeJSON(t, w, &resp)

	shared := resp["shared"].(map[string]any)["secrets"].([]any)
	if len(shared) != 1 {
		t.Fatalf("expected 1 shared secret, got %d", len(shared))
	}

	variants := resp["variants"].(map[string]any)
	previewSecrets := variants["preview"].(map[string]any)["secrets"].([]any)
	if len(previewSecrets) != 1 {
		t.Fatalf("expected 1 preview secret, got %d", len(previewSecrets))
	}

	publishSecrets := variants["publish"].(map[string]any)["secrets"].([]any)
	if len(publishSecrets) != 1 {
		t.Fatalf("expected 1 publish secret, got %d", len(publishSecrets))
	}
}

func TestUpdateSecretsHandler(t *testing.T) {
	srv := newTestServer(t)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "API_KEY",
					"value":    "secret123",
					"variants": []string{"shared"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/app1/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["secretsUpdated"] != true {
		t.Error("expected secretsUpdated true")
	}

	// Verify secret was stored
	secrets, _ := srv.DB.GetSecrets("app1", nil)
	if len(secrets) != 1 {
		t.Fatalf("expected 1 secret, got %d", len(secrets))
	}
	if secrets[0].Value != "secret123" {
		t.Errorf("expected secret123, got %s", secrets[0].Value)
	}
}

func TestUpdateSecretsHandlerDelete(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.UpsertSecret("app1", "shared", "OLD_KEY", "val", false)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "delete",
				"secret": map[string]any{
					"name":     "OLD_KEY",
					"variants": []string{"shared"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/app1/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	secrets, _ := srv.DB.GetSecrets("app1", nil)
	if len(secrets) != 0 {
		t.Fatalf("expected 0 secrets after delete, got %d", len(secrets))
	}
}

// --- Jobs ---

func TestGetJobAppsHandlerCompleted(t *testing.T) {
	srv := newTestServer(t)

	app, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	job, _ := srv.DB.CreateJob(app.ID)
	srv.DB.UpdateJobStatus(job.ID, "completed", "")

	req := httptest.NewRequest("GET", "/jobs/"+job.ID+"/apps", nil)
	req = setMuxVars(req, map[string]string{"jobId": job.ID})

	w := httptest.NewRecorder()
	srv.GetJobApps(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["status"] != "completed" {
		t.Errorf("expected completed, got %v", resp["status"])
	}
	apps := resp["apps"].([]any)
	if len(apps) != 1 {
		t.Fatalf("expected 1 app for completed job, got %d", len(apps))
	}
}

func TestGetJobAppsHandlerPending(t *testing.T) {
	srv := newTestServer(t)

	app, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	job, _ := srv.DB.CreateJob(app.ID)

	req := httptest.NewRequest("GET", "/jobs/"+job.ID+"/apps", nil)
	req = setMuxVars(req, map[string]string{"jobId": job.ID})

	w := httptest.NewRecorder()
	srv.GetJobApps(w, req)

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["status"] != "pending" {
		t.Errorf("expected pending, got %v", resp["status"])
	}
	apps := resp["apps"].([]any)
	if len(apps) != 0 {
		t.Fatalf("expected 0 apps for pending job, got %d", len(apps))
	}
}

func TestWaitForPreviewReady(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/airo/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	parsedURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}

	port := parsedURL.Port()
	if port == "" {
		t.Fatal("expected test server port")
	}

	addr, err := net.ResolveTCPAddr("tcp", parsedURL.Host)
	if err != nil {
		t.Fatalf("resolve tcp addr: %v", err)
	}

	if err := waitForPreviewReady(addr.Port); err != nil {
		t.Fatalf("expected preview readiness check to pass, got error: %v", err)
	}
}

func TestPublishAppCompletesAfterPublishReady(t *testing.T) {
	srv := newTestServer(t)

	publishServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/airo/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer publishServer.Close()

	parsedURL, err := url.Parse(publishServer.URL)
	if err != nil {
		t.Fatalf("parse publish server url: %v", err)
	}

	addr, err := net.ResolveTCPAddr("tcp", parsedURL.Host)
	if err != nil {
		t.Fatalf("resolve publish tcp addr: %v", err)
	}

	app, err := srv.DB.CreateApp("sub-1", "sys-1", map[string]any{"title": "Test"}, []string{"preview"})
	if err != nil {
		t.Fatalf("create app: %v", err)
	}

	if err := srv.DB.UpdateAppPorts(app.ID, 5001, addr.Port, 8878, 9001); err != nil {
		t.Fatalf("update ports: %v", err)
	}

	body, _ := json.Marshal(map[string]any{"gitHash": "abc123"})
	req := httptest.NewRequest("PUT", "/apps/"+app.ID+"/publish", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID})

	w := httptest.NewRecorder()
	srv.PublishApp(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["status"] != "PENDING" {
		t.Fatalf("expected initial publish status PENDING, got %v", resp["status"])
	}

	immediateApp, err := srv.DB.GetApp(app.ID)
	if err != nil {
		t.Fatalf("get app: %v", err)
	}
	if len(immediateApp.Variants) != 1 || immediateApp.Variants[0] != "preview" {
		t.Fatalf("expected publish variant to be delayed, got %v", immediateApp.Variants)
	}

	jobID, _ := resp["statusJobId"].(string)
	deploymentID, _ := resp["deploymentId"].(string)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		job, jobErr := srv.DB.GetJob(jobID)
		deps, depErr := srv.DB.GetDeployments(app.ID, 10)
		finalApp, appErr := srv.DB.GetApp(app.ID)
		if jobErr != nil || depErr != nil || appErr != nil {
			t.Fatalf("errors while waiting for publish completion: job=%v dep=%v app=%v", jobErr, depErr, appErr)
		}

		if job != nil && job.Status == "completed" && finalApp != nil {
			hasPublish := false
			for _, variant := range finalApp.Variants {
				if variant == "publish" {
					hasPublish = true
					break
				}
			}

			if hasPublish {
				for _, dep := range deps {
					if dep.ID == deploymentID {
						if dep.Status != "deployed" {
							t.Fatalf("expected deployed status, got %s", dep.Status)
						}
						return
					}
				}
			}
		}

		time.Sleep(25 * time.Millisecond)
	}

	t.Fatal("timed out waiting for publish completion")
}

func TestGetJobAppsHandlerNotFound(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/jobs/nonexistent/apps", nil)
	req = setMuxVars(req, map[string]string{"jobId": "nonexistent"})

	w := httptest.NewRecorder()
	srv.GetJobApps(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// --- Deployments ---

func TestGetDeploymentsHandler(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.CreateDeployment("app1", "job1", "abc123")
	srv.DB.CreateDeployment("app1", "job2", "def456")

	req := httptest.NewRequest("GET", "/apps/app1/deployments", nil)
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.GetDeployments(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	deps := resp["deployments"].([]any)
	if len(deps) != 2 {
		t.Fatalf("expected 2 deployments, got %d", len(deps))
	}
	if resp["total"].(float64) != 2 {
		t.Errorf("expected total 2, got %v", resp["total"])
	}
}

// --- appToResponse ---

func TestAppToResponse(t *testing.T) {
	app := &store.App{
		ID:                    "test-app",
		SubscriptionID:        "sub-1",
		SystemID:              "sys-1",
		Status:                "active",
		Variants:              []string{"preview", "publish"},
		PreviewPort:           5001,
		PublishPort:           5501,
		SupervisorPort:        8878,
		PublishSupervisorPort: 9001,
	}

	resp := appToResponse(app)

	if resp["id"] != "test-app" {
		t.Errorf("expected id test-app, got %v", resp["id"])
	}
	if resp["appTemplateName"] != "default" {
		t.Errorf("expected appTemplateName default, got %v", resp["appTemplateName"])
	}
	if resp["cellId"] != "local-dev" {
		t.Errorf("expected cellId local-dev, got %v", resp["cellId"])
	}

	urls := resp["urls"].(map[string]string)
	if urls["preview"] != "https://localhost:5001" {
		t.Errorf("expected preview url, got %v", urls["preview"])
	}
	if urls["publish"] != "https://localhost:5501" {
		t.Errorf("expected publish url, got %v", urls["publish"])
	}

	if resp["socketPath"] != "tcp://localhost:8878" {
		t.Errorf("expected socketPath, got %v", resp["socketPath"])
	}
	if resp["publishSupervisorPath"] != "tcp://localhost:9001" {
		t.Errorf("expected publishSupervisorPath, got %v", resp["publishSupervisorPath"])
	}

	system := resp["system"].(map[string]any)
	if system["productId"] != store.DefaultProductID {
		t.Errorf("expected productId %s, got %v", store.DefaultProductID, system["productId"])
	}
}

func TestAppToResponseNoPorts(t *testing.T) {
	app := &store.App{
		ID:     "test-app",
		Status: "provisioning",
	}

	resp := appToResponse(app)

	urls := resp["urls"].(map[string]string)
	if _, ok := urls["preview"]; ok {
		t.Error("expected no preview url when port is 0")
	}
	if _, ok := urls["publish"]; ok {
		t.Error("expected no publish url when port is 0")
	}
	if _, ok := resp["socketPath"]; ok {
		t.Error("expected no socketPath when port is 0")
	}
}

// --- Utility functions ---

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"key": "val"})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json, got %s", ct)
	}

	var resp map[string]string
	decodeJSON(t, w, &resp)
	if resp["key"] != "val" {
		t.Errorf("expected val, got %s", resp["key"])
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "bad input")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}

	var resp map[string]string
	decodeJSON(t, w, &resp)
	if resp["error"] != "bad input" {
		t.Errorf("expected 'bad input', got %s", resp["error"])
	}
}

func TestReadJSON(t *testing.T) {
	body, _ := json.Marshal(map[string]string{"name": "test"})
	req := httptest.NewRequest("POST", "/", bytes.NewReader(body))

	var result struct {
		Name string `json:"name"`
	}
	err := readJSON(req, &result)
	if err != nil {
		t.Fatalf("readJSON: %v", err)
	}
	if result.Name != "test" {
		t.Errorf("expected test, got %s", result.Name)
	}
}

// --- Error injection ---

func TestCheckInjectedError(t *testing.T) {
	// Ensure clean state
	injectedErrorMu.Lock()
	injectedError = nil
	injectedErrorMu.Unlock()

	w := httptest.NewRecorder()
	fired := checkInjectedError(w)
	if fired {
		t.Error("expected no error to fire when nothing is injected")
	}

	// Inject an error
	status := 503
	injectedErrorMu.Lock()
	injectedError = &status
	injectedErrorMu.Unlock()

	w = httptest.NewRecorder()
	fired = checkInjectedError(w)
	if !fired {
		t.Error("expected injected error to fire")
	}
	if w.Code != 503 {
		t.Errorf("expected 503, got %d", w.Code)
	}

	// Should be one-shot: second call should not fire
	w = httptest.NewRecorder()
	fired = checkInjectedError(w)
	if fired {
		t.Error("expected injected error to be consumed (one-shot)")
	}
}

func TestInjectErrorHandler(t *testing.T) {
	srv := newTestServer(t)

	// Clean state
	injectedErrorMu.Lock()
	injectedError = nil
	injectedErrorMu.Unlock()

	body, _ := json.Marshal(map[string]int{"status": 500})
	req := httptest.NewRequest("POST", "/api/_debug/inject-error", bytes.NewReader(body))

	w := httptest.NewRecorder()
	srv.InjectError(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Verify error was injected
	injectedErrorMu.Lock()
	hasError := injectedError != nil
	injectedError = nil // clean up
	injectedErrorMu.Unlock()

	if !hasError {
		t.Error("expected error to be injected")
	}
}

func TestClearErrorHandler(t *testing.T) {
	srv := newTestServer(t)

	// Inject first
	status := 500
	injectedErrorMu.Lock()
	injectedError = &status
	injectedErrorMu.Unlock()

	req := httptest.NewRequest("POST", "/api/_debug/clear-error", nil)
	w := httptest.NewRecorder()
	srv.ClearError(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	injectedErrorMu.Lock()
	isNil := injectedError == nil
	injectedErrorMu.Unlock()

	if !isNil {
		t.Error("expected error to be cleared")
	}
}

// --- Full router integration ---

func TestHealthEndpoint(t *testing.T) {
	db := newTestDB(t)
	router := NewRouter(db, nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]string
	decodeJSON(t, w, &resp)
	if resp["status"] != "ok" {
		t.Errorf("expected status ok, got %s", resp["status"])
	}
}

func TestRouterErrorInjectionMiddleware(t *testing.T) {
	db := newTestDB(t)
	router := NewRouter(db, nil)

	// Clean state
	injectedErrorMu.Lock()
	injectedError = nil
	injectedErrorMu.Unlock()

	// Inject error via debug endpoint
	body, _ := json.Marshal(map[string]int{"status": 503})
	req := httptest.NewRequest("POST", "/api/_debug/inject-error", bytes.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Now the next request should get the injected error
	req = httptest.NewRequest("GET", "/health", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != 503 {
		t.Fatalf("expected 503 from injected error, got %d", w.Code)
	}

	// Third request should work normally (one-shot)
	req = httptest.NewRequest("GET", "/health", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 after one-shot error consumed, got %d", w.Code)
	}
}

// --- Stubs ---

func TestGetImageStatusStub(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/apps/app1/image-status", nil)
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.GetImageStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["status"] != "current" {
		t.Errorf("expected status current, got %v", resp["status"])
	}
	if resp["appId"] != "app1" {
		t.Errorf("expected appId app1, got %v", resp["appId"])
	}
}

func TestGetCustomerHandler(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/customers/me", nil)
	w := httptest.NewRecorder()
	srv.GetCustomer(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["customerId"] != store.DefaultCustomerID {
		t.Errorf("expected %s, got %v", store.DefaultCustomerID, resp["customerId"])
	}
	if resp["exists"] != true {
		t.Error("expected exists true")
	}
}
