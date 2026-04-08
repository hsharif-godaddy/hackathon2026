package api

import (
	"net/http"
	"sort"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gorilla/mux"
)

func subscriptionToResponse(sub *store.Subscription) map[string]any {
	resp := map[string]any{
		"id":            sub.ID,
		"productId":     sub.ProductID,
		"ownerProduct":  sub.OwnerProduct,
		"customerId":    sub.CustomerID,
		"status":        sub.Status,
		"isTrial":       sub.IsTrial,
		"hadAiroPlus":   sub.HadAiroPlus,
		"tokenBudgetId": sub.TokenBudgetID,
		"plan":          sub.Plan,
		"createdAt":     sub.CreatedAt,
		"updatedAt":     sub.UpdatedAt,
	}
	resp["reason"] = sub.Reason
	return resp
}

func (s *Server) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	apps, err := s.DB.ListAllApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Collect unique subscription IDs from apps
	subIDs := make(map[string]bool)
	for _, app := range apps {
		subID := app.SubscriptionID
		if subID == "" {
			subID = store.DefaultSubscriptionID
		}
		subIDs[subID] = true
	}

	// Always include default subscription
	subIDs[store.DefaultSubscriptionID] = true

	// Sort for deterministic ordering
	sortedIDs := make([]string, 0, len(subIDs))
	for id := range subIDs {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	// Ensure all referenced subscriptions exist in DB and build response
	result := make([]map[string]any, 0, len(sortedIDs))
	for _, id := range sortedIDs {
		sub, err := s.DB.EnsureSubscription(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		result = append(result, subscriptionToResponse(sub))
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) GetSubscription(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sub, err := s.DB.EnsureSubscription(vars["subId"])
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subscriptionToResponse(sub))
}

func (s *Server) GetEntitlement(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sub, err := s.DB.EnsureSubscription(vars["subId"])
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subscriptionToResponse(sub))
}

func (s *Server) UpdateSubscriptionHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subID := vars["subId"]

	// Ensure subscription exists before updating
	if _, err := s.DB.EnsureSubscription(subID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var fields map[string]any
	if err := readJSON(r, &fields); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	sub, err := s.DB.UpdateSubscription(subID, fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subscriptionToResponse(sub))
}

func (s *Server) GetAppsForSubscription(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subId := vars["subId"]

	apps, err := s.DB.ListAllApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		// Filter by subscription ID, treating empty as default
		appSubId := app.SubscriptionID
		if appSubId == "" {
			appSubId = store.DefaultSubscriptionID
		}
		if appSubId == subId {
			result = append(result, appToResponse(app))
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"apps": result})
}
