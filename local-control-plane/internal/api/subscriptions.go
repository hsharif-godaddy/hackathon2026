package api

import (
	"net/http"
	"sort"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gorilla/mux"
)

func subscriptionToResponse(sub *store.Subscription) map[string]any {
	return map[string]any{
		"id":            sub.ID,
		"productId":     sub.ProductID,
		"ownerProduct":  sub.OwnerProduct,
		"customerId":    sub.CustomerID,
		"status":        sub.Status,
		"reason":        sub.Reason,
		"isTrial":       sub.IsTrial,
		"hadAiroPlus":   sub.HadAiroPlus,
		"tokenBudgetId": sub.TokenBudgetID,
		"bmsBudgetId":   sub.BMSBudgetID,
		"plan":          sub.Plan,
		"createdAt":     sub.CreatedAt,
		"updatedAt":     sub.UpdatedAt,
	}
}

func (s *Server) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	custID := customerIDFromRequest(r)
	defaultSubID := store.SubscriptionIDForCustomer(custID)

	apps, err := s.DB.ListAppsByCustomer(custID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Collect unique subscription IDs from apps
	subIDs := make(map[string]bool)
	for _, app := range apps {
		subIDs[app.SubscriptionID] = true
	}

	// Always include default subscription for this customer
	subIDs[defaultSubID] = true

	// Sort for deterministic ordering
	sortedIDs := make([]string, 0, len(subIDs))
	for id := range subIDs {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	// Ensure all referenced subscriptions exist in DB and build response
	result := make([]map[string]any, 0, len(sortedIDs))
	for _, id := range sortedIDs {
		sub, err := s.DB.EnsureSubscription(id, custID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		result = append(result, subscriptionToResponse(sub))
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) GetSubscription(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	custID := customerIDFromRequest(r)
	sub, err := s.DB.EnsureSubscription(vars["subId"], custID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, subscriptionToResponse(sub))
}

func (s *Server) GetEntitlement(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	custID := customerIDFromRequest(r)
	sub, err := s.DB.EnsureSubscription(vars["subId"], custID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, subscriptionToResponse(sub))
}

func (s *Server) UpdateSubscriptionHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subID := vars["subId"]
	custID := customerIDFromRequest(r)

	// Ensure subscription exists before updating
	if _, err := s.DB.EnsureSubscription(subID, custID); err != nil {
		writeStoreError(w, err)
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

	custID := customerIDFromRequest(r)

	apps, err := s.DB.ListAppsByCustomer(custID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		if app.SubscriptionID == subId {
			result = append(result, appToResponse(app))
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"apps": result})
}
