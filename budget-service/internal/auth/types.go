// internal/auth/types.go
package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AuthMode determines how JWTs are validated.
type AuthMode string

const (
	AuthModeTest AuthMode = "test" // Local JWT signing with test key
	AuthModeJWT  AuthMode = "jwt"  // Production JWKS validation
)

// SubscriptionClaims for app/agent JWTs.
type SubscriptionClaims struct {
	jwt.RegisteredClaims
	SubscriptionID string `json:"subscriptionId"`
}

// AdminClaims for admin JWTs (GoDaddy format).
type AdminClaims struct {
	jwt.RegisteredClaims
	CNAME string `json:"cname,omitempty"`
	IAM   string `json:"iam,omitempty"`
}

// AuthContext holds extracted authentication info.
type AuthContext struct {
	SubscriptionID string
	IsAdmin        bool
	AdminIdentity  string
	Exp            time.Time
	Iat            time.Time
}
