package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/airo-ai-builder/local-control-plane/internal/projectenv"
	"github.com/airo-ai-builder/local-control-plane/internal/setup"
	"github.com/gorilla/mux"
)

func (s *Server) GetSecrets(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]
	variant := r.URL.Query().Get("variant")

	var variantPtr *string
	if variant != "" {
		variantPtr = &variant
	}

	secrets, err := s.DB.GetSecrets(appID, variantPtr)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Group secrets by variant for the response format mgmt-airo uses
	shared := make([]map[string]any, 0)
	variantSecrets := map[string][]map[string]any{
		"preview": {},
		"publish": {},
	}

	for _, sec := range secrets {
		entry := map[string]any{
			"name":          sec.Name,
			"value":         sec.Value,
			"systemManaged": sec.SystemManaged,
		}

		if sec.Variant == "shared" {
			shared = append(shared, entry)
		} else {
			variantSecrets[sec.Variant] = append(variantSecrets[sec.Variant], entry)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"appId": appID,
		"shared": map[string]any{
			"secrets": shared,
		},
		"variants": map[string]any{
			"preview": map[string]any{
				"secrets": variantSecrets["preview"],
			},
			"publish": map[string]any{
				"secrets": variantSecrets["publish"],
			},
		},
	})
}

func (s *Server) UpdateSecrets(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	var body struct {
		Operations []struct {
			Type   string `json:"type"`
			Secret struct {
				Name          string   `json:"name"`
				Value         any      `json:"value"`
				Variants      []string `json:"variants"`
				SystemManaged bool     `json:"systemManaged"`
			} `json:"secret"`
		} `json:"operations"`
		WorkflowName string `json:"workflowName"`
	}

	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	succeeded, failed := 0, 0

	for _, op := range body.Operations {
		variant := "shared"
		if len(op.Secret.Variants) > 0 {
			variant = op.Secret.Variants[0]
		}

		switch op.Type {
		case "upsert":
			valueStr := ""
			switch v := op.Secret.Value.(type) {
			case string:
				valueStr = v
			default:
				// JSON-encode non-string values
				b, _ := jsonMarshal(v)
				valueStr = string(b)
			}

			err := s.DB.UpsertSecret(appID, variant, op.Secret.Name, valueStr, op.Secret.SystemManaged)
			if err != nil {
				slog.Error("secret.upsert.failed", "app_id", appID, "name", op.Secret.Name, "error", err)
				failed++
			} else {
				succeeded++
			}

		case "delete":
			err := s.DB.DeleteSecret(appID, variant, op.Secret.Name)
			if err != nil {
				slog.Error("secret.delete.failed", "app_id", appID, "name", op.Secret.Name, "error", err)
				failed++
			} else {
				succeeded++
			}
		}
	}

	if failed > 0 && succeeded == 0 {
		writeError(w, http.StatusInternalServerError, "all secret operations failed")
		return
	}

	if succeeded > 0 {
		if err := s.syncSecretsToConfigFiles(appID, "preview"); err != nil {
			slog.Error("secret.config_sync.failed", "app_id", appID, "variant", "preview", "error", err)
		}
	}

	// Fetch the updated app to include in the response
	app, _ := s.DB.GetApp(appID)
	resp := map[string]any{
		"message":        "secrets updated",
		"appId":          appID,
		"secretsUpdated": succeeded > 0,
		"workflowStatus": "completed",
	}
	if failed > 0 {
		resp["partialFailure"] = true
		resp["failedCount"] = failed
	}
	if app != nil {
		resp["variants"] = app.Variants
	}
	writeJSON(w, http.StatusOK, resp)
}

// seedSystemSecrets inserts provisioned system-managed secrets into SQLite
// so they appear in GetSecrets responses, matching production behavior.
func (s *Server) seedSystemSecrets(appID string, dbCreds *setup.DBCredentials) {
	dbValue, _ := json.Marshal(map[string]any{
		"NAME":               dbCreds.Name,
		"HOST":               "airo-app-mysql",
		"IP":                 "airo-app-mysql",
		"PORT":               3306,
		"USERNAME":           dbCreds.Username,
		"PASSWORD":           dbCreds.Password,
		"READ_ONLY_USERNAME": dbCreds.Username + "_readonly",
		"READ_ONLY_PASSWORD": "",
		"VARIANT":            "local",
	})

	secrets := map[string]string{
		"DATABASE": string(dbValue),
	}

	if clientID := projectenv.Resolve("GODADDY_OAUTH_CLIENT_ID"); clientID != "" {
		secrets["GODADDY_OAUTH_CLIENT_ID"] = clientID
	}
	if clientSecret := projectenv.Resolve("GODADDY_OAUTH_CLIENT_SECRET"); clientSecret != "" {
		secrets["GODADDY_OAUTH_CLIENT_SECRET"] = clientSecret
	}

	appURL := os.Getenv("NEXT_PUBLIC_APP_URL")
	if appURL == "" {
		appURL = "https://local.gasket.dev-godaddy.com:8443"
	}
	secrets["JWT_REDIRECT_URL"] = fmt.Sprintf("%s/develop/%s?siteId=%s", appURL, appID, appID)

	for name, value := range secrets {
		if err := s.DB.UpsertSecret(appID, "shared", name, value, true); err != nil {
			slog.Error("secret.seed.failed", "app_id", appID, "name", name, "error", err)
		}
	}

	slog.Info("secret.seed.complete", "app_id", appID, "count", len(secrets))
}

// syncSecretsToConfigFiles rebuilds config.json for a variant by merging
// system-managed entries (DATABASE, OAuth, etc.) with user secrets from SQLite.
func (s *Server) syncSecretsToConfigFiles(appID, variant string) error {
	if s.TemplateSetup == nil {
		return nil
	}

	base := s.TemplateSetup.GetBasePath(appID)
	configPath := filepath.Join(base, "local", variant, "config.json")

	config := make(map[string]any)

	// Preserve existing system-managed entries from the config file
	if data, err := os.ReadFile(configPath); err == nil {
		if err := json.Unmarshal(data, &config); err != nil {
			slog.Warn("secret.config_read.parse_failed", "app_id", appID, "path", configPath, "error", err)
			config = make(map[string]any)
		}
	}

	// Remove all non-system-managed entries so we rebuild from DB
	for key, val := range config {
		entry, ok := val.(map[string]any)
		if !ok {
			delete(config, key)
			continue
		}
		if managed, _ := entry["SYSTEM_MANAGED"].(bool); !managed {
			delete(config, key)
		}
	}

	// Add all non-system-managed secrets from SQLite for this variant
	secrets, err := s.DB.GetSecrets(appID, &variant)
	if err != nil {
		return fmt.Errorf("get secrets: %w", err)
	}

	for _, sec := range secrets {
		if sec.SystemManaged {
			continue
		}
		config[sec.Name] = map[string]any{
			"SYSTEM_MANAGED": false,
			"VALUE":          sec.Value,
		}
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", configPath, err)
	}

	slog.Info("secret.config_sync.complete", "app_id", appID, "variant", variant, "secrets_count", len(secrets))
	return nil
}
