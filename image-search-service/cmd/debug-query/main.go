// cmd/debug-query executes Qdrant queries for each stage of hybrid search and
// dumps results so you can see exactly what each retrieval leg returns.
//
// Modes:
//
//	# Run all hybrid search stages
//	go run ./cmd/debug-query \
//	  --query "sushi bar chef preparing fresh sushi counter" \
//	  --context "wide hero banner showing sushi chef ..." \
//	  --orientations horizontal --moods cool
//
//	# Search for text in stored images (find what's in the cache)
//	go run ./cmd/debug-query --mode search --text "sushi"
//
//	# Look up specific Getty IDs to see if they're in Qdrant
//	go run ./cmd/debug-query --mode lookup --ids "1357371890,2148416270"
//
//	# Run the same Getty query the service would, then check which results are in Qdrant
//	go run ./cmd/debug-query --mode getty \
//	  --query "sushi bar chef preparing fresh sushi counter" \
//	  --orientations horizontal --moods cool
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/airo-ai-builder/image-search-service/internal/config"
	"github.com/airo-ai-builder/image-search-service/internal/embeddings"
	"github.com/airo-ai-builder/image-search-service/internal/getty"
	"github.com/airo-ai-builder/image-search-service/internal/sparse"
	"github.com/airo-ai-builder/image-search-service/pkg/models"
)

const (
	denseVectorName  = "dense"
	sparseVectorName = "keywords"
	stageAll         = "all"
)

// Qdrant REST API response types
type queryResponse struct {
	Result json.RawMessage `json:"result"`
}

type queryPoint struct {
	ID      any              `json:"id"`
	Version int              `json:"version"`
	Score   float64          `json:"score"`
	Payload *json.RawMessage `json:"payload,omitempty"`
}

// Compact result for display
type resultRow struct {
	ID              any     `json:"id"`
	Score           float64 `json:"score,omitempty"`
	GettyID         string  `json:"gettyId,omitempty"`
	Title           string  `json:"title,omitempty"`
	Description     string  `json:"description,omitempty"`
	PreviewURL      string  `json:"previewUrl,omitempty"`
	HasSparse       *bool   `json:"hasSparse,omitempty"`
	AnalysisVersion string  `json:"analysisVersion,omitempty"`
	InQdrant        *bool   `json:"inQdrant,omitempty"`
}

type qdrantEnv struct {
	client     *http.Client
	baseURL    string
	collection string
	apiKey     string
}

func main() {
	mode := flag.String("mode", "hybrid", "mode: hybrid|search|lookup|getty")
	query := flag.String("query", "", "search query")
	queryContext := flag.String("context", "", "search context for re-ranking")
	limit := flag.Int("limit", 5, "number of results")
	prefetchMult := flag.Int("prefetch", 3, "prefetch multiplier")
	qdrantURL := flag.String("qdrant-url", "", "Qdrant REST API URL (default: derived from env)")

	// Filter flags
	orientations := flag.String("orientations", "", "comma-separated orientations filter")
	moods := flag.String("moods", "", "comma-separated moods filter")
	numberOfPeople := flag.String("numberOfPeople", "", "comma-separated numberOfPeople filter")
	subjectCategory := flag.String("subjectCategory", "", "comma-separated subjectCategory filter")
	compositions := flag.String("compositions", "", "comma-separated compositions filter (Getty only)")

	// Mode-specific flags
	stage := flag.String("stage", stageAll, "hybrid mode: which stage to run: dense|sparse|rrf|rescore|all")
	text := flag.String("text", "", "search mode: text to search for in stored images")
	ids := flag.String("ids", "", "lookup mode: comma-separated Getty IDs")

	flag.Parse()

	cfg := config.LoadConfig()

	// Set up Qdrant connection
	env := setupQdrant(cfg, *qdrantURL)

	switch *mode {
	case "search":
		if *text == "" {
			fmt.Fprintln(os.Stderr, "Error: --text is required for search mode")
			os.Exit(1)
		}
		runTextSearch(env, *text, *limit)

	case "lookup":
		if *ids == "" {
			fmt.Fprintln(os.Stderr, "Error: --ids is required for lookup mode")
			os.Exit(1)
		}
		runLookup(env, splitCSV(*ids))

	case "getty":
		if *query == "" {
			fmt.Fprintln(os.Stderr, "Error: --query is required for getty mode")
			os.Exit(1)
		}
		filters := buildSearchFilters(*orientations, *moods, *numberOfPeople, *subjectCategory, *compositions)
		runGettyAndCheck(cfg, env, *query, *limit, filters)

	case "hybrid":
		if *query == "" {
			fmt.Fprintln(os.Stderr, "Error: --query is required for hybrid mode")
			os.Exit(1)
		}
		if cfg.OpenAIAPIKey == "" {
			fmt.Fprintln(os.Stderr, "Error: OPENAI_API_KEY environment variable is required")
			os.Exit(1)
		}
		filters := buildSearchFilters(*orientations, *moods, *numberOfPeople, *subjectCategory, "")
		runHybrid(cfg, env, *query, *queryContext, *limit, *prefetchMult, *stage, filters)

	default:
		fmt.Fprintf(os.Stderr, "Error: unknown mode %q\n", *mode)
		os.Exit(1)
	}
}

func setupQdrant(cfg *config.Config, explicitURL string) *qdrantEnv {
	baseURL := explicitURL
	if baseURL == "" {
		scheme := "http"
		restPort := cfg.QdrantPort - 1
		if cfg.QdrantUseTLS {
			scheme = "https"
		}
		baseURL = fmt.Sprintf("%s://%s:%d", scheme, cfg.QdrantHost, restPort)
	}

	httpClient := &http.Client{}
	if cfg.QdrantUseTLS && cfg.QdrantTLSSkipVerify {
		httpClient.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion:         tls.VersionTLS12,
				InsecureSkipVerify: true, //nolint:gosec // self-signed certs for local dev
			},
		}
	}

	return &qdrantEnv{
		client:     httpClient,
		baseURL:    strings.TrimSuffix(baseURL, "/"),
		collection: cfg.QdrantCollection,
		apiKey:     cfg.QdrantAPIKey,
	}
}

// ── Mode: text search ──────────────────────────────────────────────

func runTextSearch(env *qdrantEnv, text string, limit int) {
	fmt.Fprintf(os.Stderr, "Searching for %q in stored images (searchText field)...\n", text)

	endpoint := fmt.Sprintf("%s/collections/%s/points/scroll", env.baseURL, env.collection)
	body := map[string]any{
		"filter": map[string]any{
			"must": []map[string]any{
				{
					"key":   "searchText",
					"match": map[string]string{"text": text},
				},
			},
		},
		"limit":        limit,
		"with_payload": []string{"gettyId", "title", "description", "analysisVersion", "previewUrl"},
		"with_vectors": []string{sparseVectorName},
	}

	respBody := doRequest(env, endpoint, body)
	if respBody == nil {
		return
	}

	// Scroll response: {"result": {"points": [...], "next_page_offset": ...}}
	var scrollResp struct {
		Result struct {
			Points []struct {
				ID      any              `json:"id"`
				Payload *json.RawMessage `json:"payload,omitempty"`
				Vector  *json.RawMessage `json:"vector,omitempty"`
			} `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBody, &scrollResp); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing scroll response: %v\n", err)
		return
	}

	fmt.Fprintf(os.Stderr, "%d results\n\n", len(scrollResp.Result.Points))

	rows := make([]resultRow, 0, len(scrollResp.Result.Points))
	for _, pt := range scrollResp.Result.Points {
		row := resultRow{ID: pt.ID}
		if pt.Payload != nil {
			var payload map[string]string
			if err := json.Unmarshal(*pt.Payload, &payload); err == nil {
				row.GettyID = payload["gettyId"]
				row.Title = payload["title"]
				row.Description = payload["description"]
				row.PreviewURL = payload["previewUrl"]
				row.AnalysisVersion = payload["analysisVersion"]
			}
		}
		hasSparse := pt.Vector != nil && len(*pt.Vector) > 4 // not just "null" or "{}"
		row.HasSparse = &hasSparse
		rows = append(rows, row)
	}

	printResults(rows)
}

// ── Mode: lookup by ID ─────────────────────────────────────────────

func runLookup(env *qdrantEnv, gettyIDs []string) {
	fmt.Fprintf(os.Stderr, "Looking up %d Getty IDs in Qdrant...\n", len(gettyIDs))

	// Convert Getty IDs to numeric point IDs
	var numericIDs []uint64
	for _, id := range gettyIDs {
		n, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  Skipping invalid ID %q: %v\n", id, err)
			continue
		}
		numericIDs = append(numericIDs, n)
	}

	endpoint := fmt.Sprintf("%s/collections/%s/points", env.baseURL, env.collection)
	body := map[string]any{
		"ids":          numericIDs,
		"with_payload": []string{"gettyId", "title", "description", "analysisVersion", "previewUrl"},
		"with_vectors": []string{sparseVectorName},
	}

	respBody := doRequest(env, endpoint, body)
	if respBody == nil {
		return
	}

	var getResp struct {
		Result []struct {
			ID      any              `json:"id"`
			Payload *json.RawMessage `json:"payload,omitempty"`
			Vector  *json.RawMessage `json:"vector,omitempty"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBody, &getResp); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing response: %v\n", err)
		return
	}

	// Build set of found IDs
	foundIDs := make(map[string]bool)
	rows := make([]resultRow, 0, len(getResp.Result))
	for _, pt := range getResp.Result {
		row := resultRow{ID: pt.ID}
		if pt.Payload != nil {
			var payload map[string]string
			if err := json.Unmarshal(*pt.Payload, &payload); err == nil {
				row.GettyID = payload["gettyId"]
				row.Title = payload["title"]
				row.Description = payload["description"]
				row.PreviewURL = payload["previewUrl"]
				row.AnalysisVersion = payload["analysisVersion"]
				foundIDs[payload["gettyId"]] = true
			}
		}
		hasSparse := pt.Vector != nil && len(*pt.Vector) > 4
		row.HasSparse = &hasSparse
		inQdrant := true
		row.InQdrant = &inQdrant
		rows = append(rows, row)
	}

	// Add missing IDs
	for _, id := range gettyIDs {
		if !foundIDs[id] {
			inQdrant := false
			rows = append(rows, resultRow{GettyID: id, InQdrant: &inQdrant})
		}
	}

	fmt.Fprintf(os.Stderr, "%d found, %d missing\n\n", len(getResp.Result), len(gettyIDs)-len(getResp.Result))
	printResults(rows)
}

// ── Mode: Getty query + Qdrant check ──────────────────────────────

func runGettyAndCheck(cfg *config.Config, env *qdrantEnv, query string, limit int, filters models.SearchFilters) { //nolint:gocyclo // debug tool, linear flow
	fmt.Fprintf(os.Stderr, "Running Getty search for: %q\n", query)

	gettyClient, err := getty.New(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating Getty client: %v\n", err)
		os.Exit(1)
	}

	opts := filtersToGettyOptions(query, limit*4, filters)
	ctx := context.Background()

	resp, err := gettyClient.SearchWithOptions(ctx, opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Getty search error: %v\n", err)
		os.Exit(1)
	}

	var images []getty.ImageResult
	if resp != nil {
		images = resp.Images
	}
	fmt.Fprintf(os.Stderr, "Getty returned %d results\n", len(images))

	if len(images) == 0 {
		fmt.Fprintln(os.Stdout, "[]")
		return
	}

	// Extract IDs and look them up in Qdrant
	gettyIDs := make([]string, len(images))
	titles := make(map[string]string)
	for i, img := range images {
		gettyIDs[i] = img.ID
		titles[img.ID] = img.Title
	}

	fmt.Fprintf(os.Stderr, "Checking which are in Qdrant...\n")

	// Convert to numeric IDs for Qdrant lookup
	var numericIDs []uint64
	for _, id := range gettyIDs {
		n, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			continue
		}
		numericIDs = append(numericIDs, n)
	}

	endpoint := fmt.Sprintf("%s/collections/%s/points", env.baseURL, env.collection)
	body := map[string]any{
		"ids":          numericIDs,
		"with_payload": []string{"gettyId", "title", "description", "analysisVersion", "previewUrl"},
		"with_vectors": []string{sparseVectorName},
	}

	respBody := doRequest(env, endpoint, body)

	foundIDs := make(map[string]resultRow)
	if respBody != nil { //nolint:nestif // debug tool, straightforward nested parsing
		var getResp struct {
			Result []struct {
				ID      any              `json:"id"`
				Payload *json.RawMessage `json:"payload,omitempty"`
				Vector  *json.RawMessage `json:"vector,omitempty"`
			} `json:"result"`
		}
		if err := json.Unmarshal(respBody, &getResp); err == nil {
			for _, pt := range getResp.Result {
				row := resultRow{ID: pt.ID}
				if pt.Payload != nil {
					var payload map[string]string
					if err := json.Unmarshal(*pt.Payload, &payload); err == nil {
						row.GettyID = payload["gettyId"]
						row.Title = payload["title"]
						row.Description = payload["description"]
						row.PreviewURL = payload["previewUrl"]
						row.AnalysisVersion = payload["analysisVersion"]
					}
				}
				hasSparse := pt.Vector != nil && len(*pt.Vector) > 4
				row.HasSparse = &hasSparse
				if row.GettyID != "" {
					foundIDs[row.GettyID] = row
				}
			}
		}
	}

	// Build output: all Getty results with Qdrant status
	rows := make([]resultRow, 0, len(gettyIDs))
	for _, id := range gettyIDs {
		if row, ok := foundIDs[id]; ok {
			inQdrant := true
			row.InQdrant = &inQdrant
			rows = append(rows, row)
		} else {
			inQdrant := false
			rows = append(rows, resultRow{
				GettyID:  id,
				Title:    titles[id],
				InQdrant: &inQdrant,
			})
		}
	}

	inCount := len(foundIDs)
	fmt.Fprintf(os.Stderr, "%d/%d Getty results found in Qdrant\n\n", inCount, len(gettyIDs))
	printResults(rows)
}

// ── Mode: hybrid search stages ─────────────────────────────────────

func runHybrid(cfg *config.Config, env *qdrantEnv, query, queryContext string, limit, prefetchMult int, stage string, filters models.SearchFilters) { //nolint:gocyclo // debug tool, linear flow
	ctx := context.Background()
	embClient := embeddings.New(cfg)

	fmt.Fprintf(os.Stderr, "Generating raw query embedding for: %q\n", query)
	rawEmbedding, err := embClient.Generate(ctx, query)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating raw embedding: %v\n", err)
		os.Exit(1)
	}

	var contextEmbedding []float32
	if queryContext != "" {
		enriched := query + " " + queryContext
		fmt.Fprintf(os.Stderr, "Generating context embedding for: %q\n", enriched)
		contextEmbedding, err = embClient.Generate(ctx, enriched)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error generating context embedding: %v\n", err)
			os.Exit(1)
		}
	}

	sparseIndices, sparseValues := sparse.Vectorize(query)
	fmt.Fprintf(os.Stderr, "Sparse vector: %d non-zero dimensions\n", len(sparseIndices))

	endpoint := fmt.Sprintf("%s/collections/%s/points/query", env.baseURL, env.collection)
	prefetchLimit := limit * prefetchMult
	qdrantFilter := buildQdrantFilterJSON(filters)
	payloadSelector := []string{"description", "title", "gettyId", "previewUrl"}

	sparseQueryObj := map[string]any{
		"indices": sparseIndices,
		"values":  sparseValues,
	}

	if stage == stageAll || stage == "dense" {
		fmt.Fprintf(os.Stderr, "\n=== STAGE 1: Dense Only (raw query embedding) ===\n")
		q := map[string]any{
			"query":        rawEmbedding,
			"using":        denseVectorName,
			"limit":        prefetchLimit,
			"with_payload": payloadSelector,
		}
		if qdrantFilter != nil {
			q["filter"] = qdrantFilter
		}
		runQuery(env, endpoint, q)
	}

	if stage == stageAll || stage == "sparse" {
		fmt.Fprintf(os.Stderr, "\n=== STAGE 2: Sparse Only (raw query keywords) ===\n")
		q := map[string]any{
			"query":        sparseQueryObj,
			"using":        sparseVectorName,
			"limit":        prefetchLimit,
			"with_payload": payloadSelector,
		}
		if qdrantFilter != nil {
			q["filter"] = qdrantFilter
		}
		runQuery(env, endpoint, q)
	}

	if stage == stageAll || stage == "rrf" {
		fmt.Fprintf(os.Stderr, "\n=== STAGE 3: RRF Fusion (dense + sparse, no context rescore) ===\n")
		q := map[string]any{
			"prefetch": []map[string]any{
				{
					"query": rawEmbedding,
					"using": denseVectorName,
					"limit": prefetchLimit,
				},
				{
					"query": sparseQueryObj,
					"using": sparseVectorName,
					"limit": prefetchLimit,
				},
			},
			"query":        map[string]string{"fusion": "rrf"},
			"limit":        limit,
			"with_payload": payloadSelector,
		}
		if qdrantFilter != nil {
			q["filter"] = qdrantFilter
		}
		runQuery(env, endpoint, q)
	}

	if (stage == stageAll || stage == "rescore") && len(contextEmbedding) > 0 {
		fmt.Fprintf(os.Stderr, "\n=== STAGE 4: Full Query (RRF → context rescore) ===\n")
		q := map[string]any{
			"prefetch": []map[string]any{
				{
					"prefetch": []map[string]any{
						{
							"query": rawEmbedding,
							"using": denseVectorName,
							"limit": prefetchLimit,
						},
						{
							"query": sparseQueryObj,
							"using": sparseVectorName,
							"limit": prefetchLimit,
						},
					},
					"query": map[string]string{"fusion": "rrf"},
					"limit": prefetchLimit,
				},
			},
			"query":        contextEmbedding,
			"using":        denseVectorName,
			"limit":        limit,
			"with_payload": payloadSelector,
		}
		if qdrantFilter != nil {
			q["filter"] = qdrantFilter
		}
		runQuery(env, endpoint, q)
	}
}

// ── Shared helpers ──────────────────────────────────────────────────

func doRequest(env *qdrantEnv, endpoint string, body map[string]any) []byte {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling request: %v\n", err)
		return nil
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewReader(jsonBody))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating request: %v\n", err)
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	if env.apiKey != "" {
		req.Header.Set("Api-Key", env.apiKey)
	}

	resp, err := env.client.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading response: %v\n", err)
		return nil
	}

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Qdrant error %d: %s\n", resp.StatusCode, string(respBody))
		return nil
	}

	return respBody
}

func runQuery(env *qdrantEnv, endpoint string, body map[string]any) {
	respBody := doRequest(env, endpoint, body)
	if respBody == nil {
		return
	}

	var qr queryResponse
	if err := json.Unmarshal(respBody, &qr); err != nil {
		fmt.Fprintf(os.Stderr, "  Error parsing response: %v\n", err)
		return
	}

	var points []queryPoint
	if err := json.Unmarshal(qr.Result, &points); err != nil {
		var nested struct {
			Points []queryPoint `json:"points"`
		}
		if err2 := json.Unmarshal(qr.Result, &nested); err2 != nil {
			fmt.Fprintf(os.Stderr, "  Error parsing result: %v\n  Raw: %s\n", err, string(qr.Result[:min(len(qr.Result), 200)]))
			return
		}
		points = nested.Points
	}

	fmt.Fprintf(os.Stderr, "  %d results\n\n", len(points))

	rows := make([]resultRow, 0, len(points))
	for _, pt := range points {
		row := resultRow{
			ID:    pt.ID,
			Score: pt.Score,
		}
		if pt.Payload != nil {
			var payload map[string]string
			if err := json.Unmarshal(*pt.Payload, &payload); err == nil {
				row.GettyID = payload["gettyId"]
				row.Title = payload["title"]
				row.Description = payload["description"]
				row.PreviewURL = payload["previewUrl"]
			}
		}
		rows = append(rows, row)
	}

	printResults(rows)
}

var gettyMetadataFields = []getty.Field{
	getty.FieldDisplaySet,
	getty.FieldMaxDimensions,
	getty.FieldTitle,
	getty.FieldCaption,
	getty.FieldOrientation,
	getty.FieldGraphicalStyle,
	getty.FieldKeywords,
	getty.FieldArtist,
	getty.FieldCollectionCode,
}

func filtersToGettyOptions(query string, count int, filters models.SearchFilters) *getty.SearchOptions {
	opts := getty.NewSearchOptions(query)
	opts.PageSize = count
	opts.Fields = gettyMetadataFields
	for _, v := range filters.Orientations {
		opts.Orientations = append(opts.Orientations, getty.Orientation(v))
	}
	for _, v := range filters.Compositions {
		opts.Compositions = append(opts.Compositions, getty.Composition(v))
	}
	for _, v := range filters.Moods {
		opts.Moods = append(opts.Moods, getty.Mood(v))
	}
	for _, v := range filters.NumberOfPeople {
		opts.NumberOfPeople = append(opts.NumberOfPeople, getty.NumberOfPeople(v))
	}
	return opts
}

func buildSearchFilters(orientations, moods, numberOfPeople, subjectCategory, compositions string) models.SearchFilters {
	filters := models.SearchFilters{}
	if orientations != "" {
		filters.Orientations = splitCSV(orientations)
	}
	if moods != "" {
		filters.Moods = splitCSV(moods)
	}
	if numberOfPeople != "" {
		filters.NumberOfPeople = splitCSV(numberOfPeople)
	}
	if subjectCategory != "" {
		filters.SubjectCategory = splitCSV(subjectCategory)
	}
	if compositions != "" {
		filters.Compositions = splitCSV(compositions)
	}
	return filters
}

func buildQdrantFilterJSON(filters models.SearchFilters) map[string]any {
	mustMappings := []struct {
		field  string
		values []string
	}{
		{"orientation", filters.Orientations},
		{"subjectCategory", filters.SubjectCategory},
		{"graphicalStyle", filters.GraphicalStyles},
		{"numberOfPeople", filters.NumberOfPeople},
	}

	buildCondition := func(field string, values []string) map[string]any {
		lower := toLowerSlice(values)
		if len(lower) == 1 {
			return map[string]any{
				"key":   field,
				"match": map[string]string{"value": lower[0]},
			}
		}
		return map[string]any{
			"key":   field,
			"match": map[string][]string{"any": lower},
		}
	}

	var must []map[string]any
	for _, m := range mustMappings {
		if len(m.values) > 0 {
			must = append(must, buildCondition(m.field, m.values))
		}
	}

	if len(must) == 0 {
		return nil
	}

	return map[string]any{
		"must": must,
	}
}

func printResults(rows []resultRow) {
	w := os.Stdout
	for i, r := range rows {
		fmt.Fprintf(w, "  %d. ", i+1)
		if r.GettyID != "" {
			fmt.Fprintf(w, "[%s]", r.GettyID)
		}
		if r.Score > 0 {
			fmt.Fprintf(w, "  score=%.4f", r.Score)
		}
		if r.InQdrant != nil {
			if *r.InQdrant {
				fmt.Fprint(w, "  ✓ in qdrant")
			} else {
				fmt.Fprint(w, "  ✗ not in qdrant")
			}
		}
		if r.HasSparse != nil {
			if *r.HasSparse {
				fmt.Fprint(w, "  sparse=yes")
			} else {
				fmt.Fprint(w, "  sparse=no")
			}
		}
		if r.AnalysisVersion != "" {
			fmt.Fprintf(w, "  v%s", r.AnalysisVersion)
		}
		fmt.Fprintln(w)
		if r.Title != "" {
			fmt.Fprintf(w, "     %s\n", r.Title)
		}
		if r.Description != "" {
			desc := r.Description
			if len(desc) > 120 {
				desc = desc[:120] + "…"
			}
			fmt.Fprintf(w, "     %s\n", desc)
		}
		if r.PreviewURL != "" {
			fmt.Fprintf(w, "     %s\n", r.PreviewURL)
		}
		fmt.Fprintln(w)
	}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func toLowerSlice(s []string) []string {
	result := make([]string, len(s))
	for i, v := range s {
		result[i] = strings.ToLower(v)
	}
	return result
}
