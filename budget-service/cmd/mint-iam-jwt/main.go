// Command mint-iam-jwt prints a GoDaddy AWS IAM-class JWT (raw string, no "Bearer " prefix)
// using auth-client's awsiam provider: IAM creds → SigV4 to SSO IAM token API → JWT.
//
//	curl -H "Authorization: Bearer $(go run ./cmd/mint-iam-jwt)" http://localhost:8080/api/v1/auth-check
//
// SSO_HOST must match budget-service (from the environment or `.env` in the cwd; same as cmd/server).
//
// Credentials: default AWS chain (e.g. AWS_PROFILE after aws sso login). If IAM_ROLE_ARN is set,
// the tool sts:AssumeRole's into that role first (GoCode S2S pattern). If unset, it uses the
// profile/session credentials directly (typical for AWSReservedSSO_* PowerUser-style SSO).
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/gdcorp-golang/auth-client/gdtoken"
	"github.com/gdcorp-golang/auth-client/gdtoken/provider/awsiam"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	roleARN := os.Getenv("IAM_ROLE_ARN")
	ssoHost := os.Getenv("SSO_HOST")
	if ssoHost == "" {
		fmt.Fprintln(os.Stderr, "mint-iam-jwt: set SSO_HOST to the same value as budget-service (e.g. sso.dev-godaddy.com)")
		os.Exit(2)
	}

	ctx := context.Background()
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-iam-jwt: aws config: %v\n", err)
		os.Exit(1)
	}

	var credProv aws.CredentialsProvider
	if roleARN != "" {
		stsClient := sts.NewFromConfig(awsCfg)
		credProv = stscreds.NewAssumeRoleProvider(stsClient, roleARN)
	} else {
		credProv = awsCfg.Credentials
	}

	iamProv := awsiam.NewProvider(
		awsiam.WithSSOHost(ssoHost),
		awsiam.WithGetCredentialsFunc(func(_ context.Context) (aws.CredentialsProvider, error) {
			return credProv, nil
		}),
	)

	tc := gdtoken.NewClient(gdtoken.WithProvider(iamProv))
	token, err := tc.Current(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mint-iam-jwt: token: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(token)
}
