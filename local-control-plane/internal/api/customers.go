package api

import (
	"net/http"
	"sort"

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

	// Group apps by (subscriptionId, systemId)
	// subSysApps[subID][sysID] = []apps
	subSysApps := make(map[string]map[string][]map[string]any)
	for _, app := range apps {
		subID := app.SubscriptionID
		if subID == "" {
			subID = store.DefaultSubscriptionID
		}
		sysID := app.SystemID
		if sysID == "" {
			sysID = store.DefaultSystemID
		}

		if subSysApps[subID] == nil {
			subSysApps[subID] = make(map[string][]map[string]any)
		}
		subSysApps[subID][sysID] = append(subSysApps[subID][sysID], appToResponse(app))
	}

	// Build subscriptions array with deterministic ordering
	subIDs := make([]string, 0, len(subSysApps))
	for subID := range subSysApps {
		subIDs = append(subIDs, subID)
	}
	sort.Strings(subIDs)

	subscriptions := make([]map[string]any, 0, len(subSysApps))
	for _, subID := range subIDs {
		sysApps := subSysApps[subID]

		// Sort system IDs for deterministic ordering
		sysIDs := make([]string, 0, len(sysApps))
		for sysID := range sysApps {
			sysIDs = append(sysIDs, sysID)
		}
		sort.Strings(sysIDs)

		systems := make([]map[string]any, 0, len(sysApps))
		for _, sysID := range sysIDs {
			systems = append(systems, map[string]any{
				"systemId":   sysID,
				"datacenter": store.DefaultDatacenter,
				"apps":       sysApps[sysID],
			})
		}

		subscriptions = append(subscriptions, map[string]any{
			"subscriptionId": subID,
			"productId":      store.DefaultProductID,
			"ownerProduct":   "AiroAppBuilder",
			"status":         "active",
			"isTrial":        true,
			"systems":        systems,
		})
	}

	// If no apps exist, return empty subscription with default ID
	if len(subscriptions) == 0 {
		subscriptions = []map[string]any{
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
						"apps":       []map[string]any{},
					},
				},
			},
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"customerId":    store.DefaultCustomerID,
		"subscriptions": subscriptions,
	})
}
