// Package s3 provides S3 storage for image analysis backup and reindexing.
package s3

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

// Client wraps the S3 client for storing and retrieving image analyses.
type Client struct {
	s3     *s3.Client
	bucket string
	prefix string
}

// New creates a new S3 client configured for the specified bucket and region.
func New(ctx context.Context, cfg *config.Config) (*Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(cfg.S3Region))
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	return &Client{
		s3:     s3.NewFromConfig(awsCfg),
		bucket: cfg.S3Bucket,
		prefix: cfg.S3Prefix,
	}, nil
}

// Store saves an analysis to S3 as JSON.
func (c *Client) Store(ctx context.Context, analysis *models.ImageAnalysis) error {
	if analysis == nil {
		return errors.New("analysis cannot be nil")
	}

	data, err := analysisToJSON(analysis)
	if err != nil {
		return fmt.Errorf("failed to marshal analysis: %w", err)
	}

	key := buildKey(c.prefix, analysis.GettyID)

	_, err = c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("application/json"),
	})
	if err != nil {
		return fmt.Errorf("failed to put object: %w", err)
	}

	return nil
}

// Get retrieves an analysis from S3 by its Getty ID.
func (c *Client) Get(ctx context.Context, gettyID string) (*models.ImageAnalysis, error) {
	if gettyID == "" {
		return nil, errors.New("gettyID cannot be empty")
	}

	key := buildKey(c.prefix, gettyID)

	resp, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get object: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read object: %w", err)
	}

	var analysis models.ImageAnalysis
	if err := json.Unmarshal(data, &analysis); err != nil {
		return nil, fmt.Errorf("failed to unmarshal analysis: %w", err)
	}

	return &analysis, nil
}

// Exists checks if an analysis exists in S3 for the given Getty ID.
func (c *Client) Exists(ctx context.Context, gettyID string) (bool, error) {
	if gettyID == "" {
		return false, errors.New("gettyID cannot be empty")
	}

	key := buildKey(c.prefix, gettyID)

	_, err := c.s3.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var notFound *types.NotFound
		if errors.As(err, &notFound) {
			return false, nil
		}
		return false, fmt.Errorf("failed to check object existence: %w", err)
	}

	return true, nil
}

// Close is a no-op for S3 client as the AWS SDK manages connections internally.
// This method exists for interface consistency with other storage clients.
func (c *Client) Close() error {
	return nil
}

// buildKey constructs the S3 key for an analysis file.
func buildKey(prefix, gettyID string) string {
	return fmt.Sprintf("%s/getty-%s.json", prefix, gettyID)
}

// analysisToJSON serializes an analysis to indented JSON.
func analysisToJSON(analysis *models.ImageAnalysis) ([]byte, error) {
	return json.MarshalIndent(analysis, "", "  ")
}
