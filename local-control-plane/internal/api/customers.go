package api

import (
	"net/http"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

func (s *Server) GetCustomer(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"customerId": store.DefaultCustomerID,
		"exists":     true,
		"status":     "active",
	})
}

func (s *Server) GetCustomerTree(w http.ResponseWriter, r *http.Request) {
	apps, err := s.DB.ListAllApps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	appList := make([]map[string]any, 0, len(apps))
	for _, app := range apps {
		appList = append(appList, appToResponse(app))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"customerId": store.DefaultCustomerID,
		"subscriptions": []map[string]any{
			{
				"subscriptionId": store.DefaultSubscriptionID,
				"productId":      store.DefaultProductID,
				"ownerProduct":   "AiroAppBuilder",
				"status":         "active",
				"isTrial":        true,
				"systems": []map[string]any{
					{
						"systemId":   store.DefaultSystemID,
						"datacenter": store.DefaultDatacenter,
						"apps":       appList,
					},
				},
			},
		},
	})
}
