// cmd/cli/main.go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

func main() {
	count := flag.Int("count", 10, "number of results to return")
	server := flag.String("server", "http://localhost:8080", "server URL")
	flag.Parse()

	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "Error: query is required")
		fmt.Fprintln(os.Stderr, "Usage: image-search [flags] <query>")
		fmt.Fprintln(os.Stderr, "Flags:")
		flag.PrintDefaults()
		os.Exit(1)
	}

	query := strings.Join(flag.Args(), " ")

	if err := search(*server, query, *count); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func search(serverURL, query string, count int) error {
	searchReq := models.SearchRequest{
		Query: query,
		Count: count,
	}

	body, err := json.Marshal(searchReq)
	if err != nil {
		return fmt.Errorf("failed to encode request: %w", err)
	}

	url := strings.TrimSuffix(serverURL, "/") + "/api/v1/search"
	httpReq, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("cannot connect to server at %s: %w", serverURL, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp models.ErrorResponse
		if json.Unmarshal(respBody, &errResp) == nil && errResp.Error != "" {
			return fmt.Errorf("server error: %s", errResp.Error)
		}
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	var searchResp models.SearchResponse
	if err := json.Unmarshal(respBody, &searchResp); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(searchResp.Results) == 0 {
		fmt.Fprintln(os.Stdout, "No results found for query")
		return nil
	}

	printResults(searchResp)
	return nil
}

func printResults(resp models.SearchResponse) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	fmt.Fprintln(w, "GETTY ID\tSCORE\tSUBJECT\tTONE\tTHUMBNAIL")

	for _, r := range resp.Results {
		subject := ""
		tone := ""
		if r.Analysis != nil {
			subject = truncate(r.Analysis.PrimarySubject, 20)
			if len(r.Analysis.Tone) > 0 {
				tone = r.Analysis.Tone[0]
			}
		}

		fmt.Fprintf(w, "%s\t%.2f\t%s\t%s\t%s\n",
			r.GettyID,
			r.RelevanceScore,
			subject,
			tone,
			r.URLs.Thumbnail,
		)
	}

	_ = w.Flush()

	fmt.Fprintf(os.Stdout, "\n%d results (cached: %d, analyzed: %d)\n",
		resp.Meta.Total, resp.Meta.Cached, resp.Meta.Analyzed)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
