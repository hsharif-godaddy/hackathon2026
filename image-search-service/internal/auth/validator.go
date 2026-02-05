package auth

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// Validation errors.
var (
	ErrInvalidToken     = errors.New("auth: invalid token")
	ErrMissingKid       = errors.New("auth: missing kid in token header")
	ErrInvalidSignature = errors.New("auth: invalid token signature")
	ErrTokenExpired     = errors.New("auth: token expired")
	ErrInvalidIssuer    = errors.New("auth: invalid issuer")
	ErrInvalidAudience  = errors.New("auth: invalid audience")
)

// Validator validates JWT tokens using RS256 algorithm.
type Validator struct {
	jwks     *JWKSClient
	issuer   string
	audience string
}

// NewValidator creates a new JWT validator.
// jwksURL is the URL to fetch JWK keys from.
// issuer is the expected token issuer (iss claim).
// audience is the expected token audience (aud claim).
func NewValidator(jwksURL, issuer, audience string) *Validator {
	return &Validator{
		jwks:     NewJWKSClient(jwksURL),
		issuer:   issuer,
		audience: audience,
	}
}

// Validate validates a JWT token and returns its claims if valid.
// The token must be signed with RS256 and have valid issuer and audience claims.
func (v *Validator) Validate(tokenString string) (jwt.MapClaims, error) {
	// Parse unverified to get the kid from header
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	// Get kid from header
	kid, ok := token.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, ErrMissingKid
	}

	// Get public key from JWKS
	publicKey, err := v.jwks.GetKey(kid)
	if err != nil {
		if errors.Is(err, ErrKeyNotFound) {
			return nil, fmt.Errorf("%w: key not found for kid %s", ErrInvalidSignature, kid)
		}
		return nil, fmt.Errorf("failed to get signing key: %w", err)
	}

	// Parse and verify the token with RS256
	validatedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		// Verify algorithm is RS256
		if _, isRSA := t.Method.(*jwt.SigningMethodRSA); !isRSA {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return publicKey, nil
	}, jwt.WithValidMethods([]string{"RS256"}))

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, fmt.Errorf("%w: %w", ErrInvalidSignature, err)
	}

	if !validatedToken.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := validatedToken.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	// Verify issuer
	if iss, _ := claims["iss"].(string); iss != v.issuer {
		return nil, fmt.Errorf("%w: expected %s, got %s", ErrInvalidIssuer, v.issuer, iss)
	}

	// Verify audience
	if err := v.verifyAudience(claims); err != nil {
		return nil, err
	}

	return claims, nil
}

// verifyAudience checks if the token audience matches the expected audience.
// The aud claim can be a string or an array of strings.
func (v *Validator) verifyAudience(claims jwt.MapClaims) error {
	aud, ok := claims["aud"]
	if !ok {
		return fmt.Errorf("%w: missing audience claim", ErrInvalidAudience)
	}

	// aud can be a string or []interface{} (array of strings)
	switch audValue := aud.(type) {
	case string:
		if audValue != v.audience {
			return fmt.Errorf("%w: expected %s, got %s", ErrInvalidAudience, v.audience, audValue)
		}
	case []interface{}:
		found := false
		for _, a := range audValue {
			if audStr, ok := a.(string); ok && audStr == v.audience {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("%w: %s not in audience list", ErrInvalidAudience, v.audience)
		}
	default:
		return fmt.Errorf("%w: invalid audience format", ErrInvalidAudience)
	}

	return nil
}
