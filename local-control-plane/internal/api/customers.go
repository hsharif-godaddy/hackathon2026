package api

import (
	"net/http"
	"sort"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

func (s *Server) GetCustomer(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"customerId": customerIDFromRequest(r),
		"exists":     true,
		"status":     "active",
	})
}

func (s *Server) GetCustomerTree(w http.ResponseWriter, r *http.Request) {
	custID := customerIDFromRequest(r)
	subID := store.SubscriptionIDForCustomer(custID)

	apps, err := s.DB.ListAppsByCustomer(custID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Group apps by (subscriptionId, systemId)
	subSysApps := make(map[string]map[string][]map[string]any)
	for _, app := range apps {
		aSubID := app.SubscriptionID
		aSysID := app.SystemID

		if subSysApps[aSubID] == nil {
			subSysApps[aSubID] = make(map[string][]map[string]any)
		}
		subSysApps[aSubID][aSysID] = append(subSysApps[aSubID][aSysID], appToResponse(app))
	}

	// Build subscriptions array with deterministic ordering
	subIDs := make([]string, 0, len(subSysApps))
	for id := range subSysApps {
		subIDs = append(subIDs, id)
	}
	sort.Strings(subIDs)

	subscriptions := make([]map[string]any, 0, len(subSysApps))
	for _, id := range subIDs {
		sysApps := subSysApps[id]

		sysIDs := make([]string, 0, len(sysApps))
		for sID := range sysApps {
			sysIDs = append(sysIDs, sID)
		}
		sort.Strings(sysIDs)

		systems := make([]map[string]any, 0, len(sysApps))
		for _, sID := range sysIDs {
			systems = append(systems, map[string]any{
				"systemId":   sID,
				"datacenter": store.DefaultDatacenter,
				"apps":       sysApps[sID],
			})
		}

		sub, err := s.DB.EnsureSubscription(id, custID)
		if err != nil {
			writeStoreError(w, err)
			return
		}

		subEntry := map[string]any{
			"subscriptionId": id,
			"productId":      sub.ProductID,
			"ownerProduct":   sub.OwnerProduct,
			"status":         sub.Status,
			"isTrial":        sub.IsTrial,
			"plan":           sub.Plan,
			"reason":         sub.Reason,
			"systems":        systems,
		}
		subscriptions = append(subscriptions, subEntry)
	}

	// If no apps exist, return empty subscription with default ID
	if len(subscriptions) == 0 {
		sub, err := s.DB.EnsureSubscription(subID, custID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		subEntry := map[string]any{
			"subscriptionId": sub.ID,
			"productId":      sub.ProductID,
			"ownerProduct":   sub.OwnerProduct,
			"status":         sub.Status,
			"isTrial":        sub.IsTrial,
			"plan":           sub.Plan,
			"reason":         sub.Reason,
			"systems": []map[string]any{
				{
					"systemId":   store.SystemIDForCustomer(custID),
					"datacenter": store.DefaultDatacenter,
					"apps":       []map[string]any{},
				},
			},
		}
		subscriptions = []map[string]any{subEntry}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"customerId":    custID,
		"subscriptions": subscriptions,
	})
}
