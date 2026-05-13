package jwedecrypt

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// fakeKMS implements kmsDecrypter. Tests configure plaintext / err and
// inspect lastInput after the call to assert the algorithm spec and
// keyID propagation.
type fakeKMS struct {
	plaintext []byte
	err       error
	lastInput *kms.DecryptInput
	callCount atomic.Int32
	delay     time.Duration // optional sleep before returning, for ctx tests
}

func (f *fakeKMS) Decrypt(
	ctx context.Context,
	in *kms.DecryptInput,
	_ ...func(*kms.Options),
) (*kms.DecryptOutput, error) {
	f.callCount.Add(1)
	f.lastInput = in
	if f.delay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(f.delay):
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return &kms.DecryptOutput{Plaintext: f.plaintext}, nil
}

const testKeyID = "alias/dev-airo-stripe-managed-keys"

// --- New ---

func TestNew_RejectsNilKMS(t *testing.T) {
	if _, err := New(nil, testKeyID); err == nil {
		t.Errorf("want error for nil kms, got nil")
	}
}

func TestNew_RejectsEmptyKeyID(t *testing.T) {
	if _, err := New(&fakeKMS{}, ""); err == nil {
		t.Errorf("want error for empty keyID, got nil")
	}
}

// --- Decrypt: end-to-end ---

func TestDecrypt_HappyPathWithRFCVector(t *testing.T) {
	fk := &fakeKMS{plaintext: rfcCEK}
	d, err := New(fk, testKeyID)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	plaintext, err := d.Decrypt(context.Background(), rfcJWE)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if string(plaintext) != rfcPlaintext {
		t.Errorf("plaintext mismatch:\n  want %q\n  got  %q", rfcPlaintext, string(plaintext))
	}

	if got := fk.callCount.Load(); got != 1 {
		t.Errorf("kms call count: want 1, got %d", got)
	}
}

func TestDecrypt_PassesConfiguredKeyID(t *testing.T) {
	fk := &fakeKMS{plaintext: rfcCEK}
	d, _ := New(fk, testKeyID)

	if _, err := d.Decrypt(context.Background(), rfcJWE); err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if fk.lastInput == nil || fk.lastInput.KeyId == nil {
		t.Fatalf("KeyId not set on KMS DecryptInput")
	}
	if *fk.lastInput.KeyId != testKeyID {
		t.Errorf("KeyId: want %q, got %q", testKeyID, *fk.lastInput.KeyId)
	}
}

func TestDecrypt_PassesCorrectKMSAlgorithm(t *testing.T) {
	cases := []struct {
		jweAlg string
		want   types.EncryptionAlgorithmSpec
	}{
		{algRSAOAEP, types.EncryptionAlgorithmSpecRsaesOaepSha1},
		{algRSAOAEPSHA256, types.EncryptionAlgorithmSpecRsaesOaepSha256},
	}
	for _, c := range cases {
		t.Run(c.jweAlg, func(t *testing.T) {
			// Build a minimal JWE with the right header and properly
			// sized dummy segments (12-byte IV, 16-byte auth tag —
			// crypto/cipher panics on wrong-sized IV). AES-GCM will
			// fail auth on the bogus ciphertext, which is fine — the
			// only thing this test checks is the KMS call inputs.
			hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"` + c.jweAlg + `","enc":"A256GCM"}`))
			dummyIV := base64.RawURLEncoding.EncodeToString(make([]byte, 12))
			dummyTag := base64.RawURLEncoding.EncodeToString(make([]byte, 16))
			jwe := hdr + ".aaaa." + dummyIV + ".cccc." + dummyTag

			fk := &fakeKMS{plaintext: rfcCEK}
			d, _ := New(fk, testKeyID)

			// Don't care about the result; only the KMS invocation.
			_, _ = d.Decrypt(context.Background(), jwe)

			// Fail-closed assertion: if a future refactor short-circuits
			// before the KMS call (e.g. a parser change that rejects this
			// dummy JWE), the rest of the test would silently pass with
			// a nil lastInput; this catches that.
			if got := fk.callCount.Load(); got != 1 {
				t.Fatalf("KMS call count: want 1, got %d", got)
			}
			if fk.lastInput == nil {
				t.Fatalf("KMS not called")
			}
			if fk.lastInput.EncryptionAlgorithm != c.want {
				t.Errorf("EncryptionAlgorithm: want %v, got %v", c.want, fk.lastInput.EncryptionAlgorithm)
			}
		})
	}
}

func TestDecrypt_PropagatesKMSError(t *testing.T) {
	kmsErr := errors.New("AccessDeniedException: kms:Decrypt denied")
	fk := &fakeKMS{err: kmsErr}
	d, _ := New(fk, testKeyID)

	_, err := d.Decrypt(context.Background(), rfcJWE)
	if err == nil {
		t.Fatalf("want error from KMS, got nil")
	}
	if !errors.Is(err, kmsErr) {
		t.Errorf("error should wrap KMS error; got %v", err)
	}
	if !strings.Contains(err.Error(), "kms unwrap CEK") {
		t.Errorf("error should mention 'kms unwrap CEK'; got %q", err.Error())
	}
}

func TestDecrypt_RejectsWrongSizedCEKFromKMS(t *testing.T) {
	fk := &fakeKMS{plaintext: make([]byte, 16)} // AES-128 size — not what we want
	d, _ := New(fk, testKeyID)

	_, err := d.Decrypt(context.Background(), rfcJWE)
	if !errors.Is(err, ErrInvalidCEKSize) {
		t.Fatalf("want errors.Is(ErrInvalidCEKSize), got %v", err)
	}
}

func TestDecrypt_RejectsMalformedJWEBeforeKMSCall(t *testing.T) {
	// A malformed JWE should fail in parseJWE without ever reaching the
	// KMS surface — saves a wasted RPC and avoids leaking attempted
	// junk into the audit log.
	fk := &fakeKMS{plaintext: rfcCEK}
	d, _ := New(fk, testKeyID)

	_, err := d.Decrypt(context.Background(), "not.a.jwe")
	if !errors.Is(err, ErrMalformedJWE) {
		t.Errorf("want errors.Is(ErrMalformedJWE), got %v", err)
	}
	if got := fk.callCount.Load(); got != 0 {
		t.Errorf("KMS should not be called on malformed JWE; got %d calls", got)
	}
}

func TestDecrypt_RejectsUnsupportedAlgBeforeKMSCall(t *testing.T) {
	fk := &fakeKMS{plaintext: rfcCEK}
	d, _ := New(fk, testKeyID)

	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"A128KW","enc":"A256GCM"}`))
	jwe := hdr + ".aa.bb.cc.dd"

	_, err := d.Decrypt(context.Background(), jwe)
	if !errors.Is(err, ErrUnsupportedAlg) {
		t.Errorf("want errors.Is(ErrUnsupportedAlg), got %v", err)
	}
	if got := fk.callCount.Load(); got != 0 {
		t.Errorf("KMS should not be called for unsupported alg; got %d calls", got)
	}
}

func TestDecrypt_RespectsContextCancellation(t *testing.T) {
	fk := &fakeKMS{plaintext: rfcCEK, delay: 500 * time.Millisecond}
	d, _ := New(fk, testKeyID)

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	_, err := d.Decrypt(ctx, rfcJWE)
	if err == nil {
		t.Fatalf("want error on canceled context, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error should wrap context.DeadlineExceeded; got %q", err.Error())
	}
}
