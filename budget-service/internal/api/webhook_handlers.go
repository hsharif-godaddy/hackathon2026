package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

const (
	webhookURLMaxLen             = 2048
	maxParallelWebhookDeliveries = 8
)

// Supported webhook event types.
var webhookEventTypes = map[string]bool{
	"report.created":        true,
	"budget-item.reset":     true,
	"budget-item.expired":   true,
	"budget-item.exhausted": true,
}

func normalizeWebhookEventType(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if webhookEventTypes[trimmed] {
		return trimmed, true
	}
	return "", false
}

func supportedEventTypesList() string {
	types := make([]string, 0, len(webhookEventTypes))
	for t := range webhookEventTypes {
		types = append(types, t)
	}
	sort.Strings(types)
	return strings.Join(types, ", ")
}

// validateWebhookTargetURL validates webhook registration URLs.
// When localAuthDisable is false (production), enforces:
//   - HTTPS only
//   - Domain must end with .gdcorp.tools or .godaddy.com
//
// When localAuthDisable is true (local dev), allows:
//   - HTTP for loopback addresses (127.0.0.1, localhost, ::1)
//   - Any domain
func validateWebhookTargetURL(raw string, localAuthDisable bool) string {
	u := strings.TrimSpace(raw)
	if u == "" {
		return "url is required"
	}
	if len(u) > webhookURLMaxLen {
		return "url exceeds maximum length"
	}
	parsed, err := url.Parse(u)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "url must be an absolute URL"
	}
	if parsed.User != nil {
		return "url must not contain credentials"
	}

	host := strings.ToLower(parsed.Hostname())

	if localAuthDisable {
		// Local dev: allow HTTP for loopback, HTTPS for any
		if parsed.Scheme == "http" {
			if !isLoopback(host) {
				return "http is only allowed for loopback addresses (127.0.0.1, localhost, ::1)"
			}
		} else if parsed.Scheme != "https" {
			return "url must use http or https"
		}
		return ""
	}

	// Production: HTTPS only, restricted domains
	if parsed.Scheme != "https" {
		return "url must use https"
	}
	if !isAllowedWebhookDomain(host) {
		return "url must be a *.gdcorp.tools, *.godaddy.com, or *.nstk.net domain"
	}
	return ""
}

// isLoopback returns true if the host is a loopback address.
func isLoopback(host string) bool {
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

// allowedWebhookDomains defines the allowed base domains and their environment variants.
// Each entry supports: exact match, subdomains (.<domain>), and env variants (.<env>-<domain>).
var allowedWebhookDomains = []string{"gdcorp.tools", "godaddy.com"}
var allowedWebhookEnvs = []string{"dev", "test", "stg", "ote"}

// allowedWebhookDomainsNoEnv defines allowed domains that don't use environment prefixes.
// Each entry supports: exact match and subdomains (.<domain>) only.
var allowedWebhookDomainsNoEnv = []string{"nstk.net"}

// isAllowedWebhookDomain returns true if the host is an allowed webhook domain.
// Allowed patterns for each base domain (e.g., "godaddy.com"):
//   - Exact match: "godaddy.com"
//   - Subdomain: "*.godaddy.com" (e.g., "api.godaddy.com")
//   - Environment variant: "*.<env>-godaddy.com" (e.g., "api.dev-godaddy.com")
//
// For domains in allowedWebhookDomainsNoEnv (e.g., "nstk.net"):
//   - Exact match and subdomain only (no environment variants)
func isAllowedWebhookDomain(host string) bool {
	for _, domain := range allowedWebhookDomains {
		// Exact match: "godaddy.com"
		if host == domain {
			return true
		}
		// Subdomain match: ".godaddy.com" (requires leading dot to prevent spoofing)
		if strings.HasSuffix(host, "."+domain) {
			return true
		}
		// Environment variants: ".dev-godaddy.com", ".test-godaddy.com", etc.
		for _, env := range allowedWebhookEnvs {
			envDomain := env + "-" + domain
			if host == envDomain || strings.HasSuffix(host, "."+envDomain) {
				return true
			}
		}
	}
	// Check domains without environment prefixes
	for _, domain := range allowedWebhookDomainsNoEnv {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func (s *Server) webhookHTTPClient() *http.Client {
	if s.WebhookClient != nil {
		return s.WebhookClient
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// webhookURLForLog returns scheme://host for structured logs (no path, query, fragment, or userinfo).
func webhookURLForLog(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// deliverWebhook sends a webhook request with token authentication.
// When TokenGenerator is nil (local dev with auth disabled), sends without Authorization header.
func (s *Server) deliverWebhook(ctx context.Context, wh store.WebhookRow, payload []byte) error {
	parsedURL, err := url.Parse(wh.URL)
	if err != nil {
		return fmt.Errorf("invalid webhook URL: %w", err)
	}
	if parsedURL.User != nil {
		return fmt.Errorf("webhook URL must not contain credentials")
	}

	host := strings.ToLower(parsedURL.Hostname())

	// Enforce scheme and domain based on whether auth is enabled
	if s.TokenGenerator != nil {
		// Production: require HTTPS
		if !strings.EqualFold(parsedURL.Scheme, "https") {
			return fmt.Errorf("webhook URL must use HTTPS")
		}
		// Production: require allowed domain (defense-in-depth for legacy rows or direct DB writes)
		if !isAllowedWebhookDomain(host) {
			return fmt.Errorf("webhook URL domain not in allowlist")
		}
	} else {
		// Local dev: allow HTTP for loopback only
		if strings.EqualFold(parsedURL.Scheme, "http") && !isLoopback(host) {
			return fmt.Errorf("HTTP webhooks only allowed for loopback addresses in local dev")
		}
	}

	// Get auth token if available
	var token string
	if s.TokenGenerator != nil {
		token, err = s.TokenGenerator.GetToken()
		if err != nil {
			return fmt.Errorf("token generation failed: %w", err)
		}
	}

	// Attempt delivery
	resp, err := s.doWebhookRequest(ctx, wh.URL, payload, token)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}

func (s *Server) doWebhookRequest(ctx context.Context, targetURL string, payload []byte, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "budget-service/1.0")
	if token != "" {
		req.Header.Set("Authorization", "sso-jwt "+token)
	}

	return s.webhookHTTPClient().Do(req)
}

// DeliverEventWebhooks delivers webhooks for any event type (used by background worker).
// Returns an error if delivery fails for any subscriber. The error includes the count
// of failures and wraps the first error encountered for retry logic.
func (s *Server) DeliverEventWebhooks(ctx context.Context, eventType, productKey string, data any) error {
	if s.Store == nil || strings.TrimSpace(productKey) == "" {
		return nil
	}

	hooks, err := s.Store.ListWebhooksForEvent(ctx, productKey, eventType)
	if err != nil {
		slog.Error("webhook.list", "error", err, "eventType", eventType, "productKey", productKey)
		return fmt.Errorf("list webhooks: %w", err)
	}
	if len(hooks) == 0 {
		return nil
	}

	payload := map[string]any{
		"eventType":  eventType,
		"productKey": productKey,
		"data":       data,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("webhook.marshal", "error", err, "eventType", eventType)
		return fmt.Errorf("marshal payload: %w", err)
	}

	errs := make([]error, len(hooks))
	sem := make(chan struct{}, maxParallelWebhookDeliveries)
	var wg sync.WaitGroup
	for i := range hooks {
		sem <- struct{}{}
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			errs[idx] = s.deliverWebhook(ctx, hooks[idx], body)
		}(i)
	}
	wg.Wait()

	var firstErr error
	failCount := 0
	for i := range hooks {
		if errs[i] != nil {
			err := errs[i]
			logURL := webhookURLForLog(hooks[i].URL)
			if logURL == "" {
				logURL = "(unparseable)"
			}
			slog.Warn("webhook.delivery_failed",
				"error", err,
				"webhookId", hooks[i].ID,
				"eventType", eventType,
				"url", logURL)
			if firstErr == nil {
				firstErr = err
			}
			failCount++
		}
	}
	if firstErr != nil {
		return fmt.Errorf("%d/%d webhook deliveries failed: %w", failCount, len(hooks), firstErr)
	}
	return nil
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
		"updatedAt":  row.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) getWebhooks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !rejectUnknownQueryKeys(w, q, allowedGetWebhooksQueryKeys) {
		return
	}
	pk := strings.TrimSpace(q.Get("productKey"))
	if pk != "" {
		if msg := validateIdentifier(pk); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey "+msg)
			return
		}
	}
	if !s.requireStore(w) {
		return
	}
	rows, err := s.Store.ListWebhooks(r.Context(), pk)
	if err != nil {
		slog.Error("webhooks.list.request", "error", err, "productKey", pk)
		writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for i := range rows {
		out = append(out, webhookToResponse(&rows[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) postWebhook(w http.ResponseWriter, r *http.Request) {
	var payload postWebhookBody
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}
	rawEventType := strings.TrimSpace(payload.EventType)
	if rawEventType == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "eventType is required")
		return
	}
	eventType, ok := normalizeWebhookEventType(rawEventType)
	if !ok {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "eventType must be one of: "+supportedEventTypesList())
		return
	}
	pk := strings.TrimSpace(payload.ProductKey)
	if pk == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is required")
		return
	}
	if msg := validateIdentifier(pk); msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey "+msg)
		return
	}
	if msg := validateWebhookTargetURL(payload.URL, s.LocalAuthDisable); msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}

	if !s.requireStore(w) {
		return
	}

	webhookID := uuid.NewString()
	if err := s.Store.CreateWebhook(r.Context(), webhookID, eventType, pk, payload.URL); err != nil {
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
	writeInternalError(w, op, err)
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
		writeInternalError(w, "webhook.get", err)
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
		writeInternalError(w, "webhook.delete", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
