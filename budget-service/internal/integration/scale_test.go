//go:build integration

package integration

import (
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

func BenchmarkConcurrentSpend(b *testing.B) {
	skipIfNoIntegration(b)
	client := NewClient()

	subID := generateSubscriptionID()
	initialCredits := int64(1000000000) // 1 billion credits

	// Create budget with enough credits for the benchmark
	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Benchmark Budget",
		MaxCredits:            "1000000000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(365 * 24 * time.Hour),
	})
	if err != nil {
		b.Fatalf("CreateBudget failed: %v", err)
	}
	defer client.DeleteBudget(budget.ID.String())

	b.ResetTimer()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := client.Spend(subID, models.SpendRequest{
				Amount:        "1",
				OperationType: "benchmark",
				OperationID:   fmt.Sprintf("bench-%d", time.Now().UnixNano()),
			})
			if err != nil {
				b.Errorf("Spend failed: %v", err)
			}
		}
	})

	b.StopTimer()

	// Validate final balance: should equal initial - b.N (each iteration spends 1 credit)
	resp, err := client.GetBudgets(subID)
	if err != nil {
		b.Fatalf("GetBudgets failed: %v", err)
	}
	if len(resp.Budgets) != 1 {
		b.Fatalf("Expected 1 budget, got %d", len(resp.Budgets))
	}
	expectedBalance := initialCredits - int64(b.N)
	actualBalance := resp.Budgets[0].CurrentValueRounded
	if actualBalance != expectedBalance {
		b.Errorf("Data integrity failed: expected balance %d, got %d (diff: %d)",
			expectedBalance, actualBalance, expectedBalance-actualBalance)
	}
}

func BenchmarkThroughput(b *testing.B) {
	skipIfNoIntegration(b)

	for _, concurrency := range []int{10, 50, 100, 500} {
		b.Run(fmt.Sprintf("c%d", concurrency), func(b *testing.B) {
			client := NewClient()
			subID := generateSubscriptionID()

			budget, err := client.CreateBudget(models.CreateBudgetRequest{
				SubscriptionID:        subID,
				Type:                  models.BudgetTypeBurndown,
				Label:                 "Throughput Budget",
				MaxCredits:            "1000000000.000000",
				ConversionFactor:      "1.0000",
				ExpirationOrResetDate: time.Now().Add(365 * 24 * time.Hour),
			})
			if err != nil {
				b.Fatalf("CreateBudget failed: %v", err)
			}
			defer client.DeleteBudget(budget.ID.String())

			sem := make(chan struct{}, concurrency)
			var wg sync.WaitGroup

			b.ResetTimer()

			for i := 0; i < b.N; i++ {
				sem <- struct{}{}
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					defer func() { <-sem }()

					_, err := client.Spend(subID, models.SpendRequest{
						Amount:        "1",
						OperationType: "throughput",
						OperationID:   fmt.Sprintf("tp-%d", i),
					})
					if err != nil {
						b.Errorf("Spend failed: %v", err)
					}
				}(i)
			}
			wg.Wait()
		})
	}
}

func BenchmarkMultiBudgetAllocation(b *testing.B) {
	skipIfNoIntegration(b)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create 10 budgets with staggered expirations (soonest-expiring first in list)
	var budgetIDs []string
	for i := 0; i < 10; i++ {
		budget, err := client.CreateBudget(models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 fmt.Sprintf("Budget %d", i),
			MaxCredits:            "100000000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: time.Now().Add(time.Duration(i+1) * 30 * 24 * time.Hour),
		})
		if err != nil {
			b.Fatalf("CreateBudget %d failed: %v", i, err)
		}
		budgetIDs = append(budgetIDs, budget.ID.String())
	}
	defer func() {
		for _, id := range budgetIDs {
			client.DeleteBudget(id)
		}
	}()

	b.ResetTimer()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := client.Spend(subID, models.SpendRequest{
				Amount:        "1",
				OperationType: "multi-budget",
				OperationID:   fmt.Sprintf("mb-%d", time.Now().UnixNano()),
			})
			if err != nil {
				b.Errorf("Spend failed: %v", err)
			}
		}
	})

	b.StopTimer()

	// Validate ordering: soonest-expiring budgets should be depleted first
	resp, err := client.GetBudgets(subID)
	if err != nil {
		b.Fatalf("GetBudgets failed: %v", err)
	}

	// Build a map of budget ID to current value
	balanceByID := make(map[string]int64)
	for _, budget := range resp.Budgets {
		balanceByID[budget.ID.String()] = budget.CurrentValueRounded
	}

	// Verify ordering: earlier budgets (soonest expiring) should have lower balances
	// (i.e., be depleted before later-expiring budgets)
	for i := 0; i < len(budgetIDs)-1; i++ {
		earlierBalance := balanceByID[budgetIDs[i]]
		laterBalance := balanceByID[budgetIDs[i+1]]
		// If earlier budget is not depleted and later budget has less balance, ordering is wrong
		if earlierBalance > 0 && laterBalance < earlierBalance {
			b.Errorf("Ordering violation: budget %d (expires sooner) has balance %d but budget %d has balance %d",
				i, earlierBalance, i+1, laterBalance)
		}
	}
	b.Logf("Ordering validation passed: budgets consumed in expiration order")
}

func BenchmarkProductionScale(b *testing.B) {
	skipIfNoIntegration(b)
	client := NewClient()

	const (
		numSubscriptions = 50000
		budgetsPerSub    = 2
		readPct          = 70
		spendPct         = 25
		// releasePct = 5 (remainder)
	)

	b.Logf("Setting up %d subscriptions with %d budgets each (%d total budgets)...",
		numSubscriptions, budgetsPerSub, numSubscriptions*budgetsPerSub)

	// Setup: Create all subscriptions and budgets
	type subData struct {
		id        string
		budgetIDs []string
	}
	subs := make([]subData, numSubscriptions)

	setupStart := time.Now()
	var setupWg sync.WaitGroup
	sem := make(chan struct{}, 100) // Limit concurrent setup requests

	for i := 0; i < numSubscriptions; i++ {
		sem <- struct{}{}
		setupWg.Add(1)
		go func(idx int) {
			defer setupWg.Done()
			defer func() { <-sem }()

			subID := fmt.Sprintf("prod-test-%d", idx)
			subs[idx].id = subID

			// Create interval budget (monthly)
			resetInterval := models.ResetIntervalMonthly
			b1, err := client.CreateBudget(models.CreateBudgetRequest{
				SubscriptionID:        subID,
				Type:                  models.BudgetTypeInterval,
				Label:                 "Monthly",
				MaxCredits:            "100000.000000",
				ConversionFactor:      "1.0000",
				ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
				ResetInterval:         resetInterval,
			})
			if err != nil {
				b.Errorf("CreateBudget interval failed for sub %d: %v", idx, err)
				return
			}
			subs[idx].budgetIDs = append(subs[idx].budgetIDs, b1.ID.String())

			// Create burndown budget
			b2, err := client.CreateBudget(models.CreateBudgetRequest{
				SubscriptionID:        subID,
				Type:                  models.BudgetTypeBurndown,
				Label:                 "Bonus",
				MaxCredits:            "50000.000000",
				ConversionFactor:      "1.0000",
				ExpirationOrResetDate: time.Now().Add(90 * 24 * time.Hour),
			})
			if err != nil {
				b.Errorf("CreateBudget burndown failed for sub %d: %v", idx, err)
				return
			}
			subs[idx].budgetIDs = append(subs[idx].budgetIDs, b2.ID.String())
		}(i)
	}
	setupWg.Wait()
	b.Logf("Setup completed in %v", time.Since(setupStart))

	// Cleanup function
	defer func() {
		b.Log("Cleaning up...")
		cleanupStart := time.Now()
		var cleanupWg sync.WaitGroup
		for _, sub := range subs {
			for _, budgetID := range sub.budgetIDs {
				sem <- struct{}{}
				cleanupWg.Add(1)
				go func(id string) {
					defer cleanupWg.Done()
					defer func() { <-sem }()
					client.DeleteBudget(id)
				}(budgetID)
			}
		}
		cleanupWg.Wait()
		b.Logf("Cleanup completed in %v", time.Since(cleanupStart))
	}()

	// Metrics
	var (
		reads    atomic.Int64
		spends   atomic.Int64
		releases atomic.Int64
		errors   atomic.Int64
	)

	// Latency tracking
	var (
		readLatencies    []time.Duration
		spendLatencies   []time.Duration
		releaseLatencies []time.Duration
		latencyMu        sync.Mutex
	)

	benchStart := time.Now()
	b.ResetTimer()

	b.RunParallel(func(pb *testing.PB) {
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))

		for pb.Next() {
			// Pick random subscription
			subIdx := rng.Intn(numSubscriptions)
			sub := subs[subIdx]

			// Determine operation type
			roll := rng.Intn(100)
			var err error

			switch {
			case roll < readPct:
				// Read (70%)
				start := time.Now()
				_, err = client.GetBudgets(sub.id)
				elapsed := time.Since(start)
				if err == nil {
					reads.Add(1)
					latencyMu.Lock()
					readLatencies = append(readLatencies, elapsed)
					latencyMu.Unlock()
				}
			case roll < readPct+spendPct:
				// Spend (25%)
				start := time.Now()
				_, err = client.Spend(sub.id, models.SpendRequest{
					Amount:        "1",
					OperationType: "prod-test",
					OperationID:   fmt.Sprintf("pt-%d", time.Now().UnixNano()),
				})
				elapsed := time.Since(start)
				if err == nil {
					spends.Add(1)
					latencyMu.Lock()
					spendLatencies = append(spendLatencies, elapsed)
					latencyMu.Unlock()
				}
			default:
				// Release (5%)
				start := time.Now()
				_, err = client.Release(sub.id, models.ReleaseRequest{
					Amount:        "1",
					OperationType: "prod-test",
					OperationID:   fmt.Sprintf("pt-%d", time.Now().UnixNano()),
				})
				elapsed := time.Since(start)
				if err == nil {
					releases.Add(1)
					latencyMu.Lock()
					releaseLatencies = append(releaseLatencies, elapsed)
					latencyMu.Unlock()
				}
			}

			if err != nil {
				errors.Add(1)
			}
		}
	})

	b.StopTimer()
	benchElapsed := time.Since(benchStart)

	// Calculate and report metrics
	total := reads.Load() + spends.Load() + releases.Load()
	totalWithErrors := total + errors.Load()

	// ops/sec overall and by type
	overallOpsPerSec := float64(total) / benchElapsed.Seconds()
	readOpsPerSec := float64(reads.Load()) / benchElapsed.Seconds()
	spendOpsPerSec := float64(spends.Load()) / benchElapsed.Seconds()
	releaseOpsPerSec := float64(releases.Load()) / benchElapsed.Seconds()

	b.Logf("Operations: reads=%d (%.1f%%), spends=%d (%.1f%%), releases=%d (%.1f%%), errors=%d",
		reads.Load(), float64(reads.Load())/float64(total)*100,
		spends.Load(), float64(spends.Load())/float64(total)*100,
		releases.Load(), float64(releases.Load())/float64(total)*100,
		errors.Load())

	b.Logf("Throughput: overall=%.1f ops/sec, reads=%.1f ops/sec, spends=%.1f ops/sec, releases=%.1f ops/sec",
		overallOpsPerSec, readOpsPerSec, spendOpsPerSec, releaseOpsPerSec)

	// Error rate
	errorRate := float64(errors.Load()) / float64(totalWithErrors) * 100
	b.Logf("Error rate: %.2f%%", errorRate)

	// Latency percentiles
	reportLatencyPercentiles := func(name string, latencies []time.Duration) {
		if len(latencies) == 0 {
			b.Logf("Latency %s: no samples", name)
			return
		}
		sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
		p50 := latencies[len(latencies)*50/100]
		p95 := latencies[len(latencies)*95/100]
		p99 := latencies[len(latencies)*99/100]
		b.Logf("Latency %s: p50=%v, p95=%v, p99=%v", name, p50, p95, p99)
	}

	reportLatencyPercentiles("reads", readLatencies)
	reportLatencyPercentiles("spends", spendLatencies)
	reportLatencyPercentiles("releases", releaseLatencies)

	// Combined latency percentiles
	allLatencies := make([]time.Duration, 0, len(readLatencies)+len(spendLatencies)+len(releaseLatencies))
	allLatencies = append(allLatencies, readLatencies...)
	allLatencies = append(allLatencies, spendLatencies...)
	allLatencies = append(allLatencies, releaseLatencies...)
	reportLatencyPercentiles("overall", allLatencies)

	// Data integrity check: sample a few subscriptions and verify budget consistency
	b.Log("Running data integrity check...")
	sampleSize := 10
	if sampleSize > numSubscriptions {
		sampleSize = numSubscriptions
	}
	integrityErrors := 0
	for i := 0; i < sampleSize; i++ {
		subIdx := rand.Intn(numSubscriptions)
		sub := subs[subIdx]
		resp, err := client.GetBudgets(sub.id)
		if err != nil {
			b.Errorf("Data integrity check failed for sub %s: GetBudgets error: %v", sub.id, err)
			integrityErrors++
			continue
		}
		// Verify each budget has consistent values (CurrentValue <= MaxCredits)
		for _, budget := range resp.Budgets {
			if budget.CurrentValueRounded > budget.MaxCreditsRounded {
				b.Errorf("Data integrity check failed: budget %s has CurrentValue %d > MaxCredits %d",
					budget.ID, budget.CurrentValueRounded, budget.MaxCreditsRounded)
				integrityErrors++
			}
			if budget.CurrentValueRounded < 0 {
				b.Errorf("Data integrity check failed: budget %s has negative CurrentValue %d",
					budget.ID, budget.CurrentValueRounded)
				integrityErrors++
			}
		}
	}
	if integrityErrors == 0 {
		b.Logf("Data integrity check passed: sampled %d subscriptions", sampleSize)
	}
}
