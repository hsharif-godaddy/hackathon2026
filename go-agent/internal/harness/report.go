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
	ConfigName       string                `json:"config_name"`
	TestCaseID       string                `json:"test_case_id"`
	RunNumber        int                   `json:"run_number"`
	Timestamp        time.Time             `json:"timestamp"`
	Model            string                `json:"model"`
	Temperature      float64               `json:"temperature"`
	Effort           string                `json:"effort"`
	Turns            int                   `json:"turns"`
	LatencyMs        int64                 `json:"latency_ms"`
	AgentTokens      TokenUsage            `json:"agent_tokens"`
	AgentCostUSD     float64               `json:"agent_cost_usd"`
	ResponderTokens  TokenUsage            `json:"responder_tokens"`
	ResponderCostUSD float64               `json:"responder_cost_usd"`
	JudgeTokens      TokenUsage            `json:"judge_tokens"`
	JudgeCostUSD     float64               `json:"judge_cost_usd"`
	ProjectName      string                `json:"project_name"`
	AskedQuestions   bool                  `json:"asked_questions"`
	QuestionsAsked   []string              `json:"questions_asked,omitempty"`
	TodoList         json.RawMessage       `json:"todo_list,omitempty"`
	HandoffPrompt    string                `json:"handoff_prompt"`
	HandoffTarget    string                `json:"handoff_target"`
	JudgeScores      map[string]JudgeScore `json:"judge_scores,omitempty"`
	Complete         bool                  `json:"complete"`
	FailReason       string                `json:"fail_reason,omitempty"`
	TurnTimings      []TurnTiming          `json:"turn_timings,omitempty"`
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

	// Per-turn breakdown table.
	printPerTurnSummary(w, results)
}

// turnAgg accumulates per-turn stats for averaging.
type turnAgg struct {
	count    int
	apiMs    int64
	inTok    int64
	outTok   int64
	toolSets map[string]int // tool combination -> frequency
}

// printPerTurnSummary prints an aggregated per-turn breakdown table.
func printPerTurnSummary(w io.Writer, results []*FullResult) {
	agg := map[int]*turnAgg{}

	for _, r := range results {
		for _, tt := range r.TurnTimings {
			a, ok := agg[tt.Turn]
			if !ok {
				a = &turnAgg{toolSets: map[string]int{}}
				agg[tt.Turn] = a
			}
			a.count++
			a.apiMs += tt.APIMs
			a.inTok += tt.InputTokens
			a.outTok += tt.OutputTokens

			toolKey := strings.Join(tt.ToolsCalled, ", ")
			if toolKey == "" {
				toolKey = "(none)"
			}
			a.toolSets[toolKey]++
		}
	}

	if len(agg) == 0 {
		return
	}

	// Sort turn numbers.
	turns := make([]int, 0, len(agg))
	for turn := range agg {
		turns = append(turns, turn)
	}
	sort.Ints(turns)

	fmt.Fprintf(w, "\nPer-Turn Breakdown:\n")

	pt := table.NewWriter()
	pt.SetOutputMirror(w)
	pt.AppendHeader(table.Row{"Turn", "Count", "Avg API", "Avg In Tok", "Avg Out Tok", "Common Tools"})
	pt.SetStyle(table.StyleLight)
	pt.Style().Format.HeaderAlign = text.AlignCenter
	pt.SetColumnConfigs([]table.ColumnConfig{
		{Number: 1, Align: text.AlignRight},
		{Number: 2, Align: text.AlignRight},
		{Number: 3, Align: text.AlignRight},
		{Number: 4, Align: text.AlignRight},
		{Number: 5, Align: text.AlignRight},
		{Number: 6, Align: text.AlignLeft, WidthMax: 40, WidthMaxEnforcer: text.WrapSoft},
	})

	for _, turn := range turns {
		a := agg[turn]
		n := float64(a.count)

		// Find most common tool set.
		bestTools := ""
		bestCount := 0
		for tools, cnt := range a.toolSets {
			if cnt > bestCount {
				bestCount = cnt
				bestTools = tools
			}
		}

		pt.AppendRow(table.Row{
			turn,
			a.count,
			fmt.Sprintf("%.1fs", float64(a.apiMs)/n/1000),
			fmt.Sprintf("%.0f", float64(a.inTok)/n),
			fmt.Sprintf("%.0f", float64(a.outTok)/n),
			bestTools,
		})
	}

	pt.Render()
}
