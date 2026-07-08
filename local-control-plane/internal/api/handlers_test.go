package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/auth"
	"github.com/airo-ai-builder/local-control-plane/internal/setup"
	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gdcorp-golang/auth/gdtoken"
	"github.com/gorilla/mux"
)

func noopSSOMiddleware(t *testing.T) *auth.SSOMiddleware {
	t.Helper()
	mw, err := auth.NewSSOMiddleware("none", "")
	if err != nil {
		t.Fatalf("create noop SSO middleware: %v", err)
	}
	return mw
}

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

func TestGetApp_IncludesImageDigestAndLifecycleState(t *testing.T) {
	srv := newTestServer(t)

	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	if err := srv.DB.UpdateAppImageDigest(app.ID, "aab-template-v8:latest"); err != nil {
		t.Fatal(err)
	}
	if err := srv.DB.UpdateAppLifecycleState(app.ID, store.LifecycleStateRunning); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/"+app.ID, nil)
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID})

	w := httptest.NewRecorder()
	srv.GetApp(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["imageDigest"] != "aab-template-v8:latest" {
		t.Errorf("imageDigest: got %v, want %q", resp["imageDigest"], "aab-template-v8:latest")
	}
	if resp["lifecycleState"] != store.LifecycleStateRunning {
		t.Errorf("lifecycleState: got %v, want %q", resp["lifecycleState"], store.LifecycleStateRunning)
	}
}

func TestGetApp_ActiveAppDoesNotEmitProvisioningLifecycle(t *testing.T) {
	srv := newTestServer(t)

	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	activeStatus := "active"
	if _, err := srv.DB.UpdateApp(app.ID, &activeStatus, nil, nil); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/"+app.ID, nil)
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID})

	w := httptest.NewRecorder()
	srv.GetApp(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["status"] != "active" {
		t.Fatalf("status: got %v, want active", resp["status"])
	}
	if resp["lifecycleState"] != store.LifecycleStateRunning {
		t.Errorf("lifecycleState: got %v, want %q", resp["lifecycleState"], store.LifecycleStateRunning)
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

	srv.DB.EnsureSubscription("sub-1", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-2", store.DefaultCustomerID)
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

func TestUpdateSecretsAuthClassWritesToAuthVariant(t *testing.T) {
	// SSO_OAUTH_CONFIG with auth: true + systemManaged: true is the
	// reserved-name path for Auth-at-Edge per-app OAuth credentials.
	// Routes to the "auth" sentinel variant — read by dev-supervisor in
	// production, never injected into the customer app's environment.
	srv := newTestServer(t)
	authTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":          "SSO_OAUTH_CONFIG",
					"systemManaged": true,
					"auth":          authTrue,
					"value": map[string]any{
						"local-sso-cfg-godaddy-shopper": map[string]any{
							"clientId":     "0oa1ab2cd3ef4",
							"clientSecret": "very-secret",
						},
					},
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

	authVariant := "auth"
	secrets, err := srv.DB.GetSecrets("app1", &authVariant)
	if err != nil {
		t.Fatalf("get auth secrets: %v", err)
	}
	if len(secrets) != 1 || secrets[0].Name != "SSO_OAUTH_CONFIG" {
		t.Fatalf("expected SSO_OAUTH_CONFIG in auth variant, got %+v", secrets)
	}
}

func TestUpdateSecretsAuthClassRejectsNonReservedNonPointerName(t *testing.T) {
	// auth: true on a name that is neither the SSO_OAUTH_CONFIG cache row
	// NOR a known pointer key (GD_SSO_OAUTH_CLIENT_ID/SECRET) is rejected.
	// Mirrors mhp-core's ValidateAuthClassWrite — would otherwise be a
	// "self-wedge" (present in auth.json but unreachable by dev-supervisor
	// since no cache-row pointer references it).
	srv := newTestServer(t)
	authTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":          "MY_FAKE_AUTH",
					"systemManaged": true,
					"auth":          authTrue,
					"value":         "x",
				},
			},
		},
	})
	req := httptest.NewRequest("POST", "/apps/app1/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app1"})
	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (all ops failed), got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateSecretsAuthClassAcceptsPointerRowWrite(t *testing.T) {
	// The Phase-1 AAB BFF write path: two pointer-named rows
	// (GD_SSO_OAUTH_CLIENT_ID / GD_SSO_OAUTH_CLIENT_SECRET) with
	// auth:true and systemManaged:false. Each value is a bare string
	// (the customer's credential), NOT a JSON blob.
	srv := newTestServer(t)
	authTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":          "GD_SSO_OAUTH_CLIENT_ID",
					"auth":          authTrue,
					"systemManaged": false,
					"value":         "0oa1ab2cd3ef4",
				},
			},
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":          "GD_SSO_OAUTH_CLIENT_SECRET",
					"auth":          authTrue,
					"systemManaged": false,
					"value":         "very-secret",
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

	authVariant := "auth"
	secrets, err := srv.DB.GetSecrets("app1", &authVariant)
	if err != nil {
		t.Fatalf("get auth secrets: %v", err)
	}
	if len(secrets) != 2 {
		t.Fatalf("expected 2 auth secrets, got %d", len(secrets))
	}
}

func TestUpdateSecretsAuthClassRejectsPointerRowSystemManaged(t *testing.T) {
	// Pointer-named rows MUST NOT carry systemManaged:true — mirrors
	// mhp-core's ValidateCustomerAuthRestrictions. A systemManaged:true
	// pointer row would self-wedge: subsequent customer writes would
	// mismatch on the systemManaged flag.
	srv := newTestServer(t)
	authTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":          "GD_SSO_OAUTH_CLIENT_ID",
					"auth":          authTrue,
					"systemManaged": true,
					"value":         "should-be-rejected",
				},
			},
		},
	})
	req := httptest.NewRequest("POST", "/apps/app1/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app1"})
	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (all ops failed), got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateSecretsAuthClassRequiresSystemManaged(t *testing.T) {
	// SSO_OAUTH_CONFIG must carry systemManaged: true; without it the
	// reserved-name guard rejects the write.
	srv := newTestServer(t)
	authTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":  "SSO_OAUTH_CONFIG",
					"auth":  authTrue,
					"value": map[string]any{"k": "v"},
				},
			},
		},
	})
	req := httptest.NewRequest("POST", "/apps/app1/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app1"})
	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetSecretsExposesAuthGroupWithoutValue(t *testing.T) {
	// Auth-class reads must NOT return secret VALUES — mirrors hosting's
	// invariant. The BFF only needs presence (name) to resolve the publish
	// gate's ssoConfigured claim.
	srv := newTestServer(t)
	srv.DB.UpsertSecret("app1", "auth", "SSO_OAUTH_CONFIG", `{"x":"y"}`, true)

	req := httptest.NewRequest("GET", "/apps/app1/secrets", nil)
	req = setMuxVars(req, map[string]string{"appId": "app1"})
	w := httptest.NewRecorder()
	srv.GetSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	decodeJSON(t, w, &resp)
	authGrp, ok := resp["auth"].(map[string]any)
	if !ok {
		t.Fatalf("expected auth group in response, got %v", resp)
	}
	secrets, _ := authGrp["secrets"].([]any)
	if len(secrets) != 1 {
		t.Fatalf("expected 1 auth secret, got %d", len(secrets))
	}
	entry := secrets[0].(map[string]any)
	if entry["name"] != "SSO_OAUTH_CONFIG" {
		t.Errorf("wrong name: %v", entry["name"])
	}
	if _, hasValue := entry["value"]; hasValue {
		t.Error("auth-class GET response must not include value")
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

func newTestServerWithFS(t *testing.T) (*Server, string) {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv("APPS_BASE_DIR", tmpDir)
	return &Server{
		DB:            newTestDB(t),
		TemplateSetup: setup.NewTemplateSetup(),
	}, tmpDir
}

func setupAppDirs(t *testing.T, baseDir, appID string) {
	t.Helper()
	for _, dir := range []string{
		filepath.Join(baseDir, appID, "local", "preview"),
		filepath.Join(baseDir, appID, "local", "publish"),
		filepath.Join(baseDir, appID, "alloc"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
}

func TestUpdateSecretsSyncsConfigFile(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// Write initial system config to mimic provisioning
	initialConfig := map[string]any{
		"DATABASE": map[string]any{
			"SYSTEM_MANAGED": true,
			"VALUE":          map[string]any{"NAME": "testdb", "HOST": "localhost"},
		},
	}
	configPath := filepath.Join(tmpDir, appID, "local", "preview", "config.json")
	data, _ := json.MarshalIndent(initialConfig, "", "  ")
	os.WriteFile(configPath, data, 0o600)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "API_KEY",
					"value":    "my-secret-key",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Read the config file and verify it has both system and user secrets
	configData, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}

	var config map[string]any
	if err := json.Unmarshal(configData, &config); err != nil {
		t.Fatalf("parse config: %v", err)
	}

	// System secret should be preserved
	if _, ok := config["DATABASE"]; !ok {
		t.Error("expected DATABASE system secret to be preserved")
	}

	// User secret should be added
	apiKey, ok := config["API_KEY"]
	if !ok {
		t.Fatal("expected API_KEY to be in config")
	}

	entry := apiKey.(map[string]any)
	if entry["SYSTEM_MANAGED"] != false {
		t.Error("expected API_KEY SYSTEM_MANAGED to be false")
	}
	if entry["VALUE"] != "my-secret-key" {
		t.Errorf("expected VALUE my-secret-key, got %v", entry["VALUE"])
	}
}

func TestUpdateSecretsDeleteRemovesFromConfig(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// Pre-populate DB and config with a user secret
	srv.DB.UpsertSecret(appID, "preview", "OLD_KEY", "old-value", false)

	configPath := filepath.Join(tmpDir, appID, "local", "preview", "config.json")
	initialConfig := map[string]any{
		"DATABASE": map[string]any{"SYSTEM_MANAGED": true, "VALUE": "db"},
		"OLD_KEY":  map[string]any{"SYSTEM_MANAGED": false, "VALUE": "old-value"},
	}
	data, _ := json.MarshalIndent(initialConfig, "", "  ")
	os.WriteFile(configPath, data, 0o600)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "delete",
				"secret": map[string]any{
					"name":     "OLD_KEY",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	configData, _ := os.ReadFile(configPath)
	var config map[string]any
	json.Unmarshal(configData, &config)

	if _, ok := config["OLD_KEY"]; ok {
		t.Error("expected OLD_KEY to be removed from config")
	}
	if _, ok := config["DATABASE"]; !ok {
		t.Error("expected DATABASE to be preserved")
	}
}

func TestSyncSecretsNoExistingConfig(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// No config.json exists yet — sync should create one from scratch
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "MY_SECRET",
					"value":    "val123",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	configData, err := os.ReadFile(filepath.Join(tmpDir, appID, "local", "preview", "config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}

	var config map[string]any
	if err := json.Unmarshal(configData, &config); err != nil {
		t.Fatalf("parse config: %v", err)
	}

	entry, ok := config["MY_SECRET"].(map[string]any)
	if !ok {
		t.Fatal("expected MY_SECRET in config")
	}
	if entry["VALUE"] != "val123" {
		t.Errorf("expected VALUE val123, got %v", entry["VALUE"])
	}
}

func TestSyncSecretsSharedIncludedInPreview(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// Add a shared secret, then a preview secret
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "SHARED_KEY",
					"value":    "shared-val",
					"variants": []string{"shared"},
				},
			},
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "PREVIEW_KEY",
					"value":    "preview-val",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	configData, _ := os.ReadFile(filepath.Join(tmpDir, appID, "local", "preview", "config.json"))
	var config map[string]any
	json.Unmarshal(configData, &config)

	if _, ok := config["SHARED_KEY"]; !ok {
		t.Error("expected SHARED_KEY in preview config (shared secrets should be included)")
	}
	if _, ok := config["PREVIEW_KEY"]; !ok {
		t.Error("expected PREVIEW_KEY in preview config")
	}
}

func TestSyncSecretsMixedOperations(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// Pre-populate with an existing secret to delete
	srv.DB.UpsertSecret(appID, "preview", "DELETE_ME", "old", false)
	initialConfig := map[string]any{
		"DATABASE":  map[string]any{"SYSTEM_MANAGED": true, "VALUE": "db"},
		"DELETE_ME": map[string]any{"SYSTEM_MANAGED": false, "VALUE": "old"},
	}
	configPath := filepath.Join(tmpDir, appID, "local", "preview", "config.json")
	data, _ := json.MarshalIndent(initialConfig, "", "  ")
	os.WriteFile(configPath, data, 0o600)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "NEW_KEY",
					"value":    "new-val",
					"variants": []string{"preview"},
				},
			},
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "ANOTHER_KEY",
					"value":    "another-val",
					"variants": []string{"preview"},
				},
			},
			{
				"type": "delete",
				"secret": map[string]any{
					"name":     "DELETE_ME",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	configData, _ := os.ReadFile(configPath)
	var config map[string]any
	json.Unmarshal(configData, &config)

	if _, ok := config["DATABASE"]; !ok {
		t.Error("expected DATABASE to be preserved")
	}
	if _, ok := config["NEW_KEY"]; !ok {
		t.Error("expected NEW_KEY to be added")
	}
	if _, ok := config["ANOTHER_KEY"]; !ok {
		t.Error("expected ANOTHER_KEY to be added")
	}
	if _, ok := config["DELETE_ME"]; ok {
		t.Error("expected DELETE_ME to be removed")
	}
}

func TestSyncSecretsUpdateExistingValue(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// Pre-populate with existing user secret
	srv.DB.UpsertSecret(appID, "preview", "API_KEY", "old-value", false)
	configPath := filepath.Join(tmpDir, appID, "local", "preview", "config.json")
	initialConfig := map[string]any{
		"DATABASE": map[string]any{"SYSTEM_MANAGED": true, "VALUE": "db"},
		"API_KEY":  map[string]any{"SYSTEM_MANAGED": false, "VALUE": "old-value"},
	}
	data, _ := json.MarshalIndent(initialConfig, "", "  ")
	os.WriteFile(configPath, data, 0o600)

	// Update the secret value
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "API_KEY",
					"value":    "new-value",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	configData, _ := os.ReadFile(configPath)
	var config map[string]any
	json.Unmarshal(configData, &config)

	entry := config["API_KEY"].(map[string]any)
	if entry["VALUE"] != "new-value" {
		t.Errorf("expected updated VALUE new-value, got %v", entry["VALUE"])
	}
}

func TestSyncSecretsNilTemplateSetupIsNoop(t *testing.T) {
	srv := newTestServer(t) // has nil TemplateSetup

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{
				"type": "upsert",
				"secret": map[string]any{
					"name":     "KEY",
					"value":    "val",
					"variants": []string{"preview"},
				},
			},
		},
	})

	req := httptest.NewRequest("POST", "/apps/app1/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app1"})

	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	// Should succeed without panicking — config sync is skipped
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSeedSystemSecrets(t *testing.T) {
	srv := newTestServer(t)
	appID := "test-app"

	srv.seedSystemSecrets(appID, &setup.DBCredentials{
		Name:     "testdb",
		Username: "testuser",
		Password: "testpass",
	})

	secrets, err := srv.DB.GetSecrets(appID, nil)
	if err != nil {
		t.Fatalf("GetSecrets: %v", err)
	}

	names := make(map[string]bool)
	for _, s := range secrets {
		names[s.Name] = true
		if !s.SystemManaged {
			t.Errorf("expected %s to be system-managed", s.Name)
		}
		if s.Variant != "shared" {
			t.Errorf("expected %s variant to be shared, got %s", s.Name, s.Variant)
		}
	}

	if !names["DATABASE"] {
		t.Error("expected DATABASE secret to be seeded")
	}
	if !names["JWT_REDIRECT_URL"] {
		t.Error("expected JWT_REDIRECT_URL secret to be seeded")
	}
}

func TestCopyPreviewConfigToPublishMissingSource(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// No preview config.json exists
	err := srv.copyPreviewConfigToPublish(appID)
	if err == nil {
		t.Fatal("expected error when preview config is missing")
	}
}

func TestCopyPreviewConfigToPublish(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app"
	setupAppDirs(t, tmpDir, appID)

	// Write preview config
	previewConfig := map[string]any{
		"DATABASE": map[string]any{"SYSTEM_MANAGED": true, "VALUE": "db"},
		"API_KEY":  map[string]any{"SYSTEM_MANAGED": false, "VALUE": "secret"},
	}
	data, _ := json.MarshalIndent(previewConfig, "", "  ")
	os.WriteFile(filepath.Join(tmpDir, appID, "local", "preview", "config.json"), data, 0o600)

	if err := srv.copyPreviewConfigToPublish(appID); err != nil {
		t.Fatalf("copyPreviewConfigToPublish: %v", err)
	}

	publishData, err := os.ReadFile(filepath.Join(tmpDir, appID, "local", "publish", "config.json"))
	if err != nil {
		t.Fatalf("read publish config: %v", err)
	}
	var publishConfig map[string]any
	json.Unmarshal(publishData, &publishConfig)

	if _, ok := publishConfig["API_KEY"]; !ok {
		t.Error("expected API_KEY in publish config")
	}
	if _, ok := publishConfig["DATABASE"]; !ok {
		t.Error("expected DATABASE in publish config")
	}
}

// --- Jobs ---

func TestGetJobAppsHandlerCompleted(t *testing.T) {
	srv := newTestServer(t)

	app, _ := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	job, _ := srv.DB.CreateJob(app.ID, "airo-test")
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
	job, _ := srv.DB.CreateJob(app.ID, "airo-test")

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
	if urls["preview"] != "https://local.gasket.dev-godaddy.com:5001" {
		t.Errorf("expected preview url, got %v", urls["preview"])
	}
	if urls["publish"] != "https://local.gasket.dev-godaddy.com:5501" {
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

// Pins the Auth-at-Edge SSO surface on the app GET response. With
// AAB_DEV_SUBSCRIPTION_POLICY=required, appToResponse emits ssoRequired:true
// + a stable ssoConfigId so the BFF can light up the SSO panel + JWT claims.
// The env-driven path lets a single dev process pivot between ent and
// non-ent personas without a code change.
func TestAppToResponse_SSORequiredFromEnv(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "required")
	app := &store.App{ID: "test-app", Status: "active"}

	resp := appToResponse(app)

	if resp["ssoRequired"] != true {
		t.Errorf("ssoRequired: want true, got %v", resp["ssoRequired"])
	}
	cfgID, _ := resp["ssoConfigId"].(string)
	if cfgID == "" {
		t.Errorf("ssoConfigId: want non-empty string, got %v", resp["ssoConfigId"])
	}
}

// Default (env unset) must keep the response shape byte-identical to the
// pre-SSO contract for non-ent customers. A regression here would break
// every existing AAB customer.
func TestAppToResponse_SSORequiredDefault(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "")
	app := &store.App{ID: "test-app", Status: "active"}

	resp := appToResponse(app)

	if got := resp["ssoRequired"]; got != false {
		t.Errorf("ssoRequired: want false, got %v", got)
	}
	if got, _ := resp["ssoConfigId"].(string); got != "" {
		t.Errorf("ssoConfigId: want empty string, got %v", got)
	}
	if got := resp["ssoOverrideAllowed"]; got != false {
		t.Errorf("ssoOverrideAllowed: want false, got %v", got)
	}
}

// Phase-2: admin tier 'optional' surfaces ssoOverrideAllowed=true and starts
// with ssoRequired=false (override absent → defer to admin default, which
// for 'optional' resolves to false unless the customer opts in).
func TestAppToResponse_SSOOptionalPersona(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "optional")
	t.Setenv("AAB_DEV_SSO_OVERRIDE", "")
	app := &store.App{ID: "test-app", Status: "active"}

	resp := appToResponse(app)

	if got := resp["ssoOverrideAllowed"]; got != true {
		t.Errorf("ssoOverrideAllowed: want true, got %v", got)
	}
	if got := resp["ssoRequired"]; got != false {
		t.Errorf("ssoRequired: want false (no override yet), got %v", got)
	}
	// `*bool(nil)` boxed into an `any` compares != bare nil under Go's
	// interface rules, so cast back to the underlying type for the check.
	overridePtr, _ := resp["ssoRequiredOverride"].(*bool)
	if overridePtr != nil {
		t.Errorf("ssoRequiredOverride: want typed nil (cleared override), got %v", *overridePtr)
	}
}

// Phase-2: customer enables the override via AAB_DEV_SSO_OVERRIDE=true.
// Resolved ssoRequired flips to true.
func TestAppToResponse_SSOOptionalWithCustomerOverride(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "optional")
	t.Setenv("AAB_DEV_SSO_OVERRIDE", "true")
	app := &store.App{ID: "test-app", Status: "active"}

	resp := appToResponse(app)

	if got := resp["ssoOverrideAllowed"]; got != true {
		t.Errorf("ssoOverrideAllowed: want true, got %v", got)
	}
	if got := resp["ssoRequired"]; got != true {
		t.Errorf("ssoRequired: want true (override enabled), got %v", got)
	}
	overridePtr, _ := resp["ssoRequiredOverride"].(*bool)
	if overridePtr == nil || *overridePtr != true {
		t.Errorf("ssoRequiredOverride: want &true, got %v", resp["ssoRequiredOverride"])
	}
}

// The customer-facing toggle: PutAppSSORequired accepts the tri-state body
// and flips the resolved SSO requirement.
func TestPutAppSSORequired_FlipsOverride(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "optional")
	t.Setenv("AAB_DEV_SSO_OVERRIDE", "")
	srv := newTestServer(t)

	body, _ := json.Marshal(map[string]any{"ssoRequired": true})
	req := httptest.NewRequest("PUT",
		"/api/airo/v1/subscriptions/sub-1/apps/app-1/sso-required",
		bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "appId": "app-1"})
	w := httptest.NewRecorder()
	srv.PutAppSSORequired(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["ssoRequired"] != true {
		t.Errorf("ssoRequired: want true, got %v", resp["ssoRequired"])
	}
	if resp["ssoOverrideAllowed"] != true {
		t.Errorf("ssoOverrideAllowed: want true, got %v", resp["ssoOverrideAllowed"])
	}
}

// Admin tier 'required' (locked) — customer toggle returns 409 OVERRIDE_LOCKED.
func TestPutAppSSORequired_RejectsLockedTier(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "required")
	srv := newTestServer(t)

	body, _ := json.Marshal(map[string]any{"ssoRequired": false})
	req := httptest.NewRequest("PUT",
		"/api/airo/v1/subscriptions/sub-1/apps/app-1/sso-required",
		bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "appId": "app-1"})
	w := httptest.NewRecorder()
	srv.PutAppSSORequired(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 (admin-locked), got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["error"] != "OVERRIDE_LOCKED" {
		t.Errorf("error: want OVERRIDE_LOCKED, got %v", resp["error"])
	}
}

// Body validation: missing ssoRequired field returns 400 (mirrors airo-go's
// "ssoRequired field is required" response).
func TestPutAppSSORequired_RequiresField(t *testing.T) {
	t.Setenv("AAB_DEV_SUBSCRIPTION_POLICY", "optional")
	srv := newTestServer(t)

	body, _ := json.Marshal(map[string]any{})
	req := httptest.NewRequest("PUT",
		"/api/airo/v1/subscriptions/sub-1/apps/app-1/sso-required",
		bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "appId": "app-1"})
	w := httptest.NewRecorder()
	srv.PutAppSSORequired(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (missing field), got %d: %s", w.Code, w.Body.String())
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
	router := NewRouter(db, nil, noopSSOMiddleware(t))

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
	router := NewRouter(db, nil, noopSSOMiddleware(t))

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

// --- CDN Purge Cache ---

func TestPurgeCacheHandler(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("POST", "/apps/app1/purge-cache", nil)
	req = setMuxVars(req, map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": "app1"})

	w := httptest.NewRecorder()
	srv.PurgeCache(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["statusJobId"] != "purge-job-app1" {
		t.Errorf("expected statusJobId purge-job-app1, got %v", resp["statusJobId"])
	}
}

func TestGetJobHandlerReturnsNotFoundForUnknownJob(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/jobs/unknown-job-id", nil)
	req = setMuxVars(req, map[string]string{"jobId": "unknown-job-id"})

	w := httptest.NewRecorder()
	srv.GetJob(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetJobHandlerReturnsSuccessAfterDelay(t *testing.T) {
	srv := newTestServer(t)
	jobID := "purge-job-completed"

	// Register a purge job with a start time far enough in the past
	purgeJobStartTimesMu.Lock()
	purgeJobStartTimes[jobID] = time.Now().UTC().Add(-purgeSimulatedDuration - time.Second)
	purgeJobStartTimesMu.Unlock()

	req := httptest.NewRequest("GET", "/jobs/"+jobID, nil)
	req = setMuxVars(req, map[string]string{"jobId": jobID})

	w := httptest.NewRecorder()
	srv.GetJob(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["id"] != jobID {
		t.Errorf("expected id %s, got %v", jobID, resp["id"])
	}
	if resp["jobType"] != "airo-cdn-purge" {
		t.Errorf("expected jobType airo-cdn-purge, got %v", resp["jobType"])
	}
	if resp["status"] != "success" {
		t.Errorf("expected status success, got %v", resp["status"])
	}
	if _, ok := resp["completedAt"]; !ok {
		t.Error("expected completedAt to be present")
	}
}

func TestGetJobHandlerInProgressDuringSimulatedDelay(t *testing.T) {
	srv := newTestServer(t)
	jobID := "purge-job-delay-test"

	// Simulate a purge to register the start time
	purgeReq := httptest.NewRequest("POST", "/apps/delay-test/purge-cache", nil)
	purgeReq = setMuxVars(purgeReq, map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": "delay-test"})
	purgeW := httptest.NewRecorder()
	srv.PurgeCache(purgeW, purgeReq)

	// Immediately poll — should be in_progress
	req := httptest.NewRequest("GET", "/jobs/"+jobID, nil)
	req = setMuxVars(req, map[string]string{"jobId": jobID})

	w := httptest.NewRecorder()
	srv.GetJob(w, req)

	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["status"] != "in_progress" {
		t.Errorf("expected in_progress during simulated delay, got %v", resp["status"])
	}
	if _, ok := resp["completedAt"]; ok {
		t.Error("expected no completedAt during in_progress")
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

// --- GetCustomerTree ---

func TestGetCustomerTreeEmpty(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/customers/me/tree", nil)
	w := httptest.NewRecorder()
	srv.GetCustomerTree(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["customerId"] != store.DefaultCustomerID {
		t.Errorf("expected customerId %s, got %v", store.DefaultCustomerID, resp["customerId"])
	}

	subs := resp["subscriptions"].([]any)
	if len(subs) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(subs))
	}

	sub := subs[0].(map[string]any)
	if sub["subscriptionId"] != store.SubscriptionIDForCustomer(store.DefaultCustomerID) {
		t.Errorf("expected subscriptionId %s, got %v", store.SubscriptionIDForCustomer(store.DefaultCustomerID), sub["subscriptionId"])
	}

	systems := sub["systems"].([]any)
	system := systems[0].(map[string]any)
	apps := system["apps"].([]any)
	if len(apps) != 0 {
		t.Errorf("expected 0 apps, got %d", len(apps))
	}
}

func TestGetCustomerTreeGroupsBySubscriptionID(t *testing.T) {
	srv := newTestServer(t)

	// Create apps with different subscription IDs
	srv.DB.EnsureSubscription("sub-a", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-b", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-b", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/customers/me/tree", nil)
	w := httptest.NewRecorder()
	srv.GetCustomerTree(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	subs := resp["subscriptions"].([]any)
	if len(subs) != 2 {
		t.Fatalf("expected 2 subscriptions, got %d", len(subs))
	}

	// Subscriptions should be sorted by ID
	sub1 := subs[0].(map[string]any)
	sub2 := subs[1].(map[string]any)
	if sub1["subscriptionId"] != "sub-a" {
		t.Errorf("expected first subscription sub-a, got %v", sub1["subscriptionId"])
	}
	if sub2["subscriptionId"] != "sub-b" {
		t.Errorf("expected second subscription sub-b, got %v", sub2["subscriptionId"])
	}

	// Check app counts per subscription
	systems1 := sub1["systems"].([]any)
	apps1 := systems1[0].(map[string]any)["apps"].([]any)
	if len(apps1) != 2 {
		t.Errorf("expected 2 apps in sub-a, got %d", len(apps1))
	}

	systems2 := sub2["systems"].([]any)
	apps2 := systems2[0].(map[string]any)["apps"].([]any)
	if len(apps2) != 1 {
		t.Errorf("expected 1 app in sub-b, got %d", len(apps2))
	}
}

func TestGetCustomerTreeUsesDefaultSubscription(t *testing.T) {
	srv := newTestServer(t)

	defaultSubID := store.SubscriptionIDForCustomer(store.DefaultCustomerID)
	srv.DB.EnsureSubscription(defaultSubID, store.DefaultCustomerID)
	srv.DB.CreateApp(defaultSubID, "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/customers/me/tree", nil)
	w := httptest.NewRecorder()
	srv.GetCustomerTree(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	subs := resp["subscriptions"].([]any)
	if len(subs) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(subs))
	}

	sub := subs[0].(map[string]any)
	if sub["subscriptionId"] != store.SubscriptionIDForCustomer(store.DefaultCustomerID) {
		t.Errorf("expected subscriptionId %s, got %v", store.SubscriptionIDForCustomer(store.DefaultCustomerID), sub["subscriptionId"])
	}
}

func TestGetCustomerTreeDeterministicOrdering(t *testing.T) {
	srv := newTestServer(t)

	// Create apps with subscription IDs in non-alphabetical order
	srv.DB.EnsureSubscription("sub-z", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-a", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-m", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-z", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-m", "sys-1", nil, nil)

	// Run multiple times to verify deterministic ordering
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/customers/me/tree", nil)
		w := httptest.NewRecorder()
		srv.GetCustomerTree(w, req)

		var resp map[string]any
		decodeJSON(t, w, &resp)

		subs := resp["subscriptions"].([]any)
		subIDs := make([]string, len(subs))
		for j, s := range subs {
			subIDs[j] = s.(map[string]any)["subscriptionId"].(string)
		}

		expected := []string{"sub-a", "sub-m", "sub-z"}
		for j, id := range subIDs {
			if id != expected[j] {
				t.Errorf("iteration %d: expected %v at index %d, got %v", i, expected[j], j, id)
			}
		}
	}
}

func TestGetCustomerTreeGroupsBySystemID(t *testing.T) {
	srv := newTestServer(t)

	// Create apps with same subscription but different system IDs
	srv.DB.EnsureSubscription("sub-a", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-a", "sys-2", nil, nil)

	req := httptest.NewRequest("GET", "/customers/me/tree", nil)
	w := httptest.NewRecorder()
	srv.GetCustomerTree(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	subs := resp["subscriptions"].([]any)
	if len(subs) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(subs))
	}

	sub := subs[0].(map[string]any)
	systems := sub["systems"].([]any)
	if len(systems) != 2 {
		t.Fatalf("expected 2 systems, got %d", len(systems))
	}

	// Systems should be sorted by ID
	sys1 := systems[0].(map[string]any)
	sys2 := systems[1].(map[string]any)
	if sys1["systemId"] != "sys-1" {
		t.Errorf("expected first system sys-1, got %v", sys1["systemId"])
	}
	if sys2["systemId"] != "sys-2" {
		t.Errorf("expected second system sys-2, got %v", sys2["systemId"])
	}

	// Check app counts per system
	apps1 := sys1["apps"].([]any)
	if len(apps1) != 2 {
		t.Errorf("expected 2 apps in sys-1, got %d", len(apps1))
	}

	apps2 := sys2["apps"].([]any)
	if len(apps2) != 1 {
		t.Errorf("expected 1 app in sys-2, got %d", len(apps2))
	}
}

func TestGetCustomerTreeGroupsBySubscriptionAndSystemID(t *testing.T) {
	srv := newTestServer(t)

	// Create apps with different combinations of subscription and system IDs
	srv.DB.EnsureSubscription("sub-a", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-b", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-a", "sys-2", nil, nil)
	srv.DB.CreateApp("sub-b", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-b", "sys-3", nil, nil)

	req := httptest.NewRequest("GET", "/customers/me/tree", nil)
	w := httptest.NewRecorder()
	srv.GetCustomerTree(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	subs := resp["subscriptions"].([]any)
	if len(subs) != 2 {
		t.Fatalf("expected 2 subscriptions, got %d", len(subs))
	}

	// sub-a should have sys-1 and sys-2
	subA := subs[0].(map[string]any)
	if subA["subscriptionId"] != "sub-a" {
		t.Errorf("expected sub-a, got %v", subA["subscriptionId"])
	}
	systemsA := subA["systems"].([]any)
	if len(systemsA) != 2 {
		t.Fatalf("expected 2 systems in sub-a, got %d", len(systemsA))
	}
	if systemsA[0].(map[string]any)["systemId"] != "sys-1" {
		t.Errorf("expected sys-1, got %v", systemsA[0].(map[string]any)["systemId"])
	}
	if systemsA[1].(map[string]any)["systemId"] != "sys-2" {
		t.Errorf("expected sys-2, got %v", systemsA[1].(map[string]any)["systemId"])
	}

	// sub-b should have sys-1 and sys-3
	subB := subs[1].(map[string]any)
	if subB["subscriptionId"] != "sub-b" {
		t.Errorf("expected sub-b, got %v", subB["subscriptionId"])
	}
	systemsB := subB["systems"].([]any)
	if len(systemsB) != 2 {
		t.Fatalf("expected 2 systems in sub-b, got %d", len(systemsB))
	}
	if systemsB[0].(map[string]any)["systemId"] != "sys-1" {
		t.Errorf("expected sys-1, got %v", systemsB[0].(map[string]any)["systemId"])
	}
	if systemsB[1].(map[string]any)["systemId"] != "sys-3" {
		t.Errorf("expected sys-3, got %v", systemsB[1].(map[string]any)["systemId"])
	}
}

// --- GetAppsForSubscription ---

func TestGetAppsForSubscriptionFiltersCorrectly(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.EnsureSubscription("sub-1", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-2", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-2", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/subscriptions/sub-1/apps", nil)
	req = setMuxVars(req, map[string]string{"subId": "sub-1"})

	w := httptest.NewRecorder()
	srv.GetAppsForSubscription(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	apps := resp["apps"].([]any)
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps for sub-1, got %d", len(apps))
	}
}

func TestGetAppsForSubscriptionUsesDefaultSubscription(t *testing.T) {
	srv := newTestServer(t)

	defaultSubID := store.SubscriptionIDForCustomer(store.DefaultCustomerID)
	srv.DB.EnsureSubscription(defaultSubID, store.DefaultCustomerID)
	srv.DB.CreateApp(defaultSubID, "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/subscriptions/"+defaultSubID+"/apps", nil)
	req = setMuxVars(req, map[string]string{"subId": defaultSubID})

	w := httptest.NewRecorder()
	srv.GetAppsForSubscription(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	apps := resp["apps"].([]any)
	if len(apps) != 1 {
		t.Fatalf("expected 1 app for default subscription, got %d", len(apps))
	}
}

func TestGetAppsForSubscriptionReturnsEmptyForUnknown(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.EnsureSubscription("sub-1", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-1", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/subscriptions/unknown-sub/apps", nil)
	req = setMuxVars(req, map[string]string{"subId": "unknown-sub"})

	w := httptest.NewRecorder()
	srv.GetAppsForSubscription(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)
	apps := resp["apps"].([]any)
	if len(apps) != 0 {
		t.Fatalf("expected 0 apps for unknown subscription, got %d", len(apps))
	}
}

// --- ListSubscriptions ---

func TestListSubscriptionsReturnsDefaultWhenNoApps(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/subscriptions", nil)
	w := httptest.NewRecorder()
	srv.ListSubscriptions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []map[string]any
	decodeJSON(t, w, &resp)

	if len(resp) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(resp))
	}

	if resp[0]["id"] != store.SubscriptionIDForCustomer(store.DefaultCustomerID) {
		t.Errorf("expected id %s, got %v", store.SubscriptionIDForCustomer(store.DefaultCustomerID), resp[0]["id"])
	}
}

func TestListSubscriptionsReturnsAllUniqueSubscriptions(t *testing.T) {
	srv := newTestServer(t)

	defaultSubID := store.SubscriptionIDForCustomer(store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-a", store.DefaultCustomerID)
	srv.DB.EnsureSubscription("sub-b", store.DefaultCustomerID)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil)
	srv.DB.CreateApp("sub-a", "sys-1", nil, nil) // Duplicate
	srv.DB.CreateApp("sub-b", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/subscriptions", nil)
	w := httptest.NewRecorder()
	srv.ListSubscriptions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []map[string]any
	decodeJSON(t, w, &resp)

	// sub-a + sub-b from apps + default always included
	if len(resp) != 3 {
		t.Fatalf("expected 3 unique subscriptions (sub-a, sub-b, default), got %d", len(resp))
	}

	// Should be sorted alphabetically
	expected := []string{defaultSubID, "sub-a", "sub-b"}
	for i, want := range expected {
		if resp[i]["id"] != want {
			t.Errorf("expected subscription[%d]=%s, got %v", i, want, resp[i]["id"])
		}
	}
}

func TestListSubscriptionsUsesDefaultSubscription(t *testing.T) {
	srv := newTestServer(t)

	defaultSubID := store.SubscriptionIDForCustomer(store.DefaultCustomerID)
	srv.DB.EnsureSubscription(defaultSubID, store.DefaultCustomerID)
	srv.DB.CreateApp(defaultSubID, "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/subscriptions", nil)
	w := httptest.NewRecorder()
	srv.ListSubscriptions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp []map[string]any
	decodeJSON(t, w, &resp)

	if len(resp) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(resp))
	}

	if resp[0]["id"] != store.SubscriptionIDForCustomer(store.DefaultCustomerID) {
		t.Errorf("expected id %s, got %v", store.SubscriptionIDForCustomer(store.DefaultCustomerID), resp[0]["id"])
	}
}

// --- GetEntitlement ---

func TestGetEntitlementUsesSubIdParam(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest("GET", "/subscriptions/custom-sub-123/entitlement", nil)
	req = setMuxVars(req, map[string]string{"subId": "custom-sub-123"})

	w := httptest.NewRecorder()
	srv.GetEntitlement(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["id"] != "custom-sub-123" {
		t.Errorf("expected id custom-sub-123, got %v", resp["id"])
	}
}

// --- UpdateSubscriptionHandler (PATCH) ---

func TestUpdateSubscriptionPatchValidFields(t *testing.T) {
	srv := newTestServer(t)

	body := strings.NewReader(`{"plan":"professional","isTrial":false,"status":"active","tokenBudgetId":"airo-plus"}`)
	req := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body)
	req.Header.Set("Content-Type", "application/json")
	req = setMuxVars(req, map[string]string{"subId": "local-sub-001"})

	w := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["id"] != "local-sub-001" {
		t.Errorf("expected id local-sub-001, got %v", resp["id"])
	}
	if resp["plan"] != "professional" {
		t.Errorf("expected plan professional, got %v", resp["plan"])
	}
	if resp["isTrial"] != false {
		t.Errorf("expected isTrial false, got %v", resp["isTrial"])
	}
	if resp["status"] != "active" {
		t.Errorf("expected status active, got %v", resp["status"])
	}
	if resp["tokenBudgetId"] != "airo-plus" {
		t.Errorf("expected tokenBudgetId airo-plus, got %v", resp["tokenBudgetId"])
	}
}

func TestUpdateSubscriptionPatchPartialPreservesDefaults(t *testing.T) {
	srv := newTestServer(t)

	// Only update plan - other fields should keep defaults
	body := strings.NewReader(`{"plan":"starter"}`)
	req := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body)
	req.Header.Set("Content-Type", "application/json")
	req = setMuxVars(req, map[string]string{"subId": "local-sub-001"})

	w := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["plan"] != "starter" {
		t.Errorf("expected plan starter, got %v", resp["plan"])
	}
	// Default values should be preserved
	if resp["status"] != "active" {
		t.Errorf("expected default status active, got %v", resp["status"])
	}
	if resp["isTrial"] != true {
		t.Errorf("expected default isTrial true, got %v", resp["isTrial"])
	}
}

func TestUpdateSubscriptionPatchReasonRoundTrips(t *testing.T) {
	srv := newTestServer(t)

	// Set reason
	body := strings.NewReader(`{"status":"suspended","reason":"NON_PAYMENT"}`)
	req := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body)
	req.Header.Set("Content-Type", "application/json")
	req = setMuxVars(req, map[string]string{"subId": "local-sub-001"})

	w := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["status"] != "suspended" {
		t.Errorf("expected status suspended, got %v", resp["status"])
	}
	if resp["reason"] != "NON_PAYMENT" {
		t.Errorf("expected reason NON_PAYMENT, got %v", resp["reason"])
	}

	// Clear reason
	body2 := strings.NewReader(`{"status":"active","reason":""}`)
	req2 := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body2)
	req2.Header.Set("Content-Type", "application/json")
	req2 = setMuxVars(req2, map[string]string{"subId": "local-sub-001"})

	w2 := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}

	var resp2 map[string]any
	decodeJSON(t, w2, &resp2)

	if resp2["status"] != "active" {
		t.Errorf("expected status active, got %v", resp2["status"])
	}
	if resp2["reason"] != "" {
		t.Errorf("expected reason to be empty string, got %v", resp2["reason"])
	}
}

func TestUpdateSubscriptionPatchBmsBudgetIdRoundTrips(t *testing.T) {
	srv := newTestServer(t)

	// Set bmsBudgetId
	body := strings.NewReader(`{"bmsBudgetId":"bms-123"}`)
	req := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body)
	req.Header.Set("Content-Type", "application/json")
	req = setMuxVars(req, map[string]string{"subId": "local-sub-001"})

	w := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["bmsBudgetId"] != "bms-123" {
		t.Errorf("expected bmsBudgetId bms-123, got %v", resp["bmsBudgetId"])
	}

	// Clear bmsBudgetId
	body2 := strings.NewReader(`{"bmsBudgetId":""}`)
	req2 := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body2)
	req2.Header.Set("Content-Type", "application/json")
	req2 = setMuxVars(req2, map[string]string{"subId": "local-sub-001"})

	w2 := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}

	var resp2 map[string]any
	decodeJSON(t, w2, &resp2)

	if resp2["bmsBudgetId"] != "" {
		t.Errorf("expected bmsBudgetId to be empty string, got %v", resp2["bmsBudgetId"])
	}
}

func TestUpdateSubscriptionPatchCreatesIfNotExists(t *testing.T) {
	srv := newTestServer(t)

	body := strings.NewReader(`{"plan":"professional"}`)
	req := httptest.NewRequest("PATCH", "/subscriptions/new-sub-999", body)
	req.Header.Set("Content-Type", "application/json")
	req = setMuxVars(req, map[string]string{"subId": "new-sub-999"})

	w := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	decodeJSON(t, w, &resp)

	if resp["id"] != "new-sub-999" {
		t.Errorf("expected id new-sub-999, got %v", resp["id"])
	}
	if resp["plan"] != "professional" {
		t.Errorf("expected plan professional, got %v", resp["plan"])
	}
}

func TestUpdateSubscriptionPatchInvalidJSON(t *testing.T) {
	srv := newTestServer(t)

	body := strings.NewReader(`not valid json`)
	req := httptest.NewRequest("PATCH", "/subscriptions/local-sub-001", body)
	req.Header.Set("Content-Type", "application/json")
	req = setMuxVars(req, map[string]string{"subId": "local-sub-001"})

	w := httptest.NewRecorder()
	srv.UpdateSubscriptionHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// --- EnsureSubscription (DB) ---

func TestEnsureSubscriptionCreatesWithDefaults(t *testing.T) {
	db := newTestDB(t)

	sub, err := db.EnsureSubscription("test-sub-1", store.DefaultCustomerID)
	if err != nil {
		t.Fatalf("EnsureSubscription: %v", err)
	}

	if sub.ID != "test-sub-1" {
		t.Errorf("expected id test-sub-1, got %s", sub.ID)
	}
	if sub.Status != "active" {
		t.Errorf("expected default status active, got %s", sub.Status)
	}
	if !sub.IsTrial {
		t.Errorf("expected default isTrial true")
	}
	if sub.Plan != "professional" {
		t.Errorf("expected default plan professional, got %s", sub.Plan)
	}
	if sub.Reason != "" {
		t.Errorf("expected default reason empty, got %s", sub.Reason)
	}
}

func TestEnsureSubscriptionReturnsExisting(t *testing.T) {
	db := newTestDB(t)

	// Create
	sub1, err := db.EnsureSubscription("test-sub-1", store.DefaultCustomerID)
	if err != nil {
		t.Fatalf("first EnsureSubscription: %v", err)
	}

	// Update it
	_, err = db.UpdateSubscription("test-sub-1", map[string]any{"plan": "professional"})
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}

	// Ensure again - should return the updated version, not re-create
	sub2, err := db.EnsureSubscription("test-sub-1", store.DefaultCustomerID)
	if err != nil {
		t.Fatalf("second EnsureSubscription: %v", err)
	}

	if sub2.CreatedAt != sub1.CreatedAt {
		t.Errorf("expected same createdAt, got %s vs %s", sub2.CreatedAt, sub1.CreatedAt)
	}
	if sub2.Plan != "professional" {
		t.Errorf("expected updated plan professional, got %s", sub2.Plan)
	}
}

// --- UpdateSubscription (DB) ---

func TestUpdateSubscriptionNotFound(t *testing.T) {
	db := newTestDB(t)

	_, err := db.UpdateSubscription("nonexistent", map[string]any{"plan": "starter"})
	if err == nil {
		t.Fatal("expected error for nonexistent subscription")
	}
}

// --- customerIDFromRequest ---

func TestCustomerIDFromRequest_NoToken(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	got := customerIDFromRequest(req)
	if got != store.DefaultCustomerID {
		t.Errorf("expected %q, got %q", store.DefaultCustomerID, got)
	}
}

func TestCustomerIDFromRequest_WithShopperID(t *testing.T) {
	token := gdtoken.NewToken(
		gdtoken.WithKind(gdtoken.ShopperKind),
		gdtoken.WithBaseToken(gdtoken.BaseToken{ShopperID: "shopper-42"}),
	)
	req := httptest.NewRequest("GET", "/", nil)
	ctx := gdtoken.ContextWithToken(req.Context(), token)
	req = req.WithContext(ctx)

	got := customerIDFromRequest(req)
	if got != "shopper-42" {
		t.Errorf("expected %q, got %q", "shopper-42", got)
	}
}

func TestCustomerIDFromRequest_EmptyShopperID(t *testing.T) {
	token := gdtoken.NewToken(
		gdtoken.WithKind(gdtoken.ShopperKind),
		gdtoken.WithBaseToken(gdtoken.BaseToken{}),
	)
	req := httptest.NewRequest("GET", "/", nil)
	ctx := gdtoken.ContextWithToken(req.Context(), token)
	req = req.WithContext(ctx)

	got := customerIDFromRequest(req)
	if got != store.DefaultCustomerID {
		t.Errorf("expected %q, got %q", store.DefaultCustomerID, got)
	}
}

func TestCrossCustomerSubscriptionAccess_Returns403(t *testing.T) {
	db := newTestDB(t)
	router := NewRouter(db, nil, noopSSOMiddleware(t))

	// Create subscription owned by shopper-A
	db.EnsureSubscription("sub-owned-by-A", "shopper-A")

	// shopper-B tries to access shopper-A's subscription → 403
	tokenB := gdtoken.NewToken(
		gdtoken.WithKind(gdtoken.ShopperKind),
		gdtoken.WithBaseToken(gdtoken.BaseToken{ShopperID: "shopper-B"}),
	)
	req := httptest.NewRequest("GET", "/api/airo/v1/subscriptions/sub-owned-by-A", nil)
	req = mux.SetURLVars(req, map[string]string{"subId": "sub-owned-by-A"})
	req = req.WithContext(gdtoken.ContextWithToken(req.Context(), tokenB))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for cross-customer access, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCustomerIDFromRequest_DataIsolation(t *testing.T) {
	db := newTestDB(t)
	router := NewRouter(db, nil, noopSSOMiddleware(t))

	// Create app as shopper-A
	tokenA := gdtoken.NewToken(
		gdtoken.WithKind(gdtoken.ShopperKind),
		gdtoken.WithBaseToken(gdtoken.BaseToken{ShopperID: "shopper-A"}),
	)
	signupBody := `{"datacenter":"local","isTrial":true,"productId":"aab-v1","appConfigs":[{"templateName":"v8","variants":["preview"],"variables":{}}]}`
	req := httptest.NewRequest("POST", "/api/airo/v1/signup", strings.NewReader(signupBody))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(gdtoken.ContextWithToken(req.Context(), tokenA))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("signup failed: %d %s", w.Code, w.Body.String())
	}

	// List apps as shopper-B -- should see nothing
	tokenB := gdtoken.NewToken(
		gdtoken.WithKind(gdtoken.ShopperKind),
		gdtoken.WithBaseToken(gdtoken.BaseToken{ShopperID: "shopper-B"}),
	)
	req = httptest.NewRequest("GET", "/api/airo/v1/customers/me/apps", nil)
	req = req.WithContext(gdtoken.ContextWithToken(req.Context(), tokenB))
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list apps failed: %d %s", w.Code, w.Body.String())
	}

	var resp struct {
		Apps []map[string]any `json:"apps"`
	}
	decodeJSON(t, w, &resp)
	if len(resp.Apps) != 0 {
		t.Errorf("shopper-B should see 0 apps, got %d", len(resp.Apps))
	}
}

// --- Hosting endpoint mock + protected-secrets fold-in ---

// Pins the /hosting/v1/apps/{appId}/secrets route alongside the legacy
// /api/airo/v1/... path. Dropping the alias would silently 404 every
// local secrets push.
func TestHostingRouteAlias_ReachesUpdateSecrets(t *testing.T) {
	// Scope APPS_BASE_DIR so config-sync writes don't bleed into $HOME.
	t.Setenv("APPS_BASE_DIR", t.TempDir())
	router := NewRouter(newTestDB(t), nil, noopSSOMiddleware(t))

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{"type": "upsert", "secret": map[string]any{
				"name": "STRIPE_SECRET_KEY", "value": "sk_test_x",
				"variants": []string{"preview"}, "systemManaged": true,
			}},
		},
	})
	req := httptest.NewRequest(http.MethodPost,
		"/hosting/v1/apps/app-route-alias/secrets", bytes.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("hosting alias should reach UpdateSecrets; got %d (body=%q)",
			w.Code, w.Body.String())
	}
	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["secretsUpdated"] != true {
		t.Errorf("expected secretsUpdated:true; got %+v", resp)
	}
}

// Pins that the /hosting/v1/... subrouter is NOT gated by gd-auth SSO,
// even when SSO is enabled (AUTH_TYPE=jwt). In production, mhp-core's
// hosting routes authenticate callers via mTLS client cert (service-context)
// or X-On-Behalf-Of (customer-proxy) — neither of which carries a gd-auth
// cookie. The AAB BFF's auth-class secret writes (SSO_OAUTH_CONFIG) arrive
// over mTLS without a gd-auth cookie. If a future refactor wraps these
// routes in ssoMW.Authenticate, the BFF service-context call will 401
// locally even though the same call would succeed in production.
func TestHostingRouteAlias_BypassesSSOGate(t *testing.T) {
	t.Setenv("APPS_BASE_DIR", t.TempDir())
	mw, err := auth.NewSSOMiddleware("jwt", "sso.dev-godaddy.com")
	if err != nil {
		t.Fatalf("NewSSOMiddleware: %v", err)
	}
	router := NewRouter(newTestDB(t), nil, mw)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{"type": "upsert", "secret": map[string]any{
				"name": "STRIPE_SECRET_KEY", "value": "sk_test_x",
				"variants": []string{"preview"}, "systemManaged": true,
			}},
		},
	})
	req := httptest.NewRequest(http.MethodPost,
		"/hosting/v1/apps/app-no-gd-auth/secrets", bytes.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code == http.StatusUnauthorized {
		t.Fatalf("hosting alias POST should NOT 401 without gd-auth cookie; got %d (body=%q)",
			w.Code, w.Body.String())
	}
}

// Pins the default arm of the op.Type switch: a typo'd type must be
// counted as a failed op so partialFailure:true surfaces rather than
// returning 200 with secretsUpdated:false. The payload pairs a valid
// op with a typo so partialFailure surfaces; a typo alone would trip
// the "all operations failed" 500 branch.
func TestUpdateSecrets_UnknownOpTypeCountsAsFailed(t *testing.T) {
	srv := newTestServer(t)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{"type": "upsert", "secret": map[string]any{
				"name": "VALID_KEY", "value": "valid", "variants": []string{"shared"},
			}},
			{"type": "upsrt", "secret": map[string]any{ // typo
				"name": "TYPO_KEY", "value": "should-be-rejected",
			}},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/apps/app-typo/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app-typo"})
	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: want 200 (partial failure on 200), got %d (body=%q)", w.Code, w.Body.String())
	}
	var resp map[string]any
	decodeJSON(t, w, &resp)
	if resp["partialFailure"] != true {
		t.Errorf("partialFailure: want true, got %+v (full body=%+v)", resp["partialFailure"], resp)
	}
	failedCount, _ := resp["failedCount"].(float64)
	if failedCount < 1 {
		t.Errorf("failedCount: want >= 1, got %v", resp["failedCount"])
	}
	if resp["secretsUpdated"] != true {
		t.Errorf("secretsUpdated: want true (the valid op succeeded); got %+v", resp["secretsUpdated"])
	}

	// The typo'd op must not have written to DB.
	rows, err := srv.DB.GetSecrets("app-typo", nil)
	if err != nil {
		t.Fatalf("GetSecrets: %v", err)
	}
	for _, r := range rows {
		if r.Name == "TYPO_KEY" {
			t.Errorf("typo'd op MUST NOT write to DB; got row %+v", r)
		}
	}
}

// Pins the "Protected:true → variant=protected" routing in UpdateSecrets.
// Mirrors prod's protectedSecretsTargets delivery; if misrouted into
// "shared" or an explicit variants array, the secret would land where
// prod never delivers protected secrets.
func TestUpdateSecrets_ProtectedFlagStoresUnderProtectedVariant(t *testing.T) {
	srv := newTestServer(t)

	pTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{"type": "upsert", "secret": map[string]any{
				"name": "STRIPE_MCP_KEY", "value": "ek_test_x",
				"protected": pTrue, "systemManaged": true,
			}},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/apps/app-protected/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": "app-protected"})
	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("UpdateSecrets: status %d (body=%q)", w.Code, w.Body.String())
	}
	rows, err := srv.DB.GetSecrets("app-protected", nil)
	if err != nil {
		t.Fatalf("GetSecrets: %v", err)
	}
	var found *store.Secret
	for i := range rows {
		if rows[i].Name == "STRIPE_MCP_KEY" {
			found = &rows[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("STRIPE_MCP_KEY not stored; got rows=%+v", rows)
	}
	if found.Variant != "protected" {
		t.Errorf("variant: want %q, got %q (this row would land in the wrong "+
			"per-variant config in prod via syncSecretsToConfigFiles)",
			"protected", found.Variant)
	}
}

// Pins the preview-only fold-in for protected secrets. Flipping the
// publish-skip guard would surface protected secrets into the published
// runtime — the exact inversion the protected flag exists to prevent.
func TestUpdateSecrets_ProtectedFoldsIntoPreviewButNotPublish(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	appID := "test-app-protected-fold"
	setupAppDirs(t, tmpDir, appID)

	pTrue := true
	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{"type": "upsert", "secret": map[string]any{
				"name": "STRIPE_MCP_KEY", "value": "ek_test_xyz",
				"protected": pTrue, "systemManaged": true,
			}},
			// Pair with a publish-variant secret so we can verify publish's
			// config.json is also synced (not silently skipped).
			{"type": "upsert", "secret": map[string]any{
				"name": "STRIPE_SECRET_KEY", "value": "sk_test_xyz",
				"variants": []string{"publish"}, "systemManaged": true,
			}},
		},
	})
	req := httptest.NewRequest(http.MethodPost,
		"/hosting/v1/apps/"+appID+"/secrets", bytes.NewReader(body))
	req = setMuxVars(req, map[string]string{"appId": appID})
	w := httptest.NewRecorder()
	srv.UpdateSecrets(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateSecrets: status %d (body=%q)", w.Code, w.Body.String())
	}

	previewConfig := readConfig(t, filepath.Join(tmpDir, appID, "local", "preview", "config.json"))
	publishConfig := readConfig(t, filepath.Join(tmpDir, appID, "local", "publish", "config.json"))

	// Preview must contain the protected secret.
	if previewConfig["STRIPE_MCP_KEY"] == nil {
		t.Errorf("preview/config.json missing STRIPE_MCP_KEY: %+v", previewConfig)
	}

	// Publish must NOT contain the protected secret — load-bearing
	// assertion; the rest of the suite would still pass if the
	// publish-skip guard were removed.
	if _, leaked := publishConfig["STRIPE_MCP_KEY"]; leaked {
		t.Errorf("publish/config.json must not contain STRIPE_MCP_KEY (protected secret leak): %+v",
			publishConfig)
	}

	// Publish-variant secret should land in publish (proves the publish
	// sync ran at all and that the publish skip is scoped to protected).
	if publishConfig["STRIPE_SECRET_KEY"] == nil {
		t.Errorf("publish/config.json missing STRIPE_SECRET_KEY (publish-variant op): %+v",
			publishConfig)
	}
}

// readConfig loads a per-app config.json into a map. Returns an empty map
// when the file doesn't exist (some sync paths only write one variant).
func readConfig(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}
		}
		t.Fatalf("read %s: %v", path, err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return cfg
}

// initResetTestRepo builds the git-repo/.git + preview/ layout ResetApp needs,
// commits one file, and returns its committed content.
func initResetTestRepo(t *testing.T, baseDir, appID string) (workTree, committed string) {
	t.Helper()
	base := filepath.Join(baseDir, appID)
	gitDir := filepath.Join(base, "git-repo", ".git")
	workTree = filepath.Join(base, "preview")
	for _, d := range []string{filepath.Join(base, "git-repo"), workTree} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}
	git := func(args ...string) {
		full := append([]string{"--git-dir=" + gitDir, "--work-tree=" + workTree}, args...)
		if out, err := exec.Command("git", full...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	git("init", "--initial-branch=main")
	git("config", "user.email", "test@airo.dev")
	git("config", "user.name", "Test")
	committed = "committed\n"
	if err := os.WriteFile(filepath.Join(workTree, "page.tsx"), []byte(committed), 0o644); err != nil {
		t.Fatalf("write page.tsx: %v", err)
	}
	git("add", "-A")
	git("commit", "-m", "initial")
	return workTree, committed
}

func TestResetAppRestoresWorkspace(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	workTree, committed := initResetTestRepo(t, tmpDir, app.ID)

	// Agent dirties the tree.
	if err := os.WriteFile(filepath.Join(workTree, "page.tsx"), []byte("edited\n"), 0o644); err != nil {
		t.Fatalf("dirty file: %v", err)
	}

	// restart:false so the handler doesn't shell out to docker in CI.
	body, _ := json.Marshal(map[string]any{"restart": false})
	r := setMuxVars(
		httptest.NewRequest("POST", "/reset", bytes.NewReader(body)),
		map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID},
	)
	w := httptest.NewRecorder()
	srv.ResetApp(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Success   bool `json:"success"`
		Restarted bool `json:"restarted"`
	}
	decodeJSON(t, w, &resp)
	if !resp.Success || resp.Restarted {
		t.Fatalf("expected success=true restarted=false, got %+v", resp)
	}

	got, err := os.ReadFile(filepath.Join(workTree, "page.tsx"))
	if err != nil {
		t.Fatalf("read after reset: %v", err)
	}
	if string(got) != committed {
		t.Errorf("page.tsx = %q, want %q", got, committed)
	}
}

func TestResetAppReadyAfterRestart(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	initResetTestRepo(t, tmpDir, app.ID)

	restartCalled := false
	readyCalled := false
	srv.restartContainers = func(string) error { restartCalled = true; return nil }
	srv.awaitPreviewReady = func(int) error { readyCalled = true; return nil }

	r := setMuxVars(
		httptest.NewRequest("POST", "/reset", strings.NewReader("{}")),
		map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID},
	)
	w := httptest.NewRecorder()
	srv.ResetApp(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Restarted bool `json:"restarted"`
		Ready     bool `json:"ready"`
	}
	decodeJSON(t, w, &resp)
	if !restartCalled || !readyCalled {
		t.Fatalf("expected restart and readiness both invoked, got restart=%v ready=%v", restartCalled, readyCalled)
	}
	if !resp.Restarted || !resp.Ready {
		t.Fatalf("expected restarted=true ready=true, got %+v", resp)
	}
}

func TestResetAppRestartedButNotReady(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	initResetTestRepo(t, tmpDir, app.ID)

	srv.restartContainers = func(string) error { return nil }
	srv.awaitPreviewReady = func(int) error { return fmt.Errorf("preview health check timed out") }

	r := setMuxVars(
		httptest.NewRequest("POST", "/reset", strings.NewReader("{}")),
		map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID},
	)
	w := httptest.NewRecorder()
	srv.ResetApp(w, r)

	// A not-ready preview is reported on the body (ready:false + readyError),
	// not as an HTTP error: the git reset itself succeeded, so the handler
	// returns 200 and lets the caller decide the reset was degraded.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Restarted  bool   `json:"restarted"`
		Ready      bool   `json:"ready"`
		ReadyError string `json:"readyError"`
	}
	decodeJSON(t, w, &resp)
	if !resp.Restarted {
		t.Fatalf("expected restarted=true, got %+v", resp)
	}
	if resp.Ready {
		t.Fatalf("expected ready=false, got %+v", resp)
	}
	if resp.ReadyError == "" {
		t.Fatalf("expected readyError to be populated, got %+v", resp)
	}
}

func TestResetAppSkipsReadinessWhenRestartNotRequested(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	initResetTestRepo(t, tmpDir, app.ID)

	srv.restartContainers = func(string) error {
		t.Fatal("restart must not be called when restart:false")
		return nil
	}
	srv.awaitPreviewReady = func(int) error {
		t.Fatal("readiness must not be checked when restart:false")
		return nil
	}

	body, _ := json.Marshal(map[string]any{"restart": false})
	r := setMuxVars(
		httptest.NewRequest("POST", "/reset", bytes.NewReader(body)),
		map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID},
	)
	w := httptest.NewRecorder()
	srv.ResetApp(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Restarted bool `json:"restarted"`
		Ready     bool `json:"ready"`
	}
	decodeJSON(t, w, &resp)
	if resp.Restarted || resp.Ready {
		t.Fatalf("expected restarted=false ready=false, got %+v", resp)
	}
}

func TestResetAppNotFound(t *testing.T) {
	srv, _ := newTestServerWithFS(t)
	r := setMuxVars(
		httptest.NewRequest("POST", "/reset", strings.NewReader("{}")),
		map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": "missing"},
	)
	w := httptest.NewRecorder()
	srv.ResetApp(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestResetAppRejectsMalformedBody(t *testing.T) {
	srv, tmpDir := newTestServerWithFS(t)
	app, err := srv.DB.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	initResetTestRepo(t, tmpDir, app.ID)

	// Present-but-malformed body must 400, not silently reset-to-HEAD.
	r := setMuxVars(
		httptest.NewRequest("POST", "/reset", strings.NewReader(`{"restart": "yes"`)),
		map[string]string{"subId": "sub-1", "sysId": "sys-1", "appId": app.ID},
	)
	w := httptest.NewRecorder()
	srv.ResetApp(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed body, got %d (%s)", w.Code, w.Body.String())
	}
}
