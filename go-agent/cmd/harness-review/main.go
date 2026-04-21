package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/jedib0t/go-pretty/v6/table"
	"github.com/jedib0t/go-pretty/v6/text"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/harness"
)

const (
	toolFilterAll = "all"
	toolGroupNone = "(none)"
)

func main() {
	brief := flag.Bool("brief", false, "one-line-per-result summary")
	compare := flag.Bool(
		"compare",
		false,
		"compare two result directories: -compare <baseline-dir> <candidate-dir>",
	)
	latency := flag.String(
		"latency",
		"",
		"latency breakdown by tool call (e.g. -latency handoff, -latency all, -latency setProjectName,todoList)",
	)
	outlierThreshold := flag.Int(
		"outlier",
		1,
		"score delta threshold to flag as outlier (default 1)",
	)
	flag.Parse()

	paths := flag.Args()

	if *compare {
		if len(paths) != 2 {
			fmt.Fprintln(
				os.Stderr,
				"usage: harness-review -compare [-outlier N] <baseline-dir> <candidate-dir>",
			)
			fmt.Fprintln(
				os.Stderr,
				"       harness-review -compare -latency <tool-filter> <baseline-dir> <candidate-dir>",
			)
			os.Exit(1)
		}
		if *latency != "" {
			runLatencyCompare(paths[0], paths[1], *latency)
			return
		}
		runCompare(paths[0], paths[1], *outlierThreshold)
		return
	}

	if len(paths) == 0 {
		fmt.Fprintln(os.Stderr, "usage: harness-review [-brief] <result.json ...> or <results-dir>")
		fmt.Fprintln(
			os.Stderr,
			"       harness-review -compare [-outlier N] <baseline-dir> <candidate-dir>",
		)
		fmt.Fprintln(os.Stderr, "       harness-review -latency <tool-filter> <results-dir>")
		fmt.Fprintln(
			os.Stderr,
			"       harness-review -compare -latency <tool-filter> <baseline-dir> <candidate-dir>",
		)
		fmt.Fprintln(os.Stderr, "         tool-filter: 'all', 'handoff', 'todoList', etc.")
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

	if *latency != "" {
		printLatency(files, *latency)
		return
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

// loadResultsDir loads all results from a directory, keyed by test case ID.
// When multiple runs exist for the same case, the latest (highest run number) is used.
func loadResultsDir(dir string) (map[string]*harness.FullResult, error) {
	files, err := collectJSONFiles(dir)
	if err != nil {
		return nil, err
	}

	results := make(map[string]*harness.FullResult)
	for _, f := range files {
		r, err := loadResult(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "skip %s: %v\n", f, err)
			continue
		}
		existing, ok := results[r.TestCaseID]
		if !ok || r.RunNumber > existing.RunNumber {
			results[r.TestCaseID] = r
		}
	}
	return results, nil
}

type scoreDelta struct {
	testCase   string
	criterion  string
	baseline   int
	candidate  int
	delta      int
	baseReason string
	candReason string
}

func runCompare(baseDir, candDir string, outlierThreshold int) {
	baseResults, err := loadResultsDir(baseDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error loading baseline %s: %v\n", baseDir, err)
		os.Exit(1)
	}
	candResults, err := loadResultsDir(candDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error loading candidate %s: %v\n", candDir, err)
		os.Exit(1)
	}

	// Determine config names from first result in each set.
	baseName, candName := filepath.Base(baseDir), filepath.Base(candDir)
	for _, r := range baseResults {
		baseName = r.ConfigName
		break
	}
	for _, r := range candResults {
		candName = r.ConfigName
		break
	}

	// Collect all test cases and criteria.
	caseSet := map[string]struct{}{}
	criteriaSet := map[string]struct{}{}
	for id, r := range baseResults {
		caseSet[id] = struct{}{}
		for k := range r.JudgeScores {
			criteriaSet[k] = struct{}{}
		}
	}
	for id, r := range candResults {
		caseSet[id] = struct{}{}
		for k := range r.JudgeScores {
			criteriaSet[k] = struct{}{}
		}
	}

	cases := sortedKeys(caseSet)
	criteria := sortedKeys(criteriaSet)

	// --- Per-case comparison table ---
	fmt.Printf("Comparison: %s (baseline) vs %s (candidate)\n", baseName, candName)
	fmt.Printf(
		"Test cases: %d baseline, %d candidate, %d matched\n\n",
		len(baseResults),
		len(candResults),
		countMatched(cases, baseResults, candResults),
	)

	t := table.NewWriter()
	t.SetOutputMirror(os.Stdout)

	header := table.Row{"Test Case"}
	for _, c := range criteria {
		header = append(header, shortCriterion(c))
	}
	header = append(header, "Cost Δ", "Latency Δ")
	t.AppendHeader(header)
	t.SetStyle(table.StyleLight)
	t.Style().Format.HeaderAlign = text.AlignCenter

	colConfigs := []table.ColumnConfig{
		{Number: 1, Align: text.AlignLeft},
	}
	for i := range criteria {
		colConfigs = append(colConfigs, table.ColumnConfig{Number: i + 2, Align: text.AlignCenter})
	}
	colConfigs = append(colConfigs,
		table.ColumnConfig{Number: len(criteria) + 2, Align: text.AlignRight},
		table.ColumnConfig{Number: len(criteria) + 3, Align: text.AlignRight},
	)
	t.SetColumnConfigs(colConfigs)

	// Accumulators for averages.
	baseSum := make(map[string]float64)
	candSum := make(map[string]float64)
	baseCnt := make(map[string]int)
	candCnt := make(map[string]int)
	var baseCostSum, candCostSum float64
	var baseLatSum, candLatSum int64
	var matchedCount int
	var allDeltas []scoreDelta

	for _, caseID := range cases {
		br, bOK := baseResults[caseID]
		cr, cOK := candResults[caseID]
		if !bOK || !cOK {
			continue
		}
		matchedCount++

		bCost := br.AgentCostUSD + br.ResponderCostUSD + br.JudgeCostUSD
		cCost := cr.AgentCostUSD + cr.ResponderCostUSD + cr.JudgeCostUSD
		baseCostSum += bCost
		candCostSum += cCost
		baseLatSum += br.LatencyMs
		candLatSum += cr.LatencyMs

		row := table.Row{caseID}
		for _, crit := range criteria {
			bs, bHas := br.JudgeScores[crit]
			cs, cHas := cr.JudgeScores[crit]
			if bHas {
				baseSum[crit] += float64(bs.Score)
				baseCnt[crit]++
			}
			if cHas {
				candSum[crit] += float64(cs.Score)
				candCnt[crit]++
			}

			if bHas && cHas {
				delta := cs.Score - bs.Score
				cell := formatDelta(delta, abs(delta) > outlierThreshold)
				row = append(row, cell)

				if delta != 0 {
					allDeltas = append(allDeltas, scoreDelta{
						testCase:   caseID,
						criterion:  crit,
						baseline:   bs.Score,
						candidate:  cs.Score,
						delta:      delta,
						baseReason: bs.Reasoning,
						candReason: cs.Reasoning,
					})
				}
			} else if bHas {
				row = append(row, fmt.Sprintf("%d→?", bs.Score))
			} else if cHas {
				row = append(row, fmt.Sprintf("?→%d", cs.Score))
			} else {
				row = append(row, "-")
			}
		}

		costDelta := cCost - bCost
		latDelta := float64(cr.LatencyMs-br.LatencyMs) / 1000
		row = append(row, fmt.Sprintf("%+.3f", costDelta))
		row = append(row, fmt.Sprintf("%+.1fs", latDelta))
		t.AppendRow(row)
	}

	// Footer with averages.
	footer := table.Row{"Avg"}
	for _, crit := range criteria {
		bAvg := safeAvg(baseSum[crit], baseCnt[crit])
		cAvg := safeAvg(candSum[crit], candCnt[crit])
		delta := cAvg - bAvg
		footer = append(footer, fmt.Sprintf("%.2f→%.2f (%+.2f)", bAvg, cAvg, delta))
	}
	if matchedCount > 0 {
		n := float64(matchedCount)
		footer = append(footer, fmt.Sprintf("%+.3f", (candCostSum-baseCostSum)/n))
		footer = append(footer, fmt.Sprintf("%+.1fs", float64(candLatSum-baseLatSum)/n/1000))
	} else {
		footer = append(footer, "-", "-")
	}
	t.AppendFooter(footer)
	t.Render()

	printCompareSummary(
		allDeltas,
		matchedCount,
		len(criteria),
		baseName,
		candName,
		baseCostSum,
		candCostSum,
		baseLatSum,
		candLatSum,
	)
	printOutliers(allDeltas, outlierThreshold, baseName, candName)
}

func printCompareSummary(
	allDeltas []scoreDelta, matchedCount, numCriteria int,
	baseName, candName string,
	baseCostSum, candCostSum float64,
	baseLatSum, candLatSum int64,
) {
	fmt.Println()
	var improved, regressed int
	var improvedPts, regressedPts int
	for _, d := range allDeltas {
		if d.delta > 0 {
			improved++
			improvedPts += d.delta
		} else {
			regressed++
			regressedPts += -d.delta
		}
	}
	total := matchedCount * numCriteria
	unchanged := total - improved - regressed
	fmt.Printf(
		"Score changes: %d unchanged, %d improved (+%d pts), %d regressed (-%d pts) out of %d scores\n",
		unchanged,
		improved,
		improvedPts,
		regressed,
		regressedPts,
		total,
	)

	if matchedCount > 0 {
		n := float64(matchedCount)
		fmt.Printf("Cost: %s avg $%.4f, %s avg $%.4f (Δ %+.4f)\n",
			baseName, baseCostSum/n, candName, candCostSum/n, (candCostSum-baseCostSum)/n)
		fmt.Printf(
			"Latency: %s avg %.1fs, %s avg %.1fs (Δ %+.1fs)\n",
			baseName, float64(baseLatSum)/n/1000,
			candName, float64(candLatSum)/n/1000,
			float64(candLatSum-baseLatSum)/n/1000,
		)
	}
}

func printOutliers(allDeltas []scoreDelta, outlierThreshold int, baseName, candName string) {
	var outliers []scoreDelta
	for _, d := range allDeltas {
		if abs(d.delta) > outlierThreshold {
			outliers = append(outliers, d)
		}
	}

	if len(outliers) == 0 {
		fmt.Printf("\nNo outliers (all deltas within ±%d).\n", outlierThreshold)
		return
	}

	sort.Slice(outliers, func(i, j int) bool {
		ai, aj := abs(outliers[i].delta), abs(outliers[j].delta)
		if ai != aj {
			return ai > aj
		}
		return outliers[i].testCase < outliers[j].testCase
	})

	fmt.Printf("\n══ Outliers (|delta| > %d) ══\n", outlierThreshold)
	for _, o := range outliers {
		tag := "▲ IMPROVED"
		if o.delta < 0 {
			tag = "▼ REGRESSED"
		}
		fmt.Printf(
			"\n%s  %s / %s: %d → %d (%+d)\n",
			tag, o.testCase, o.criterion, o.baseline, o.candidate, o.delta,
		)
		fmt.Printf("  %s reasoning:\n", baseName)
		for _, line := range wrapText(o.baseReason, 72) {
			fmt.Printf("    %s\n", line)
		}
		fmt.Printf("  %s reasoning:\n", candName)
		for _, line := range wrapText(o.candReason, 72) {
			fmt.Printf("    %s\n", line)
		}
	}
}

type turnEntry struct {
	testCase    string
	tools       string
	apiMs       int64
	latencyMs   int64
	inTok       int64
	outTok      int64
	textContent string
}

func printLatency(files []string, filter string) {
	// Collect all turn entries grouped by tool combination.
	groups := map[string][]turnEntry{}

	for _, f := range files {
		r, err := loadResult(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "skip %s: %v\n", f, err)
			continue
		}

		for _, tt := range r.TurnTimings {
			tools := strings.Join(tt.ToolsCalled, ", ")
			if tools == "" {
				tools = toolGroupNone
			}

			if filter != toolFilterAll && !toolsMatchFilter(tools, filter) {
				continue
			}

			groups[tools] = append(groups[tools], turnEntry{
				testCase:    r.TestCaseID,
				tools:       tools,
				apiMs:       tt.APIMs,
				latencyMs:   tt.LatencyMs,
				inTok:       tt.InputTokens,
				outTok:      tt.OutputTokens,
				textContent: tt.TextContent,
			})
		}
	}

	if len(groups) == 0 {
		fmt.Println("No matching turns found.")
		return
	}

	// Sort group keys for stable output.
	groupKeys := make([]string, 0, len(groups))
	for k := range groups {
		groupKeys = append(groupKeys, k)
	}
	sort.Strings(groupKeys)

	for _, tools := range groupKeys {
		entries := groups[tools]

		// Sort entries by API time descending (slowest first).
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].apiMs > entries[j].apiMs
		})

		// Compute stats.
		var sumAPI, sumOut, sumIn int64
		var minAPI, maxAPI int64
		minAPI = math.MaxInt64
		for _, e := range entries {
			sumAPI += e.apiMs
			sumIn += e.inTok
			sumOut += e.outTok
			if e.apiMs < minAPI {
				minAPI = e.apiMs
			}
			if e.apiMs > maxAPI {
				maxAPI = e.apiMs
			}
		}
		n := int64(len(entries))
		avgAPI := float64(sumAPI) / float64(n)

		fmt.Printf("══ %s (%d cases) ══\n", tools, len(entries))
		fmt.Printf("   API: avg %.1fs  min %.1fs  max %.1fs  |  Out: avg %d  |  In: avg %d\n\n",
			avgAPI/1000, float64(minAPI)/1000, float64(maxAPI)/1000,
			sumOut/n, sumIn/n)

		// Per-case table sorted slowest first.
		t := table.NewWriter()
		t.SetOutputMirror(os.Stdout)
		t.AppendHeader(table.Row{"Test Case", "API", "In", "Out", "Text"})
		t.SetStyle(table.StyleLight)
		t.SetColumnConfigs([]table.ColumnConfig{
			{Number: 1, Align: text.AlignLeft},
			{Number: 2, Align: text.AlignRight},
			{Number: 3, Align: text.AlignRight},
			{Number: 4, Align: text.AlignRight},
			{Number: 5, Align: text.AlignLeft, WidthMax: 50, WidthMaxEnforcer: text.WrapSoft},
		})

		for _, e := range entries {
			textPreview := e.textContent
			if textPreview == "" {
				textPreview = "-"
			} else if len(textPreview) > 80 {
				textPreview = textPreview[:77] + "..."
			}
			t.AppendRow(table.Row{
				e.testCase,
				fmt.Sprintf("%.1fs", float64(e.apiMs)/1000),
				e.inTok,
				e.outTok,
				textPreview,
			})
		}
		t.Render()
		fmt.Println()
	}
}

type toolGroupStats struct {
	count  int
	sumAPI int64
	sumIn  int64
	sumOut int64
	minAPI int64
	maxAPI int64
}

func (s *toolGroupStats) avgAPI() float64 { return float64(s.sumAPI) / float64(s.count) }
func (s *toolGroupStats) avgOut() int64   { return s.sumOut / int64(s.count) }

// collectToolStats collects per-tool-group stats from result files.
func collectToolStats(files []string, filter string) map[string]*toolGroupStats {
	stats := map[string]*toolGroupStats{}
	for _, f := range files {
		r, err := loadResult(f)
		if err != nil {
			continue
		}
		for _, tt := range r.TurnTimings {
			tools := strings.Join(tt.ToolsCalled, ", ")
			if tools == "" {
				tools = toolGroupNone
			}
			if filter != toolFilterAll && !toolsMatchFilter(tools, filter) {
				continue
			}
			s, ok := stats[tools]
			if !ok {
				s = &toolGroupStats{minAPI: tt.APIMs, maxAPI: tt.APIMs}
				stats[tools] = s
			}
			s.count++
			s.sumAPI += tt.APIMs
			s.sumIn += tt.InputTokens
			s.sumOut += tt.OutputTokens
			if tt.APIMs < s.minAPI {
				s.minAPI = tt.APIMs
			}
			if tt.APIMs > s.maxAPI {
				s.maxAPI = tt.APIMs
			}
		}
	}
	return stats
}

// collectPerCaseToolEntries collects per-test-case turn entries keyed by test case ID.
func collectPerCaseToolEntries(files []string, filter string) map[string]turnEntry {
	entries := map[string]turnEntry{}
	for _, f := range files {
		r, err := loadResult(f)
		if err != nil {
			continue
		}
		for _, tt := range r.TurnTimings {
			tools := strings.Join(tt.ToolsCalled, ", ")
			if tools == "" {
				tools = toolGroupNone
			}
			if filter != toolFilterAll && !toolsMatchFilter(tools, filter) {
				continue
			}
			entries[r.TestCaseID] = turnEntry{
				testCase: r.TestCaseID,
				tools:    tools,
				apiMs:    tt.APIMs,
				inTok:    tt.InputTokens,
				outTok:   tt.OutputTokens,
			}
		}
	}
	return entries
}

func runLatencyCompare(baseDir, candDir, filter string) {
	baseFiles, err := collectJSONFiles(baseDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error loading baseline %s: %v\n", baseDir, err)
		os.Exit(1)
	}
	candFiles, err := collectJSONFiles(candDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error loading candidate %s: %v\n", candDir, err)
		os.Exit(1)
	}

	baseStats := collectToolStats(baseFiles, filter)
	candStats := collectToolStats(candFiles, filter)

	// Collect all tool group keys from both sides.
	keySet := map[string]struct{}{}
	for k := range baseStats {
		keySet[k] = struct{}{}
	}
	for k := range candStats {
		keySet[k] = struct{}{}
	}
	keys := sortedKeys(keySet)

	if len(keys) == 0 {
		fmt.Println("No matching turns found in either directory.")
		return
	}

	baseName := filepath.Base(baseDir)
	candName := filepath.Base(candDir)

	fmt.Printf("Latency Compare: %s vs %s  (filter: %s)\n\n", baseName, candName, filter)

	// Summary table: one row per tool group.
	t := table.NewWriter()
	t.SetOutputMirror(os.Stdout)
	t.AppendHeader(table.Row{
		"Tools",
		baseName + "\nAvg API", baseName + "\nAvg Out",
		candName + "\nAvg API", candName + "\nAvg Out",
		"Δ API", "Δ Out",
	})
	t.SetStyle(table.StyleLight)
	t.Style().Format.HeaderAlign = text.AlignCenter
	t.SetColumnConfigs([]table.ColumnConfig{
		{Number: 1, Align: text.AlignLeft, WidthMax: 30, WidthMaxEnforcer: text.WrapSoft},
		{Number: 2, Align: text.AlignRight},
		{Number: 3, Align: text.AlignRight},
		{Number: 4, Align: text.AlignRight},
		{Number: 5, Align: text.AlignRight},
		{Number: 6, Align: text.AlignRight},
		{Number: 7, Align: text.AlignRight},
	})

	for _, k := range keys {
		bs, bOK := baseStats[k]
		cs, cOK := candStats[k]

		bAPI, bOut := "-", "-"
		cAPI, cOut := "-", "-"
		dAPI, dOut := "-", "-"

		if bOK {
			bAPI = fmt.Sprintf("%.1fs", bs.avgAPI()/1000)
			bOut = strconv.FormatInt(bs.avgOut(), 10)
		}
		if cOK {
			cAPI = fmt.Sprintf("%.1fs", cs.avgAPI()/1000)
			cOut = strconv.FormatInt(cs.avgOut(), 10)
		}
		if bOK && cOK {
			deltaAPI := cs.avgAPI() - bs.avgAPI()
			deltaOut := cs.avgOut() - bs.avgOut()
			dAPI = fmt.Sprintf("%+.1fs", deltaAPI/1000)
			dOut = fmt.Sprintf("%+d", deltaOut)
		}

		t.AppendRow(table.Row{k, bAPI, bOut, cAPI, cOut, dAPI, dOut})
	}
	t.Render()

	// Per-case detail table for matched test cases.
	baseEntries := collectPerCaseToolEntries(baseFiles, filter)
	candEntries := collectPerCaseToolEntries(candFiles, filter)

	// Collect matched cases.
	type caseDelta struct {
		testCase string
		bAPI     int64
		cAPI     int64
		bOut     int64
		cOut     int64
	}
	var deltas []caseDelta
	for tc, be := range baseEntries {
		if ce, ok := candEntries[tc]; ok {
			deltas = append(deltas, caseDelta{
				testCase: tc,
				bAPI:     be.apiMs,
				cAPI:     ce.apiMs,
				bOut:     be.outTok,
				cOut:     ce.outTok,
			})
		}
	}

	if len(deltas) == 0 {
		return
	}

	// Sort by API delta descending (biggest slowdown first).
	sort.Slice(deltas, func(i, j int) bool {
		di := deltas[i].cAPI - deltas[i].bAPI
		dj := deltas[j].cAPI - deltas[j].bAPI
		return di > dj
	})

	fmt.Printf("\nPer-Case Detail (%d matched):\n", len(deltas))

	dt := table.NewWriter()
	dt.SetOutputMirror(os.Stdout)
	dt.AppendHeader(table.Row{
		"Test Case",
		baseName + " API", baseName + " Out",
		candName + " API", candName + " Out",
		"Δ API", "Δ Out",
	})
	dt.SetStyle(table.StyleLight)
	dt.Style().Format.HeaderAlign = text.AlignCenter
	dt.SetColumnConfigs([]table.ColumnConfig{
		{Number: 1, Align: text.AlignLeft},
		{Number: 2, Align: text.AlignRight},
		{Number: 3, Align: text.AlignRight},
		{Number: 4, Align: text.AlignRight},
		{Number: 5, Align: text.AlignRight},
		{Number: 6, Align: text.AlignRight},
		{Number: 7, Align: text.AlignRight},
	})

	for _, d := range deltas {
		deltaAPI := d.cAPI - d.bAPI
		deltaOut := d.cOut - d.bOut
		dt.AppendRow(table.Row{
			d.testCase,
			fmt.Sprintf("%.1fs", float64(d.bAPI)/1000),
			d.bOut,
			fmt.Sprintf("%.1fs", float64(d.cAPI)/1000),
			d.cOut,
			fmt.Sprintf("%+.1fs", float64(deltaAPI)/1000),
			fmt.Sprintf("%+d", deltaOut),
		})
	}
	dt.Render()
}

// toolsMatchFilter checks if a tool combination matches the filter.
// The filter can be a single tool name (matches any combination containing it)
// or a full combination like "setProjectName, todoList" (exact match).
func toolsMatchFilter(tools, filter string) bool {
	if tools == filter {
		return true
	}
	return slices.Contains(slices.Collect(strings.SplitSeq(tools, ", ")), filter)
}

func formatDelta(delta int, outlier bool) string {
	if delta == 0 {
		return "·"
	}
	s := fmt.Sprintf("%+d", delta)
	if outlier {
		if delta > 0 {
			s = "▲" + s
		} else {
			s = "▼" + s
		}
	}
	return s
}

func shortCriterion(name string) string {
	abbrevs := map[string]string{
		"project_name_quality": "name",
		"handoff_completeness": "handoff",
		"design_specificity":   "specif",
		"anti_cliche":          "anti_cl",
		"design_fit_and_vibe":  "fit",
		"visual_impact":        "impact",
		"actionability":        "action",
		"feature_list_quality": "features",
	}
	if short, ok := abbrevs[name]; ok {
		return short
	}
	if len(name) > 8 {
		return name[:8]
	}
	return name
}

func sortedKeys(m map[string]struct{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func countMatched(cases []string, a, b map[string]*harness.FullResult) int {
	n := 0
	for _, c := range cases {
		if _, aOK := a[c]; aOK {
			if _, bOK := b[c]; bOK {
				n++
			}
		}
	}
	return n
}

func safeAvg(sum float64, count int) float64 {
	if count == 0 {
		return 0
	}
	return math.Round(sum/float64(count)*100) / 100
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
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
				tools = toolGroupNone
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
