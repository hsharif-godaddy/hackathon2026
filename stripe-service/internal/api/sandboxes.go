package api

import "net/http"

// postSandboxes is the agent-facing endpoint that provisions a new Stripe
// claimable sandbox. Stub until the next PR implements the Stripe client,
// DynamoDB persistence, and mhp-airo alloc-secret write. The route exists
// now to pin the URL and exercise the auth middleware end-to-end.
func (s *Server) postSandboxes(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED",
		"sandbox provisioning lands in a follow-up PR")
}
