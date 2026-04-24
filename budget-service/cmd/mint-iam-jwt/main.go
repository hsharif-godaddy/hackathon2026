// Command mint-iam-jwt prints a GoDaddy AWS IAM-class JWT (raw string, no "Bearer " prefix)
// using gd-auth-lib's GenerateIamToken: IAM creds → SigV4 to SSO IAM token API → JWT.
//
//	curl -H "Authorization: Bearer $(go run ./cmd/mint-iam-jwt)" http://localhost:8080/api/v1/auth-check
//
// SSO_HOST must match budget-service (from the environment or `.env` in the cwd; same as cmd/server).
//
// Credentials: default AWS chain (e.g. AWS_PROFILE after aws sso login).
package main

import (
	"fmt"
	"os"
	"strings"

	gdauth "github.com/gdcorp-identity/gd-auth-lib/go/gd_auth_lib"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	ssoHost := os.Getenv("SSO_HOST")
	if ssoHost == "" {
		fmt.Fprintln(os.Stderr, "mint-iam-jwt: set SSO_HOST to the same value as budget-service (e.g. sso.dev-godaddy.com)")
		os.Exit(2)
	}

	// Create gd-auth client (same config as budget-service)
	gdClient, err := gdauth.New(
		gdauth.WithApp("budget-service"),
		gdauth.WithClient("budget-service.api.int.godaddy.com"),
		gdauth.WithPCPID("8606"),
		gdauth.WithTestMode(false),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-iam-jwt: gd-auth init: %v\n", err)
		os.Exit(1)
	}

	// NewAwsIamTokenClientConfig requires host without protocol
	ssoHostClean := strings.TrimPrefix(strings.TrimPrefix(ssoHost, "https://"), "http://")
	config := gdauth.NewAwsIamTokenClientConfig(ssoHostClean)

	token, err := gdClient.GenerateIamToken(config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-iam-jwt: token: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(token)
}
