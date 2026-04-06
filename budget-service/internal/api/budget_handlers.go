package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/credits"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

const budgetMaxBodyBytes = 1 << 20

var budgetResetIntervals = map[string]struct{}{
	"DAY": {}, "WEEK": {}, "MONTH": {}, "YEAR": {},
}

// flexAmount unmarshals JSON string or number into a normalized decimal string.
type flexAmount string

func (f *flexAmount) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || string(data) == "null" {
		*f = ""
		return nil
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*f = flexAmount(strings.TrimSpace(s))
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(data, &n); err != nil {
		return err
	}
	*f = flexAmount(string(n))
	return nil
}

func sessionDebugQuery(r *http.Request) bool {
	return r.URL.Query().Get("debug") == "1"
}

func sessionCostJSONNumber(costStr string) (json.Number, error) {
	d, err := credits.ParseNonNegative(strings.TrimSpace(costStr))
	if err != nil {
		return "", err
	}
	return json.Number(credits.Format(d)), nil
}

func (s *Server) requireStore(w http.ResponseWriter) bool {
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "database not configured")
		return false
	}
	return true
}

func requireUUIDParam(w http.ResponseWriter, id, label string) bool {
	id = strings.TrimSpace(id)
	if id == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", label+" is required")
		return false
	}
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", label+" must be a valid UUID")
		return false
	}
	return true
}

func writeBudgetStoreError(w http.ResponseWriter, op string, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "resource not found")
		return
	}
	if errors.Is(err, store.ErrUnknownProductKey) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is not registered")
		return
	}
	if errors.Is(err, store.ErrAlreadyReconciled) {
		writeError(w, http.StatusConflict, "CONFLICT", "session already closed or reconciled")
		return
	}
	if errors.Is(err, store.ErrBudgetHasUnreconciledSessions) {
		writeError(w, http.StatusConflict, "CONFLICT", "budget has unreconciled sessions")
		return
	}
	if errors.Is(err, store.ErrBudgetHasReports) {
		writeError(w, http.StatusConflict, "CONFLICT", "budget has session reports")
		return
	}
	if errors.Is(err, store.ErrBudgetItemInReport) {
		writeError(w, http.StatusConflict, "CONFLICT", "budget item referenced in a report")
		return
	}
	if errors.Is(err, store.ErrNoSessionCapacity) {
		writeError(w, http.StatusPaymentRequired, "NO_BUDGET_CAPACITY", "no credits available to open a session")
		return
	}
	if errors.Is(err, store.ErrInsufficientCredits) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "insufficient credits for this report")
		return
	}
	if errors.Is(err, credits.ErrInvalid) || errors.Is(err, credits.ErrOutOfRange) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	slog.Error(op, "error", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
}

// parseCostToCreditRatio parses JSON costToCreditRatio: USD per credit, same as DB credit_spend_ratio.
func parseCostToCreditRatio(s string) (string, error) {
	d, err := credits.ParsePositiveRatio(s)
	if err != nil {
		return "", err
	}
	return credits.Format(d), nil
}

func validateBudgetItemDates(expiresAt, startsAt, resetsAt *string, resetInterval *string) string {
	if resetInterval != nil && strings.TrimSpace(*resetInterval) != "" {
		u := strings.ToUpper(strings.TrimSpace(*resetInterval))
		if _, ok := budgetResetIntervals[u]; !ok {
			return "resetInterval must be DAY, WEEK, MONTH, YEAR, or null"
		}
	}
	for _, label := range []struct {
		name string
		p    *string
	}{
		{"expiresAt", expiresAt},
		{"startsAt", startsAt},
		{"resetsAt", resetsAt},
	} {
		if label.p == nil || strings.TrimSpace(*label.p) == "" {
			continue
		}
		if _, err := time.Parse(time.RFC3339, strings.TrimSpace(*label.p)); err != nil {
			return label.name + " must be RFC3339 or null"
		}
	}
	return ""
}

type budgetItemBody struct {
	CreditsTotal      flexAmount  `json:"creditsTotal"`
	CostToCreditRatio *flexAmount `json:"costToCreditRatio"`
	ExpiresAt         *string     `json:"expiresAt"`
	StartsAt          *string     `json:"startsAt"`
	ResetsAt          *string     `json:"resetsAt"`
	ResetInterval     *string     `json:"resetInterval"`
}

func (b budgetItemBody) toItemInput() (store.ItemInput, string) {
	if msg := validateBudgetItemDates(b.ExpiresAt, b.StartsAt, b.ResetsAt, b.ResetInterval); msg != "" {
		return store.ItemInput{}, msg
	}
	ct, err := credits.ParseNonNegative(strings.TrimSpace(string(b.CreditsTotal)))
	if err != nil {
		return store.ItemInput{}, "creditsTotal must be a valid NUMERIC(20,6) non-negative value"
	}
	ratioStr := "1"
	if b.CostToCreditRatio != nil && strings.TrimSpace(string(*b.CostToCreditRatio)) != "" {
		ratioStr = strings.TrimSpace(string(*b.CostToCreditRatio))
	}
	csr, err := parseCostToCreditRatio(ratioStr)
	if err != nil {
		return store.ItemInput{}, "costToCreditRatio must be a valid NUMERIC(20,6) positive value"
	}
	out := store.ItemInput{
		CreditsTotal:     credits.Format(ct),
		CreditSpendRatio: csr,
		ExpireAt:         b.ExpiresAt,
		StartsAt:         b.StartsAt,
		ResetsAt:         b.ResetsAt,
		RenewInterval:    b.ResetInterval,
	}
	return out, ""
}

func budgetItemRowToJSON(r store.BudgetItemRow) map[string]any {
	ctc := strings.TrimSpace(r.CreditSpendRatio)
	if d, err := credits.ParsePositiveRatio(ctc); err == nil {
		ctc = credits.Format(d)
	}
	out := map[string]any{
		"budgetItemId":      r.ID,
		"creditsTotal":      r.CreditsTotal,
		"creditsUsed":       r.CreditsUsed,
		"costToCreditRatio": ctc,
		"updatedAt":         r.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"createdAt":         r.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if r.ExpireAt != nil {
		out["expiresAt"] = r.ExpireAt.UTC().Format(time.RFC3339Nano)
	} else {
		out["expiresAt"] = nil
	}
	if r.StartsAt != nil {
		out["startsAt"] = r.StartsAt.UTC().Format(time.RFC3339Nano)
	} else {
		out["startsAt"] = nil
	}
	if r.ResetsAt != nil {
		out["resetsAt"] = r.ResetsAt.UTC().Format(time.RFC3339Nano)
	} else {
		out["resetsAt"] = nil
	}
	if r.RenewInterval != nil {
		out["resetInterval"] = *r.RenewInterval
	} else {
		out["resetInterval"] = nil
	}
	return out
}

type postBudgetBody struct {
	ProductKey string           `json:"productKey"`
	Items      []budgetItemBody `json:"items"`
}

func (s *Server) postBudget(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload postBudgetBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if strings.TrimSpace(payload.ProductKey) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey is required")
		return
	}
	if len(payload.Items) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "items must contain at least one entry")
		return
	}
	items := make([]store.ItemInput, len(payload.Items))
	for i := range payload.Items {
		if strings.TrimSpace(string(payload.Items[i].CreditsTotal)) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each item requires creditsTotal")
			return
		}
		row, msg := payload.Items[i].toItemInput()
		if msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
			return
		}
		items[i] = row
	}

	if !s.requireStore(w) {
		return
	}

	budgetID := uuid.NewString()
	if err := s.Store.CreateBudget(r.Context(), budgetID, strings.TrimSpace(payload.ProductKey), items); err != nil {
		writeBudgetStoreError(w, "budget.post_budget", err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"budgetId": budgetID,
	})
}

func (s *Server) getBudget(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}
	if !s.requireStore(w) {
		return
	}

	d, err := s.Store.GetBudget(r.Context(), budgetID)
	if err != nil {
		writeBudgetStoreError(w, "budget.get_budget", err)
		return
	}

	items := make([]map[string]any, 0, len(d.Items))
	for i := range d.Items {
		items = append(items, budgetItemRowToJSON(d.Items[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"budgetId":       d.BudgetID,
		"productKey":     d.ProductKey,
		"creditsTotal":   d.CreditsTotal,
		"creditsPending": d.CreditsPending,
		"creditsUsed":    d.CreditsUsed,
		"updatedAt":      d.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"createdAt":      d.CreatedAt.UTC().Format(time.RFC3339Nano),
		"items":          items,
	})
}

type patchBudgetItem struct {
	BudgetItemID      *string     `json:"budgetItemId"`
	CreditsTotal      flexAmount  `json:"creditsTotal"`
	CostToCreditRatio *flexAmount `json:"costToCreditRatio"`
	ExpiresAt         *string     `json:"expiresAt"`
	StartsAt          *string     `json:"startsAt"`
	ResetsAt          *string     `json:"resetsAt"`
	ResetInterval     *string     `json:"resetInterval"`
}

func (p patchBudgetItem) toPutItemInput() (store.PutItemInput, string) {
	body := budgetItemBody{
		CreditsTotal:      p.CreditsTotal,
		CostToCreditRatio: p.CostToCreditRatio,
		ExpiresAt:         p.ExpiresAt,
		StartsAt:          p.StartsAt,
		ResetsAt:          p.ResetsAt,
		ResetInterval:     p.ResetInterval,
	}
	row, msg := body.toItemInput()
	if msg != "" {
		return store.PutItemInput{}, msg
	}
	return store.PutItemInput{
		BudgetItemID:     p.BudgetItemID,
		CreditsTotal:     row.CreditsTotal,
		CreditSpendRatio: row.CreditSpendRatio,
		ExpireAt:         row.ExpireAt,
		StartsAt:         row.StartsAt,
		ResetsAt:         row.ResetsAt,
		RenewInterval:    row.RenewInterval,
	}, ""
}

type patchBudgetBody struct {
	Items []patchBudgetItem `json:"items"`
}

func (s *Server) patchBudget(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload patchBudgetBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if len(payload.Items) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "items must contain at least one entry")
		return
	}
	rows := make([]store.PutItemInput, len(payload.Items))
	for i := range payload.Items {
		if strings.TrimSpace(string(payload.Items[i].CreditsTotal)) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each item requires creditsTotal")
			return
		}
		row, msg := payload.Items[i].toPutItemInput()
		if msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
			return
		}
		rows[i] = row
	}

	if !s.requireStore(w) {
		return
	}

	if err := s.Store.UpsertBudgetItems(r.Context(), budgetID, rows); err != nil {
		writeBudgetStoreError(w, "budget.patch_budget", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"budgetId": budgetID})
}

func (s *Server) deleteBudget(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}
	if !s.requireStore(w) {
		return
	}
	if err := s.Store.SoftDeleteBudget(r.Context(), budgetID); err != nil {
		writeBudgetStoreError(w, "budget.delete_budget", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postBudgetItem(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload budgetItemBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if strings.TrimSpace(string(payload.CreditsTotal)) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "creditsTotal is required")
		return
	}
	row, msg := payload.toItemInput()
	if msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}

	if !s.requireStore(w) {
		return
	}

	budgetItemID, err := s.Store.InsertBudgetItem(r.Context(), budgetID, row)
	if err != nil {
		writeBudgetStoreError(w, "budget.post_budget_item", err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"budgetId":     budgetID,
		"budgetItemId": budgetItemID,
	})
}

func (s *Server) getBudgetItem(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	budgetItemID := strings.TrimSpace(mux.Vars(r)["budgetItemId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, budgetItemID, "budgetItemId") {
		return
	}
	if !s.requireStore(w) {
		return
	}
	row, err := s.Store.GetBudgetItem(r.Context(), budgetID, budgetItemID)
	if err != nil {
		writeBudgetStoreError(w, "budget.get_budget_item", err)
		return
	}
	out := budgetItemRowToJSON(*row)
	out["budgetId"] = budgetID
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) patchBudgetItem(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	budgetItemID := strings.TrimSpace(mux.Vars(r)["budgetItemId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, budgetItemID, "budgetItemId") {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload budgetItemBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if strings.TrimSpace(string(payload.CreditsTotal)) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "creditsTotal is required")
		return
	}
	row, msg := payload.toItemInput()
	if msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}

	if !s.requireStore(w) {
		return
	}

	if err := s.Store.UpdateBudgetItem(r.Context(), budgetID, budgetItemID, row); err != nil {
		writeBudgetStoreError(w, "budget.patch_budget_item", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"budgetId":     budgetID,
		"budgetItemId": budgetItemID,
	})
}

func (s *Server) deleteBudgetItem(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	budgetItemID := strings.TrimSpace(mux.Vars(r)["budgetItemId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, budgetItemID, "budgetItemId") {
		return
	}
	if !s.requireStore(w) {
		return
	}
	if err := s.Store.SoftDeleteBudgetItem(r.Context(), budgetID, budgetItemID); err != nil {
		writeBudgetStoreError(w, "budget.delete_budget_item", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postBudgetSession(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	raw := bytes.TrimSpace(body)
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	var postSess struct {
		Metadata json.RawMessage `json:"metadata"`
	}
	if err := json.Unmarshal(raw, &postSess); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	var metaBytes []byte
	if len(postSess.Metadata) > 0 && !bytes.Equal(postSess.Metadata, []byte("null")) {
		if !json.Valid(postSess.Metadata) {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "metadata must be valid JSON")
			return
		}
		metaBytes = postSess.Metadata
	}

	if !s.requireStore(w) {
		return
	}

	sessionID := uuid.NewString()
	if err := s.Store.CreateBudgetSession(r.Context(), budgetID, sessionID, metaBytes); err != nil {
		writeBudgetStoreError(w, "budget.post_budget_session", err)
		return
	}

	var metaResp any
	if len(metaBytes) == 0 {
		metaResp = nil
	} else {
		metaResp = json.RawMessage(metaBytes)
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"sessionId": sessionID,
		"metadata":  metaResp,
	})
}

type sessionItemBody struct {
	Cost          flexAmount `json:"cost"`
	CallRequestID string     `json:"callRequestId"`
}

type patchBudgetSessionBody struct {
	SessionItems []sessionItemBody `json:"sessionItems"`
}

func (s *Server) appendSessionLines(w http.ResponseWriter, r *http.Request, budgetID, sessionID string, items []sessionItemBody) {
	if len(items) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "sessionItems must contain at least one entry")
		return
	}
	for i := range items {
		if strings.TrimSpace(items[i].CallRequestID) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each sessionItem requires callRequestId")
			return
		}
		if strings.TrimSpace(string(items[i].Cost)) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each sessionItem requires cost")
			return
		}
	}

	if !s.requireStore(w) {
		return
	}

	lines := make([]store.SessionLine, len(items))
	for i := range items {
		lines[i] = store.SessionLine{
			Cost:          strings.TrimSpace(string(items[i].Cost)),
			CallRequestID: strings.TrimSpace(items[i].CallRequestID),
		}
	}
	math, err := s.Store.AppendSessionItems(r.Context(), budgetID, sessionID, lines)
	if err != nil {
		writeBudgetStoreError(w, "budget.append_session_items", err)
		return
	}

	out := map[string]any{
		"budgetId":  budgetID,
		"sessionId": sessionID,
	}
	if sessionDebugQuery(r) {
		out["debug"] = map[string]any{
			"appendedLines": math,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) patchBudgetSession(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, sessionID, "sessionId") {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload patchBudgetSessionBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	s.appendSessionLines(w, r, budgetID, sessionID, payload.SessionItems)
}

func (s *Server) getBudgetSession(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, sessionID, "sessionId") {
		return
	}
	if !s.requireStore(w) {
		return
	}

	d, err := s.Store.GetBudgetSession(r.Context(), budgetID, sessionID)
	if err != nil {
		writeBudgetStoreError(w, "budget.get_budget_session", err)
		return
	}

	costTotalNum, err := sessionCostJSONNumber(d.CostTotal)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "session costTotal")
		return
	}
	lines := make([]map[string]any, len(d.Lines))
	for i := range d.Lines {
		costNum, err := sessionCostJSONNumber(d.Lines[i].Cost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "session line cost")
			return
		}
		lines[i] = map[string]any{
			"cost":          costNum,
			"callRequestId": d.Lines[i].CallRequestID,
		}
	}
	out := map[string]any{
		"costTotal":    costTotalNum,
		"updatedAt":    d.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"createdAt":    d.CreatedAt.UTC().Format(time.RFC3339Nano),
		"sessionItems": lines,
	}
	if d.ReconciledAt != nil {
		out["reconciledAt"] = d.ReconciledAt.UTC().Format(time.RFC3339Nano)
	} else {
		out["reconciledAt"] = nil
	}
	// ?debug=1: expose consumption order and replay math (no weighted “effective” ratio).
	if sessionDebugQuery(r) {
		order, err := s.Store.BudgetConsumptionPreview(r.Context(), budgetID)
		if err != nil {
			writeBudgetStoreError(w, "budget.get_session_debug_consumption", err)
			return
		}
		replayed, err := s.Store.DebugSessionCreditsReplay(r.Context(), budgetID, sessionID)
		if err != nil {
			writeBudgetStoreError(w, "budget.get_session_debug_replay", err)
			return
		}
		orderJSON := make([]map[string]any, len(order))
		for i := range order {
			orderJSON[i] = map[string]any{
				"budgetItemId":     order[i].BudgetItemID,
				"creditSpendRatio": order[i].CreditSpendRatio,
				"renewInterval":    order[i].RenewInterval,
				"expiresAt":        order[i].ExpiresAt,
			}
		}
		dbgItems := make([]map[string]any, len(d.Lines))
		for i := range d.Lines {
			replayedVal := ""
			if i < len(replayed) {
				replayedVal = replayed[i]
			}
			dbgItems[i] = map[string]any{
				"callRequestId":          d.Lines[i].CallRequestID,
				"costUsd":                d.Lines[i].Cost,
				"creditsChargedStored":   d.Lines[i].CreditsCharged,
				"creditsChargedReplayed": replayedVal,
			}
		}
		out["debug"] = map[string]any{
			"consumptionOrder": orderJSON,
			"note":             "USD→credits walks budget items renew_interval set first, then soonest expire_at; replay recomputes each line in id order from current budget_items.credits_used",
			"sessionItems":     dbgItems,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

type sessionReportItemBody struct {
	BudgetCost  flexAmount `json:"budgetCost"`
	ProductCost flexAmount `json:"productCost"`
	Label       string     `json:"label"`
}

type postSessionReportBody struct {
	ReportItems []sessionReportItemBody `json:"reportItems"`
}

func (s *Server) postBudgetSessionReport(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, sessionID, "sessionId") {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, budgetMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read body")
		return
	}
	var payload postSessionReportBody
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON body")
		return
	}
	if len(payload.ReportItems) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "reportItems must contain at least one entry")
		return
	}
	lines := make([]store.ReportLineInput, len(payload.ReportItems))
	for i := range payload.ReportItems {
		ri := payload.ReportItems[i]
		if strings.TrimSpace(ri.Label) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each reportItem requires label")
			return
		}
		if strings.TrimSpace(string(ri.BudgetCost)) == "" || strings.TrimSpace(string(ri.ProductCost)) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each reportItem requires budgetCost and productCost")
			return
		}
		if _, err := credits.ParseNonNegative(strings.TrimSpace(string(ri.BudgetCost))); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "budgetCost must be a valid non-negative amount")
			return
		}
		if _, err := credits.ParseNonNegative(strings.TrimSpace(string(ri.ProductCost))); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productCost must be a valid non-negative amount")
			return
		}
		lines[i] = store.ReportLineInput{
			BudgetCost:  strings.TrimSpace(string(ri.BudgetCost)),
			ProductCost: strings.TrimSpace(string(ri.ProductCost)),
			Category:    strings.TrimSpace(ri.Label),
		}
	}

	if !s.requireStore(w) {
		return
	}

	reportID, err := s.Store.CreateSessionReport(r.Context(), budgetID, sessionID, lines)
	if err != nil {
		writeBudgetStoreError(w, "budget.post_session_report", err)
		return
	}

	var productKey string
	if b, gerr := s.Store.GetBudget(r.Context(), budgetID); gerr == nil {
		productKey = b.ProductKey
	}
	go s.deliverReportCreatedWebhooks(budgetID, sessionID, reportID, productKey)

	writeJSON(w, http.StatusCreated, map[string]string{
		"budgetId":  budgetID,
		"sessionId": sessionID,
		"reportId":  reportID,
	})
}

func (s *Server) getBudgetSessionReport(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	reportID := strings.TrimSpace(mux.Vars(r)["reportId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, sessionID, "sessionId") || !requireUUIDParam(w, reportID, "reportId") {
		return
	}
	if !s.requireStore(w) {
		return
	}

	d, err := s.Store.GetSessionReport(r.Context(), budgetID, sessionID, reportID)
	if err != nil {
		writeBudgetStoreError(w, "budget.get_session_report", err)
		return
	}

	out, err := sessionReportDetailToResponse(d)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "report response")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func sessionReportDetailToResponse(d *store.SessionReportDetail) (map[string]any, error) {
	bct, err := sessionCostJSONNumber(d.BudgetCostTotal)
	if err != nil {
		return nil, err
	}
	pct, err := sessionCostJSONNumber(d.ProductCostTotal)
	if err != nil {
		return nil, err
	}
	cav, err := sessionCostJSONNumber(d.CreditsAvailable)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]any, len(d.Items))
	for i := range d.Items {
		it := d.Items[i]
		bc, err := sessionCostJSONNumber(it.BudgetCost)
		if err != nil {
			return nil, err
		}
		pc, err := sessionCostJSONNumber(it.ProductCost)
		if err != nil {
			return nil, err
		}
		budgetItems := make([]map[string]any, len(it.BudgetItems))
		for j := range it.BudgetItems {
			cu, err := sessionCostJSONNumber(it.BudgetItems[j].CreditsUsed)
			if err != nil {
				return nil, err
			}
			budgetItems[j] = map[string]any{
				"budgetItemId": it.BudgetItems[j].BudgetItemID,
				"creditsUsed":  cu,
			}
		}
		items[i] = map[string]any{
			"reportItemId": it.ReportItemID,
			"budgetCost":   bc,
			"productCost":  pc,
			"category":     it.Category,
			"createdAt":    it.CreatedAt.UTC().Format(time.RFC3339Nano),
			"budgetItems":  budgetItems,
		}
	}

	return map[string]any{
		"productKey":       d.ProductKey,
		"budgetId":         d.BudgetID,
		"sessionId":        d.SessionID,
		"reportId":         d.ReportID,
		"budgetCostTotal":  bct,
		"productCostTotal": pct,
		"creditsAvailable": cav,
		"reportItems":      items,
	}, nil
}
