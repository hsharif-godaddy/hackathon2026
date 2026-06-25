package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// IDPSession represents an authenticated user session stored in an encrypted cookie.
type IDPSession struct {
	AccessToken string `json:"access_token"`
	ExpiresAt   int64  `json:"expires_at"` // Unix timestamp
}

// IDPPKCEState stores PKCE parameters and request state during the OAuth flow.
// Encrypted into the airo_idp_pkce cookie before redirecting to the IDP.
type IDPPKCEState struct {
	State        string `json:"state"`
	CodeVerifier string `json:"code_verifier"`
	OriginalURL  string `json:"original_url"`
	CreatedAt    int64  `json:"created_at"`
}

const (
	idpSessionCookieName = "airo_idp_session"
	idpPKCECookieName    = "airo_idp_pkce"
	pkceMaxAgeSec        = 300 // 5 minutes for the OAuth flow
)

// SessionEncryptor handles AES-GCM encryption/decryption of session data.
type SessionEncryptor struct {
	gcm cipher.AEAD
}

// NewSessionEncryptor creates an encryptor from a hex-encoded 32-byte key.
func NewSessionEncryptor(hexKey string) (*SessionEncryptor, error) {
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("invalid session secret hex: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("session secret must be 32 bytes (64 hex chars), got %d bytes", len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	return &SessionEncryptor{gcm: gcm}, nil
}

// Encrypt serializes data to JSON and encrypts it with AES-GCM.
// Returns hex-encoded ciphertext (nonce prepended).
func (e *SessionEncryptor) Encrypt(data any) (string, error) {
	plaintext, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("failed to marshal session data: %w", err)
	}

	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	ciphertext := e.gcm.Seal(nonce, nonce, plaintext, nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt decodes hex ciphertext, decrypts with AES-GCM, and unmarshals into target.
func (e *SessionEncryptor) Decrypt(encoded string, target any) error {
	ciphertext, err := hex.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("failed to decode hex: %w", err)
	}

	nonceSize := e.gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return errors.New("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := e.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return fmt.Errorf("decryption failed: %w", err)
	}

	return json.Unmarshal(plaintext, target)
}

// SetSessionCookie encrypts the session and sets it as an HTTP cookie.
func (e *SessionEncryptor) SetSessionCookie(w http.ResponseWriter, session *IDPSession) error {
	encrypted, err := e.Encrypt(session)
	if err != nil {
		return err
	}

	maxAge := int(session.ExpiresAt - time.Now().Unix())
	if maxAge <= 0 {
		maxAge = 3600 // fallback 1 hour
	}

	http.SetCookie(w, &http.Cookie{
		Name:     idpSessionCookieName,
		Value:    encrypted,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// GetSessionFromCookie reads and decrypts the session cookie.
// Returns nil if cookie is missing, expired, or invalid.
func (e *SessionEncryptor) GetSessionFromCookie(r *http.Request) *IDPSession {
	cookie, err := r.Cookie(idpSessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}

	var session IDPSession
	if err := e.Decrypt(cookie.Value, &session); err != nil {
		slog.WarnContext(r.Context(), "idp.session.cookie_decrypt_failed",
			"cookie", idpSessionCookieName,
			"remoteAddr", r.RemoteAddr,
			"error", err.Error())
		return nil
	}

	// Check expiration
	if session.ExpiresAt > 0 && time.Now().Unix() > session.ExpiresAt {
		return nil
	}

	return &session
}

// SetPKCECookie encrypts PKCE state and sets it as a short-lived cookie.
func (e *SessionEncryptor) SetPKCECookie(w http.ResponseWriter, pkce *IDPPKCEState) error {
	encrypted, err := e.Encrypt(pkce)
	if err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     idpPKCECookieName,
		Value:    encrypted,
		Path:     "/",
		MaxAge:   pkceMaxAgeSec,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// GetPKCEFromCookie reads and decrypts the PKCE cookie.
// Returns nil if cookie is missing, expired, or invalid.
func (e *SessionEncryptor) GetPKCEFromCookie(r *http.Request) *IDPPKCEState {
	cookie, err := r.Cookie(idpPKCECookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}

	var pkce IDPPKCEState
	if err := e.Decrypt(cookie.Value, &pkce); err != nil {
		slog.WarnContext(r.Context(), "idp.pkce.cookie_decrypt_failed",
			"cookie", idpPKCECookieName,
			"remoteAddr", r.RemoteAddr,
			"error", err.Error())
		return nil
	}

	// Check TTL (5 minutes)
	if time.Now().Unix()-pkce.CreatedAt > pkceMaxAgeSec {
		return nil
	}

	return &pkce
}

// ClearPKCECookie deletes the PKCE cookie after the callback is processed.
func ClearPKCECookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     idpPKCECookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookie deletes the session cookie (logout).
func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     idpSessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}
