package api

import (
	"log/slog"
	"net/http"

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
