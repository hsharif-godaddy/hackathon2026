package api

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/setup"
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
		if err := os.MkdirAll(dir, 0755); err != nil {
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
	os.WriteFile(configPath, data, 0600)

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
	os.WriteFile(configPath, data, 0600)

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
	os.WriteFile(configPath, data, 0600)

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
	os.WriteFile(configPath, data, 0600)

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
	os.WriteFile(filepath.Join(tmpDir, appID, "local", "preview", "config.json"), data, 0600)

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
	if sub["subscriptionId"] != store.DefaultSubscriptionID {
		t.Errorf("expected subscriptionId %s, got %v", store.DefaultSubscriptionID, sub["subscriptionId"])
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

func TestGetCustomerTreeUsesDefaultForEmptySubscriptionID(t *testing.T) {
	srv := newTestServer(t)

	// Create an app with empty subscription ID (will use default)
	srv.DB.CreateApp("", "sys-1", nil, nil)

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
	if sub["subscriptionId"] != store.DefaultSubscriptionID {
		t.Errorf("expected subscriptionId %s, got %v", store.DefaultSubscriptionID, sub["subscriptionId"])
	}
}

func TestGetCustomerTreeDeterministicOrdering(t *testing.T) {
	srv := newTestServer(t)

	// Create apps with subscription IDs in non-alphabetical order
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

func TestGetAppsForSubscriptionUsesDefaultForEmptySubscriptionID(t *testing.T) {
	srv := newTestServer(t)

	// Create an app with empty subscription ID
	srv.DB.CreateApp("", "sys-1", nil, nil)

	req := httptest.NewRequest("GET", "/subscriptions/"+store.DefaultSubscriptionID+"/apps", nil)
	req = setMuxVars(req, map[string]string{"subId": store.DefaultSubscriptionID})

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

	if resp[0]["id"] != store.DefaultSubscriptionID {
		t.Errorf("expected id %s, got %v", store.DefaultSubscriptionID, resp[0]["id"])
	}
}

func TestListSubscriptionsReturnsAllUniqueSubscriptions(t *testing.T) {
	srv := newTestServer(t)

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

	// sub-a + sub-b from apps + default local-sub-001 always included
	if len(resp) != 3 {
		t.Fatalf("expected 3 unique subscriptions (sub-a, sub-b, default), got %d", len(resp))
	}

	// Should be sorted alphabetically: local-sub-001, sub-a, sub-b
	expected := []string{"local-sub-001", "sub-a", "sub-b"}
	for i, want := range expected {
		if resp[i]["id"] != want {
			t.Errorf("expected subscription[%d]=%s, got %v", i, want, resp[i]["id"])
		}
	}
}

func TestListSubscriptionsUsesDefaultForEmptySubscriptionID(t *testing.T) {
	srv := newTestServer(t)

	srv.DB.CreateApp("", "sys-1", nil, nil)

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

	if resp[0]["id"] != store.DefaultSubscriptionID {
		t.Errorf("expected id %s, got %v", store.DefaultSubscriptionID, resp[0]["id"])
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

	sub, err := db.EnsureSubscription("test-sub-1")
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
	if sub.Plan != "free" {
		t.Errorf("expected default plan free, got %s", sub.Plan)
	}
	if sub.Reason != "" {
		t.Errorf("expected default reason empty, got %s", sub.Reason)
	}
}

func TestEnsureSubscriptionReturnsExisting(t *testing.T) {
	db := newTestDB(t)

	// Create
	sub1, err := db.EnsureSubscription("test-sub-1")
	if err != nil {
		t.Fatalf("first EnsureSubscription: %v", err)
	}

	// Update it
	_, err = db.UpdateSubscription("test-sub-1", map[string]any{"plan": "professional"})
	if err != nil {
		t.Fatalf("UpdateSubscription: %v", err)
	}

	// Ensure again - should return the updated version, not re-create
	sub2, err := db.EnsureSubscription("test-sub-1")
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
