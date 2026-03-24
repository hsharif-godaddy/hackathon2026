// internal/auth/middleware.go
package auth

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/budget-service/internal/config"
	apierrors "github.com/airo-ai-builder/budget-service/pkg/errors"
)

// Middleware provides authentication and authorization handlers.
type Middleware struct {
	config         *config.Config
	adminAllowlist map[string]bool
	testSigningKey []byte
}

// allowlistFile represents the JSON structure of the allowlist file.
type allowlistFile struct {
	Allowed []string `json:"allowed"`
}

// NewMiddleware creates authentication middleware with the given configuration.
func NewMiddleware(cfg *config.Config) (*Middleware, error) {
	m := &Middleware{
		config:         cfg,
		adminAllowlist: make(map[string]bool),
	}

	// Validate test mode requirements
	if cfg.AuthMode == "test" && cfg.AuthTestSigningKey == "" {
		return nil, fmt.Errorf("AUTH_TEST_SIGNING_KEY required in test mode")
	}
	m.testSigningKey = []byte(cfg.AuthTestSigningKey)

	// Load allowlist from env var
	if cfg.AuthAdminAllowlist != "" {
		for _, identity := range strings.Split(cfg.AuthAdminAllowlist, ",") {
			identity = strings.TrimSpace(identity)
			if identity != "" {
				m.adminAllowlist[identity] = true
			}
		}
	}

	// Load allowlist from file
	if cfg.AuthAdminAllowlistFile != "" {
		if err := m.loadAllowlistFile(cfg.AuthAdminAllowlistFile); err != nil {
			return nil, fmt.Errorf("failed to load allowlist file: %w", err)
		}
	}

	return m, nil
}

func (m *Middleware) loadAllowlistFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var f allowlistFile
	if err := json.Unmarshal(data, &f); err != nil {
		return err
	}

	for _, identity := range f.Allowed {
		identity = strings.TrimSpace(identity)
		if identity != "" {
			m.adminAllowlist[identity] = true
		}
	}

	return nil
}

// ExtractAuth parses the JWT and populates AuthContext on the request.
// Returns 401 if token is missing, malformed, or expired.
func (m *Middleware) ExtractAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenString := extractBearerToken(r)
		if tokenString == "" {
			writeAPIError(w, http.StatusUnauthorized, apierrors.ErrMissingAuthToken)
			return
		}

		authCtx, err := m.validateToken(tokenString)
		if err != nil {
			writeAPIError(w, http.StatusUnauthorized, apierrors.ErrInvalidToken.WithDetails(err.Error()))
			return
		}

		if time.Now().After(authCtx.Exp) {
			writeAPIError(w, http.StatusUnauthorized, apierrors.ErrTokenExpired)
			return
		}

		ctx := WithAuthContext(r.Context(), authCtx)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

func (m *Middleware) validateToken(tokenString string) (*AuthContext, error) {
	// Key function validates signing method and returns key
	keyFunc := func(token *jwt.Token) (any, error) {
		// Validate signing algorithm to prevent algorithm confusion attacks
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.testSigningKey, nil
	}

	// Try parsing as subscription token first
	subClaims := &SubscriptionClaims{}
	token, err := jwt.ParseWithClaims(tokenString, subClaims, keyFunc)

	if err == nil && token.Valid && subClaims.SubscriptionID != "" {
		return &AuthContext{
			SubscriptionID: subClaims.SubscriptionID,
			IsAdmin:        false,
			Exp:            subClaims.ExpiresAt.Time,
			Iat:            subClaims.IssuedAt.Time,
		}, nil
	}

	// Try parsing as admin token
	adminClaims := &AdminClaims{}
	token, err = jwt.ParseWithClaims(tokenString, adminClaims, keyFunc)

	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("token validation failed")
	}

	identity := adminClaims.CNAME
	if adminClaims.IAM != "" {
		identity = adminClaims.IAM
	}

	if identity == "" {
		return nil, fmt.Errorf("token missing identity (cname or iam)")
	}

	return &AuthContext{
		IsAdmin:       true,
		AdminIdentity: identity,
		Exp:           adminClaims.ExpiresAt.Time,
		Iat:           adminClaims.IssuedAt.Time,
	}, nil
}

func writeAPIError(w http.ResponseWriter, status int, err apierrors.APIError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if encErr := json.NewEncoder(w).Encode(err); encErr != nil {
		slog.Error("auth.writeError.failed", "error", encErr)
	}
}

// RequireSubscription validates that the JWT's subscriptionId matches
// the {subscriptionId} path parameter. Returns 403 on mismatch.
func (m *Middleware) RequireSubscription(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCtx := GetAuthContext(r)
		if authCtx == nil {
			writeAPIError(w, http.StatusInternalServerError, apierrors.ErrAuthContextMissing)
			return
		}

		vars := mux.Vars(r)
		urlSubscriptionID := vars["subscriptionId"]

		if authCtx.SubscriptionID != urlSubscriptionID {
			slog.Warn("auth.subscription.mismatch",
				"tokenSubscriptionId", authCtx.SubscriptionID,
				"urlSubscriptionId", urlSubscriptionID,
			)
			writeAPIError(w, http.StatusForbidden, apierrors.ErrSubscriptionMismatch)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RequireAdmin validates that the request came from an admin JWT
// and the identity is in the allowlist. Returns 403 if not allowed.
func (m *Middleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCtx := GetAuthContext(r)
		if authCtx == nil {
			writeAPIError(w, http.StatusInternalServerError, apierrors.ErrAuthContextMissing)
			return
		}

		if !authCtx.IsAdmin {
			writeAPIError(w, http.StatusForbidden, apierrors.ErrAdminRequired)
			return
		}

		if !m.adminAllowlist[authCtx.AdminIdentity] {
			slog.Warn("auth.admin.not_allowed",
				"identity", authCtx.AdminIdentity,
			)
			writeAPIError(w, http.StatusForbidden, apierrors.ErrAdminNotAllowed)
			return
		}

		next.ServeHTTP(w, r)
	})
}
