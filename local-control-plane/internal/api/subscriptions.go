package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gorilla/mux"
)

var defaultTimestamp = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

// subscriptionResponse returns common subscription fields.
// Callers must set "id" explicitly since subscriptions can have any ID.
func subscriptionResponse() map[string]any {
	return map[string]any{
		"productId":    store.DefaultProductID,
		"ownerProduct": "AiroAppBuilder",
		"customerId":   store.DefaultCustomerID,
		"status":       "active",
		"isTrial":      true,
		"plan":         "free",
		"createdAt":    defaultTimestamp,
		"updatedAt":    defaultTimestamp,
	}
}

func (s *Server) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	apps, err := s.DB.ListAllApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Collect unique subscription IDs
	subIDs := make(map[string]bool)
	for _, app := range apps {
		subID := app.SubscriptionID
		if subID == "" {
			subID = store.DefaultSubscriptionID
		}
		subIDs[subID] = true
	}

	// Always include default subscription if no apps exist
	if len(subIDs) == 0 {
		subIDs[store.DefaultSubscriptionID] = true
	}

	// Sort for deterministic ordering
	sortedIDs := make([]string, 0, len(subIDs))
	for id := range subIDs {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	// Build response
	result := make([]map[string]any, 0, len(sortedIDs))
	for _, id := range sortedIDs {
		sub := subscriptionResponse()
		sub["id"] = id
		result = append(result, sub)
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) GetSubscription(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sub := subscriptionResponse()
	sub["id"] = vars["subId"]
	writeJSON(w, http.StatusOK, sub)
}

func (s *Server) GetEntitlement(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sub := subscriptionResponse()
	sub["id"] = vars["subId"]
	writeJSON(w, http.StatusOK, sub)
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
