package lock

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/airo-ai-builder/release-manager/internal/logger"
)

type Info struct {
	Operator  string    `json:"operator"`
	Branch    string    `json:"branch"`
	StartedAt time.Time `json:"started_at"`
}

// Check reads the SSM parameter and returns the current lock holder.
// Returns nil if the parameter does not exist or is empty (no lock held).
func Check(ctx context.Context, parameter, profile string) (*Info, error) {
	out, err := ssm(ctx, profile, "get-parameter",
		"--name", parameter,
		"--query", "Parameter.Value",
		"--output", "text")
	if err != nil {
		if strings.Contains(err.Error(), "ParameterNotFound") {
			return nil, nil
		}
		return nil, err
	}

	value := strings.TrimSpace(out)
	if value == "" || value == "None" {
		return nil, nil
	}

	var info Info
	if err := json.Unmarshal([]byte(value), &info); err != nil {
		return nil, fmt.Errorf("parsing lock value: %w", err)
	}
	return &info, nil
}

// Acquire writes the lock using a write-wait-verify pattern for pseudo-atomicity.
// Writes the lock, waits 2 seconds, then reads it back to confirm this operator
// still holds it. Returns an error if someone else won the race.
func Acquire(ctx context.Context, parameter, profile, operator, branch string) error {
	info := Info{
		Operator:  operator,
		Branch:    branch,
		StartedAt: time.Now().UTC(),
	}

	value, err := json.Marshal(info)
	if err != nil {
		return fmt.Errorf("marshalling lock info: %w", err)
	}

	if _, err := ssm(ctx, profile, "put-parameter",
		"--name", parameter,
		"--value", string(value),
		"--type", "String",
		"--overwrite"); err != nil {
		return fmt.Errorf("writing lock: %w", err)
	}

	logger.Log("lock.acquire: wrote lock, waiting 2s for verification")

	select {
	case <-time.After(2 * time.Second):
	case <-ctx.Done():
		return ctx.Err()
	}

	current, err := Check(ctx, parameter, profile)
	if err != nil {
		return fmt.Errorf("verifying lock: %w", err)
	}

	if current == nil || current.Operator != operator {
		holder := "unknown"
		if current != nil {
			holder = current.Operator
		}
		return fmt.Errorf("lost lock race to %s", holder)
	}

	logger.Log("lock.acquire: verified — lock held by %s", operator)
	return nil
}

// Release deletes the SSM parameter. Retries up to 3 times with 2-second
// backoff on failure. If all retries fail, logs a warning but does not
// return an error — the lock becomes stale and the next operator can
// use --force-lock.
func Release(ctx context.Context, parameter, profile string) {
	for attempt := 1; attempt <= 3; attempt++ {
		if _, err := ssm(ctx, profile, "delete-parameter",
			"--name", parameter); err != nil {
			if strings.Contains(err.Error(), "ParameterNotFound") {
				logger.Log("lock.release: parameter already deleted")
				return
			}
			logger.Log("lock.release: attempt %d/3 failed: %s", attempt, err)
			if attempt < 3 {
				select {
				case <-time.After(2 * time.Second):
				case <-ctx.Done():
					logger.Log("lock.release: context cancelled, giving up")
					return
				}
			}
			continue
		}
		logger.Log("lock.release: lock released")
		return
	}
	logger.Log("lock.release: WARNING — all 3 attempts failed, lock is stale")
}

func ssm(ctx context.Context, profile string, args ...string) (string, error) {
	fullArgs := append([]string{"ssm"}, args...)
	if profile != "" {
		fullArgs = append(fullArgs, "--profile", profile)
	}

	cmd := exec.CommandContext(ctx, "aws", fullArgs...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("aws %s: %w\n%s", strings.Join(fullArgs, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}
