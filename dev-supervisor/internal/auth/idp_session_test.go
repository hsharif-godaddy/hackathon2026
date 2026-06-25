package auth //nolint:testpackage // Tests access unexported constants and helpers.

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validTestKey(t *testing.T) string {
	t.Helper()
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)
	return hex.EncodeToString(key)
}

func TestNewSessionEncryptor(t *testing.T) {
	t.Run("valid 32-byte hex key", func(t *testing.T) {
		enc, err := NewSessionEncryptor(validTestKey(t))
		require.NoError(t, err)
		assert.NotNil(t, enc)
	})

	t.Run("invalid hex string", func(t *testing.T) {
		_, err := NewSessionEncryptor("not-valid-hex")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid session secret hex")
	})

	t.Run("wrong key length (16 bytes)", func(t *testing.T) {
		shortKey := hex.EncodeToString(make([]byte, 16))
		_, err := NewSessionEncryptor(shortKey)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "32 bytes")
	})

	t.Run("empty key", func(t *testing.T) {
		_, err := NewSessionEncryptor("")
		assert.Error(t, err)
	})
}

func TestSessionEncryptor_EncryptDecrypt(t *testing.T) {
	enc, err := NewSessionEncryptor(validTestKey(t))
	require.NoError(t, err)

	t.Run("round-trip IDPSession", func(t *testing.T) {
		original := &IDPSession{
			AccessToken: "access-token-123",
			ExpiresAt:   time.Now().Add(1 * time.Hour).Unix(),
		}

		encrypted, err := enc.Encrypt(original)
		require.NoError(t, err)
		assert.NotEmpty(t, encrypted)

		var decoded IDPSession
		err = enc.Decrypt(encrypted, &decoded)
		require.NoError(t, err)

		assert.Equal(t, original.AccessToken, decoded.AccessToken)
		assert.Equal(t, original.ExpiresAt, decoded.ExpiresAt)
	})

	t.Run("round-trip IDPPKCEState", func(t *testing.T) {
		original := &IDPPKCEState{
			State:        "state-abc",
			CodeVerifier: "verifier-xyz",
			OriginalURL:  "/dashboard",
			CreatedAt:    time.Now().Unix(),
		}

		encrypted, err := enc.Encrypt(original)
		require.NoError(t, err)

		var decoded IDPPKCEState
		err = enc.Decrypt(encrypted, &decoded)
		require.NoError(t, err)

		assert.Equal(t, original.State, decoded.State)
		assert.Equal(t, original.CodeVerifier, decoded.CodeVerifier)
		assert.Equal(t, original.OriginalURL, decoded.OriginalURL)
	})

	t.Run("different encryptions produce different ciphertext", func(t *testing.T) {
		data := &IDPSession{AccessToken: "token"}
		enc1, _ := enc.Encrypt(data)
		enc2, _ := enc.Encrypt(data)
		assert.NotEqual(t, enc1, enc2, "nonce should make each encryption unique")
	})
}

func TestSessionEncryptor_DecryptTampered(t *testing.T) {
	enc, err := NewSessionEncryptor(validTestKey(t))
	require.NoError(t, err)

	original := &IDPSession{AccessToken: "token"}
	encrypted, err := enc.Encrypt(original)
	require.NoError(t, err)

	t.Run("tampered ciphertext fails", func(t *testing.T) {
		// Flip a byte in the middle of the ciphertext
		tampered := []byte(encrypted)
		tampered[len(tampered)/2] ^= 0xff
		var decoded IDPSession
		err := enc.Decrypt(string(tampered), &decoded)
		assert.Error(t, err)
	})

	t.Run("wrong key fails", func(t *testing.T) {
		otherEnc, err := NewSessionEncryptor(validTestKey(t))
		require.NoError(t, err)

		var decoded IDPSession
		err = otherEnc.Decrypt(encrypted, &decoded)
		assert.Error(t, err)
	})

	t.Run("empty ciphertext fails", func(t *testing.T) {
		var decoded IDPSession
		err := enc.Decrypt("", &decoded)
		assert.Error(t, err)
	})

	t.Run("short ciphertext fails", func(t *testing.T) {
		var decoded IDPSession
		err := enc.Decrypt("aabbcc", &decoded)
		assert.Error(t, err)
	})
}

func TestSessionEncryptor_SetAndGetSessionCookie(t *testing.T) {
	enc, err := NewSessionEncryptor(validTestKey(t))
	require.NoError(t, err)

	session := &IDPSession{
		AccessToken: "access-token",
		ExpiresAt:   time.Now().Add(1 * time.Hour).Unix(),
	}

	t.Run("set and get session cookie", func(t *testing.T) {
		rec := httptest.NewRecorder()
		err := enc.SetSessionCookie(rec, session)
		require.NoError(t, err)

		cookies := rec.Result().Cookies()
		require.Len(t, cookies, 1)

		cookie := cookies[0]
		assert.Equal(t, idpSessionCookieName, cookie.Name)
		assert.True(t, cookie.HttpOnly)
		assert.True(t, cookie.Secure)
		assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
		assert.Positive(t, cookie.MaxAge)

		// Read it back
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(cookie)
		got := enc.GetSessionFromCookie(req)
		require.NotNil(t, got)
		assert.Equal(t, session.AccessToken, got.AccessToken)
	})

	t.Run("missing cookie returns nil", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		got := enc.GetSessionFromCookie(req)
		assert.Nil(t, got)
	})

	t.Run("expired session returns nil", func(t *testing.T) {
		expiredSession := &IDPSession{
			AccessToken: "old-token",
			ExpiresAt:   time.Now().Add(-1 * time.Hour).Unix(),
		}
		rec := httptest.NewRecorder()
		err := enc.SetSessionCookie(rec, expiredSession)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(rec.Result().Cookies()[0])
		got := enc.GetSessionFromCookie(req)
		assert.Nil(t, got)
	})
}

func TestSessionEncryptor_PKCECookie(t *testing.T) {
	enc, err := NewSessionEncryptor(validTestKey(t))
	require.NoError(t, err)

	pkce := &IDPPKCEState{
		State:        "state-123",
		CodeVerifier: "verifier-456",
		OriginalURL:  "/page",
		CreatedAt:    time.Now().Unix(),
	}

	t.Run("set and get PKCE cookie", func(t *testing.T) {
		rec := httptest.NewRecorder()
		err := enc.SetPKCECookie(rec, pkce)
		require.NoError(t, err)

		cookies := rec.Result().Cookies()
		require.Len(t, cookies, 1)

		cookie := cookies[0]
		assert.Equal(t, idpPKCECookieName, cookie.Name)
		assert.Equal(t, pkceMaxAgeSec, cookie.MaxAge)
		assert.True(t, cookie.HttpOnly)
		assert.True(t, cookie.Secure)

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(cookie)
		got := enc.GetPKCEFromCookie(req)
		require.NotNil(t, got)
		assert.Equal(t, pkce.State, got.State)
		assert.Equal(t, pkce.CodeVerifier, got.CodeVerifier)
		assert.Equal(t, pkce.OriginalURL, got.OriginalURL)
	})

	t.Run("expired PKCE returns nil", func(t *testing.T) {
		expiredPKCE := &IDPPKCEState{
			State:        "old-state",
			CodeVerifier: "old-verifier",
			OriginalURL:  "/old",
			CreatedAt:    time.Now().Add(-10 * time.Minute).Unix(),
		}
		rec := httptest.NewRecorder()
		err := enc.SetPKCECookie(rec, expiredPKCE)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(rec.Result().Cookies()[0])
		got := enc.GetPKCEFromCookie(req)
		assert.Nil(t, got)
	})
}

func TestClearCookies(t *testing.T) {
	t.Run("ClearPKCECookie sets MaxAge -1", func(t *testing.T) {
		rec := httptest.NewRecorder()
		ClearPKCECookie(rec)
		cookies := rec.Result().Cookies()
		require.Len(t, cookies, 1)
		assert.Equal(t, idpPKCECookieName, cookies[0].Name)
		assert.Equal(t, -1, cookies[0].MaxAge)
	})

	t.Run("ClearSessionCookie sets MaxAge -1", func(t *testing.T) {
		rec := httptest.NewRecorder()
		ClearSessionCookie(rec)
		cookies := rec.Result().Cookies()
		require.Len(t, cookies, 1)
		assert.Equal(t, idpSessionCookieName, cookies[0].Name)
		assert.Equal(t, -1, cookies[0].MaxAge)
	})
}
