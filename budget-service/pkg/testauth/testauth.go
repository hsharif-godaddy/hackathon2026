// pkg/testauth/testauth.go
package testauth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// SubscriptionClaims for app/agent test JWTs.
type SubscriptionClaims struct {
	jwt.RegisteredClaims
	SubscriptionID string `json:"subscriptionId"`
}

// AdminClaims for admin test JWTs.
type AdminClaims struct {
	jwt.RegisteredClaims
	CNAME string `json:"cname,omitempty"`
	IAM   string `json:"iam,omitempty"`
}

// SignTestToken creates a signed subscription JWT for integration tests.
func SignTestToken(signingKey string, subscriptionID string, expiry time.Duration) (string, error) {
	claims := SubscriptionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		SubscriptionID: subscriptionID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(signingKey))
}

// SignAdminTestToken creates a signed admin JWT for integration tests.
func SignAdminTestToken(signingKey string, identity string, isIAM bool, expiry time.Duration) (string, error) {
	claims := AdminClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	if isIAM {
		claims.IAM = identity
	} else {
		claims.CNAME = identity
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(signingKey))
}
