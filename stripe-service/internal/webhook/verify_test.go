package webhook

import (
	"strings"
	"testing"
	"time"
)

// Reference test vector. Computed independently with:
//
//	SECRET="whsec_test_reference_secret_do_not_use_in_prod"
//	TS="1735689600"
//	BODY='{"id":"evt_reference_001","type":"v2.core.claimable_sandbox.claimed"}'
//	printf '%s' "${TS}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -hex
//
// Hard-coded so the verifier isn't merely symmetric with a Go-side signer
// that could share a bug.
const (
	refSecret    = "whsec_test_reference_secret_do_not_use_in_prod"
	refTimestamp = int64(1735689600)
	refBody      = `{"id":"evt_reference_001","type":"v2.core.claimable_sandbox.claimed"}`
	refSig       = "383d1c0bb7812ee33c0c4115ac7818ed295ab3c8f2bda4af7616de16f2a973e0"
)

// fixedNow returns a Verifier whose clock is `delta` past refTimestamp. Use
// `delta=0` for the in-tolerance case, larger absolute values to test replay
// rejection.
func fixedNow(delta time.Duration) *Verifier {
	v := NewVerifier(refSecret)
	v.now = func() time.Time { return time.Unix(refTimestamp, 0).Add(delta) }
	return v
}

func refHeader() string {
	return "t=1735689600,v1=" + refSig
}

func TestVerify_AcceptsKnownGoodSignature(t *testing.T) {
	v := fixedNow(0)
	if err := v.Verify(refHeader(), []byte(refBody)); err != nil {
		t.Fatalf("Verify on reference vector: want nil, got %v", err)
	}
}

func TestVerify_RejectsTamperedBody(t *testing.T) {
	v := fixedNow(0)
	tampered := []byte(refBody[:len(refBody)-1] + "X")
	err := v.Verify(refHeader(), tampered)
	if err == nil {
		t.Fatalf("Verify on tampered body: want error, got nil")
	}
	if !strings.Contains(err.Error(), "no v1 signature matched") {
		t.Errorf("error should be the no-match message; got %q", err)
	}
}

func TestVerify_RejectsWrongSecret(t *testing.T) {
	v := NewVerifier("whsec_some_other_secret")
	v.now = func() time.Time { return time.Unix(refTimestamp, 0) }
	if err := v.Verify(refHeader(), []byte(refBody)); err == nil {
		t.Fatalf("Verify with wrong secret: want error, got nil")
	}
}

func TestVerify_RejectsMissingTimestamp(t *testing.T) {
	v := fixedNow(0)
	if err := v.Verify("v1="+refSig, []byte(refBody)); err == nil {
		t.Fatalf("Verify with no timestamp: want error, got nil")
	} else if !strings.Contains(err.Error(), "timestamp") {
		t.Errorf("error should mention timestamp; got %q", err)
	}
}

func TestVerify_RejectsMissingV1(t *testing.T) {
	v := fixedNow(0)
	err := v.Verify("t=1735689600", []byte(refBody))
	if err == nil {
		t.Fatalf("Verify with no v1: want error, got nil")
	}
	if !strings.Contains(err.Error(), "no v1 signatures") {
		t.Errorf("error should mention no v1 signatures; got %q", err)
	}
}

func TestVerify_RejectsMalformedHeader(t *testing.T) {
	v := fixedNow(0)
	cases := []string{
		"",                     // empty
		"garbage",              // no = at all
		"t=not-a-number,v1=ab", // unparseable timestamp
	}
	for _, h := range cases {
		t.Run(h, func(t *testing.T) {
			if err := v.Verify(h, []byte(refBody)); err == nil {
				t.Errorf("Verify(%q): want error, got nil", h)
			}
		})
	}
}

func TestVerify_RejectsNonHexV1(t *testing.T) {
	v := fixedNow(0)
	// Non-hex v1 should be skipped silently and lead to "no v1 matched".
	header := "t=1735689600,v1=ZZZZnonhex"
	if err := v.Verify(header, []byte(refBody)); err == nil {
		t.Fatalf("Verify with non-hex v1: want error, got nil")
	}
}

func TestVerify_RejectsTimestampTooOld(t *testing.T) {
	// Clock is 6 minutes past the signed timestamp; tolerance is 5 minutes.
	v := fixedNow(6 * time.Minute)
	err := v.Verify(refHeader(), []byte(refBody))
	if err == nil {
		t.Fatalf("Verify on stale timestamp: want error, got nil")
	}
	if !strings.Contains(err.Error(), "tolerance") {
		t.Errorf("error should mention tolerance; got %q", err)
	}
}

func TestVerify_RejectsTimestampTooFarInFuture(t *testing.T) {
	// Clock is 6 minutes BEFORE the signed timestamp; tolerance is 5 minutes.
	v := fixedNow(-6 * time.Minute)
	err := v.Verify(refHeader(), []byte(refBody))
	if err == nil {
		t.Fatalf("Verify on future-dated timestamp: want error, got nil")
	}
	if !strings.Contains(err.Error(), "tolerance") {
		t.Errorf("error should mention tolerance; got %q", err)
	}
}

func TestVerify_AcceptsRotatedKey(t *testing.T) {
	// During a key rotation Stripe sends multiple v1 entries; the second is
	// the one signed by the secret we hold.
	v := fixedNow(0)
	header := "t=1735689600,v1=deadbeef" + strings.Repeat("00", 28) + ",v1=" + refSig
	if err := v.Verify(header, []byte(refBody)); err != nil {
		t.Fatalf("Verify with rotated key (good sig second): want nil, got %v", err)
	}
}

func TestVerify_RejectsEmptySecret(t *testing.T) {
	v := NewVerifier("")
	if err := v.Verify(refHeader(), []byte(refBody)); err == nil {
		t.Fatalf("Verify with empty secret: want error, got nil")
	}
}

func TestVerify_RejectsEmptyHeader(t *testing.T) {
	v := fixedNow(0)
	if err := v.Verify("", []byte(refBody)); err == nil {
		t.Fatalf("Verify with empty header: want error, got nil")
	}
}

func TestNewVerifier_DefaultsToFiveMinutes(t *testing.T) {
	v := NewVerifier("anything")
	if v.tolerance != 5*time.Minute {
		t.Errorf("default tolerance: want 5m, got %s", v.tolerance)
	}
	if v.now == nil {
		t.Errorf("default now: want non-nil, got nil")
	}
}

func TestVerify_AcceptsTrailingComma(t *testing.T) {
	// Defensive: tolerate harmless formatting variants. Stripe sends
	// well-formed headers, but a stray empty segment shouldn't crash us.
	v := fixedNow(0)
	header := "t=1735689600,v1=" + refSig + ",,"
	if err := v.Verify(header, []byte(refBody)); err != nil {
		t.Fatalf("Verify with trailing comma: want nil, got %v", err)
	}
}
