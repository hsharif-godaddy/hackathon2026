package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/credits"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

const maxSessionCallRequestIDsInLog = 100

// flexAmount unmarshals JSON string or number into a normalized decimal string.
type flexAmount string

func (f *flexAmount) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || string(data) == "null" {
		*f = ""
		return nil
	}
	if len(data) > maxDecimalLen {
		return fmt.Errorf("decimal value exceeds maximum length")
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

// appendSessionDebug adds debug info to a session response. It fetches consumption order
// and replayed credits, then populates out["debug"]. If appendedLines is provided (from PATCH),
// it also includes the per-line allocation math. Returns an error string for the op name if
// a store call fails, empty string on success.
func (s *Server) appendSessionDebug(ctx context.Context, out map[string]any, budgetID, sessionID string, lines []store.SessionLineOut, appendedLines []store.SessionAppendMathLine) (string, error) {
	order, err := s.Store.BudgetConsumptionPreview(ctx, budgetID)
	if err != nil {
		return "budget.get_session_debug_consumption", err
	}
	replayed, err := s.Store.DebugSessionCreditsReplay(ctx, sessionID)
	if err != nil {
		return "budget.get_session_debug_replay", err
	}
	orderJSON := make([]map[string]any, len(order))
	for i := range order {
		orderJSON[i] = map[string]any{
			"budgetItemId":    order[i].BudgetItemID,
			"costCreditRatio": order[i].CostCreditRatio,
			"resetInterval":   order[i].ResetInterval,
			"expiresAt":       order[i].ExpiresAt,
		}
	}
	dbgItems := make([]map[string]any, len(lines))
	for i := range lines {
		replayedVal := ""
		if i < len(replayed) {
			replayedVal = replayed[i]
		}
		dbgItems[i] = map[string]any{
			"callRequestId":          lines[i].CallRequestID,
			"costUsd":                lines[i].Cost,
			"creditsChargedStored":   lines[i].CreditsCharged,
			"creditsChargedReplayed": replayedVal,
		}
	}
	debug := map[string]any{
		"consumptionOrder": orderJSON,
		"note":             "USD→credits walks budget items reset_interval set first, then soonest expires_at; replay recomputes each line in id order from current budget_items.credits_used",
		"sessionItems":     dbgItems,
	}
	if len(appendedLines) > 0 {
		debug["appendedLines"] = appendedLines
	}
	out["debug"] = debug
	return "", nil
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
		writeError(w, http.StatusConflict, "CONFLICT", "session already reconciled")
		return
	}
	if errors.Is(err, store.ErrBudgetHasUnreconciledSessions) {
		writeError(w, http.StatusConflict, "CONFLICT", "budget has unreconciled sessions")
		return
	}
	if errors.Is(err, store.ErrNoBudgetItems) {
		writeError(w, http.StatusPaymentRequired, "NO_BUDGET_CAPACITY", "budget has no budget items")
		return
	}
	if errors.Is(err, store.ErrNoSessionCapacity) {
		writeError(w, http.StatusPaymentRequired, "NO_BUDGET_CAPACITY", "no credits available to open a session")
		return
	}
	if errors.Is(err, store.ErrInsufficientCredits) {
		slog.Warn("budget.insufficient_credits", "op", op, "error", err)
		writeError(w, http.StatusBadRequest, "INSUFFICIENT_CREDITS", "insufficient credits")
		return
	}
	if errors.Is(err, store.ErrDuplicateCallRequestID) {
		writeError(w, http.StatusBadRequest, "DUPLICATE_CALL_REQUEST_ID", "callRequestId already used for this session")
		return
	}
	if errors.Is(err, store.ErrReportAggregateNoFilter) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "at least one of productKey and label is required")
		return
	}
	if errors.Is(err, credits.ErrInvalid) || errors.Is(err, credits.ErrOutOfRange) {
		slog.Warn(op, "error", err)
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid amount")
		return
	}
	writeInternalError(w, op, err)
}

// parseCostToCreditRatio parses JSON costToCreditRatio: USD per credit, same as DB cost_credit_ratio.
func parseCostToCreditRatio(s string) (string, error) {
	d, err := credits.ParsePositiveRatio(s)
	if err != nil {
		return "", err
	}
	return credits.Format(d), nil
}

func validateBudgetItemDates(expiresAt, startsAt, resetsAt *string) string {
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
		v := strings.TrimSpace(*label.p)
		if len(v) > maxDateStringLen {
			return label.name + " must be RFC3339 or null"
		}
		if _, err := time.Parse(time.RFC3339, v); err != nil {
			return label.name + " must be RFC3339 or null"
		}
	}
	return ""
}

func hasNonEmptyStringValue(p *string) bool {
	return p != nil && strings.TrimSpace(*p) != ""
}

func hasMissingFlexAmountValue(p *flexAmount) bool {
	return p == nil || strings.TrimSpace(string(*p)) == ""
}

// hydrateMissingBudgetItemUpdateFields loads the current DB record and fills only missing
// update fields used by PATCH handlers.
func (s *Server) hydrateMissingBudgetItemUpdateFields(ctx context.Context, budgetID, budgetItemID string, creditsTotal *flexAmount, costToCreditRatio **flexAmount, hydrateExpiresAt, hydrateStartsAt, hydrateResetsAt, hydrateResetInterval, hydrateLabel bool, expiresAt, startsAt, resetsAt, resetInterval **string, label **string) error {
	missingCreditsTotal := strings.TrimSpace(string(*creditsTotal)) == ""
	missingCostToCreditRatio := hasMissingFlexAmountValue(*costToCreditRatio)
	missingExpiresAt := hydrateExpiresAt && *expiresAt == nil
	missingStartsAt := hydrateStartsAt && *startsAt == nil
	missingResetsAt := hydrateResetsAt && *resetsAt == nil
	missingResetInterval := hydrateResetInterval && *resetInterval == nil
	missingLabel := hydrateLabel && *label == nil
	if !missingCreditsTotal && !missingCostToCreditRatio && !missingExpiresAt && !missingStartsAt && !missingResetsAt && !missingResetInterval && !missingLabel {
		return nil
	}

	existing, err := s.Store.GetBudgetItem(ctx, budgetID, budgetItemID, false)
	if err != nil {
		return err
	}
	if missingCreditsTotal {
		*creditsTotal = flexAmount(existing.CreditsTotal)
	}
	if missingCostToCreditRatio {
		ratio := flexAmount(existing.CostCreditRatio)
		*costToCreditRatio = &ratio
	}
	if missingExpiresAt && existing.ExpiresAt != nil {
		expires := existing.ExpiresAt.UTC().Format(time.RFC3339Nano)
		*expiresAt = &expires
	}
	if missingStartsAt && existing.StartsAt != nil {
		starts := existing.StartsAt.UTC().Format(time.RFC3339Nano)
		*startsAt = &starts
	}
	if missingResetsAt && existing.ResetsAt != nil {
		resets := existing.ResetsAt.UTC().Format(time.RFC3339Nano)
		*resetsAt = &resets
	}
	if missingResetInterval && existing.ResetInterval != nil {
		interval := *existing.ResetInterval
		*resetInterval = &interval
	}
	if missingLabel {
		if existing.Label != nil {
			v := *existing.Label
			*label = &v
		} else {
			*label = nil
		}
	}
	return nil
}

type budgetItemBody struct {
	CreditsTotal      flexAmount  `json:"creditsTotal"`
	CreditsUsed       *flexAmount `json:"creditsUsed"`
	CostToCreditRatio *flexAmount `json:"costToCreditRatio"`
	ExpiresAt         *string     `json:"expiresAt"`
	StartsAt          *string     `json:"startsAt"`
	ResetsAt          *string     `json:"resetsAt"`
	ResetInterval     *string     `json:"resetInterval"`
	Label             *string     `json:"label"`
}

func (b budgetItemBody) toItemInput(validateCreate bool) (store.ItemInput, string) {
	if b.ResetInterval != nil && len(*b.ResetInterval) > maxFieldLen {
		return store.ItemInput{}, "resetInterval exceeds maximum length"
	}
	ri, err := store.NormalizeResetInterval(b.ResetInterval)
	if err != nil {
		slog.Warn("budget.normalize_reset_interval", "error", err)
		msg := "resetInterval format is invalid"
		if errors.Is(err, store.ErrResetIntervalOutOfRange) {
			msg = "resetInterval value is out of range"
		}
		return store.ItemInput{}, msg
	}
	if hasNonEmptyStringValue(b.ResetsAt) && ri == nil {
		return store.ItemInput{}, "resetsAt requires resetInterval"
	}
	if !validateCreate && ri != nil && b.ResetsAt == nil {
		return store.ItemInput{}, "resetInterval requires resetsAt when updating"
	}
	if msg := validateBudgetItemDates(b.ExpiresAt, b.StartsAt, b.ResetsAt); msg != "" {
		return store.ItemInput{}, msg
	}
	creditsTotalStr := strings.TrimSpace(string(b.CreditsTotal))
	var formattedCreditsTotal string
	if creditsTotalStr == "" && !validateCreate {
		// creditsTotal is optional when updating; caller must fill it in before persisting.
		formattedCreditsTotal = ""
	} else {
		ct, err := credits.ParseNonNegative(creditsTotalStr)
		if err != nil {
			return store.ItemInput{}, "creditsTotal must be a valid NUMERIC(20,6) non-negative value"
		}
		formattedCreditsTotal = credits.Format(ct)
	}

	// Parse creditsUsed (optional, only valid for create).
	var formattedCreditsUsed string
	if b.CreditsUsed != nil && strings.TrimSpace(string(*b.CreditsUsed)) != "" {
		if !validateCreate {
			return store.ItemInput{}, "creditsUsed can only be set when creating a budget item"
		}
		cu, err := credits.ParseNonNegative(strings.TrimSpace(string(*b.CreditsUsed)))
		if err != nil {
			return store.ItemInput{}, "creditsUsed must be a valid NUMERIC(20,6) non-negative value"
		}
		formattedCreditsUsed = credits.Format(cu)
		// Validate creditsUsed <= creditsTotal
		if formattedCreditsTotal != "" {
			ct, _ := credits.ParseNonNegative(formattedCreditsTotal)
			if cu.GreaterThan(ct) {
				return store.ItemInput{}, "creditsUsed cannot exceed creditsTotal"
			}
		}
	}

	ratioStr := "1"
	if !validateCreate && hasMissingFlexAmountValue(b.CostToCreditRatio) {
		ratioStr = ""
	} else if b.CostToCreditRatio != nil && strings.TrimSpace(string(*b.CostToCreditRatio)) != "" {
		ratioStr = strings.TrimSpace(string(*b.CostToCreditRatio))
	}
	csr := ""
	if ratioStr != "" {
		var err error
		csr, err = parseCostToCreditRatio(ratioStr)
		if err != nil {
			return store.ItemInput{}, "costToCreditRatio must be a valid NUMERIC(20,6) positive value"
		}
	}
	if b.Label != nil {
		trimmed := strings.TrimSpace(*b.Label)
		b.Label = &trimmed
	}
	if b.Label != nil && *b.Label != "" {
		if msg := validateLabel(*b.Label); msg != "" {
			return store.ItemInput{}, "label " + msg
		}
	}
	out := store.ItemInput{
		CreditsTotal:    formattedCreditsTotal,
		CreditsUsed:     formattedCreditsUsed,
		CostCreditRatio: csr,
		ExpiresAt:       b.ExpiresAt,
		StartsAt:        b.StartsAt,
		ResetsAt:        b.ResetsAt,
		ResetInterval:   ri,
		Label:           b.Label,
	}
	return out, ""
}

func budgetItemToResponse(r store.BudgetItemRow) map[string]any {
	ctc := strings.TrimSpace(r.CostCreditRatio)
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
	if r.ExpiresAt != nil {
		out["expiresAt"] = r.ExpiresAt.UTC().Format(time.RFC3339Nano)
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
	if r.ResetInterval != nil {
		out["resetInterval"] = *r.ResetInterval
	} else {
		out["resetInterval"] = nil
	}
	if r.Label != nil {
		out["label"] = *r.Label
	} else {
		out["label"] = nil
	}
	if r.DeletedAt != nil {
		out["deletedAt"] = r.DeletedAt.UTC().Format(time.RFC3339Nano)
	}
	return out
}

func budgetToResponse(d *store.BudgetDetail) map[string]any {
	items := make([]map[string]any, 0, len(d.Items))
	for i := range d.Items {
		items = append(items, budgetItemToResponse(d.Items[i]))
	}
	out := map[string]any{
		"budgetId":       d.BudgetID,
		"productKey":     d.ProductKey,
		"creditsTotal":   d.CreditsTotal,
		"creditsPending": d.CreditsPending,
		"creditsUsed":    d.CreditsUsed,
		"updatedAt":      d.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"createdAt":      d.CreatedAt.UTC().Format(time.RFC3339Nano),
		"items":          items,
	}
	if d.DeletedAt != nil {
		out["deletedAt"] = d.DeletedAt.UTC().Format(time.RFC3339Nano)
	}
	return out
}

func budgetSessionToResponse(sessionID string, d *store.BudgetSessionDetail) (map[string]any, error) {
	costTotalNum, err := sessionCostJSONNumber(d.CostTotal)
	if err != nil {
		return nil, err
	}
	lines := make([]map[string]any, len(d.Lines))
	for i := range d.Lines {
		costNum, err := sessionCostJSONNumber(d.Lines[i].Cost)
		if err != nil {
			return nil, err
		}
		lines[i] = map[string]any{
			"cost":          costNum,
			"callRequestId": d.Lines[i].CallRequestID,
		}
	}
	out := map[string]any{
		"budgetId":     d.BudgetID,
		"sessionId":    sessionID,
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
	if len(d.Metadata) == 0 {
		out["metadata"] = nil
	} else {
		out["metadata"] = json.RawMessage(d.Metadata)
	}
	return out, nil
}

type postBudgetBody struct {
	ProductKey string           `json:"productKey"`
	Items      []budgetItemBody `json:"items"`
}

func (s *Server) postBudget(w http.ResponseWriter, r *http.Request) {
	var payload postBudgetBody
	if !decodeJSONBody(w, r, &payload, false) {
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
	items := make([]store.ItemInput, len(payload.Items))
	for i := range payload.Items {
		if strings.TrimSpace(string(payload.Items[i].CreditsTotal)) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each item requires creditsTotal")
			return
		}
		row, msg := payload.Items[i].toItemInput(true)
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
	if err := s.Store.CreateBudget(r.Context(), budgetID, pk, items); err != nil {
		writeBudgetStoreError(w, "budget.post_budget", err)
		return
	}
	d, err := s.Store.GetBudget(r.Context(), budgetID, false)
	if err != nil {
		slog.Error("budget.post_budget_get", "error", err)
		writeJSON(w, http.StatusCreated, map[string]string{"budgetId": budgetID})
		return
	}

	writeJSON(w, http.StatusCreated, budgetToResponse(d))
}

func (s *Server) getBudget(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}
	q := r.URL.Query()
	if !rejectUnknownQueryKeys(w, q, allowedGetBudgetQueryKeys) {
		return
	}
	if !s.requireStore(w) {
		return
	}

	d, err := s.Store.GetBudget(r.Context(), budgetID, queryIncludeDeleted(q))
	if err != nil {
		writeBudgetStoreError(w, "budget.get_budget", err)
		return
	}

	writeJSON(w, http.StatusOK, budgetToResponse(d))
}

type patchBudgetItem struct {
	BudgetItemID      *string     `json:"budgetItemId"`
	CreditsTotal      flexAmount  `json:"creditsTotal"`
	CreditsUsed       *flexAmount `json:"creditsUsed"`
	CostToCreditRatio *flexAmount `json:"costToCreditRatio"`
	ExpiresAt         *string     `json:"expiresAt"`
	StartsAt          *string     `json:"startsAt"`
	ResetsAt          *string     `json:"resetsAt"`
	ResetInterval     *string     `json:"resetInterval"`
	Label             *string     `json:"label"`
	expiresAtSet      bool        `json:"-"`
	startsAtSet       bool        `json:"-"`
	resetsAtSet       bool        `json:"-"`
	resetIntervalSet  bool        `json:"-"`
	labelSet          bool        `json:"-"`
}

// patchBudgetItemAllowedFields lists JSON keys accepted by patchBudgetItem.UnmarshalJSON.
var patchBudgetItemAllowedFields = map[string]struct{}{
	"budgetItemId":      {},
	"creditsTotal":      {},
	"creditsUsed":       {},
	"costToCreditRatio": {},
	"expiresAt":         {},
	"startsAt":          {},
	"resetsAt":          {},
	"resetInterval":     {},
	"label":             {},
}

func (p *patchBudgetItem) UnmarshalJSON(data []byte) error {
	type alias patchBudgetItem
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	// Reject unknown fields to match decodeJSONBody's DisallowUnknownFields behavior.
	for key := range raw {
		if _, ok := patchBudgetItemAllowedFields[key]; !ok {
			return fmt.Errorf("json: unknown field %q", key)
		}
	}
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*p = patchBudgetItem(a)
	_, p.expiresAtSet = raw["expiresAt"]
	_, p.startsAtSet = raw["startsAt"]
	_, p.resetsAtSet = raw["resetsAt"]
	_, p.resetIntervalSet = raw["resetInterval"]
	_, p.labelSet = raw["label"]
	return nil
}

func (p patchBudgetItem) toPutItemInput(validateCreate bool) (store.PutItemInput, string) {
	body := budgetItemBody{
		CreditsTotal:      p.CreditsTotal,
		CreditsUsed:       p.CreditsUsed,
		CostToCreditRatio: p.CostToCreditRatio,
		ExpiresAt:         p.ExpiresAt,
		StartsAt:          p.StartsAt,
		ResetsAt:          p.ResetsAt,
		ResetInterval:     p.ResetInterval,
		Label:             p.Label,
	}
	row, msg := body.toItemInput(validateCreate)
	if msg != "" {
		return store.PutItemInput{}, msg
	}
	return store.PutItemInput{
		BudgetItemID:    p.BudgetItemID,
		CreditsTotal:    row.CreditsTotal,
		CreditsUsed:     row.CreditsUsed,
		CostCreditRatio: row.CostCreditRatio,
		ExpiresAt:       row.ExpiresAt,
		StartsAt:        row.StartsAt,
		ResetsAt:        row.ResetsAt,
		ResetInterval:   row.ResetInterval,
		Label:           row.Label,
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
	var payload patchBudgetBody
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}
	if len(payload.Items) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "items must contain at least one entry")
		return
	}

	for i := range payload.Items {
		if payload.Items[i].BudgetItemID == nil || strings.TrimSpace(*payload.Items[i].BudgetItemID) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST",
				"each item must include budgetItemId; use POST /api/v1/budgets/"+budgetID+"/budget-items to add a budget item")
			return
		}
		if _, err := uuid.Parse(strings.TrimSpace(*payload.Items[i].BudgetItemID)); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "budgetItemId must be a valid UUID")
			return
		}
	}

	// Pre-hydration validation: validate all items eagerly before touching the store.
	// creditsTotal is optional for updates (toItemInput allows it when validateCreate=false);
	// we resolve existing values from the DB further below.
	// NOTE: The result of toPutItemInput here is intentionally discarded — this call validates
	// the payload fields only. We call it again after hydration to get the final values.
	for i := range payload.Items {
		if _, msg := payload.Items[i].toPutItemInput(false); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
			return
		}
	}

	if !s.requireStore(w) {
		return
	}

	// For items missing update fields, fill in values from the current DB record.
	// If resetInterval is explicitly cleared (set to null), don't hydrate resetsAt from DB —
	// clearing one implicitly clears the other to avoid confusing validation errors.
	for i := range payload.Items {
		it := &payload.Items[i]
		hydrateResetsAt := !it.resetsAtSet && !(it.resetIntervalSet && it.ResetInterval == nil)
		hydrateResetInterval := !it.resetIntervalSet && !(it.resetsAtSet && it.ResetsAt == nil)
		err := s.hydrateMissingBudgetItemUpdateFields(
			r.Context(),
			budgetID,
			strings.TrimSpace(*it.BudgetItemID),
			&it.CreditsTotal,
			&it.CostToCreditRatio,
			!it.expiresAtSet,
			!it.startsAtSet,
			hydrateResetsAt,
			hydrateResetInterval,
			!it.labelSet,
			&it.ExpiresAt,
			&it.StartsAt,
			&it.ResetsAt,
			&it.ResetInterval,
			&it.Label,
		)
		if err != nil {
			writeBudgetStoreError(w, "budget.patch_budget_get_existing_item", err)
			return
		}
	}

	rows := make([]store.PutItemInput, len(payload.Items))
	for i := range payload.Items {
		row, msg := payload.Items[i].toPutItemInput(false)
		if msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
			return
		}
		rows[i] = row
	}

	if err := s.Store.UpdateBudgetItems(r.Context(), budgetID, rows); err != nil {
		writeBudgetStoreError(w, "budget.patch_budget", err)
		return
	}
	d, err := s.Store.GetBudget(r.Context(), budgetID, false)
	if err != nil {
		slog.Error("budget.patch_budget_get", "error", err)
		writeJSON(w, http.StatusOK, map[string]string{"budgetId": budgetID})
		return
	}

	writeJSON(w, http.StatusOK, budgetToResponse(d))
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
	var payload budgetItemBody
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}
	if strings.TrimSpace(string(payload.CreditsTotal)) == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "creditsTotal is required")
		return
	}
	row, msg := payload.toItemInput(true)
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
	created, err := s.Store.GetBudgetItem(r.Context(), budgetID, budgetItemID, false)
	if err != nil {
		slog.Error("budget.post_budget_item_get", "error", err)
		writeJSON(w, http.StatusCreated, map[string]string{"budgetId": budgetID, "budgetItemId": budgetItemID})
		return
	}

	out := budgetItemToResponse(*created)
	out["budgetId"] = budgetID
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) getBudgetItem(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	budgetItemID := strings.TrimSpace(mux.Vars(r)["budgetItemId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, budgetItemID, "budgetItemId") {
		return
	}
	q := r.URL.Query()
	if !rejectUnknownQueryKeys(w, q, allowedGetBudgetItemQueryKeys) {
		return
	}
	if !s.requireStore(w) {
		return
	}
	row, err := s.Store.GetBudgetItem(r.Context(), budgetID, budgetItemID, queryIncludeDeleted(q))
	if err != nil {
		writeBudgetStoreError(w, "budget.get_budget_item", err)
		return
	}
	out := budgetItemToResponse(*row)
	out["budgetId"] = budgetID
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) patchBudgetItem(w http.ResponseWriter, r *http.Request) {
	budgetID := strings.TrimSpace(mux.Vars(r)["budgetId"])
	budgetItemID := strings.TrimSpace(mux.Vars(r)["budgetItemId"])
	if !requireUUIDParam(w, budgetID, "budgetId") || !requireUUIDParam(w, budgetItemID, "budgetItemId") {
		return
	}
	var payload patchBudgetItem
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}

	// Pre-hydration validation: validate all fields eagerly. creditsTotal may be empty for updates
	// (toItemInput allows it when validateCreate=false); we resolve the existing value from the DB
	// further below. NOTE: The result here is intentionally discarded — this call validates the
	// payload fields only. We call it again after hydration to get the final values.
	if _, msg := payload.toPutItemInput(false); msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}

	if !s.requireStore(w) {
		return
	}

	// creditsTotal and costToCreditRatio are optional for PATCH: if omitted, retain current values.
	// If resetInterval is explicitly cleared (set to null), don't hydrate resetsAt from DB —
	// clearing one implicitly clears the other to avoid confusing validation errors.
	hydrateResetsAt := !payload.resetsAtSet && !(payload.resetIntervalSet && payload.ResetInterval == nil)
	hydrateResetInterval := !payload.resetIntervalSet && !(payload.resetsAtSet && payload.ResetsAt == nil)
	if err := s.hydrateMissingBudgetItemUpdateFields(
		r.Context(),
		budgetID,
		budgetItemID,
		&payload.CreditsTotal,
		&payload.CostToCreditRatio,
		!payload.expiresAtSet,
		!payload.startsAtSet,
		hydrateResetsAt,
		hydrateResetInterval,
		!payload.labelSet,
		&payload.ExpiresAt,
		&payload.StartsAt,
		&payload.ResetsAt,
		&payload.ResetInterval,
		&payload.Label,
	); err != nil {
		writeBudgetStoreError(w, "budget.patch_budget_item_get_existing", err)
		return
	}

	putRow, msg := payload.toPutItemInput(false)
	if msg != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", msg)
		return
	}
	row := store.ItemInput{
		CreditsTotal:    putRow.CreditsTotal,
		CostCreditRatio: putRow.CostCreditRatio,
		ExpiresAt:       putRow.ExpiresAt,
		StartsAt:        putRow.StartsAt,
		ResetsAt:        putRow.ResetsAt,
		ResetInterval:   putRow.ResetInterval,
		Label:           putRow.Label,
	}

	if err := s.Store.UpdateBudgetItem(r.Context(), budgetID, budgetItemID, row); err != nil {
		writeBudgetStoreError(w, "budget.patch_budget_item", err)
		return
	}
	updated, err := s.Store.GetBudgetItem(r.Context(), budgetID, budgetItemID, false)
	if err != nil {
		slog.Error("budget.patch_budget_item_get", "error", err)
		writeJSON(w, http.StatusOK, map[string]string{"budgetId": budgetID, "budgetItemId": budgetItemID})
		return
	}

	out := budgetItemToResponse(*updated)
	out["budgetId"] = budgetID
	writeJSON(w, http.StatusOK, out)
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
	var postSess struct {
		BudgetID string          `json:"budgetId"`
		Metadata json.RawMessage `json:"metadata"`
	}
	if !decodeJSONBody(w, r, &postSess, false) {
		return
	}
	budgetID := strings.TrimSpace(postSess.BudgetID)
	if !requireUUIDParam(w, budgetID, "budgetId") {
		return
	}
	var metaBytes []byte
	if len(postSess.Metadata) > 0 && !bytes.Equal(postSess.Metadata, []byte("null")) {
		if len(postSess.Metadata) > maxSessionMetadataBytes {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "metadata exceeds maximum size")
			return
		}
		if !json.Valid(postSess.Metadata) {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "metadata must be valid JSON")
			return
		}
		depth, err := jsonDepth(postSess.Metadata)
		if err != nil || depth > maxMetadataDepth {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "metadata exceeds maximum nesting depth")
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

	d, err := s.Store.GetBudgetSession(r.Context(), sessionID)
	if err != nil {
		slog.Error("budget.post_budget_session_get", "error", err, "budgetId", budgetID, "sessionId", sessionID)
		writeJSON(w, http.StatusCreated, map[string]string{"budgetId": budgetID, "sessionId": sessionID})
		return
	}
	out, err := budgetSessionToResponse(sessionID, d)
	if err != nil {
		writeInternalError(w, "budget.post_budget_session_response", err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

type sessionItemBody struct {
	Cost          flexAmount `json:"cost"`
	CallRequestID string     `json:"callRequestId"`
}

type patchBudgetSessionBody struct {
	SessionItems []sessionItemBody `json:"sessionItems"`
}

func (s *Server) appendSessionLines(w http.ResponseWriter, r *http.Request, sessionID string, items []sessionItemBody) ([]store.SessionAppendMathLine, string, bool) {
	if len(items) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "sessionItems must contain at least one entry")
		return nil, "", false
	}
	seenCallRequest := make(map[string]struct{}, len(items))
	for i := range items {
		crID := strings.TrimSpace(items[i].CallRequestID)
		if crID == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each sessionItem requires callRequestId")
			return nil, "", false
		}
		if msg := validateIdentifier(crID); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "callRequestId "+msg)
			return nil, "", false
		}
		if strings.TrimSpace(string(items[i].Cost)) == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each sessionItem requires cost")
			return nil, "", false
		}
		if _, dup := seenCallRequest[crID]; dup {
			writeError(w, http.StatusBadRequest, "DUPLICATE_CALL_REQUEST_ID", "duplicate callRequestId in sessionItems")
			return nil, "", false
		}
		seenCallRequest[crID] = struct{}{}
	}

	if !s.requireStore(w) {
		return nil, "", false
	}

	lines := make([]store.SessionLine, len(items))
	for i := range items {
		lines[i] = store.SessionLine{
			Cost:          strings.TrimSpace(string(items[i].Cost)),
			CallRequestID: strings.TrimSpace(items[i].CallRequestID),
		}
	}
	mathLines, budgetID, err := s.Store.AppendSessionItems(r.Context(), sessionID, lines)
	if err != nil {
		writeBudgetStoreError(w, "budget.append_session_items", err)
		return nil, "", false
	}
	return mathLines, budgetID, true
}

func (s *Server) patchBudgetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	if !requireUUIDParam(w, sessionID, "sessionId") {
		return
	}
	var payload patchBudgetSessionBody
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}
	appendedLines, appendBudgetID, ok := s.appendSessionLines(w, r, sessionID, payload.SessionItems)
	if !ok {
		return
	}
	d, err := s.Store.GetBudgetSession(r.Context(), sessionID)
	if err != nil {
		slog.Error("budget.patch_budget_session_get", "error", err)
		writeJSON(w, http.StatusOK, map[string]string{"budgetId": appendBudgetID, "sessionId": sessionID})
		return
	}
	out, err := budgetSessionToResponse(sessionID, d)
	if err != nil {
		writeInternalError(w, "budget.patch_budget_session_response", err)
		return
	}
	if sessionDebugQuery(r) {
		if op, err := s.appendSessionDebug(r.Context(), out, d.BudgetID, sessionID, d.Lines, appendedLines); err != nil {
			writeBudgetStoreError(w, op, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getBudgetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	if !requireUUIDParam(w, sessionID, "sessionId") {
		return
	}
	if !s.requireStore(w) {
		return
	}

	d, err := s.Store.GetBudgetSession(r.Context(), sessionID)
	if err != nil {
		writeBudgetStoreError(w, "budget.get_budget_session", err)
		return
	}

	out, err := budgetSessionToResponse(sessionID, d)
	if err != nil {
		writeInternalError(w, "budget.get_budget_session_response", err)
		return
	}
	// ?debug=1: expose consumption order and replay math (no weighted "effective" ratio).
	if sessionDebugQuery(r) {
		if op, err := s.appendSessionDebug(r.Context(), out, d.BudgetID, sessionID, d.Lines, nil); err != nil {
			writeBudgetStoreError(w, op, err)
			return
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
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	if !requireUUIDParam(w, sessionID, "sessionId") {
		return
	}
	var payload postSessionReportBody
	if !decodeJSONBody(w, r, &payload, false) {
		return
	}
	if len(payload.ReportItems) == 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "reportItems must contain at least one entry")
		return
	}
	lines := make([]store.ReportLineInput, len(payload.ReportItems))
	for i := range payload.ReportItems {
		ri := payload.ReportItems[i]
		ri.Label = strings.TrimSpace(ri.Label)
		if ri.Label == "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "each reportItem requires label")
			return
		}
		if msg := validateLabel(ri.Label); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "label "+msg)
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
			Label:       ri.Label,
		}
	}

	if !s.requireStore(w) {
		return
	}

	reportID, budgetID, err := s.Store.CreateSessionReport(r.Context(), sessionID, lines)
	if err != nil {
		writeBudgetStoreError(w, "budget.post_session_report", err)
		return
	}

	// Webhook delivery is now handled via the outbox pattern - the event was
	// written atomically with the report creation and will be delivered by
	// the background worker.

	d, err := s.Store.GetSessionReport(r.Context(), sessionID, reportID)
	if err != nil {
		slog.Error("budget.post_session_report_get", "error", err)
		// Write succeeded — return minimal payload so client has reportId
		writeJSON(w, http.StatusCreated, map[string]string{
			"budgetId": budgetID, "sessionId": sessionID, "reportId": reportID,
		})
		return
	}
	out, err := sessionReportToResponse(d)
	if err != nil {
		slog.Error("budget.post_session_report_response", "error", err)
		// Write succeeded — return minimal payload so client has reportId
		writeJSON(w, http.StatusCreated, map[string]string{
			"budgetId": budgetID, "sessionId": sessionID, "reportId": reportID,
		})
		return
	}

	pc, _ := credits.ParseNonNegative(d.ProductCostTotal)
	bc, _ := credits.ParseNonNegative(d.BudgetCostTotal)
	ids := d.SessionCallRequestIDs
	logCallReqIDs := any(ids)
	cridN := len(ids)
	trunc := false
	if cridN > maxSessionCallRequestIDsInLog {
		logCallReqIDs = append([]string(nil), ids[:maxSessionCallRequestIDsInLog]...)
		trunc = true
	}
	slog.Info("budget.session.report.success",
		"budgetCostTotal", d.BudgetCostTotal,
		"budgetCostTotalUsd", bc.InexactFloat64(),
		"budgetId", d.BudgetID,
		"callRequestIdCount", cridN,
		"callRequestIdsTruncated", trunc,
		"productCostTotal", d.ProductCostTotal,
		"productCostTotalUsd", pc.InexactFloat64(),
		"productKey", d.ProductKey,
		"reportId", d.ReportID,
		"sessionCallRequestIds", logCallReqIDs,
		"sessionId", d.SessionID,
	)

	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) getReports(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !rejectUnknownQueryKeys(w, q, allowedGetReportsQueryKeys) {
		return
	}
	pk := strings.TrimSpace(q.Get("productKey"))
	if pk != "" {
		if msg := validateIdentifier(pk); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey "+msg)
			return
		}
	}
	budgetID := strings.TrimSpace(q.Get("budgetId"))
	if budgetID != "" {
		if _, err := uuid.Parse(budgetID); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "budgetId must be a valid UUID")
			return
		}
	}
	sessionID := strings.TrimSpace(q.Get("sessionId"))
	if sessionID != "" {
		if _, err := uuid.Parse(sessionID); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "sessionId must be a valid UUID")
			return
		}
	}
	sortName := strings.TrimSpace(q.Get("sort"))
	if sortName == "" {
		sortName = "createdAt"
	}
	if sortName != "createdAt" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "sort must be createdAt")
		return
	}
	// Store order is fixed to budget_session_reports.created_at (+ id). `sort` is reserved for future sort keys.
	order := strings.ToLower(strings.TrimSpace(q.Get("order")))
	if order == "" {
		order = "desc"
	}
	var sortDesc bool
	switch order {
	case "desc":
		sortDesc = true
	case "asc":
		sortDesc = false
	default:
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "order must be asc or desc")
		return
	}
	limit := store.ListSessionReportsDefaultLimit
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > store.ListSessionReportsMaxLimit {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "limit must be an integer from 1 to "+strconv.Itoa(store.ListSessionReportsMaxLimit))
			return
		}
		limit = n
	}
	offset := 0
	if raw := strings.TrimSpace(q.Get("offset")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "offset must be a non-negative integer")
			return
		}
		offset = n
	}
	if !s.requireStore(w) {
		return
	}
	rows, total, err := s.Store.ListSessionReports(r.Context(), store.ListSessionReportsFilter{
		ProductKey: pk,
		BudgetID:   budgetID,
		SessionID:  sessionID,
		Limit:      limit,
		Offset:     offset,
		SortDesc:   sortDesc,
	})
	if err != nil {
		writeInternalError(w, "reports.list", err)
		return
	}
	rep := make([]map[string]any, 0, len(rows))
	for i := range rows {
		rep = append(rep, sessionReportListRowToMap(rows[i]))
	}
	hasMore := offset+len(rep) < total
	writeJSON(w, http.StatusOK, map[string]any{
		"reports": rep,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
		"hasMore": hasMore,
	})
}

func parseRFC3339Time(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("empty time")
	}
	if len(s) > maxDateStringLen {
		return time.Time{}, fmt.Errorf("date string too long")
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func (s *Server) getReportsAggregate(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !rejectUnknownQueryKeys(w, q, allowedGetReportsAggregateQueryKeys) {
		return
	}
	pk := strings.TrimSpace(q.Get("productKey"))
	if pk != "" {
		if msg := validateIdentifier(pk); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "productKey "+msg)
			return
		}
	}
	label := strings.TrimSpace(q.Get("label"))
	if label != "" {
		if msg := validateLabel(label); msg != "" {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "label "+msg)
			return
		}
	}
	if pk == "" && label == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "at least one of productKey and label is required")
		return
	}
	budgetID := strings.TrimSpace(q.Get("budgetId"))
	if budgetID != "" {
		if _, err := uuid.Parse(budgetID); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "budgetId must be a valid UUID")
			return
		}
	}
	sessionID := strings.TrimSpace(q.Get("sessionId"))
	if sessionID != "" {
		if _, err := uuid.Parse(sessionID); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "sessionId must be a valid UUID")
			return
		}
	}
	fromRaw := strings.TrimSpace(q.Get("from"))
	toRaw := strings.TrimSpace(q.Get("to"))
	var fromTime, toTime time.Time
	switch {
	case fromRaw == "" && toRaw == "":
		toTime = time.Now().UTC()
		fromTime = toTime.AddDate(0, -1, 0)
	case fromRaw == "" || toRaw == "":
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "from and to must both be set, or both omitted (default last calendar month to now)")
		return
	default:
		var err error
		fromTime, err = parseRFC3339Time(fromRaw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "from must be RFC3339 or RFC3339Nano")
			return
		}
		toTime, err = parseRFC3339Time(toRaw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "to must be RFC3339 or RFC3339Nano")
			return
		}
		if !fromTime.Before(toTime) {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", "from must be before to")
			return
		}
	}
	if !s.requireStore(w) {
		return
	}
	res, err := s.Store.SumReportItemCostsByLabelAndProduct(r.Context(), store.ReportItemCostAggregateFilter{
		ProductKey: pk,
		Label:      label,
		From:       fromTime,
		To:         toTime,
		BudgetID:   budgetID,
		SessionID:  sessionID,
	})
	if err != nil {
		writeBudgetStoreError(w, "reports.aggregate", err)
		return
	}
	bc, err := sessionCostJSONNumber(res.BudgetCostTotal)
	if err != nil {
		writeInternalError(w, "reports.aggregate.budget_cost_total", err)
		return
	}
	pc, err := sessionCostJSONNumber(res.ProductCostTotal)
	if err != nil {
		writeInternalError(w, "reports.aggregate.product_cost_total", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"productKey":       pk,
		"label":            label,
		"from":             fromTime.UTC().Format(time.RFC3339Nano),
		"to":               toTime.UTC().Format(time.RFC3339Nano),
		"budgetCostTotal":  bc,
		"productCostTotal": pc,
		"reportLineCount":  res.LineCount,
	})
}

func (s *Server) getBudgetSessionReport(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(mux.Vars(r)["sessionId"])
	reportID := strings.TrimSpace(mux.Vars(r)["reportId"])
	if !requireUUIDParam(w, sessionID, "sessionId") || !requireUUIDParam(w, reportID, "reportId") {
		return
	}
	if !s.requireStore(w) {
		return
	}

	d, err := s.Store.GetSessionReport(r.Context(), sessionID, reportID)
	if err != nil {
		writeBudgetStoreError(w, "budget.get_session_report", err)
		return
	}

	out, err := sessionReportToResponse(d)
	if err != nil {
		writeInternalError(w, "budget.get_session_report_response", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func sessionReportListRowToMap(row store.SessionReportListRow) map[string]any {
	return map[string]any{
		"reportId":   row.ReportID,
		"sessionId":  row.SessionID,
		"budgetId":   row.BudgetID,
		"productKey": row.ProductKey,
		"createdAt":  row.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func sessionReportToResponse(d *store.SessionReportDetail) (map[string]any, error) {
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
			"label":        it.Label,
			"createdAt":    it.CreatedAt.UTC().Format(time.RFC3339Nano),
			"budgetItems":  budgetItems,
		}
	}

	sessCRIDs := d.SessionCallRequestIDs
	if sessCRIDs == nil {
		sessCRIDs = []string{}
	}

	return map[string]any{
		"productKey":            d.ProductKey,
		"budgetId":              d.BudgetID,
		"sessionId":             d.SessionID,
		"reportId":              d.ReportID,
		"budgetCostTotal":       bct,
		"productCostTotal":      pct,
		"creditsAvailable":      cav,
		"sessionCallRequestIds": sessCRIDs,
		"reportItems":           items,
	}, nil
}
