package hosting

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// defaultTimeout is the per-request timeout applied to the shared *http.Client
// when Config.Timeout is zero.
const defaultTimeout = 30 * time.Second

// errorBodyLimit bounds how many bytes of an error response we include in a
// returned error message. Prevents pathological multi-MB HTML error pages
// from bloating logs.
const errorBodyLimit = 512

// defaultWorkflowName is the workflow hosting fires after a successful
// secrets write. Triggers the alloc reload that delivers protected.json
// and per-variant artifacts to their task targets — the same name the
// BFF uses today (see app/src/lib/mgmt-airo/client.ts updateSecrets).
const defaultWorkflowName = "airo-app-secrets"

// HTTPError carries the response status and body preview for a non-2xx
// hosting response. Callers that need to classify retry-worthy errors
// (5xx, 408, 429) versus terminal ones (4xx) can errors.As this and
// inspect Status.
type HTTPError struct {
	OpName  string
	Status  int
	Preview string
}

// Error implements error.
func (e *HTTPError) Error() string {
	return fmt.Sprintf("hosting %s: HTTP %d: %s", e.OpName, e.Status, e.Preview)
}

// Config is what main.go passes to New. BaseURL and Auth are required; the
// rest have sensible defaults.
type Config struct {
	// BaseURL is the hosting API root, up to but not including "/hosting/v1".
	// Example prod (in-cluster): "http://api.mgmt".
	// Example local: "http://localhost:4100".
	// The "/hosting/v1/apps/:appId/secrets" suffix is appended by the client.
	BaseURL string

	// Auth attaches the Authorization header on each outbound request. Pass
	// NoopAuth{} for local-control-plane (AUTH_TYPE=none).
	Auth AuthProvider

	// Timeout is the per-request HTTP timeout. Defaults to 30s when zero.
	Timeout time.Duration

	// Transport overrides the HTTP transport. Primarily for tests; leave nil
	// in production to use http.DefaultTransport.
	Transport http.RoundTripper

	// WorkflowName overrides the name used to trigger the alloc reload.
	// Defaults to "airo-app-secrets" (matches today's BFF behavior). Set
	// only if a future hosting workflow rename forces it.
	WorkflowName string
}

// Client wraps *http.Client and targets hosting's bulk-secrets endpoint.
// All methods take an appId only — hosting's secrets endpoint does not
// require the (subscriptionId, systemId) tuple the legacy mhp-airo path
// did, so callers don't need to resolve it.
type Client struct {
	http         *http.Client
	baseURL      string
	auth         AuthProvider
	workflowName string
}

// New validates cfg and returns a Client ready for use. A zero Timeout is
// filled in with defaultTimeout. BaseURL trailing slashes are stripped so
// callers can pass either "http://api.mgmt" or "http://api.mgmt/" interchangeably.
func New(cfg Config) (*Client, error) {
	if cfg.Auth == nil {
		return nil, errors.New("hosting: Auth is required (use NoopAuth{} for local-control-plane)")
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		return nil, errors.New("hosting: BaseURL is required")
	}
	// url.Parse is too permissive — it accepts "localhost:4100" and other
	// scheme-less inputs without error, deferring failure to the first
	// outbound request. ParseRequestURI requires an absolute URL, and the
	// explicit scheme/host checks rule out the remaining edge cases
	// (file://, http://, etc.).
	u, err := url.ParseRequestURI(base)
	if err != nil {
		return nil, fmt.Errorf("hosting: BaseURL %q is not a valid URL: %w", base, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("hosting: BaseURL %q must use http or https scheme", base)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("hosting: BaseURL %q must include a host", base)
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	wf := strings.TrimSpace(cfg.WorkflowName)
	if wf == "" {
		wf = defaultWorkflowName
	}
	return &Client{
		http: &http.Client{
			Timeout:   timeout,
			Transport: cfg.Transport, // nil is fine; net/http falls back to DefaultTransport
		},
		baseURL:      base,
		auth:         cfg.Auth,
		workflowName: wf,
	}, nil
}

// SecretOpType is the kind of bulk-operation each SecretOp carries. The
// wire schema is a free string, but using a typed alias with constants
// here matches the codebase's other enum patterns (StripeClientKind,
// Environment) and prevents bare-string drift at call sites.
type SecretOpType string

const (
	// SecretOpUpsert creates or updates a secret. Value is required.
	SecretOpUpsert SecretOpType = "upsert"
	// SecretOpDelete removes a secret. Value is ignored.
	SecretOpDelete SecretOpType = "delete"
)

// SecretOp is one upsert-or-delete operation in a bulk secrets update. Matches
// the shape accepted by hosting's POST /hosting/v1/apps/:id/secrets (and
// local-control-plane's stub).
type SecretOp struct {
	Type   SecretOpType  `json:"type"`
	Secret SecretPayload `json:"secret"`
}

// SecretPayload is the inner shape of a SecretOp. Name is required on both
// upsert and delete; Value is required on upsert only (use json:omitempty so
// delete ops don't send an empty "value": "").
//
// Protected uses *bool so unset operations omit the field entirely (hosting's
// schema treats omitted as false). Senders that want to mark a key
// agent-only — delivered to protected.json and routed to the composition's
// protectedSecretsTargets — set Protected to a true pointer and leave
// Variants nil/empty.
type SecretPayload struct {
	Name          string   `json:"name"`
	Value         string   `json:"value,omitempty"`
	Variants      []string `json:"variants,omitempty"`
	SystemManaged bool     `json:"systemManaged"`
	Protected     *bool    `json:"protected,omitempty"`
}

// newRequestID generates a per-request correlation ID for the X-Request-ID
// audit header. crypto/rand-backed; the prefix matches the pattern used
// elsewhere in stripe-service for non-Stripe IDs.
func newRequestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand only fails on platforms without a working CSPRNG;
		// degrade to a static marker rather than panic in the request path.
		return "req_unrandom"
	}
	return "req_" + hex.EncodeToString(b[:])
}

// UpdateSecrets issues a single bulk POST /hosting/v1/apps/:appId/secrets
// with the given operations. Returns nil on full success; returns an error
// on non-2xx (typed *HTTPError) or when the 2xx response body contains
// "partialFailure":true (which hosting / local-control-plane return when
// some — but not all — ops fail).
//
// The workflowName carried in the request body triggers the post-write
// reload pipeline server-side; no separate /reload call is needed.
func (c *Client) UpdateSecrets(ctx context.Context, appID string, ops []SecretOp) error {
	body := struct {
		Operations   []SecretOp `json:"operations"`
		WorkflowName string     `json:"workflowName"`
	}{
		Operations:   ops,
		WorkflowName: c.workflowName,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("hosting update-secrets: marshal body: %w", err)
	}

	rawURL := c.secretsURL(appID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("hosting update-secrets: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// Audit headers consumed by hosting's structured logging + secrets-handler
	// CallerContext. Without these, writes show up in hosting's logs as
	// anonymous admin-token traffic. airo-go's proxy sets the same two when it
	// forwards customer secret writes (mhp-core/backends/airo-go/internal/
	// infrastructure/mgmt_client/hosting_client.go). NOT setting X-On-Behalf-Of:
	// hosting interprets that as customer-initiated proxy traffic and flips on
	// IsCustomerProxy=true; we want these treated as direct s2s writes.
	req.Header.Set("X-Source-Service", "stripe-service")
	req.Header.Set("X-Request-ID", newRequestID())
	if err := c.auth.ApplyAuth(ctx, req); err != nil {
		return fmt.Errorf("hosting update-secrets: attach auth: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("hosting update-secrets: http do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		rb, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit+1))
		preview := string(rb)
		if len(preview) > errorBodyLimit {
			preview = preview[:errorBodyLimit] + "…"
		}
		return &HTTPError{OpName: "update-secrets", Status: resp.StatusCode, Preview: preview}
	}

	// Decode the response to check for partial failure: hosting and the
	// local-control-plane stub return 200 with partialFailure:true when some
	// ops succeed but others fail. Treat this as an error so the caller
	// doesn't proceed with an incomplete set of secrets in the alloc env.
	//
	// Decode against the live response body rather than reading into a
	// bounded buffer first — truncating a real partial-failure body would
	// cause Unmarshal to fail silently and we'd treat the response as full
	// success. Overall body size is bounded by Client.Timeout.
	//
	// EOF (empty body) is the only "no body to inspect" signal we accept as
	// success. Any other decode failure means we can't tell whether the
	// response carried partialFailure:true — so we fail loud rather than
	// write the DDB row over an unverified push. The realistic causes
	// (intermediary returning HTML on 2xx, gzip without negotiation,
	// truncated stream, future schema reshape) are all worth a retry from
	// the agent rather than a silent commit.
	var result struct {
		PartialFailure bool `json:"partialFailure"`
		FailedCount    int  `json:"failedCount"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil && !errors.Is(err, io.EOF) {
		slog.Warn("stripe_service.hosting.update_secrets.body_decode_failed",
			"status", resp.Status, "error", err)
		return fmt.Errorf("hosting update-secrets: 2xx body undecodable, partial-failure status unknown: %w", err)
	}
	if result.PartialFailure {
		return fmt.Errorf("hosting update-secrets: partial failure: %d operation(s) failed", result.FailedCount)
	}
	return nil
}

// GetCustomerEmail fetches the authenticated customer's email from the PIE
// proxy endpoint hosted on the same mgmt-airo host as the secrets API. The
// call uses the same AuthProvider (cert-SSO or awsiam) already configured on
// the client. Returns ("", nil) for an empty customerId as a no-op guard (the
// primary caller — postSandboxes — pre-checks and returns 400 before reaching
// here, so this path is exercised only in tests that invoke the method directly).
//
// The PIE response shape is:
//
//	{ "customerId": "...", "shopperId": "...", "email": "...", ... }
//
// or wrapped under a "data" key — we handle both.
func (c *Client) GetCustomerEmail(ctx context.Context, customerID string) (string, error) {
	if strings.TrimSpace(customerID) == "" {
		return "", nil
	}

	pieURL := fmt.Sprintf("%s/api/pie/v1/proxy/customers/%s",
		c.baseURL, url.PathEscape(customerID))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pieURL, nil)
	if err != nil {
		return "", fmt.Errorf("hosting.GetCustomerEmail: build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if err := c.auth.ApplyAuth(ctx, req); err != nil {
		return "", fmt.Errorf("hosting.GetCustomerEmail: apply auth: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("hosting.GetCustomerEmail: request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Only error bodies get the 512-byte cap.
		rb, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit+1))
		preview := strings.TrimSpace(string(rb))
		if len(preview) > errorBodyLimit {
			preview = preview[:errorBodyLimit] + "…"
		}
		return "", fmt.Errorf("hosting.GetCustomerEmail: HTTP %d: %s", resp.StatusCode, preview)
	}

	// Success: stream the JSON directly — never cap the success body, since a
	// real PIE customer record with address/phone/name fields exceeds 512 bytes.
	// Response may be the customer object directly or wrapped under "data".
	var raw map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return "", fmt.Errorf("hosting.GetCustomerEmail: parse response: %w", err)
	}
	// Try unwrapped first, then wrapped under "data".
	if email, ok := raw["email"].(string); ok && email != "" {
		return email, nil
	}
	if data, ok := raw["data"].(map[string]interface{}); ok {
		if email, ok := data["email"].(string); ok {
			return email, nil
		}
	}
	return "", fmt.Errorf("hosting.GetCustomerEmail: email field absent or empty in response")
}

// secretsURL builds the POST /hosting/v1/apps/:appId/secrets URL.
func (c *Client) secretsURL(appID string) string {
	return fmt.Sprintf("%s/hosting/v1/apps/%s/secrets",
		c.baseURL, url.PathEscape(appID))
}

// probeProbeAppID is the placeholder appId used by ProbeReach. Hosting will
// 401 (auth path failed) or 404/400 (auth passed, app not found or validation
// reject) for any non-existent app — no side effects either way.
const probeProbeAppID = "_probe"

// probeSentinelSecretName is the secret name on the no-op delete op
// ProbeReach issues. The pairing of probeProbeAppID + probeSentinelSecretName
// guarantees no real state is modified even if mhp-core somehow processes the
// request: the app doesn't exist, and the secret name is namespaced to
// signal "diagnostic-only".
const probeSentinelSecretName = "_PROBE_DOES_NOT_EXIST"

// ProbeAuth verifies the configured AuthProvider can produce credentials
// for an outbound request. Calls ApplyAuth against a dummy request and
// returns the resulting Authorization scheme prefix ("sso-jwt", "Bearer",
// or "noop" when no header is set). The full token is intentionally NOT
// returned — only the scheme — so the probe response is safe to log or
// expose via /v1/_probe.
//
// No network I/O for NoopAuth or AwsIamAuth (the latter mints via the
// gd-auth-lib in-process cache); CertSSOAuth performs an outbound TLS
// handshake to SSO if its cache is cold.
func (c *Client) ProbeAuth(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL, nil)
	if err != nil {
		return "", fmt.Errorf("hosting probe-auth: build dummy request: %w", err)
	}
	if err := c.auth.ApplyAuth(ctx, req); err != nil {
		return "", err
	}
	authHeader := req.Header.Get("Authorization")
	if authHeader == "" {
		return "noop", nil
	}
	scheme, _, _ := strings.Cut(authHeader, " ")
	return scheme, nil
}

// ProbeReach exercises the full auth path against mhp-core's hosting
// service by issuing a side-effect-free POST /hosting/v1/apps/_probe/secrets
// with a single delete op for a sentinel secret name. Returns mhp-core's
// response status and a body preview. Distinguishes:
//
//   - 401 from Edge ("Missing authentication token") → frontdoor rejected
//   - 401 from middleware ("Certificate CN not authorized") → mhp-core
//     rejected the cert (CN typo, allowlist not deployed yet)
//   - 401 from middleware ("Authentication required") → secrets endpoint
//     not yet wired to JWTOrCert for cert callers (mhp-core PR not deployed)
//   - 404 ("App not found") → auth passed, _probe app doesn't exist
//   - 400 (schema reject) → auth passed, mhp-core didn't like the body shape
//   - 5xx → mhp-core internal issue
//
// Never returns 2xx — the _probe app does not exist by convention.
//
// POST (not GET) is deliberate: the frontdoor pioneermgmt route only allows
// awsiam on POST /api/hosting/v1/apps/, so a GET would fall through to the
// catch-all /api/ rule (idp,jomax,cert only) and false-negative for
// MGMT_API_AUTH=awsiam. POST routes through the same rule the production
// UpdateSecrets call does, exercising the actual auth path end-to-end.
//
// The body is a no-op: a single delete op for probeSentinelSecretName on
// probeProbeAppID. mhp-core never processes it (404 on app, or 400 on
// schema), but if validation somehow accepts it the delete targets a name
// that cannot exist on a non-existent app — zero side effects.
func (c *Client) ProbeReach(ctx context.Context) (status int, bodyPreview string, err error) {
	body := struct {
		Operations   []SecretOp `json:"operations"`
		WorkflowName string     `json:"workflowName"`
	}{
		Operations: []SecretOp{{
			Type: SecretOpDelete,
			Secret: SecretPayload{
				Name: probeSentinelSecretName,
			},
		}},
		WorkflowName: c.workflowName,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return 0, "", fmt.Errorf("hosting probe-reach: marshal body: %w", err)
	}

	rawURL := c.secretsURL(probeProbeAppID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(encoded))
	if err != nil {
		return 0, "", fmt.Errorf("hosting probe-reach: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Source-Service", "stripe-service")
	req.Header.Set("X-Request-ID", newRequestID())
	if err := c.auth.ApplyAuth(ctx, req); err != nil {
		return 0, "", fmt.Errorf("hosting probe-reach: attach auth: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, "", fmt.Errorf("hosting probe-reach: http do: %w", err)
	}
	defer resp.Body.Close()

	rb, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit+1))
	preview := string(rb)
	if len(preview) > errorBodyLimit {
		preview = preview[:errorBodyLimit] + "…"
	}
	return resp.StatusCode, preview, nil
}
