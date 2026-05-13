package kmspubkey

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// rsaTestKey holds a deterministic-per-test-run RSA-2048 keypair plus
// its PKIX-DER-encoded public bytes. RSA-2048 generation takes
// 100-500ms, so we amortize the cost across the whole test binary
// using sync.OnceValues.
var rsaTestKey = sync.OnceValues(func() (*rsa.PublicKey, []byte) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("kmspubkey test: rsa.GenerateKey: " + err.Error())
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		panic("kmspubkey test: marshal pkix: " + err.Error())
	}
	return &priv.PublicKey, der
})

// fakeKMS implements keyFetcher. Configurable response and an
// atomic counter so concurrency tests can assert how many fetches
// actually reached the wire.
type fakeKMS struct {
	out       *kms.GetPublicKeyOutput
	err       error
	lastInput *kms.GetPublicKeyInput
	callCount atomic.Int32
	beforeFn  func(ctx context.Context) error // optional pre-call hook (used for ctx-cancel test)
}

func (f *fakeKMS) GetPublicKey(
	ctx context.Context,
	in *kms.GetPublicKeyInput,
	_ ...func(*kms.Options),
) (*kms.GetPublicKeyOutput, error) {
	f.callCount.Add(1)
	f.lastInput = in
	if f.beforeFn != nil {
		if err := f.beforeFn(ctx); err != nil {
			return nil, err
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// goodOutput builds a kms.GetPublicKeyOutput with all the fields
// fetchAndValidate inspects set to acceptable values. Tests then
// override individual fields to exercise specific failure paths.
func goodOutput(t *testing.T) *kms.GetPublicKeyOutput {
	t.Helper()
	_, der := rsaTestKey()
	return &kms.GetPublicKeyOutput{
		KeySpec:   types.KeySpecRsa2048,
		KeyUsage:  types.KeyUsageTypeEncryptDecrypt,
		PublicKey: der,
		EncryptionAlgorithms: []types.EncryptionAlgorithmSpec{
			types.EncryptionAlgorithmSpecRsaesOaepSha1,
			types.EncryptionAlgorithmSpecRsaesOaepSha256,
		},
	}
}

const testKeyID = "alias/dev-airo-stripe-managed-keys"

// --- Happy path ---

func TestFetchAndValidate_AcceptsValidRSA2048(t *testing.T) {
	wantPub, _ := rsaTestKey()
	fk := &fakeKMS{out: goodOutput(t)}

	pemStr, err := fetchAndValidate(context.Background(), fk, testKeyID)
	if err != nil {
		t.Fatalf("fetchAndValidate: %v", err)
	}

	if !strings.Contains(pemStr, "-----BEGIN PUBLIC KEY-----") {
		t.Errorf("PEM missing PKIX BEGIN header: %q", pemStr)
	}
	if !strings.Contains(pemStr, "-----END PUBLIC KEY-----") {
		t.Errorf("PEM missing PKIX END header: %q", pemStr)
	}

	// Round-trip: parse the returned PEM and assert the modulus matches
	// the test key. Catches subtle bugs in pem.Block construction.
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		t.Fatalf("pem.Decode: nil block")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		t.Fatalf("ParsePKIXPublicKey on returned PEM: %v", err)
	}
	gotPub, ok := parsed.(*rsa.PublicKey)
	if !ok {
		t.Fatalf("parsed type: want *rsa.PublicKey, got %T", parsed)
	}
	if gotPub.N.Cmp(wantPub.N) != 0 {
		t.Errorf("modulus mismatch in round-trip: PEM encoding lost the public key")
	}

	// KMS was passed the configured keyID.
	if fk.lastInput == nil || fk.lastInput.KeyId == nil || *fk.lastInput.KeyId != testKeyID {
		t.Errorf("KeyId not propagated to KMS DecryptInput")
	}
}

// --- KMS error pass-through ---

func TestFetchAndValidate_RejectsKMSError(t *testing.T) {
	kmsErr := errors.New("AccessDeniedException")
	fk := &fakeKMS{err: kmsErr}

	_, err := fetchAndValidate(context.Background(), fk, testKeyID)
	if err == nil {
		t.Fatalf("want error from KMS, got nil")
	}
	if !errors.Is(err, kmsErr) {
		t.Errorf("error should wrap KMS error; got %v", err)
	}
	if !strings.Contains(err.Error(), testKeyID) {
		t.Errorf("error should mention keyID; got %q", err.Error())
	}
}

// --- Validation failures (one test per sentinel) ---

func TestFetchAndValidate_RejectsWrongKeySpec(t *testing.T) {
	out := goodOutput(t)
	out.KeySpec = types.KeySpecRsa4096

	fk := &fakeKMS{out: out}
	_, err := fetchAndValidate(context.Background(), fk, testKeyID)
	if !errors.Is(err, ErrUnsupportedKeySpec) {
		t.Errorf("want errors.Is(ErrUnsupportedKeySpec), got %v", err)
	}
}

func TestFetchAndValidate_RejectsWrongKeyUsage(t *testing.T) {
	out := goodOutput(t)
	out.KeyUsage = types.KeyUsageTypeSignVerify

	fk := &fakeKMS{out: out}
	_, err := fetchAndValidate(context.Background(), fk, testKeyID)
	if !errors.Is(err, ErrUnsupportedKeyUsage) {
		t.Errorf("want errors.Is(ErrUnsupportedKeyUsage), got %v", err)
	}
}

func TestFetchAndValidate_RejectsMissingAlgorithms(t *testing.T) {
	cases := []struct {
		name string
		algs []types.EncryptionAlgorithmSpec
	}{
		{"empty", nil},
		{"only sha1", []types.EncryptionAlgorithmSpec{types.EncryptionAlgorithmSpecRsaesOaepSha1}},
		{"only sha256", []types.EncryptionAlgorithmSpec{types.EncryptionAlgorithmSpecRsaesOaepSha256}},
		{"unrelated", []types.EncryptionAlgorithmSpec{types.EncryptionAlgorithmSpecSymmetricDefault}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := goodOutput(t)
			out.EncryptionAlgorithms = c.algs

			fk := &fakeKMS{out: out}
			_, err := fetchAndValidate(context.Background(), fk, testKeyID)
			if !errors.Is(err, ErrMissingAlgorithms) {
				t.Errorf("want errors.Is(ErrMissingAlgorithms), got %v", err)
			}
		})
	}
}

func TestFetchAndValidate_RejectsEmptyPublicKey(t *testing.T) {
	out := goodOutput(t)
	out.PublicKey = nil

	fk := &fakeKMS{out: out}
	_, err := fetchAndValidate(context.Background(), fk, testKeyID)
	if !errors.Is(err, ErrEmptyPublicKey) {
		t.Errorf("want errors.Is(ErrEmptyPublicKey), got %v", err)
	}
}

func TestFetchAndValidate_RejectsMalformedDER(t *testing.T) {
	out := goodOutput(t)
	out.PublicKey = []byte{0xDE, 0xAD, 0xBE, 0xEF}

	fk := &fakeKMS{out: out}
	_, err := fetchAndValidate(context.Background(), fk, testKeyID)
	if err == nil {
		t.Fatalf("want parse error, got nil")
	}
	if !strings.Contains(err.Error(), "parse PKIX public key") {
		t.Errorf("error should mention PKIX parse failure; got %q", err.Error())
	}
}

func TestFetchAndValidate_RejectsNonRSAKey(t *testing.T) {
	// Generate an ECDSA P-256 keypair to stand in for "wrong algorithm
	// public key in PKIX format".
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ecdsa.GenerateKey: %v", err)
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("MarshalPKIXPublicKey: %v", err)
	}

	out := goodOutput(t)
	out.PublicKey = der
	// Note: we keep KeySpec=RSA_2048 to force the type check (rather
	// than the KeySpec check) to be the failure point.

	fk := &fakeKMS{out: out}
	_, err = fetchAndValidate(context.Background(), fk, testKeyID)
	if !errors.Is(err, ErrNotRSAPublicKey) {
		t.Errorf("want errors.Is(ErrNotRSAPublicKey), got %v", err)
	}
}

func TestFetchAndValidate_RejectsWrongBitLength(t *testing.T) {
	// Generate a 1024-bit RSA key; encode the public DER. KMS metadata
	// claims RSA_2048 (forced lie) so the KeySpec check passes and the
	// modulus length check fires.
	priv, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatalf("MarshalPKIXPublicKey: %v", err)
	}

	out := goodOutput(t)
	out.PublicKey = der

	fk := &fakeKMS{out: out}
	_, err = fetchAndValidate(context.Background(), fk, testKeyID)
	if !errors.Is(err, ErrWrongRSABitLength) {
		t.Errorf("want errors.Is(ErrWrongRSABitLength), got %v", err)
	}
}
