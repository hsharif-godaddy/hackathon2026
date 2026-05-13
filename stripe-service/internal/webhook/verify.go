package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// defaultTolerance bounds how far the Stripe-Signature timestamp may drift
// from the verifier's wall clock. Stripe's recommended default; replay
// protection lives here.
const defaultTolerance = 5 * time.Minute

// Verifier checks Stripe-Signature headers against a shared secret.
// Construct via NewVerifier; the zero value is not usable.
type Verifier struct {
	secret    string
	tolerance time.Duration
	now       func() time.Time // injected for tests; defaults to time.Now
}

// NewVerifier returns a Verifier with the documented 5-minute replay
// tolerance and time.Now as the wall clock.
func NewVerifier(secret string) *Verifier {
	return &Verifier{
		secret:    secret,
		tolerance: defaultTolerance,
		now:       time.Now,
	}
}

// Verify returns nil if sigHeader is a valid Stripe-Signature for body
// under the verifier's secret and tolerance. Otherwise it returns a
// descriptive error suitable for logging at warn level (the messages
// don't include any secret material).
//
// The signed payload is "<timestamp>.<body>" (timestamp digits, a literal
// dot, then the raw request bytes — note the spec says the prefix is just
// the integer, not the literal "t=").
func (v *Verifier) Verify(sigHeader string, body []byte) error {
	if v.secret == "" {
		return errors.New("webhook: signing secret is empty")
	}
	if sigHeader == "" {
		return errors.New("webhook: missing Stripe-Signature header")
	}

	timestamp, sigs, err := parseStripeSignature(sigHeader)
	if err != nil {
		return err
	}
	if len(sigs) == 0 {
		return errors.New("webhook: no v1 signatures in header")
	}

	// Replay protection: reject if the timestamp is too far from now in
	// either direction. (Future-dated timestamps would otherwise let a
	// captured signature replay-attack indefinitely as the clock catches up.)
	signedAt := time.Unix(timestamp, 0)
	if delta := v.now().Sub(signedAt); delta > v.tolerance || delta < -v.tolerance {
		return fmt.Errorf("webhook: timestamp outside tolerance %v (delta %v)", v.tolerance, delta)
	}

	// Compute expected once. Stripe signs the literal byte string
	// "<timestamp_digits>.<raw_body>".
	expected := computeHMAC(v.secret, timestamp, body)

	// Constant-time compare against each provided v1 signature. Any match
	// is sufficient — Stripe sends multiple v1 entries during a key rotation
	// window so both the old and new secrets verify successfully.
	for _, sig := range sigs {
		provided, err := hex.DecodeString(sig)
		if err != nil {
			continue // malformed entry; try the next one
		}
		if hmac.Equal(expected, provided) {
			return nil
		}
	}
	return errors.New("webhook: no v1 signature matched")
}

// parseStripeSignature splits a Stripe-Signature header into its timestamp
// and the list of v1 hex signatures. Other scheme keys (v0, future versions)
// are ignored. Returns an error only if the timestamp is missing or
// unparseable; missing v1 entries are reported by the caller so it can
// distinguish that case in the error message.
func parseStripeSignature(header string) (timestamp int64, sigs []string, err error) {
	var hasT bool
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			t, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return 0, nil, fmt.Errorf("webhook: invalid timestamp %q: %w", v, err)
			}
			timestamp = t
			hasT = true
		case "v1":
			sigs = append(sigs, v)
		}
	}
	if !hasT {
		return 0, nil, errors.New("webhook: missing timestamp in header")
	}
	return timestamp, sigs, nil
}

// computeHMAC returns the raw HMAC-SHA256 bytes for the canonical signed
// payload Stripe prescribes: "<timestamp_digits>.<body>".
func computeHMAC(secret string, timestamp int64, body []byte) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	// Avoid an extra allocation by writing the timestamp + dot + body
	// directly to the MAC instead of building a temporary string.
	mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	mac.Write([]byte{'.'})
	mac.Write(body)
	return mac.Sum(nil)
}
