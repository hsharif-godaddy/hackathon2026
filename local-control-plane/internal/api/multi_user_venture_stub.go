package api

import "net/http"

// Multi-user venture/collaborator reconcile stubs.
//
// The local control plane has no FGA/collaborator surface (real multi-user needs
// `local:test`, which talks to deployed mgmt-airo + OpenFGA). These no-op stubs
// exist so the BFF's provisioning write (set-app-venture) and invitee-pull
// (reconcile-shared) succeed locally instead of 404ing — both are best-effort on
// the BFF side, so a 404 only adds log noise, but a clean 200 keeps local dev quiet.

// SetAppVenture stubs POST /subscriptions/{subId}/apps/{appId}/venture.
func (s *Server) SetAppVenture(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ReconcileShared stubs POST /customers/me/reconcile-shared — no-op, zero counts.
func (s *Server) ReconcileShared(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]int{"granted": 0, "skipped": 0})
}
