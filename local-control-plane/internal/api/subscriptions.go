package api

import (
	"net/http"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
	"github.com/gorilla/mux"
)

var defaultTimestamp = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

func subscriptionResponse() map[string]any {
	return map[string]any{
		"id":           store.DefaultSubscriptionID,
		"productId":    store.DefaultProductID,
		"ownerProduct": "AiroAppBuilder",
		"customerId":   store.DefaultCustomerID,
		"status":       "active",
		"isTrial":      true,
		"plan": "free",
		"createdAt": defaultTimestamp,
		"updatedAt": defaultTimestamp,
	}
}

func (s *Server) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []map[string]any{subscriptionResponse()})
}

func (s *Server) GetSubscription(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sub := subscriptionResponse()
	sub["id"] = vars["subId"]
	writeJSON(w, http.StatusOK, sub)
}

func (s *Server) GetEntitlement(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, subscriptionResponse())
}

func (s *Server) GetAppsForSubscription(w http.ResponseWriter, r *http.Request) {
	apps, err := s.DB.ListAllApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		result = append(result, appToResponse(app))
	}

	writeJSON(w, http.StatusOK, map[string]any{"apps": result})
}
