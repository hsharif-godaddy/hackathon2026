// internal/api/handlers.go
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/shopspring/decimal"

	"github.com/airo-ai-builder/budget-service/internal/logging"
	apierrors "github.com/airo-ai-builder/budget-service/pkg/errors"
	"github.com/airo-ai-builder/budget-service/pkg/models"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	response := models.HealthResponse{
		Status:   "healthy",
		Version:  s.version,
		Database: "connected",
		Uptime:   time.Since(s.startTime).String(),
	}

	status := http.StatusOK

	// Check database connection
	if err := s.db.Ping(); err != nil {
		response.Status = "unhealthy"
		response.Database = "disconnected"
		status = http.StatusServiceUnavailable
	}

	writeJSON(w, status, response)
}

func (s *Server) handleCreateBudget(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req models.CreateBudgetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	// Validate required fields
	if req.SubscriptionID == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingSubscriptionID)
		return
	}
	if len(req.SubscriptionID) > 21 {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidSubscriptionID)
		return
	}
	if req.Type != models.BudgetTypeInterval && req.Type != models.BudgetTypeBurndown {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidBudgetType)
		return
	}
	if req.Label == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingLabel)
		return
	}
	// Validate MaxCredits is a positive decimal string
	if req.MaxCredits == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidMaxCredits)
		return
	}
	maxCredits, err := decimal.NewFromString(req.MaxCredits)
	if err != nil || maxCredits.LessThanOrEqual(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidMaxCredits)
		return
	}
	// Validate ConversionFactor is a positive decimal string
	if req.ConversionFactor == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidConversionFactor)
		return
	}
	convFactor, err := decimal.NewFromString(req.ConversionFactor)
	if err != nil || convFactor.LessThanOrEqual(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidConversionFactor)
		return
	}
	if req.ExpirationOrResetDate.IsZero() {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingExpirationDate)
		return
	}
	if req.Type == models.BudgetTypeInterval && req.ResetInterval == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingResetInterval)
		return
	}

	budget, err := s.budgetRepo.Create(r.Context(), req)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeCreateFailed, "failed to create budget").WithDetails(err.Error()))
		return
	}

	if err := s.auditLog.Log(logging.AuditEntry{
		Event:          "budget.created",
		SubscriptionID: req.SubscriptionID,
		BudgetID:       budget.ID.String(),
		Metadata:       req,
	}); err != nil {
		slog.Error("audit.log.failed", "event", "budget.created", "error", err)
	}

	writeJSON(w, http.StatusCreated, budget)
}

func (s *Server) handleUpdateBudget(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	vars := mux.Vars(r)
	budgetID, err := uuid.Parse(vars["budgetId"])
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidBudgetID.WithDetails(err.Error()))
		return
	}

	var req models.UpdateBudgetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	budget, err := s.budgetRepo.Update(r.Context(), budgetID, req)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeUpdateFailed, "failed to update budget").WithDetails(err.Error()))
		return
	}
	if budget == nil {
		writeAPIError(w, http.StatusNotFound, apierrors.ErrBudgetNotFound)
		return
	}

	if err := s.auditLog.Log(logging.AuditEntry{
		Event:          "budget.updated",
		SubscriptionID: budget.SubscriptionID,
		BudgetID:       budget.ID.String(),
		Metadata:       req,
	}); err != nil {
		slog.Error("audit.log.failed", "event", "budget.updated", "error", err)
	}

	writeJSON(w, http.StatusOK, budget)
}

func (s *Server) handleDeleteBudget(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	budgetID, err := uuid.Parse(vars["budgetId"])
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidBudgetID.WithDetails(err.Error()))
		return
	}

	// Get budget for audit log before deletion (ignore error - deletion proceeds regardless)
	budget, _ := s.budgetRepo.GetByID(r.Context(), budgetID)

	if err := s.budgetRepo.Delete(r.Context(), budgetID); err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeDeleteFailed, "failed to delete budget").WithDetails(err.Error()))
		return
	}

	if budget != nil {
		if err := s.auditLog.Log(logging.AuditEntry{
			Event:          "budget.deleted",
			SubscriptionID: budget.SubscriptionID,
			BudgetID:       budgetID.String(),
		}); err != nil {
			slog.Error("audit.log.failed", "event", "budget.deleted", "error", err)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleGetBudgets(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subscriptionID := vars["subscriptionId"]

	budgets, err := s.budgetRepo.GetBySubscription(r.Context(), subscriptionID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeNoBudgetsFound, "failed to get budgets").WithDetails(err.Error()))
		return
	}

	// Calculate totals using decimal library
	totalMaxDec := decimal.Zero
	totalCurrentDec := decimal.Zero
	for _, b := range budgets {
		max, _ := decimal.NewFromString(b.MaxCredits)
		current, _ := decimal.NewFromString(b.CurrentValue)
		totalMaxDec = totalMaxDec.Add(max)
		totalCurrentDec = totalCurrentDec.Add(current)
	}

	response := models.BudgetsResponse{
		SubscriptionID:           subscriptionID,
		TotalMaxCredits:          totalMaxDec.StringFixed(6),
		TotalCurrentValue:        totalCurrentDec.StringFixed(6),
		TotalMaxCreditsRounded:   totalMaxDec.Round(0).IntPart(),
		TotalCurrentValueRounded: totalCurrentDec.Round(0).IntPart(),
		Budgets:                  budgets,
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleSpend(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	vars := mux.Vars(r)
	subscriptionID := vars["subscriptionId"]

	var req models.SpendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	// Validate amount is a non-negative decimal string
	if req.Amount == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.LessThan(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}

	response, err := s.spendEngine.Spend(r.Context(), subscriptionID, req.Amount, req.OperationType, req.OperationID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeSpendFailed, "failed to spend credits").WithDetails(err.Error()))
		return
	}

	for _, alloc := range response.Allocations {
		if err := s.auditLog.Log(logging.AuditEntry{
			Event:          "credits.spent",
			SubscriptionID: subscriptionID,
			BudgetID:       alloc.BudgetID,
			Amount:         alloc.Amount,
			BalanceAfter:   alloc.NewBalanceRounded,
			OperationType:  req.OperationType,
			OperationID:    req.OperationID,
		}); err != nil {
			slog.Error("audit.log.failed", "event", "credits.spent", "error", err)
		}
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleRelease(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	vars := mux.Vars(r)
	subscriptionID := vars["subscriptionId"]

	var req models.ReleaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	// Validate amount is a non-negative decimal string
	if req.Amount == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.LessThan(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}

	response, err := s.spendEngine.Release(r.Context(), subscriptionID, req.Amount, req.OperationType, req.OperationID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeReleaseFailed, "failed to release credits").WithDetails(err.Error()))
		return
	}

	for _, alloc := range response.Allocations {
		if err := s.auditLog.Log(logging.AuditEntry{
			Event:          "credits.released",
			SubscriptionID: subscriptionID,
			BudgetID:       alloc.BudgetID,
			Amount:         alloc.Amount,
			BalanceAfter:   alloc.NewBalanceRounded,
			OperationType:  req.OperationType,
			OperationID:    req.OperationID,
		}); err != nil {
			slog.Error("audit.log.failed", "event", "credits.released", "error", err)
		}
	}

	writeJSON(w, http.StatusOK, response)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("json.encode.failed", "error", err)
	}
}

func writeAPIError(w http.ResponseWriter, status int, err apierrors.APIError) {
	writeJSON(w, status, err)
}
