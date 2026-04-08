package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

const webhookURLMaxLen = 2048

func validateWebhookTargetURL(raw string) string {
	u := strings.TrimSpace(raw)
	if u == "" {
		return "url is required"
	}
	if len(u) > webhookURLMaxLen {
		return "url exceeds maximum length"
	}
	parsed, err := url.Parse(u)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "url must be an absolute http or https URL"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "url must use http or https"
	}
	return ""
}

func (s *Server) webhookHTTPClient() *http.Client {
	if s.WebhookClient != nil {
		return s.WebhookClient
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// deliverReportCreatedWebhooks POSTs report payload to report.created subscribers (best-effort; spawned from postBudgetSessionReport).
func (s *Server) deliverReportCreatedWebhooks(budgetID, sessionID, reportID, productKey string) {
	if s.Store == nil || strings.TrimSpace(productKey) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	hooks, err := s.Store.ListWebhooksForReportCreated(ctx, productKey)
	if err != nil {
		slog.Error("webhook.list_report_created", "error", err, "productKey", productKey)
		return
	}
	if len(hooks) == 0 {
		return
	}

	d, err := s.Store.GetSessionReport(ctx, budgetID, sessionID, reportID)
	if err != nil {
		slog.Error("webhook.load_report_payload", "error", err,
			"budgetId", budgetID, "sessionId", sessionID, "reportId", reportID)
		return
	}
	reportObj, err := sessionReportToResponse(d)
	if err != nil {
		slog.Error("webhook.report_payload", "error", err)
		return
	}

	payload := map[string]any{
		"eventType":  "reportCreated",
		"productKey": productKey,
		"data":       reportObj,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("webhook.marshal", "error", err)
		return
	}

	client := s.webhookHTTPClient()
	for i := range hooks {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, hooks[i].URL, bytes.NewReader(body))
		if err != nil {
			slog.Warn("webhook.request_build", "error", err, "webhookId", hooks[i].ID)
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		if s.WebhookSecret != "" {
			if req.URL != nil && strings.EqualFold(req.URL.Scheme, "https") {
				req.Header.Set("X-BMS-Secret", s.WebhookSecret)
			} else {
				slog.Warn("webhook.secret_skipped_insecure_transport", "webhookId", hooks[i].ID, "url", hooks[i].URL)
			}
		}
		resp, err := client.Do(req)
		if err != nil {
			slog.Warn("webhook.delivery_failed", "error", err, "webhookId", hooks[i].ID, "url", hooks[i].URL)
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			slog.Warn("webhook.delivery_status", "status", resp.StatusCode, "webhookId", hooks[i].ID, "url", hooks[i].URL)
		}
	}
}

type postWebhookBody struct {
	EventType  string `json:"eventType"`
	ProductKey string `json:"productKey"`
	URL        string `json:"url"`
}

func webhookToResponse(row *store.WebhookRow) map[string]any {
	return map[string]any{
		"webhookId":  row.ID,
		"eventType":  row.EventType,
		"productKey": row.ProductKey,
		"url":        row.URL,
		"createdAt":  row.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) postWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload postWebhookBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if strings.TrimSpace(payload.EventType) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "eventType is required")
		return
	}
	pk := strings.TrimSpace(payload.ProductKey)
	if pk == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is required")
		return
	}
	if len(pk) > productKeyMaxLen {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey exceeds maximum length")
		return
	}
	if msg := validateWebhookTargetURL(payload.URL); msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}

	if !s.requireStore(w) {
		return
	}

	webhookID := uuid.NewString()
	if err := s.Store.CreateWebhook(r.Context(), webhookID, payload.EventType, pk, payload.URL); err != nil {
		writeWebhookStoreError(w, "webhook.create", err)
		return
	}
	row, err := s.Store.GetWebhook(r.Context(), webhookID)
	if err != nil {
		slog.Error("webhook.create_get", "error", err)
		writeJSON(w, http.StatusCreated, map[string]string{"webhookId": webhookID})
		return
	}

	writeJSON(w, http.StatusCreated, webhookToResponse(row))
}

func writeWebhookStoreError(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is not registered")
		return
	}
	slog.Error(op, "error", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
}

func (s *Server) getWebhook(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(mux.Vars(r)["webhookId"])
	if !requireUUIDParam(w, id, "webhookId") {
		return
	}
	if !s.requireStore(w) {
		return
	}
	row, err := s.Store.GetWebhook(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
			return
		}
		slog.Error("webhook.get", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}
	writeJSON(w, http.StatusOK, webhookToResponse(row))
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(mux.Vars(r)["webhookId"])
	if !requireUUIDParam(w, id, "webhookId") {
		return
	}
	if !s.requireStore(w) {
		return
	}
	if err := s.Store.DeleteWebhook(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
			return
		}
		slog.Error("webhook.delete", "error", err)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
