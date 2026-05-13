package jwedecrypt

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/kms/types"
)

// dummyIV / dummyTag are correctly-sized placeholder segments for
// JWE tests that exercise header validation but don't care about
// the cryptographic content. parseJWE checks IV / tag lengths up
// front, so smaller dummies (`aa`, `bb`) trip the size guard before
// the test can reach its assertion.
var (
	dummyIV  = base64.RawURLEncoding.EncodeToString(make([]byte, expectedIVLength))
	dummyTag = base64.RawURLEncoding.EncodeToString(make([]byte, expectedTagLength))
)

// Reference vector from RFC 7516 Appendix A.1 — the canonical
// test vector for RSA-OAEP + A256GCM. Using the published spec
// vector (rather than our own externally-generated one) means our
// implementation is verified against an external authority: any
// symmetric bug in encrypt/decrypt would have to be present in the
// RFC itself.
//
// Source: https://datatracker.ietf.org/doc/html/rfc7516#appendix-A.1
//
//   - Plaintext: "The true sign of intelligence is not knowledge but imagination."
//   - Header:    {"alg":"RSA-OAEP","enc":"A256GCM"}
//   - CEK:       32 bytes per A.1.2
//   - IV:        12 bytes per A.1.4
const (
	// rfcJWE is the full compact serialization from A.1.7 (concatenation
	// of segments 0 through 4 with dots).
	rfcJWE = "eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ" +
		".OKOawDo13gRp2ojaHV7LFpZcgV7T6DVZKTyKOMTYUmKoTCVJRgckCL9kiMT03JGeipsEdY3mx_etLbbWSrFr05kLzcSr4qKAq7YN7e9jwQRb23nfa6c9d-StnImGyFDbSv04uVuxIp5Zms1gNxKKK2Da14B8S4rzVRltdYwam_lDp5XnZAYpQdb76FdIKLaVmqgfwX7XWRxv2322i-vDxRfqNzo_tETKzpVLzfiwQyeyPGLBIO56YJ7eObdv0je81860ppamavo35UgoRdbYaBcoh9QcfylQr66oc6vFWXRcZ_ZT2LawVCWTIy3brGPi6UklfCpIMfIjf7iGdXKHzg" +
		".48V1_ALb6US04U3b" +
		".5eym8TW_c8SuK0ltJ3rpYIzOeDQz7TALvtu6UG9oMo4vpzs9tX_EFShS8iB7j6jiSdiwkIr3ajwQzaBtQD_A" +
		".XFBoMYUZodetZdvTiFvSkQ"

	rfcPlaintext = "The true sign of intelligence is not knowledge but imagination."
)

// rfcCEK is the 32-byte CEK from RFC 7516 §A.1.2. The fake KMS in
// decrypter_test.go returns this when asked to unwrap the JWE's
// segment 1; the pure-crypto tests in this file use it directly.
var rfcCEK = []byte{
	177, 161, 244, 128, 84, 143, 225, 115, 63, 180, 3, 255, 107, 154,
	212, 246, 138, 7, 110, 91, 112, 46, 34, 105, 47, 130, 203, 46, 122,
	234, 64, 252,
}

// --- parseJWE ---

func TestParseJWE_AcceptsRFCReferenceVector(t *testing.T) {
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}
	// kmsAlg is the projection of the RFC vector's "RSA-OAEP" header.
	if parsed.kmsAlg != types.EncryptionAlgorithmSpecRsaesOaepSha1 {
		t.Errorf("kmsAlg: want RsaesOaepSha1, got %q", parsed.kmsAlg)
	}
	// AAD per RFC 7516 §5.1.10: the raw base64url-encoded segment 0
	// bytes (NOT the decoded JSON).
	if string(parsed.aad) != strings.SplitN(rfcJWE, ".", 2)[0] {
		t.Errorf("aad: should equal segment 0 ASCII bytes, got %q", string(parsed.aad))
	}
	if got := len(parsed.iv); got != expectedIVLength {
		t.Errorf("iv: want %d bytes, got %d", expectedIVLength, got)
	}
	if got := len(parsed.authTag); got != expectedTagLength {
		t.Errorf("authTag: want %d bytes, got %d", expectedTagLength, got)
	}
}

func TestParseJWE_RejectsWrongSegmentCount(t *testing.T) {
	cases := []string{
		"",
		"x",
		"x.y",
		"x.y.z",
		"x.y.z.w",
		"a.b.c.d.e.f", // six segments
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			_, err := parseJWE(in)
			if !errors.Is(err, ErrMalformedJWE) {
				t.Errorf("input %q: want errors.Is(ErrMalformedJWE), got %v", in, err)
			}
		})
	}
}

func TestParseJWE_RejectsNonBase64URLSegment(t *testing.T) {
	// `+` and `/` are valid in standard base64 but not base64url. Stripe
	// uses base64url; we reject anything else.
	bad := "eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ.has+plus.iv.ct.tag"
	_, err := parseJWE(bad)
	if err == nil {
		t.Fatalf("want error for non-base64url segment, got nil")
	}
	if !strings.Contains(err.Error(), "wrapped CEK") {
		t.Errorf("error should mention which segment failed; got %q", err.Error())
	}
}

func TestParseJWE_RejectsNonJSONHeader(t *testing.T) {
	// "not json" base64url-encoded.
	notJSONHeader := base64.RawURLEncoding.EncodeToString([]byte("not json"))
	bad := notJSONHeader + ".aaaa.bbbb.cccc.dddd"
	_, err := parseJWE(bad)
	if !errors.Is(err, ErrInvalidHeader) {
		t.Errorf("want errors.Is(ErrInvalidHeader), got %v", err)
	}
}

func TestParseJWE_RejectsUnsupportedAlg(t *testing.T) {
	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"A128KW","enc":"A256GCM"}`))
	bad := hdr + ".aa.bb.cc.dd"
	_, err := parseJWE(bad)
	if !errors.Is(err, ErrUnsupportedAlg) {
		t.Errorf("want errors.Is(ErrUnsupportedAlg), got %v", err)
	}
}

func TestParseJWE_RejectsUnsupportedEnc(t *testing.T) {
	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RSA-OAEP","enc":"A128CBC-HS256"}`))
	bad := hdr + ".aa.bb.cc.dd"
	_, err := parseJWE(bad)
	if !errors.Is(err, ErrUnsupportedEnc) {
		t.Errorf("want errors.Is(ErrUnsupportedEnc), got %v", err)
	}
}

func TestParseJWE_AcceptsBothRSAOAEPVariants(t *testing.T) {
	cases := []struct {
		alg    string
		kmsAlg types.EncryptionAlgorithmSpec
	}{
		{algRSAOAEP, types.EncryptionAlgorithmSpecRsaesOaepSha1},
		{algRSAOAEPSHA256, types.EncryptionAlgorithmSpecRsaesOaepSha256},
	}
	for _, c := range cases {
		t.Run(c.alg, func(t *testing.T) {
			hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"` + c.alg + `","enc":"A256GCM"}`))
			s := hdr + ".aa." + dummyIV + ".cccc." + dummyTag
			parsed, err := parseJWE(s)
			if err != nil {
				t.Fatalf("parseJWE: %v", err)
			}
			if parsed.kmsAlg != c.kmsAlg {
				t.Errorf("kmsAlg: want %v, got %v", c.kmsAlg, parsed.kmsAlg)
			}
		})
	}
}

// --- decryptContent ---

func TestDecryptContent_AcceptsRFCReferenceVector(t *testing.T) {
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}

	plaintext, err := decryptContent(rfcCEK, parsed.iv, parsed.ciphertext, parsed.authTag, parsed.aad)
	if err != nil {
		t.Fatalf("decryptContent: %v", err)
	}
	if got := string(plaintext); got != rfcPlaintext {
		t.Errorf("plaintext mismatch:\n  want %q\n  got  %q", rfcPlaintext, got)
	}
}

func TestDecryptContent_RejectsTamperedCiphertext(t *testing.T) {
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}

	tampered := make([]byte, len(parsed.ciphertext))
	copy(tampered, parsed.ciphertext)
	tampered[0] ^= 0x01

	_, err = decryptContent(rfcCEK, parsed.iv, tampered, parsed.authTag, parsed.aad)
	if !errors.Is(err, ErrAuthenticationFailed) {
		t.Fatalf("want errors.Is(ErrAuthenticationFailed) on tampered ciphertext, got %v", err)
	}
}

func TestDecryptContent_RejectsTamperedAuthTag(t *testing.T) {
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}

	tampered := make([]byte, len(parsed.authTag))
	copy(tampered, parsed.authTag)
	tampered[0] ^= 0x01

	_, err = decryptContent(rfcCEK, parsed.iv, parsed.ciphertext, tampered, parsed.aad)
	if !errors.Is(err, ErrAuthenticationFailed) {
		t.Fatalf("want errors.Is(ErrAuthenticationFailed) on tampered tag, got %v", err)
	}
}

func TestDecryptContent_RejectsWrongAAD(t *testing.T) {
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}

	wrongAAD := []byte("not the real aad")
	_, err = decryptContent(rfcCEK, parsed.iv, parsed.ciphertext, parsed.authTag, wrongAAD)
	if !errors.Is(err, ErrAuthenticationFailed) {
		t.Fatalf("want errors.Is(ErrAuthenticationFailed) on wrong AAD, got %v", err)
	}
}

func TestDecryptContent_RejectsWrongCEK(t *testing.T) {
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}

	wrongCEK := make([]byte, expectedCEKLength)
	_, err = decryptContent(wrongCEK, parsed.iv, parsed.ciphertext, parsed.authTag, parsed.aad)
	if !errors.Is(err, ErrAuthenticationFailed) {
		t.Fatalf("want errors.Is(ErrAuthenticationFailed) on wrong CEK, got %v", err)
	}
}

func TestDecryptContent_RejectsAESInvalidKeySize(t *testing.T) {
	// 15 bytes is rejected outright by aes.NewCipher (no AES variant
	// uses 15-byte keys), so this exercises the aes.NewCipher branch
	// rather than the GCM auth branch. Note: this is decryptContent's
	// pre-cipher path; Decrypter.Decrypt enforces the 32-byte rule
	// upstream via ErrInvalidCEKSize.
	parsed, err := parseJWE(rfcJWE)
	if err != nil {
		t.Fatalf("parseJWE: %v", err)
	}

	tooShort := make([]byte, 15)
	_, err = decryptContent(tooShort, parsed.iv, parsed.ciphertext, parsed.authTag, parsed.aad)
	if err == nil {
		t.Fatalf("want aes.NewCipher error, got nil")
	}
	if !strings.Contains(err.Error(), "aes.NewCipher") {
		t.Errorf("error should mention aes.NewCipher; got %q", err.Error())
	}
	// Should NOT be ErrAuthenticationFailed — that's reserved for the
	// GCM auth path so callers can distinguish "tamper" from
	// "structurally broken".
}

// --- crit header rejection (PR #3736 review fix) ---

func TestParseJWE_RejectsCritHeader(t *testing.T) {
	// RFC 7515 §4.1.11 (inherited by 7516): recipient MUST reject any
	// JWE listing critical extensions it doesn't understand. We don't
	// understand any extensions, so any non-empty crit array must
	// reject — even if the named extension is one we'd otherwise
	// recognize.
	cases := []struct {
		name string
		crit []string
	}{
		{"single extension", []string{"b64"}},
		{"unknown extension", []string{"x5u"}},
		{"multiple", []string{"b64", "exp"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			critJSON, _ := json.Marshal(c.crit)
			hdr := base64.RawURLEncoding.EncodeToString([]byte(
				`{"alg":"RSA-OAEP","enc":"A256GCM","crit":` + string(critJSON) + `}`,
			))
			s := hdr + ".aa." + dummyIV + ".cccc." + dummyTag

			_, err := parseJWE(s)
			if !errors.Is(err, ErrUnsupportedHeader) {
				t.Errorf("want errors.Is(ErrUnsupportedHeader), got %v", err)
			}
		})
	}
}

func TestParseJWE_AcceptsHeaderWithUnknownNonCritFields(t *testing.T) {
	// JWE explicitly permits arbitrary extension parameters as long as
	// they aren't listed in `crit`. A header carrying e.g. `kid` or a
	// custom field should parse fine.
	hdr := base64.RawURLEncoding.EncodeToString([]byte(
		`{"alg":"RSA-OAEP","enc":"A256GCM","kid":"key-1","typ":"JOSE"}`,
	))
	s := hdr + ".aa." + dummyIV + ".cccc." + dummyTag
	if _, err := parseJWE(s); err != nil {
		t.Errorf("unknown non-crit fields should be accepted; got %v", err)
	}
}

// --- IV / tag size validation (PR #3736 review fix) ---

func TestParseJWE_RejectsWrongSizedIV(t *testing.T) {
	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RSA-OAEP","enc":"A256GCM"}`))
	shortIV := base64.RawURLEncoding.EncodeToString(make([]byte, 8)) // not 12
	s := hdr + ".aa." + shortIV + ".cccc." + dummyTag

	_, err := parseJWE(s)
	if !errors.Is(err, ErrInvalidIVSize) {
		t.Errorf("want errors.Is(ErrInvalidIVSize), got %v", err)
	}
}

func TestParseJWE_RejectsWrongSizedAuthTag(t *testing.T) {
	hdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RSA-OAEP","enc":"A256GCM"}`))
	shortTag := base64.RawURLEncoding.EncodeToString(make([]byte, 12)) // not 16
	s := hdr + ".aa." + dummyIV + ".cccc." + shortTag

	_, err := parseJWE(s)
	if !errors.Is(err, ErrInvalidAuthTagSize) {
		t.Errorf("want errors.Is(ErrInvalidAuthTagSize), got %v", err)
	}
}

// --- per-segment base64url-decode error coverage (PR #3736 review fix) ---

// TestParseJWE_RejectsNonBase64URLSegmentInEachPosition places a `+`
// (valid in standard base64 but rejected by RawURLEncoding) in each of
// the five segments and asserts the error mentions the right segment.
// Catches future copy-paste edits that mislabel segments without
// breaking any test.
func TestParseJWE_RejectsNonBase64URLSegmentInEachPosition(t *testing.T) {
	validHdr := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RSA-OAEP","enc":"A256GCM"}`))
	cases := []struct {
		name        string
		idx         int
		wantMessage string // substring expected in the error
	}{
		{"segment 0 (header)", 0, "protected header"},
		{"segment 1 (wrapped CEK)", 1, "wrapped CEK"},
		{"segment 2 (IV)", 2, "IV"},
		{"segment 3 (ciphertext)", 3, "ciphertext"},
		{"segment 4 (auth tag)", 4, "auth tag"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			segs := [5]string{validHdr, "aa", dummyIV, "cccc", dummyTag}
			segs[c.idx] = "has+plus"

			_, err := parseJWE(strings.Join(segs[:], "."))
			if err == nil {
				t.Fatalf("want decode error, got nil")
			}
			if !strings.Contains(err.Error(), c.wantMessage) {
				t.Errorf("error should mention %q; got %q", c.wantMessage, err.Error())
			}
		})
	}
}
