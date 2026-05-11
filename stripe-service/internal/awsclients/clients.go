// Package awsclients bundles the AWS SDK v2 service clients stripe-service uses.
// Clients are constructed once at boot from the default credential chain and
// injected into api.Server. The SDK's credential resolution is lazy, so missing
// credentials surface at call time (e.g. via /v1/_probe), but config-loading
// errors such as a malformed shared-config file still fail at startup.
package awsclients

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// Clients holds the AWS SDK v2 service clients. Fields are unexported to keep
// construction funneled through New(), so partial Clients{} literals can't
// bypass the non-nil invariant.
type Clients struct {
	dynamodb       *dynamodb.Client
	secretsManager *secretsmanager.Client
	kms            *kms.Client
}

// New loads the default AWS config and builds each service client.
func New(ctx context.Context) (*Clients, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return &Clients{
		dynamodb:       dynamodb.NewFromConfig(cfg),
		secretsManager: secretsmanager.NewFromConfig(cfg),
		kms:            kms.NewFromConfig(cfg),
	}, nil
}

// Prober is the narrow surface the /v1/_probe handler depends on. Each method
// wraps a zero-side-effect Describe call against the respective AWS service.
// A fake implementation is used in unit tests.
type Prober interface {
	DescribeTable(ctx context.Context, name string) error
	DescribeSecret(ctx context.Context, nameOrArn string) error
	DescribeKey(ctx context.Context, keyID string) error
}

var _ Prober = (*Clients)(nil)

func (c *Clients) DescribeTable(ctx context.Context, name string) error {
	_, err := c.dynamodb.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: &name})
	return err
}

func (c *Clients) DescribeSecret(ctx context.Context, nameOrArn string) error {
	_, err := c.secretsManager.DescribeSecret(ctx, &secretsmanager.DescribeSecretInput{SecretId: &nameOrArn})
	return err
}

func (c *Clients) DescribeKey(ctx context.Context, keyID string) error {
	_, err := c.kms.DescribeKey(ctx, &kms.DescribeKeyInput{KeyId: &keyID})
	return err
}
