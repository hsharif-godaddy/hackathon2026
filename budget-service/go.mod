module github.com/gdcorp-partners/airo-app-builder/budget-service

go 1.25.5

require (
	github.com/aws/aws-sdk-go-v2 v1.41.5
	github.com/aws/aws-sdk-go-v2/config v1.32.13
	github.com/aws/aws-sdk-go-v2/credentials v1.19.13
	github.com/aws/aws-sdk-go-v2/service/sts v1.41.10
	github.com/gdcorp-golang/auth-client v1.0.0
	github.com/gdcorp-identity/authz-lib-go v0.2.0
	github.com/gdcorp-partners/airo-app-builder/packages/go-auth v0.0.0
	github.com/google/uuid v1.6.0
	github.com/gorilla/mux v1.8.1
	github.com/joho/godotenv v1.5.1
	github.com/lib/pq v1.12.1
	github.com/shopspring/decimal v1.4.0
)

require (
	github.com/aws/aws-sdk-go v1.44.135 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.18.21 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.21 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.21 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.8.6 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.7 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.13.21 // indirect
	github.com/aws/aws-sdk-go-v2/service/secretsmanager v1.41.1 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.0.9 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.30.14 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.35.18 // indirect
	github.com/aws/smithy-go v1.24.2 // indirect
	github.com/gdcorp-golang/auth v1.0.0 // indirect
	github.com/jmespath/go-jmespath v0.4.0 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	github.com/rs/zerolog v1.34.0 // indirect
	golang.org/x/oauth2 v0.30.0 // indirect
	golang.org/x/sys v0.41.0 // indirect
)

replace github.com/gdcorp-partners/airo-app-builder/packages/go-auth => ../packages/go-auth
