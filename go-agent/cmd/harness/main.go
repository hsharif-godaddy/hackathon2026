package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/joho/godotenv"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/harness"
)

func main() {
	// Load .env file, ignoring file-not-found errors.
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "warning: loading .env: %v\n", err)
	}

	// Parse flags.
	caseFilter := flag.String("case", "", "filter to single test case ID")
	runsOverride := flag.Int("runs", 0, "override runs_per_case (0 = use config value)")
	resultsDir := flag.String("results", "results/harness", "results base directory")
	concurrency := flag.Int("concurrency", 1, "number of test cases to run in parallel")
	flag.Parse()

	configPaths := flag.Args()
	if len(configPaths) == 0 {
		fmt.Fprintln(os.Stderr, "error: at least one config YAML file path is required")
		flag.Usage()
		os.Exit(1)
	}

	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "error: ANTHROPIC_API_KEY environment variable is required")
		os.Exit(1)
	}

	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL := os.Getenv("ANTHROPIC_BASE_URL"); baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
		fmt.Printf("Using API base URL: %s\n", baseURL)
	}
	client := sdk.NewClient(opts...)

	for _, cfgPath := range configPaths {
		if err := runExperiment(
			context.Background(),
			&client,
			cfgPath,
			*caseFilter,
			*runsOverride,
			*resultsDir,
			*concurrency,
		); err != nil {
			fmt.Fprintf(os.Stderr, "error running experiment %s: %v\n", cfgPath, err)
			os.Exit(1)
		}
	}
}

// workItem represents a single (test case, run number) pair to execute.
type workItem struct {
	tc  harness.TestCase
	run int
}

func runExperiment(
	ctx context.Context,
	client *sdk.Client,
	cfgPath, caseFilter string,
	runsOverride int,
	resultsDir string,
	concurrency int,
) error {
	cfg, err := harness.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	fmt.Printf("=== Experiment: %s ===\n", cfg.Name)
	if cfg.Description != "" {
		fmt.Printf("Description: %s\n", cfg.Description)
	}

	// Build system prompt from prompt files.
	systemPrompt, err := buildSystemPrompt(cfg)
	if err != nil {
		return fmt.Errorf("building system prompt: %w", err)
	}

	// Apply case filter.
	testCases := cfg.TestCases
	if caseFilter != "" {
		filtered := testCases[:0]
		for _, tc := range testCases {
			if tc.ID == caseFilter {
				filtered = append(filtered, tc)
			}
		}
		if len(filtered) == 0 {
			return fmt.Errorf("no test case found with ID %q", caseFilter)
		}
		testCases = filtered
	}

	// Determine runs per case.
	runsPerCase := cfg.RunsPerCase
	if runsOverride > 0 {
		runsPerCase = runsOverride
	}

	if concurrency < 1 {
		concurrency = 1
	}

	// Create the API call function (SDK client is safe for concurrent use).
	apiCall := harness.APICallFunc(func(ctx context.Context, params sdk.MessageNewParams) (*sdk.Message, error) {
		return client.Messages.New(ctx, params)
	})

	// Create the judge.
	judge := harness.NewJudge(harness.JudgeConfigRuntime{
		APICall:  apiCall,
		Model:    cfg.Judge.Model,
		Criteria: cfg.Judge.Criteria,
	})

	// Build work items.
	var items []workItem
	for _, tc := range testCases {
		for run := 1; run <= runsPerCase; run++ {
			items = append(items, workItem{tc: tc, run: run})
		}
	}

	totalItems := len(items)
	fmt.Printf("Running %d test cases with concurrency=%d\n", totalItems, concurrency)

	// Results collected from workers (indexed by position to preserve order).
	results := make([]*harness.FullResult, totalItems)
	var firstErr error
	var mu sync.Mutex

	// Worker pool.
	work := make(chan int, totalItems)
	var wg sync.WaitGroup

	for range concurrency {
		wg.Go(func() {
			for idx := range work {
				item := items[idx]

				// Each goroutine gets its own responder (stateless, just closes over apiCall).
				responder := harness.ResponderFunc(
					func(ctx context.Context, questions json.RawMessage, persona, userMessage string) (string, *harness.TokenUsage, error) {
						return callResponder(ctx, apiCall, cfg.Responder.Model, questions, persona, userMessage)
					},
				)

				result, err := runSingleCase(
					ctx,
					cfg,
					systemPrompt,
					apiCall,
					responder,
					judge,
					item.tc,
					item.run,
					resultsDir,
				)

				mu.Lock()
				if err != nil {
					fmt.Fprintf(os.Stderr, "  [%s] run %d FAILED: %v\n", item.tc.ID, item.run, err)
					if firstErr == nil {
						firstErr = fmt.Errorf("test case %s run %d: %w", item.tc.ID, item.run, err)
					}
				} else {
					results[idx] = result

					// Print progress.
					totalCost := result.AgentCostUSD + result.ResponderCostUSD + result.JudgeCostUSD
					msg := fmt.Sprintf(
						"  [%s] run %d done (%dms, $%.4f)",
						item.tc.ID,
						item.run,
						result.LatencyMs,
						totalCost,
					)
					if result.FailReason != "" {
						msg += fmt.Sprintf(" FAIL(%s)", result.FailReason)
					} else if len(result.JudgeScores) > 0 {
						var scoreParts []string
						for name, score := range result.JudgeScores {
							scoreParts = append(scoreParts, fmt.Sprintf("%s=%d/5", name, score.Score))
						}
						msg += fmt.Sprintf(" [%s]", strings.Join(scoreParts, ", "))
					}
					fmt.Println(msg)
				}
				mu.Unlock()
			}
		})
	}

	// Send work.
	for i := range items {
		work <- i
	}
	close(work)
	wg.Wait()

	// Collect non-nil results (preserving order).
	var allResults []*harness.FullResult
	for _, r := range results {
		if r != nil {
			allResults = append(allResults, r)
		}
	}

	fmt.Println()
	harness.PrintSummary(os.Stdout, cfg.Name, allResults)
	fmt.Println()

	if firstErr != nil {
		return firstErr
	}
	return nil
}

// runSingleCase executes one (test case, run) and returns the full result.
func runSingleCase(
	ctx context.Context,
	cfg *harness.Config,
	systemPrompt string,
	apiCall harness.APICallFunc,
	responder harness.ResponderFunc,
	judge *harness.Judge,
	tc harness.TestCase,
	run int,
	resultsDir string,
) (*harness.FullResult, error) {
	runner := harness.NewRunner(harness.RunnerConfig{
		MaxSteps:     cfg.MaxSteps,
		StopAfter:    []string{"handoff", "websiteRebuild", "askQuestion"},
		SystemPrompt: systemPrompt,
		Model:        cfg.Model,
		Temperature:  cfg.Temperature,
		MaxTokens:    cfg.MaxOutputTokens,
		Effort:       cfg.Effort,
		APICall:      apiCall,
		Responder:    responder,
		Persona:      tc.Persona,
		UserMessage:  tc.UserMessage,
	})

	runResult, err := runner.Run(ctx, tc.UserMessage)
	if err != nil {
		return nil, err
	}

	// Calculate costs.
	agentCost := harness.CalculateCost(cfg.Model, runResult.AgentTokens)
	responderCost := harness.CalculateCost(cfg.Responder.Model, runResult.ResponderTokens)

	// Run judge if we have a handoff prompt.
	var judgeScores map[string]harness.JudgeScore
	var judgeTokens harness.TokenUsage
	if runResult.HandoffPrompt != "" {
		scores, tokens, judgeErr := judge.Evaluate(ctx, harness.JudgeInput{
			UserMessage:   tc.UserMessage,
			Persona:       tc.Persona,
			ProjectName:   runResult.ProjectName,
			HandoffPrompt: runResult.HandoffPrompt,
		})
		if judgeErr != nil {
			fmt.Fprintf(os.Stderr, "  [%s] warning: judge failed: %v\n", tc.ID, judgeErr)
		} else {
			judgeScores = scores
			if tokens != nil {
				judgeTokens = *tokens
			}
		}
	}
	judgeCost := harness.CalculateCost(cfg.Judge.Model, judgeTokens)

	result := &harness.FullResult{
		ConfigName:       cfg.Name,
		TestCaseID:       tc.ID,
		RunNumber:        run,
		Timestamp:        time.Now(),
		Model:            cfg.Model,
		Temperature:      cfg.Temperature,
		Effort:           cfg.Effort,
		Turns:            runResult.Turns,
		LatencyMs:        runResult.LatencyMs,
		AgentTokens:      runResult.AgentTokens,
		AgentCostUSD:     agentCost.Total(),
		ResponderTokens:  runResult.ResponderTokens,
		ResponderCostUSD: responderCost.Total(),
		JudgeTokens:      judgeTokens,
		JudgeCostUSD:     judgeCost.Total(),
		ProjectName:      runResult.ProjectName,
		AskedQuestions:   runResult.AskedQuestions,
		QuestionsAsked:   runResult.QuestionsAsked,
		TodoList:         runResult.TodoList,
		HandoffPrompt:    runResult.HandoffPrompt,
		HandoffTarget:    runResult.HandoffTarget,
		JudgeScores:      judgeScores,
		Complete:         runResult.Complete,
		FailReason:       runResult.FailReason,
		TurnTimings:      runResult.TurnTimings,
	}

	if err := harness.SaveResult(resultsDir, result); err != nil {
		return nil, fmt.Errorf("saving result: %w", err)
	}

	return result, nil
}

// callResponder simulates a user answering questions from the agent.
// It calls the API with a persona-based system prompt and a numbered question list.
func callResponder(
	ctx context.Context,
	apiCall harness.APICallFunc,
	model string,
	questionsJSON json.RawMessage,
	persona, userMessage string,
) (string, *harness.TokenUsage, error) {
	// Parse questions — suggestions can be strings or {text, value} objects.
	var questionsPayload struct {
		Questions []struct {
			Question    string            `json:"question"`
			Suggestions []json.RawMessage `json:"suggestions"`
		} `json:"questions"`
	}
	if err := json.Unmarshal(questionsJSON, &questionsPayload); err != nil {
		return "", nil, fmt.Errorf("parsing questions JSON: %w", err)
	}

	// Build system prompt for the responder.
	systemPrompt := fmt.Sprintf(
		"You are a potential customer answering questions from an AI assistant that is helping you build a website.\n"+
			"Your persona: %s\n"+
			"Your original request: %s\n\n"+
			"Answer the questions naturally and concisely, staying in character. "+
			"Pick from the suggestions when they make sense, or provide your own answer.",
		persona,
		userMessage,
	)

	// Build user message with numbered question list.
	var msgBuilder strings.Builder
	msgBuilder.WriteString("Please answer these questions:\n\n")
	for i, q := range questionsPayload.Questions {
		msgBuilder.WriteString(fmt.Sprintf("%d. %s\n", i+1, q.Question))
		if suggTexts := parseSuggestions(q.Suggestions); len(suggTexts) > 0 {
			msgBuilder.WriteString(fmt.Sprintf("   Suggestions: %s\n", strings.Join(suggTexts, ", ")))
		}
	}

	params := sdk.MessageNewParams{
		Model:     model,
		MaxTokens: 1000,
		System: []sdk.TextBlockParam{
			{Text: systemPrompt},
		},
		Messages: []sdk.MessageParam{
			sdk.NewUserMessage(sdk.NewTextBlock(msgBuilder.String())),
		},
	}

	resp, err := apiCall(ctx, params)
	if err != nil {
		return "", nil, fmt.Errorf("responder API call failed: %w", err)
	}

	usage := &harness.TokenUsage{
		InputTokens:         resp.Usage.InputTokens,
		OutputTokens:        resp.Usage.OutputTokens,
		CacheCreationTokens: resp.Usage.CacheCreationInputTokens,
		CacheReadTokens:     resp.Usage.CacheReadInputTokens,
	}

	// Extract text from the response.
	var answer string
	for _, block := range resp.Content {
		if block.Type == "text" {
			answer = block.Text
			break
		}
	}

	return answer, usage, nil
}

// parseSuggestions converts a slice of raw JSON suggestion values into display strings.
// Each element may be a plain string or a {"text": "..."} object.
func parseSuggestions(suggestions []json.RawMessage) []string {
	var texts []string
	for _, s := range suggestions {
		var plain string
		if json.Unmarshal(s, &plain) == nil {
			texts = append(texts, plain)
			continue
		}
		var obj struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(s, &obj) == nil {
			texts = append(texts, obj.Text)
		}
	}
	return texts
}

// buildSystemPrompt reads and concatenates all prompt files from the config.
func buildSystemPrompt(cfg *harness.Config) (string, error) {
	var parts []string
	for _, promptFile := range cfg.PromptFiles {
		resolvedPath := cfg.ResolvePromptPath(promptFile)
		data, err := os.ReadFile(resolvedPath)
		if err != nil {
			return "", fmt.Errorf("reading prompt file %s: %w", resolvedPath, err)
		}
		parts = append(parts, string(data))
	}
	return strings.Join(parts, "\n\n"), nil
}
