package main

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

/**
 * JWTClaims represents the expected JWT claims structure
 * Supports both custom JWT tokens and GoDaddy SSO IDP tokens
 */
type JWTClaims struct {
	// Standard OIDC claims (optional - not present in GoDaddy SSO tokens)
	Issuer   string `json:"iss"` // Issuer (e.g., "airo-app")
	Audience string `json:"aud"` // Audience (e.g., "agents-service")
	Expiry   int64  `json:"exp"` // Expiration timestamp
	IssuedAt int64  `json:"iat"` // Issued at timestamp

	// Custom claims (airo-app JWT)
	SiteID string `json:"siteId"` // Site/App ID (custom JWT)

	// GoDaddy SSO IDP token claims
	ShopperID string `json:"shopperId"` // GoDaddy shopper ID
	CID       string `json:"cid"`       // GoDaddy customer ID
	Type      string `json:"typ"`       // Token type (e.g., "idp")

	jwt.RegisteredClaims
}

/**
 * JWTValidatorConfig defines configuration for JWT validation
 */
type JWTValidatorConfig struct {
	JWKSUrl       string // JWKS endpoint URL
	SkipTLSVerify bool   // Skip TLS certificate verification (local dev only)
}

/**
 * JWTValidator validates JWT tokens using JWKS public keys
 */
type JWTValidator struct {
	config     JWTValidatorConfig
	jwksClient *JWKSClient
}

/**
 * ValidationResult contains the result of JWT validation
 */
type ValidationResult struct {
	Valid  bool
	Reason string
	Claims *JWTClaims // Parsed claims if validation succeeded
}

/**
 * NewJWTValidator creates a new JWT validator
 *
 * @param config - Validator configuration
 * @returns Initialized JWTValidator
 */
func NewJWTValidator(config JWTValidatorConfig) *JWTValidator {
	return &JWTValidator{
		config:     config,
		jwksClient: NewJWKSClient(config.JWKSUrl, 5*time.Minute, config.SkipTLSVerify), // 5 minute cache
	}
}

/**
 * ValidateToken validates a JWT token and returns the validation result
 *
 * @param tokenString - JWT token to validate
 * @returns ValidationResult with details
 */
func (v *JWTValidator) ValidateToken(tokenString string) ValidationResult {
	if tokenString == "" {
		return ValidationResult{
			Valid:  false,
			Reason: "unauthorized",
		}
	}

	// Parse token and extract kid from header
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if token.Method.Alg() != "RS256" {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		// Extract kid from header
		kid, ok := token.Header["kid"].(string)
		if !ok {
			return nil, fmt.Errorf("kid not found in token header")
		}

		// Get public key from JWKS
		publicKey, err := v.jwksClient.GetPublicKey(kid)
		if err != nil {
			return nil, fmt.Errorf("failed to get public key: %w", err)
		}

		return publicKey, nil
	})

	if err != nil {
		reason := v.sanitizeErrorMessage()
		slog.Debug("jwt.validation.failed",
			"error", err.Error(),
			"reason", reason)
		return ValidationResult{
			Valid:  false,
			Reason: reason,
		}
	}

	// Check if token is valid
	if !token.Valid {
		return ValidationResult{
			Valid:  false,
			Reason: "unauthorized",
		}
	}

	// Extract claims
	claims, ok := token.Claims.(*JWTClaims)
	if !ok {
		return ValidationResult{
			Valid:  false,
			Reason: "unauthorized",
		}
	}

	// JWT is valid - signature verified and not expired
	// Note: We validate authentication (token is valid) here.
	// Authorization (site access) is checked by the middleware using the Claims.

	slog.Debug("jwt.validation.success",
		"tokenType", claims.Type,
		"siteID", claims.SiteID)

	return ValidationResult{
		Valid:  true,
		Claims: claims,
	}
}

/**
 * sanitizeErrorMessage returns a generic error message
 * Returns only "unauthorized" to prevent information disclosure and timing attacks
 * Detailed error information is logged server-side for debugging
 *
 * @returns Generic error message (always "unauthorized")
 */
func (v *JWTValidator) sanitizeErrorMessage() string {
	// Always return generic message to prevent:
	// 1. Information disclosure (revealing token state)
	// 2. Timing attacks (distinguishing between error types)
	// 3. Token enumeration attacks
	//
	// Detailed errors are logged via slog.Debug() for server-side debugging
	return "unauthorized"
}

/**
 * ExtractTokenFromHeader extracts JWT token from Authorization header
 *
 * @param authHeader - Authorization header value
 * @returns Token string or empty string if not found
 */
func ExtractTokenFromHeader(authHeader string) string {
	if authHeader == "" {
		return ""
	}

	// Check for Bearer scheme
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(authHeader, bearerPrefix) {
		return ""
	}

	// Extract token
	token := strings.TrimPrefix(authHeader, bearerPrefix)
	token = strings.TrimSpace(token)

	return token
}
