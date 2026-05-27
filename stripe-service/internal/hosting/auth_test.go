package hosting

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
)

// fakeMinter lets auth tests run without real AWS credentials or a loadable
// gd-auth-lib FFI binding.
type fakeMinter struct {
	token    string
	err      error
	calls    int
	lastConf *gdauth.AwsIamTokenClientConfig
}

func (f *fakeMinter) GenerateIamToken(cfg *gdauth.AwsIamTokenClientConfig) (string, error) {
	f.calls++
	f.lastConf = cfg
	return f.token, f.err
}

func TestNoopAuth_AttachesNothing(t *testing.T) {
	req := httptest.NewRequest("POST", "http://example/x", nil)
	if err := (NoopAuth{}).ApplyAuth(context.Background(), req); err != nil {
		t.Fatalf("NoopAuth.ApplyAuth: %v", err)
	}
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization: want empty, got %q", got)
	}
	if got := (NoopAuth{}).Name(); got != "noop" {
		t.Errorf("Name: want noop, got %q", got)
	}
}

func TestAwsIamAuth_SetsBearerHeaderFromMintedToken(t *testing.T) {
	mint := &fakeMinter{token: "mint-token-abc"}
	a := &AwsIamAuth{
		minter: mint,
		config: gdauth.NewAwsIamTokenClientConfig("sso.godaddy.com"),
	}

	req := httptest.NewRequest("POST", "http://example/x", nil)
	if err := a.ApplyAuth(context.Background(), req); err != nil {
		t.Fatalf("ApplyAuth: %v", err)
	}
	if got, want := req.Header.Get("Authorization"), "Bearer mint-token-abc"; got != want {
		t.Errorf("Authorization: want %q, got %q", want, got)
	}
	if mint.calls != 1 {
		t.Errorf("mint calls: want 1, got %d", mint.calls)
	}
}

func TestAwsIamAuth_PropagatesMintError(t *testing.T) {
	mint := &fakeMinter{err: errors.New("iam broken")}
	a := &AwsIamAuth{
		minter: mint,
		config: gdauth.NewAwsIamTokenClientConfig("sso.godaddy.com"),
	}

	req := httptest.NewRequest("POST", "http://example/x", nil)
	err := a.ApplyAuth(context.Background(), req)
	if err == nil {
		t.Fatalf("want error, got nil")
	}
	if !strings.Contains(err.Error(), "iam broken") {
		t.Errorf("error should wrap minter error; got %q", err.Error())
	}
	// Failure must not leak a partial header.
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization should be empty on mint error; got %q", got)
	}
}

func TestAwsIamAuth_Name(t *testing.T) {
	a := &AwsIamAuth{}
	if got := a.Name(); got != "aws-iam" {
		t.Errorf("Name: want aws-iam, got %q", got)
	}
}

func TestNewAwsIamAuth_ValidatesInputs(t *testing.T) {
	// Real *gdauth.GDAuth construction needs FFI + config; skip creating one.
	// We only check the constructor's null-guard branches.

	if _, err := NewAwsIamAuth(nil, "sso.godaddy.com"); err == nil {
		t.Errorf("want error for nil gd-auth client, got nil")
	}

	// Can't easily construct a real *gdauth.GDAuth here, but the empty-host
	// path guards against a nil-client happy path earlier — so instead
	// exercise the trim-and-reject logic by passing what would be a valid
	// client: an empty host after stripping should still fail loudly.
	// (Use a non-nil sentinel; the nil-check runs before the host check.)
	sentinel := &gdauth.GDAuth{}
	if _, err := NewAwsIamAuth(sentinel, ""); err == nil {
		t.Errorf("want error for empty SSO host, got nil")
	}
	if _, err := NewAwsIamAuth(sentinel, "https://"); err == nil {
		t.Errorf("want error for bare protocol, got nil")
	}
}

func TestNewAwsIamAuth_StripsProtocolFromHost(t *testing.T) {
	sentinel := &gdauth.GDAuth{}
	cases := []struct{ in, want string }{
		{"sso.godaddy.com", "sso.godaddy.com"},
		{"https://sso.godaddy.com", "sso.godaddy.com"},
		{"http://sso.dev-godaddy.com", "sso.dev-godaddy.com"},
		{" sso.godaddy.com ", "sso.godaddy.com"},
		{"  https://sso.dev-godaddy.com\t", "sso.dev-godaddy.com"},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			a, err := NewAwsIamAuth(sentinel, c.in)
			if err != nil {
				t.Fatalf("NewAwsIamAuth: %v", err)
			}
			if a.config.SsoHost != c.want {
				t.Errorf("SsoHost: want %q, got %q", c.want, a.config.SsoHost)
			}
		})
	}
}

func TestNewAwsIamAuth_RejectsWhitespaceOnlyHost(t *testing.T) {
	sentinel := &gdauth.GDAuth{}
	if _, err := NewAwsIamAuth(sentinel, "   \t"); err == nil {
		t.Errorf("want error for whitespace-only host, got nil")
	}
}

func TestAwsIamAuth_RejectsEmptyMintedToken(t *testing.T) {
	mint := &fakeMinter{token: ""}
	a := &AwsIamAuth{
		minter: mint,
		config: gdauth.NewAwsIamTokenClientConfig("sso.godaddy.com"),
	}

	req := httptest.NewRequest("POST", "http://example/x", nil)
	err := a.ApplyAuth(context.Background(), req)
	if err == nil {
		t.Fatalf("want error for empty token, got nil")
	}
	if !strings.Contains(err.Error(), "empty token") {
		t.Errorf("error should mention empty token; got %q", err.Error())
	}
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization should be empty when minter returns empty; got %q", got)
	}
}

// blockingMinter blocks GenerateIamToken until release is closed. Used to
// confirm ApplyAuth returns when ctx fires before the mint completes.
type blockingMinter struct {
	release <-chan struct{}
}

func (b *blockingMinter) GenerateIamToken(_ *gdauth.AwsIamTokenClientConfig) (string, error) {
	<-b.release
	return "late-token", nil
}

func TestAwsIamAuth_HonorsContextCancellation(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	a := &AwsIamAuth{
		minter: &blockingMinter{release: release},
		config: gdauth.NewAwsIamTokenClientConfig("sso.godaddy.com"),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	req := httptest.NewRequest("POST", "http://example/x", nil)
	start := time.Now()
	err := a.ApplyAuth(ctx, req)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatalf("want error when ctx fires before mint, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error should wrap context.DeadlineExceeded; got %q", err.Error())
	}
	if elapsed > 250*time.Millisecond {
		t.Errorf("ApplyAuth should return promptly on ctx cancellation; took %v", elapsed)
	}
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization should not be set on cancellation; got %q", got)
	}
}
