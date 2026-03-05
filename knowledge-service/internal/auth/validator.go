package auth

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken     = errors.New("auth: invalid token")
	ErrMissingKid       = errors.New("auth: missing kid in token header")
	ErrInvalidSignature = errors.New("auth: invalid token signature")
	ErrTokenExpired     = errors.New("auth: token expired")
	ErrInvalidIssuer    = errors.New("auth: invalid issuer")
	ErrInvalidAudience  = errors.New("auth: invalid audience")
)

// Validator validates JWT tokens issued by the airo-app service.
// It supports RSA signing methods (RS256, RS384, RS512) only because the
// airo-app JWKS endpoint serves exclusively RSA keys (kty == "RSA").
type Validator struct {
	jwks     *JWKSClient
	issuer   string
	audience string
}

func NewValidator(jwksURL, issuer, audience string) *Validator {
	return &Validator{
		jwks:     NewJWKSClient(jwksURL),
		issuer:   issuer,
		audience: audience,
	}
}

func (v *Validator) Validate(tokenString string) (jwt.MapClaims, error) {
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	kid, ok := token.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, ErrMissingKid
	}

	publicKey, err := v.jwks.GetKey(kid)
	if err != nil {
		if errors.Is(err, ErrKeyNotFound) {
			return nil, fmt.Errorf("%w: key not found for kid %s", ErrInvalidSignature, kid)
		}
		return nil, fmt.Errorf("failed to get signing key: %w", err)
	}

	validatedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		return publicKey, nil
	}, jwt.WithValidMethods([]string{"RS256", "RS384", "RS512"}))

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

	if iss, _ := claims["iss"].(string); iss != v.issuer {
		return nil, fmt.Errorf("%w: expected %s, got %s", ErrInvalidIssuer, v.issuer, iss)
	}

	if err := v.verifyAudience(claims); err != nil {
		return nil, err
	}

	return claims, nil
}

func (v *Validator) verifyAudience(claims jwt.MapClaims) error {
	aud, ok := claims["aud"]
	if !ok {
		return fmt.Errorf("%w: missing audience claim", ErrInvalidAudience)
	}

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
