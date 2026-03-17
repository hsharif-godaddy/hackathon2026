package api

import (
	"net/http"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

func (s *Server) ListSystems(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []map[string]any{
		{
			"id":             store.DefaultSystemID,
			"systemId":       store.DefaultSystemID,
			"subscriptionId": store.DefaultSubscriptionID,
			"datacenter":     store.DefaultDatacenter,
			"ownerProduct":   "AiroAppBuilder",
			"productId":      store.DefaultProductID,
			"createdAt":      defaultTimestamp,
			"updatedAt":      defaultTimestamp,
		},
	})
}
