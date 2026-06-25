package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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

	// Group secrets by variant for the mgmt-airo / hosting response format.
	// The "protected" group mirrors hosting's GetSecretsResponse; "auth"
	// mirrors the new Auth-at-Edge classification (mhp-core §3.1) — the BFF
	// reads this group to know whether SSO_OAUTH_CONFIG has been saved for
	// publish-gate purposes.
	shared := make([]map[string]any, 0)
	protected := make([]map[string]any, 0)
	authSecrets := make([]map[string]any, 0)
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

		switch sec.Variant {
		case "shared":
			shared = append(shared, entry)
		case "protected":
			protected = append(protected, entry)
		case "auth":
			// Mirror hosting: reads never return secret VALUES for any class.
			// Strip value before exposing; surface only name + presence.
			delete(entry, "value")
			authSecrets = append(authSecrets, entry)
		default:
			variantSecrets[sec.Variant] = append(variantSecrets[sec.Variant], entry)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"appId": appID,
		"shared": map[string]any{
			"secrets": shared,
		},
		"protected": map[string]any{
			"secrets": protected,
		},
		"auth": map[string]any{
			"secrets": authSecrets,
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

// ReservedSecretSSOOAuthConfig is the fixed NAME (not a value) of the
// Auth-at-Edge SSO CACHE ROW — auto-seeded by mhp-core's airo-go SFN tasks.
// AAB never writes this; the customer writes the two pointer rows below.
//
//nolint:gosec // G101 false positive: this is the reserved secret NAME, not a credential value.
const ReservedSecretSSOOAuthConfig = "SSO_OAUTH_CONFIG"

// DefaultClientIDPointerName / DefaultClientSecretPointerName are the names
// mhp-core's `airo_enterprise_sso_configs.client_id_secret_name` /
// `…_client_secret_name` columns default to. LCP hardcodes them for Phase 1
// (matches AAB's default-name assumption) — when AAB writes the pointer
// rows, LCP validates the names against these defaults.
//
//nolint:gosec // G101 false positive: these are reserved secret NAMES, not credential values.
const (
	DefaultClientIDPointerName     = "GD_SSO_OAUTH_CLIENT_ID"
	DefaultClientSecretPointerName = "GD_SSO_OAUTH_CLIENT_SECRET"
)

// isPointerName reports whether `name` matches one of the pointer-key
// defaults (case-insensitive, mirroring mhp-core's `strings.EqualFold` on
// the cache-row pointer keys). Phase 1.5 will replace this with a dynamic
// read of the cache row's `clientIdKey` / `clientSecretKey` JSON fields.
func isPointerName(name string) bool {
	return strings.EqualFold(name, DefaultClientIDPointerName) ||
		strings.EqualFold(name, DefaultClientSecretPointerName)
}

// validateAuthClassWrite mirrors mhp-core's ValidateAuthClassWrite +
// validateUpsert reserved-name rules for the local-dev path. Returns nil
// when the secret op is acceptable, or a structured error when it must be
// rejected. Extracted from UpdateSecrets to keep the handler's
// cyclomatic complexity within the project's golangci-lint budget.
//
// Rules (caller-agnostic — LCP doesn't enforce mTLS):
//
//  1. Reserved name SSO_OAUTH_CONFIG (CACHE ROW): MUST carry
//     auth=true && systemManaged=true.
//  2. Pointer-named auth:true row: MUST NOT carry systemManaged=true
//     (would self-wedge subsequent customer writes).
//  3. auth=true on any other name: rejected (self-wedge — present but
//     unreachable by dev-supervisor).
//
// Non-auth ops always pass.
func validateAuthClassOp(appID string, name string, isAuth, systemManaged bool) error {
	if name == ReservedSecretSSOOAuthConfig {
		if !isAuth || !systemManaged {
			slog.Warn("secret.reserved_name.invalid_flags",
				"app_id", appID, "name", name,
				"auth", isAuth, "system_managed", systemManaged)
			return fmt.Errorf("reserved_name.invalid_flags")
		}
		return nil
	}
	if !isAuth {
		return nil
	}
	if !isPointerName(name) {
		slog.Warn("secret.auth_flag_on_non_pointer_name", "app_id", appID, "name", name)
		return fmt.Errorf("auth_flag_on_non_pointer_name")
	}
	if systemManaged {
		slog.Warn("secret.pointer_row_system_managed_disallowed",
			"app_id", appID, "name", name)
		return fmt.Errorf("pointer_row_system_managed_disallowed")
	}
	return nil
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
				// Protected mirrors hosting's flag — secrets delivered only
				// to the agent task target (composition's
				// protectedSecretsTargets). Locally stored under the
				// sentinel variant "protected".
				Protected *bool `json:"protected,omitempty"`
				// Auth is the Auth-at-Edge classification. Routes to a
				// dedicated `auth.json` file that dev-supervisor reads at
				// runtime; customer apps cannot read it (Landlock-enforced
				// in production). Locally stored under the sentinel variant
				// "auth". See validation rules below.
				Auth *bool `json:"auth,omitempty"`
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
		// Auth-class validation extracted to keep the handler within
		// gocyclo's complexity budget. See validateAuthClassOp for the
		// full rule set (mirrors mhp-core's ValidateAuthClassWrite +
		// ValidateCustomerAuthRestrictions).
		isAuth := op.Secret.Auth != nil && *op.Secret.Auth
		if err := validateAuthClassOp(appID, op.Secret.Name, isAuth, op.Secret.SystemManaged); err != nil {
			failed++
			continue
		}

		variant := "shared"
		switch {
		case isAuth:
			variant = "auth"
		case op.Secret.Protected != nil && *op.Secret.Protected:
			variant = "protected"
		case len(op.Secret.Variants) > 0:
			variant = op.Secret.Variants[0]
		}

		switch op.Type {
		case "upsert":
			valueStr := ""
			switch v := op.Secret.Value.(type) {
			case string:
				valueStr = v
			default:
				// JSON-encode non-string values; count marshal failure as a failed op.
				b, mErr := jsonMarshal(v)
				if mErr != nil {
					slog.Error("secret.upsert.marshal_failed", "app_id", appID, "name", op.Secret.Name, "error", mErr)
					failed++
					continue
				}
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

		default:
			// Surface unknown op.Type as a failed op so typos don't slip through silently.
			slog.Error("secret.unknown_op_type", "app_id", appID, "name", op.Secret.Name, "type", op.Type)
			failed++
		}
	}

	if failed > 0 && succeeded == 0 {
		writeError(w, http.StatusInternalServerError, "all secret operations failed")
		return
	}

	if succeeded > 0 {
		// Sync both variant configs; errors are logged but non-fatal.
		for _, v := range []string{"preview", "publish"} {
			if err := s.syncSecretsToConfigFiles(appID, v); err != nil {
				slog.Error("secret.config_sync.failed", "app_id", appID, "variant", v, "error", err)
			}
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

	// Add secrets from SQLite for this variant. System-managed entries are
	// only written if the file didn't already preserve them — protects
	// structured entries like DATABASE (written by template.go at app
	// creation) from being overwritten by the DB's JSON-string form.
	secrets, err := s.DB.GetSecrets(appID, &variant)
	if err != nil {
		return fmt.Errorf("get secrets: %w", err)
	}

	for _, sec := range secrets {
		if sec.SystemManaged {
			if _, alreadyPreserved := config[sec.Name]; alreadyPreserved {
				continue
			}
		}
		config[sec.Name] = map[string]any{
			"SYSTEM_MANAGED": sec.SystemManaged,
			"VALUE":          sec.Value,
		}
	}

	// Fold protected secrets into the preview config. In prod they're
	// delivered as a separate artifact to the agent task target only
	// (composition's protectedSecretsTargets); locally the agent reads
	// preview/config.json directly. Skip publish — protected secrets must
	// never reach the published runtime.
	//
	// Upsert-only: this iterates current DB rows. A delete of a protected
	// row leaves the SYSTEM_MANAGED-flagged entry in preview/config.json
	// (the file-preserve sweep above keeps system-managed entries from
	// disk regardless of DB state). Theoretical today since callers don't
	// delete protected rows; a future delete flow needs an explicit clear.
	if variant == "preview" {
		protectedVariant := "protected"
		protected, err := s.DB.GetSecrets(appID, &protectedVariant)
		if err != nil {
			return fmt.Errorf("get protected secrets: %w", err)
		}
		for _, sec := range protected {
			// GetSecrets unions the requested variant with "shared";
			// filter back down to just the protected rows.
			if sec.Variant != "protected" {
				continue
			}
			config[sec.Name] = map[string]any{
				"SYSTEM_MANAGED": sec.SystemManaged,
				"VALUE":          sec.Value,
			}
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
