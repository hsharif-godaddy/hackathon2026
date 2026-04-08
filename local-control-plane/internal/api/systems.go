package api

import (
	"net/http"
	"time"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

var defaultTimestamp = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

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
