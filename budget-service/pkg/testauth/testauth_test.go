// pkg/testauth/testauth_test.go
package testauth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSignTestToken(t *testing.T) {
	signingKey := "test-secret-key"
	subscriptionID := "sub-123"

	tokenString, err := SignTestToken(signingKey, subscriptionID, time.Hour)
	if err != nil {
		t.Fatalf("SignTestToken failed: %v", err)
	}

	token, err := jwt.ParseWithClaims(tokenString, &SubscriptionClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(signingKey), nil
	})
	if err != nil {
		t.Fatalf("Failed to parse token: %v", err)
	}

	claims, ok := token.Claims.(*SubscriptionClaims)
	if !ok {
		t.Fatal("Failed to get claims")
	}

	if claims.SubscriptionID != subscriptionID {
		t.Errorf("expected subscriptionId %s, got %s", subscriptionID, claims.SubscriptionID)
	}
}

func TestSignAdminTestToken_CNAME(t *testing.T) {
	signingKey := "test-secret-key"
	cname := "admin.example.com"

	tokenString, err := SignAdminTestToken(signingKey, cname, false, time.Hour)
	if err != nil {
		t.Fatalf("SignAdminTestToken failed: %v", err)
	}

	token, err := jwt.ParseWithClaims(tokenString, &AdminClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(signingKey), nil
	})
	if err != nil {
		t.Fatalf("Failed to parse token: %v", err)
	}

	claims, ok := token.Claims.(*AdminClaims)
	if !ok {
		t.Fatal("Failed to get claims")
	}

	if claims.CNAME != cname {
		t.Errorf("expected CNAME %s, got %s", cname, claims.CNAME)
	}
	if claims.IAM != "" {
		t.Errorf("expected empty IAM, got %s", claims.IAM)
	}
}

func TestSignAdminTestToken_IAM(t *testing.T) {
	signingKey := "test-secret-key"
	iam := "iam:service-account"

	tokenString, err := SignAdminTestToken(signingKey, iam, true, time.Hour)
	if err != nil {
		t.Fatalf("SignAdminTestToken failed: %v", err)
	}

	token, err := jwt.ParseWithClaims(tokenString, &AdminClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(signingKey), nil
	})
	if err != nil {
		t.Fatalf("Failed to parse token: %v", err)
	}

	claims, ok := token.Claims.(*AdminClaims)
	if !ok {
		t.Fatal("Failed to get claims")
	}

	if claims.IAM != iam {
		t.Errorf("expected IAM %s, got %s", iam, claims.IAM)
	}
	if claims.CNAME != "" {
		t.Errorf("expected empty CNAME, got %s", claims.CNAME)
	}
}
