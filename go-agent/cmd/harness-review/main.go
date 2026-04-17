package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/harness"
)

func main() {
	brief := flag.Bool("brief", false, "one-line-per-result summary")
	flag.Parse()

	paths := flag.Args()
	if len(paths) == 0 {
		fmt.Fprintln(os.Stderr, "usage: harness-review [-brief] <result.json ...> or <results-dir>")
		os.Exit(1)
	}

	// Expand directories to JSON files.
	var files []string
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		if info.IsDir() {
			found, err := collectJSONFiles(p)
			if err != nil {
				fmt.Fprintf(os.Stderr, "error scanning %s: %v\n", p, err)
				os.Exit(1)
			}
			files = append(files, found...)
		} else {
			files = append(files, p)
		}
	}

	sort.Strings(files)

	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "no JSON result files found")
		os.Exit(1)
	}

	if *brief {
		printBrief(files)
		return
	}

	for i, f := range files {
		if i > 0 {
			fmt.Println(strings.Repeat("═", 80))
			fmt.Println()
		}
		printDetail(f)
	}
}

func collectJSONFiles(dir string) ([]string, error) {
	var files []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(path, ".json") {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}

func loadResult(path string) (*harness.FullResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var r harness.FullResult
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func printBrief(files []string) {
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintf(w, "CONFIG\tCASE\tTURNS\tLATENCY\tCOST\tASKED\tNAME\tSCORES\n")

	for _, f := range files {
		r, err := loadResult(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "skip %s: %v\n", f, err)
			continue
		}

		cost := r.AgentCostUSD + r.ResponderCostUSD + r.JudgeCostUSD
		asked := "no"
		if r.AskedQuestions {
			asked = fmt.Sprintf("yes(%d)", len(r.QuestionsAsked))
		}

		name := r.ProjectName
		if r.FailReason != "" {
			name = "FAIL:" + r.FailReason
		}

		var scores []string
		for k, v := range r.JudgeScores {
			scores = append(scores, fmt.Sprintf("%s=%d", k, v.Score))
		}
		sort.Strings(scores)

		fmt.Fprintf(w, "%s\t%s\t%d\t%.1fs\t$%.3f\t%s\t%s\t%s\n",
			r.ConfigName,
			r.TestCaseID,
			r.Turns,
			float64(r.LatencyMs)/1000,
			cost,
			asked,
			name,
			strings.Join(scores, ", "),
		)
	}
	_ = w.Flush()
}

func printDetail(path string) {
	r, err := loadResult(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error loading %s: %v\n", path, err)
		return
	}

	totalCost := r.AgentCostUSD + r.ResponderCostUSD + r.JudgeCostUSD

	// Header
	fmt.Printf("  Config: %s | Case: %s | Run: %d\n", r.ConfigName, r.TestCaseID, r.RunNumber)
	fmt.Printf("  Model: %s | Temp: %.2f\n", r.Model, r.Temperature)
	if r.FailReason != "" {
		fmt.Printf("  Status: FAILED (%s)\n", r.FailReason)
	} else {
		fmt.Printf("  Status: Complete\n")
	}
	fmt.Println()

	// Timing
	fmt.Printf("  Timing: %d turns, %.1fs total, $%.4f\n",
		r.Turns, float64(r.LatencyMs)/1000, totalCost)
	fmt.Printf("  Cost breakdown: agent $%.4f + responder $%.4f + judge $%.4f\n",
		r.AgentCostUSD, r.ResponderCostUSD, r.JudgeCostUSD)
	fmt.Println()

	// Per-turn timing
	if len(r.TurnTimings) > 0 {
		fmt.Println("  Turn Breakdown:")
		for _, tt := range r.TurnTimings {
			tools := strings.Join(tt.ToolsCalled, ", ")
			if tools == "" {
				tools = "(none)"
			}
			fmt.Printf("    Turn %d: %.1fs | in=%d out=%d | %s\n",
				tt.Turn,
				float64(tt.APIMs)/1000,
				tt.InputTokens,
				tt.OutputTokens,
				tools,
			)
		}
		fmt.Println()
	}

	// Project name
	fmt.Printf("  Project Name: %s\n", r.ProjectName)
	fmt.Println()

	// Questions
	if r.AskedQuestions && len(r.QuestionsAsked) > 0 {
		fmt.Printf("  Questions Asked (%d):\n", len(r.QuestionsAsked))
		for i, q := range r.QuestionsAsked {
			fmt.Printf("    %d. %s\n", i+1, q)
		}
		fmt.Println()
	}

	// Todo list
	if len(r.TodoList) > 0 {
		var todo struct {
			ListName string `json:"listName"`
			Items    []struct {
				Title       string `json:"title"`
				Description string `json:"description"`
			} `json:"items"`
		}
		if json.Unmarshal(r.TodoList, &todo) == nil && len(todo.Items) > 0 {
			fmt.Printf("  Todo List: %s\n", todo.ListName)
			for _, item := range todo.Items {
				fmt.Printf("    - %s: %s\n", item.Title, item.Description)
			}
			fmt.Println()
		}
	}

	// Judge scores
	if len(r.JudgeScores) > 0 {
		fmt.Println("  Judge Scores:")
		var names []string
		for k := range r.JudgeScores {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, name := range names {
			s := r.JudgeScores[name]
			fmt.Printf("    %s: %d/5\n", name, s.Score)
			// Wrap reasoning at ~70 chars for readability.
			wrapped := wrapText(s.Reasoning, 70)
			for _, line := range wrapped {
				fmt.Printf("      %s\n", line)
			}
		}
		fmt.Println()
	}

	// Handoff prompt
	if r.HandoffPrompt != "" {
		fmt.Printf("  Handoff Target: %s\n", r.HandoffTarget)
		fmt.Println("  Handoff Prompt:")
		fmt.Println(indent(r.HandoffPrompt, "    "))
		fmt.Println()
	}
}

// wrapText breaks text into lines of at most maxWidth characters,
// splitting on word boundaries.
func wrapText(text string, maxWidth int) []string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return nil
	}

	var lines []string
	line := words[0]
	for _, w := range words[1:] {
		if len(line)+1+len(w) > maxWidth {
			lines = append(lines, line)
			line = w
		} else {
			line += " " + w
		}
	}
	lines = append(lines, line)
	return lines
}

// indent prefixes every line with the given prefix.
func indent(text, prefix string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}
