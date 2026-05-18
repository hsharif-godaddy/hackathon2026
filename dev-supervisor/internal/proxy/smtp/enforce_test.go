package smtp

import (
	"bytes"
	"errors"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

// rewriteIdentity is the shared Identity used by enforce_test.go cases:
// AppID abc1234567, attached acme.com (also primary), default airoapp.ai.
// Foreign-domain claims rewrite to "abc1234567@acme.com".
func rewriteIdentity() email.Identity {
	return email.Identity{
		AppID:           "abc1234567",
		AttachedDomains: []string{"acme.com"},
		PrimaryDomain:   "acme.com",
		DefaultDomain:   "airoapp.ai",
	}
}

// TestEnforceMessageFrom_NoRewriteFastPathReturnsByteEqualInput pins
// down that an allowed claim on an attached domain produces output
// byte-identical to the input — no header reshuffle, no whitespace
// normalization, nothing.
func TestEnforceMessageFrom_NoRewriteFastPathReturnsByteEqualInput(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from app-host\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"From: support@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"\r\n" +
			"Body.\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, in) {
		t.Errorf("no-rewrite path diverged from input:\n=== got ===\n%s\n=== want ===\n%s", got, in)
	}
}

// TestEnforceMessageFrom_PreservesHeaderOrderOnRewrite is the headline
// case: an 8-header message in a deliberate order with From in the
// middle, foreign-domain claim → only the From line changes, every
// other header stays in its exact position with its exact bytes.
//
// This test would fail nearly every run against a map-iteration
// implementation (Go intentionally randomizes map iteration).
func TestEnforceMessageFrom_PreservesHeaderOrderOnRewrite(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from app-host\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"Message-ID: <abc@example.com>\r\n" +
			"From: noreply@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"MIME-Version: 1.0\r\n" +
			"Content-Type: text/plain\r\n" +
			"X-Trace-ID: req-abc-123\r\n" +
			"\r\n" +
			"Body content.\r\n")

	want := []byte(
		"Received: from app-host\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"Message-ID: <abc@example.com>\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"MIME-Version: 1.0\r\n" +
			"Content-Type: text/plain\r\n" +
			"X-Trace-ID: req-abc-123\r\n" +
			"\r\n" +
			"Body content.\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf(
			"rewrite reshuffled headers or otherwise diverged from minimal-edit:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestEnforceMessageFrom_PreservesReceivedChainOrder pins down that
// repeated-key headers (Received chain is the canonical example) keep
// their relative order. Loop-detection at downstream MTAs depends on
// reverse-chronological-prepend ordering.
func TestEnforceMessageFrom_PreservesReceivedChainOrder(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from edge-3 (third hop)\r\n" +
			"Received: from edge-2 (second hop)\r\n" +
			"Received: from edge-1 (first hop)\r\n" +
			"From: noreply@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"Received: from edge-3 (third hop)\r\n" +
			"Received: from edge-2 (second hop)\r\n" +
			"Received: from edge-1 (first hop)\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf("Received chain order changed on rewrite:\n=== got ===\n%s\n=== want ===\n%s", got, want)
	}
}

// TestEnforceMessageFrom_PreservesFoldedNonFromHeader pins folded
// continuation lines on a non-From header. The rewrite must not
// unfold or otherwise touch the original bytes of that header.
func TestEnforceMessageFrom_PreservesFoldedNonFromHeader(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from edge-1 (host.example)\r\n" +
			" by relay.local\r\n" +
			" for <ken@perkins.io>;\r\n" +
			" Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"From: noreply@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"Received: from edge-1 (host.example)\r\n" +
			" by relay.local\r\n" +
			" for <ken@perkins.io>;\r\n" +
			" Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf("folded non-From header bytes changed:\n=== got ===\n%s\n=== want ===\n%s", got, want)
	}
}

// TestEnforceMessageFrom_ConsumesFoldedFromContinuation pins down that
// when the original From: header has folded continuation lines, the
// rewrite consumes ALL of those lines (not just the first). A naive
// regex-on-first-line implementation would leave the continuation in
// place — that's the bug we're guarding against.
func TestEnforceMessageFrom_ConsumesFoldedFromContinuation(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from x\r\n" +
			"From: \"CEO of Victim\"\r\n" +
			" <ceo@victim.com>\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"Received: from x\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf("folded From continuation leaked into output:\n=== got ===\n%s\n=== want ===\n%s", got, want)
	}
}

// TestEnforceMessageFrom_InsertsCanonicalFromWhenMissing pins the
// no-From-header case. We insert at the end of the header block (just
// before the empty line that separates headers and body). All other
// headers preserved in original order.
func TestEnforceMessageFrom_InsertsCanonicalFromWhenMissing(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from x\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"Received: from x\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf("missing-From insert produced unexpected bytes:\n=== got ===\n%s\n=== want ===\n%s", got, want)
	}
}

// TestEnforceMessageFrom_LeavesFromLikeBodyLineAlone pins down that a
// "From:" line in the BODY (e.g., a quoted message-in-message) is not
// promoted, rewritten, or otherwise touched. Once we cross the
// header/body separator, our enforcement has no further opinions.
func TestEnforceMessageFrom_LeavesFromLikeBodyLineAlone(t *testing.T) {
	t.Parallel()
	in := []byte(
		"From: noreply@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"Hi! See the original message:\r\n" +
			"From: someone@elsewhere.example\r\n" +
			"Date: Tue, 12 May 2026\r\n" +
			"Subject: Re: hello\r\n" +
			"\r\n" +
			"Original body.\r\n")

	want := []byte(
		"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"Hi! See the original message:\r\n" +
			"From: someone@elsewhere.example\r\n" +
			"Date: Tue, 12 May 2026\r\n" +
			"Subject: Re: hello\r\n" +
			"\r\n" +
			"Original body.\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf(
			"body From-like line was modified or header block reshaped:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestEnforceMessageFrom_LowercaseFromFieldNameCanonicalizedOnRewrite
// pins down the small editorial choice: when we DO rewrite the From,
// we emit the canonical "From:" field name regardless of how the
// customer wrote it. Other headers keep whatever casing they had —
// we only touch the line we have to.
func TestEnforceMessageFrom_LowercaseFromFieldNameCanonicalizedOnRewrite(t *testing.T) {
	t.Parallel()
	in := []byte(
		"received: from x\r\n" +
			"from: noreply@victim.com\r\n" +
			"to: ken@perkins.io\r\n" +
			"subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"received: from x\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"to: ken@perkins.io\r\n" +
			"subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf(
			"lowercase-from rewrite output differed from canonical-only-on-rewritten-line"+
				" expectation:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestPipeline_PreservesBytesOnPassthrough pins down the full
// enforceMessageFrom + injectHeaders pipeline on an allowed claim:
// every original header byte (order, casing, folded continuation
// lines) survives, and the X-* tracking headers appear in sorted
// order at the bottom of the header block, immediately before the
// blank-line separator.
//
// This is the test that's load-bearing for the byte-preservation
// claim made in enforceMessageFrom's doc-comment. Unit tests on
// enforceMessageFrom alone don't catch a regression in injectHeaders
// because Data() composes both stages on every send.
func TestPipeline_PreservesBytesOnPassthrough(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from app-host\r\n" +
			" by relay.local\r\n" +
			" for <ken@perkins.io>;\r\n" +
			" Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"Message-ID: <abc@example.com>\r\n" +
			"MIME-Version: 1.0\r\n" +
			"From: support@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"\r\n" +
			"Body content.\r\n")

	customHeaders := map[string]string{
		"X-SITE-UID":    "abc1234567",
		"X-PRODUCT":     "airo-app-builder",
		"X-ENVIRONMENT": "test",
		"X-DATACENTER":  "us-east",
	}

	enforced := enforceMessageFrom(in, rewriteIdentity())
	got := injectHeaders(enforced, customHeaders)

	want := []byte(
		"Received: from app-host\r\n" +
			" by relay.local\r\n" +
			" for <ken@perkins.io>;\r\n" +
			" Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"Date: Wed, 13 May 2026 19:24:49 -0700\r\n" +
			"Message-ID: <abc@example.com>\r\n" +
			"MIME-Version: 1.0\r\n" +
			"From: support@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"X-DATACENTER: us-east\r\n" +
			"X-ENVIRONMENT: test\r\n" +
			"X-PRODUCT: airo-app-builder\r\n" +
			"X-SITE-UID: abc1234567\r\n" +
			"\r\n" +
			"Body content.\r\n")

	if !bytes.Equal(got, want) {
		t.Errorf(
			"end-to-end pipeline diverged from byte-preservation contract:\n"+
				"=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestPipeline_PreservesBytesOnRewrite pins the same contract on the
// rewrite path: only the From: line changes; every other byte
// (including header-name casing on Message-ID/MIME-Version, which
// mail.ReadMessage would have canonicalized) survives, and X-*
// headers land at the bottom in sorted order.
func TestPipeline_PreservesBytesOnRewrite(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from app-host\r\n" +
			"Message-ID: <abc@example.com>\r\n" +
			"MIME-Version: 1.0\r\n" +
			"From: noreply@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"\r\n" +
			"body\r\n")

	customHeaders := map[string]string{
		"X-SITE-UID": "abc1234567",
	}

	enforced := enforceMessageFrom(in, rewriteIdentity())
	got := injectHeaders(enforced, customHeaders)

	want := []byte(
		"Received: from app-host\r\n" +
			"Message-ID: <abc@example.com>\r\n" +
			"MIME-Version: 1.0\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: Welcome\r\n" +
			"X-SITE-UID: abc1234567\r\n" +
			"\r\n" +
			"body\r\n")

	if !bytes.Equal(got, want) {
		t.Errorf(
			"rewrite-then-inject pipeline diverged:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestEnforceMessageFrom_MultipleFromAllowedThenForeignSmuggling
// pins the smuggling-bypass we close in decideMessageFrom: a
// customer with an attached domain crafts two From: headers, the
// first allowed, the second foreign. msg.Header.Get("From") returns
// only the first, so the naive "is the claim allowed?" check would
// say yes and let both lines through. We force the rewrite path
// whenever len(msg.Header["From"]) > 1 and rewriteFromHeader emits
// exactly one canonical From: line, dropping the second.
func TestEnforceMessageFrom_MultipleFromAllowedThenForeignSmuggling(t *testing.T) {
	t.Parallel()
	in := []byte(
		"Received: from x\r\n" +
			"From: support@acme.com\r\n" +
			"From: noreply@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"Received: from x\r\n" +
			"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: x\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf(
			"multi-From smuggling not collapsed:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestEnforceMessageFrom_MultipleFromForeignThenAllowed pins the
// symmetric case: foreign first, allowed second. Even though the
// allowed claim "deserves" passthrough, the presence of two From:
// fields trips the multiple_from policy and we collapse to canonical.
func TestEnforceMessageFrom_MultipleFromForeignThenAllowed(t *testing.T) {
	t.Parallel()
	in := []byte(
		"From: noreply@victim.com\r\n" +
			"From: support@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf(
			"multi-From (foreign-then-allowed) not collapsed:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestEnforceMessageFrom_MultipleFromWithFoldedContinuations pins
// that folded continuations on a duplicate From: are also dropped,
// not just the field line itself. A naive implementation that
// recognized only the first line of a duplicate From: would leave
// orphan continuation lines in the output.
func TestEnforceMessageFrom_MultipleFromWithFoldedContinuations(t *testing.T) {
	t.Parallel()
	in := []byte(
		"From: support@acme.com\r\n" +
			"From: \"Phisher\"\r\n" +
			" <attacker@victim.com>\r\n" +
			"To: ken@perkins.io\r\n" +
			"\r\n" +
			"body\r\n")

	want := []byte(
		"From: abc1234567@acme.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())
	if !bytes.Equal(got, want) {
		t.Errorf(
			"folded continuation on duplicate From leaked:\n=== got ===\n%s\n=== want ===\n%s",
			got, want,
		)
	}
}

// TestEnforceMessageFrom_ParseFailureForcesCanonicalRewrite pins
// the fail-closed contract on the parse-failure path. An attacker
// can deliberately construct bytes that mail.ReadMessage rejects
// but a downstream MTA accepts (e.g., a header line with no colon
// followed by a foreign From:). Forwarding those bytes verbatim
// would let the foreign From: through. We instead feed the bytes
// to rewriteFromHeader with the canonical sender, which finds and
// replaces the From: line via byte-level walking — no parser
// involved. The output carries a single platform-approved From:
// regardless of the malformed prefix.
func TestEnforceMessageFrom_ParseFailureForcesCanonicalRewrite(t *testing.T) {
	t.Parallel()
	// "This-has-no-colon" is a malformed header line that
	// mail.ReadMessage rejects. A naive proxy that forwarded the
	// original bytes on parse error would leak the foreign From:
	// to the upstream MTA.
	in := []byte(
		"This-has-no-colon\r\n" +
			"From: ceo@victim.com\r\n" +
			"To: ken@perkins.io\r\n" +
			"Subject: smuggle attempt\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())

	// The output must NOT contain the foreign From: claim.
	if bytes.Contains(got, []byte("From: ceo@victim.com")) {
		t.Errorf(
			"foreign From: leaked through parse-failure path:\n=== got ===\n%s",
			got,
		)
	}
	// The output MUST contain a canonical From:.
	if !bytes.Contains(got, []byte("From: abc1234567@acme.com")) {
		t.Errorf(
			"canonical From: missing from parse-failure output:\n=== got ===\n%s",
			got,
		)
	}
}

// TestEnforceMessageFrom_ParseFailureWithoutFromInsertsCanonical
// pins the parse-failure case where the malformed input has no
// From: header at all. rewriteFromHeader still inserts a canonical
// one at the end of the header block so the output has a
// platform-approved sender even when the input was unparseable
// AND lacked any sender claim.
func TestEnforceMessageFrom_ParseFailureWithoutFromInsertsCanonical(t *testing.T) {
	t.Parallel()
	in := []byte(
		"NoColonHere\r\n" +
			"To: ken@perkins.io\r\n" +
			"\r\n" +
			"body\r\n")

	got := enforceMessageFrom(in, rewriteIdentity())

	if !bytes.Contains(got, []byte("From: abc1234567@acme.com")) {
		t.Errorf(
			"canonical From: missing from parse-failure-no-from output:\n=== got ===\n%s",
			got,
		)
	}
}

// TestInjectHeaders_NoCustomHeadersReturnsByteEqualInput pins the
// no-op fast path: when no tracking headers are configured, the
// function must return the input bytes unchanged.
func TestInjectHeaders_NoCustomHeadersReturnsByteEqualInput(t *testing.T) {
	t.Parallel()
	in := []byte(
		"From: x@y.com\r\n" +
			"\r\n" +
			"body\r\n")

	got := injectHeaders(in, nil)
	if !bytes.Equal(got, in) {
		t.Errorf("nil-headers fast path diverged:\n=== got ===\n%s\n=== want ===\n%s", got, in)
	}

	got = injectHeaders(in, map[string]string{})
	if !bytes.Equal(got, in) {
		t.Errorf("empty-headers fast path diverged:\n=== got ===\n%s\n=== want ===\n%s", got, in)
	}
}

// TestProxyBackend_NewSessionFailsClosedOnIdentityError pins the
// fail-closed contract on NewSession when the identity loader
// errors. The earlier behavior — log the error, substitute
// email.Identity{}, continue — silently rewrote every customer's
// mail to "unknown@airoapp.ai" because Identity{}.IsAllowedSender
// returns false for all inputs and CanonicalSender's hard fallback
// resolves to "unknown@airoapp.ai". We instead return the error so
// go-smtp emits 421 and clients retry when alloc-config recovers.
func TestProxyBackend_NewSessionFailsClosedOnIdentityError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("simulated alloc-config read failure")
	backend := &proxyBackend{
		destinationAddr: "127.0.0.1:25",
		customHeaders:   map[string]string{},
		identityFn: func() (email.Identity, error) {
			return email.Identity{}, sentinel
		},
	}

	sess, err := backend.NewSession(nil)
	if err == nil {
		t.Fatal("expected error from NewSession when identityFn fails, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("error should wrap the underlying cause; got %v", err)
	}
	if sess != nil {
		t.Errorf("session should be nil on identity-load failure, got %v", sess)
	}
}

// TestProxyBackend_NewSessionSucceedsOnValidIdentity is the
// negative case: a healthy identityFn must produce a working
// session, otherwise the fail-closed change above breaks the happy
// path.
func TestProxyBackend_NewSessionSucceedsOnValidIdentity(t *testing.T) {
	t.Parallel()
	backend := &proxyBackend{
		destinationAddr: "127.0.0.1:25",
		customHeaders:   map[string]string{},
		identityFn: func() (email.Identity, error) {
			return email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"}, nil
		},
	}

	sess, err := backend.NewSession(nil)
	if err != nil {
		t.Fatalf("unexpected error from NewSession with valid identityFn: %v", err)
	}
	if sess == nil {
		t.Fatal("session should not be nil on success")
	}
}
