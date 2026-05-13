package kmspubkey

import (
	"context"
	"errors"
	"sync"

	"github.com/aws/aws-sdk-go-v2/service/kms"
)

// keyFetcher is the slice of *kms.Client this package needs.
// Production wiring (in the live-key webhook handler PR) passes the
// real *kms.Client; tests inject a fake returning canned DER bytes.
type keyFetcher interface {
	GetPublicKey(
		ctx context.Context,
		in *kms.GetPublicKeyInput,
		opts ...func(*kms.Options),
	) (*kms.GetPublicKeyOutput, error)
}

// Cache memoizes the result of fetchAndValidate. Lazy: the actual KMS
// call happens on the first PEM() invocation. Subsequent calls return
// the cached value (or cached error) without re-hitting KMS.
//
// Thread-safe. Concurrent first-callers serialize through the mutex
// and share a single fetch.
//
// Cache discipline: a successful fetch and a permanent failure (e.g.
// AccessDenied, wrong KeySpec) are sticky — the public half doesn't
// change for the lifetime of the CMK, so retrying buys nothing. But a
// context cancellation (Canceled / DeadlineExceeded) on the first
// call is NOT cached: that's a transient condition that says nothing
// about the CMK's actual state, and caching it forever would turn a
// boot-time network blip into a permanent poisoning of the cache for
// any caller pattern that doesn't crash on first error.
type Cache struct {
	kms   keyFetcher
	keyID string

	mu      sync.Mutex
	pem     string
	err     error
	fetched bool // true once we have cached a non-transient result
}

// New validates inputs and returns a Cache ready for use. New does
// NOT contact KMS — that happens lazily on the first PEM() call.
//
// Wiring code that wants fail-fast-on-boot semantics should call
// PEM(ctx) once at startup and exit on error; #3679's webhook secret
// handling is the precedent.
func New(kmsClient keyFetcher, keyID string) (*Cache, error) {
	if kmsClient == nil {
		return nil, errors.New("kmspubkey: kms client is required")
	}
	if keyID == "" {
		return nil, errors.New("kmspubkey: keyID is required")
	}
	return &Cache{kms: kmsClient, keyID: keyID}, nil
}

// PEM returns the validated, PKIX-PEM-encoded public key. On the
// first call, fetches from KMS and runs the full validation
// checklist. Subsequent calls return the cached value (or cached
// permanent error) without hitting KMS again.
//
// Context cancellation errors are returned to the caller but not
// cached — the next call retries. See Cache's doc comment for the
// rationale.
func (c *Cache) PEM(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.fetched {
		return c.pem, c.err
	}
	pem, err := fetchAndValidate(ctx, c.kms, c.keyID)
	if isTransientCtxError(err) {
		// Surface the error to this caller without caching it; a
		// future call with a healthy ctx will retry.
		return pem, err
	}
	c.pem = pem
	c.err = err
	c.fetched = true
	return pem, err
}

// isTransientCtxError reports whether err originates from the request
// context being cancelled or timing out. Such errors say nothing
// about the CMK's actual state and should not be cached.
func isTransientCtxError(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
