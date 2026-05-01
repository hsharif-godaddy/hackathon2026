package harness

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jedib0t/go-pretty/v6/table"
	"github.com/jedib0t/go-pretty/v6/text"
)

// FullResult is the complete output of a single harness run, saved as JSON.
type FullResult struct {
	ConfigName          string                `json:"config_name"`
	TestCaseID          string                `json:"test_case_id"`
	RunNumber           int                   `json:"run_number"`
	Timestamp           time.Time             `json:"timestamp"`
	Model               string                `json:"model"`
	Temperature         float64               `json:"temperature"`
	Effort              string                `json:"effort"`
	Turns               int                   `json:"turns"`
	LatencyMs           int64                 `json:"latency_ms"`
	AgentTokens         TokenUsage            `json:"agent_tokens"`
	AgentCostUSD        float64               `json:"agent_cost_usd"`
	ResponderTokens     TokenUsage            `json:"responder_tokens"`
	ResponderCostUSD    float64               `json:"responder_cost_usd"`
	JudgeTokens         TokenUsage            `json:"judge_tokens"`
	JudgeCostUSD        float64               `json:"judge_cost_usd"`
	ProjectName         string                `json:"project_name"`
	AskedQuestions      bool                  `json:"asked_questions"`
	QuestionsAsked      []string              `json:"questions_asked,omitempty"`
	AskQuestionPayloads []json.RawMessage     `json:"ask_question_payloads,omitempty"`
	TodoList            json.RawMessage       `json:"todo_list,omitempty"`
	HandoffPrompt       string                `json:"handoff_prompt"`
	HandoffTarget       string                `json:"handoff_target"`
	JudgeScores         map[string]JudgeScore `json:"judge_scores,omitempty"`
	Complete            bool                  `json:"complete"`
	FailReason          string                `json:"fail_reason,omitempty"`
	TurnTimings         []TurnTiming          `json:"turn_timings,omitempty"`
}

// SaveResult writes a FullResult as JSON to baseDir/{ConfigName}/{TestCaseID}/{RunNumber}.json.
func SaveResult(baseDir string, result *FullResult) error {
	dir := filepath.Join(baseDir, result.ConfigName, result.TestCaseID)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating result directory: %w", err)
	}

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling result: %w", err)
	}

	path := filepath.Join(dir, fmt.Sprintf("%d.json", result.RunNumber))
	if _, err := os.Stat(path); err == nil {
		path = filepath.Join(dir, fmt.Sprintf("%d_%d.json", result.RunNumber, time.Now().UnixMilli()))
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("writing result file: %w", err)
	}

	return nil
}

// firstTurnAPIMs returns the API latency of the first turn, or 0.
func firstTurnAPIMs(r *FullResult) int64 {
	if len(r.TurnTimings) > 0 {
		return r.TurnTimings[0].APIMs
	}
	return 0
}

// PrintSummary prints a formatted summary table to the writer.
func PrintSummary(w io.Writer, configName string, results []*FullResult) {
	if len(results) == 0 {
		fmt.Fprintf(w, "Experiment: %s (0 results)\n", configName)
		return
	}

	first := results[0]
	fmt.Fprintf(w, "Experiment: %s (%d results)\n", configName, len(results))
	fmt.Fprintf(w, "Model: %s | Temp: %.2f | Effort: %s\n\n", first.Model, first.Temperature, first.Effort)

	// Collect judge criteria in sorted order.
	criteriaSet := map[string]struct{}{}
	for _, r := range results {
		for k := range r.JudgeScores {
			criteriaSet[k] = struct{}{}
		}
	}
	criteria := make([]string, 0, len(criteriaSet))
	for k := range criteriaSet {
		criteria = append(criteria, k)
	}
	sort.Strings(criteria)

	// Build table header.
	header := table.Row{"Test Case", "Turns", "Total", "TTFB", "Cost", "Name"}
	for _, c := range criteria {
		header = append(header, c)
	}

	t := table.NewWriter()
	t.SetOutputMirror(w)
	t.AppendHeader(header)

	// Configure style.
	t.SetStyle(table.StyleLight)
	t.Style().Format.HeaderAlign = text.AlignCenter
	t.SetColumnConfigs([]table.ColumnConfig{
		{Number: 1, Align: text.AlignLeft},                                                // Test Case
		{Number: 2, Align: text.AlignRight},                                               // Turns
		{Number: 3, Align: text.AlignRight},                                               // Total
		{Number: 4, Align: text.AlignRight},                                               // TTFB
		{Number: 5, Align: text.AlignRight},                                               // Cost
		{Number: 6, Align: text.AlignLeft, WidthMax: 25, WidthMaxEnforcer: text.WrapSoft}, // Name
	})

	// Data rows.
	var totalLatency, totalTTFB int64
	var totalCost float64
	criteriaSum := make(map[string]int)
	criteriaCnt := make(map[string]int)

	for _, r := range results {
		rowCost := r.AgentCostUSD + r.ResponderCostUSD + r.JudgeCostUSD
		totalLatency += r.LatencyMs
		ttfb := firstTurnAPIMs(r)
		totalTTFB += ttfb
		totalCost += rowCost

		nameCol := r.ProjectName
		if r.FailReason != "" {
			nameCol = "FAIL:" + r.FailReason
		}

		row := table.Row{
			r.TestCaseID,
			r.Turns,
			fmt.Sprintf("%.1fs", float64(r.LatencyMs)/1000),
			fmt.Sprintf("%.1fs", float64(ttfb)/1000),
			fmt.Sprintf("$%.3f", rowCost),
			nameCol,
		}
		for _, c := range criteria {
			if score, ok := r.JudgeScores[c]; ok {
				criteriaSum[c] += score.Score
				criteriaCnt[c]++
				row = append(row, fmt.Sprintf("%d/5", score.Score))
			} else {
				row = append(row, "-")
			}
		}
		t.AppendRow(row)
	}

	// Footer with averages.
	n := len(results)
	footer := table.Row{
		"Avg",
		"",
		fmt.Sprintf("%.1fs", float64(totalLatency)/float64(n)/1000),
		fmt.Sprintf("%.1fs", float64(totalTTFB)/float64(n)/1000),
		fmt.Sprintf("$%.3f", totalCost/float64(n)),
		"",
	}
	for _, c := range criteria {
		if cnt := criteriaCnt[c]; cnt > 0 {
			avg := float64(criteriaSum[c]) / float64(cnt)
			footer = append(footer, fmt.Sprintf("%.1f/5", avg))
		} else {
			footer = append(footer, "-")
		}
	}
	t.AppendFooter(footer)

	t.Render()

	// Total cost breakdown.
	var agentTotal, responderTotal, judgeTotal float64
	for _, r := range results {
		agentTotal += r.AgentCostUSD
		responderTotal += r.ResponderCostUSD
		judgeTotal += r.JudgeCostUSD
	}
	fmt.Fprintf(w, "\nTotal cost: agent $%.4f + responder $%.4f + judge $%.4f = $%.4f\n",
		agentTotal, responderTotal, judgeTotal, agentTotal+responderTotal+judgeTotal)

	// Per-tool breakdown table.
	printPerToolSummary(w, results)
}

// toolAgg accumulates per-tool-combination stats for averaging.
type toolAgg struct {
	count  int
	apiMs  int64
	inTok  int64
	outTok int64
	minAPI int64
	maxAPI int64
}

// printPerToolSummary prints a tool-grouped breakdown table.
func printPerToolSummary(w io.Writer, results []*FullResult) {
	agg := map[string]*toolAgg{}

	for _, r := range results {
		for _, tt := range r.TurnTimings {
			toolKey := strings.Join(tt.ToolsCalled, ", ")
			if toolKey == "" {
				toolKey = "(none)"
			}

			a, ok := agg[toolKey]
			if !ok {
				a = &toolAgg{minAPI: tt.APIMs, maxAPI: tt.APIMs}
				agg[toolKey] = a
			}
			a.count++
			a.apiMs += tt.APIMs
			a.inTok += tt.InputTokens
			a.outTok += tt.OutputTokens
			if tt.APIMs < a.minAPI {
				a.minAPI = tt.APIMs
			}
			if tt.APIMs > a.maxAPI {
				a.maxAPI = tt.APIMs
			}
		}
	}

	if len(agg) == 0 {
		return
	}

	// Sort by average API time descending (slowest first).
	keys := make([]string, 0, len(agg))
	for k := range agg {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		ai := float64(agg[keys[i]].apiMs) / float64(agg[keys[i]].count)
		aj := float64(agg[keys[j]].apiMs) / float64(agg[keys[j]].count)
		return ai > aj
	})

	fmt.Fprintf(w, "\nPer-Tool Breakdown:\n")

	pt := table.NewWriter()
	pt.SetOutputMirror(w)
	pt.AppendHeader(table.Row{"Tools", "Count", "Avg API", "Min API", "Max API", "Avg In Tok", "Avg Out Tok"})
	pt.SetStyle(table.StyleLight)
	pt.Style().Format.HeaderAlign = text.AlignCenter
	pt.SetColumnConfigs([]table.ColumnConfig{
		{Number: 1, Align: text.AlignLeft, WidthMax: 30, WidthMaxEnforcer: text.WrapSoft},
		{Number: 2, Align: text.AlignRight},
		{Number: 3, Align: text.AlignRight},
		{Number: 4, Align: text.AlignRight},
		{Number: 5, Align: text.AlignRight},
		{Number: 6, Align: text.AlignRight},
		{Number: 7, Align: text.AlignRight},
	})

	for _, toolKey := range keys {
		a := agg[toolKey]
		n := float64(a.count)

		pt.AppendRow(table.Row{
			toolKey,
			a.count,
			fmt.Sprintf("%.1fs", float64(a.apiMs)/n/1000),
			fmt.Sprintf("%.1fs", float64(a.minAPI)/1000),
			fmt.Sprintf("%.1fs", float64(a.maxAPI)/1000),
			fmt.Sprintf("%.0f", float64(a.inTok)/n),
			fmt.Sprintf("%.0f", float64(a.outTok)/n),
		})
	}

	pt.Render()
}
