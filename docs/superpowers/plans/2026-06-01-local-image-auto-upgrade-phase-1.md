# Local Control Plane Image Auto-Upgrade — Phase 1: Schema + State Tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track per-app image identity and lifecycle state in `local-control-plane`'s SQLite store, populate them on app provisioning, and expose them through the existing API. Foundation for the auto-upgrade flow described in the broader epic.

**Architecture:** Add two columns (`image_digest TEXT`, `lifecycle_state TEXT`) to the existing `apps` table via the established `ALTER TABLE` migration pattern. Update the `App` model and persistence layer to round-trip them. Populate `image_digest` from the resolved image tag during container provisioning. Use the existing `LifecycleState*` constants in `models.go` (already defined, currently unused on apps). No behavior change for the upgrade flow itself — that lands in Phase 4.

**Tech Stack:** Go 1.25, SQLite (modernc.org/sqlite driver), `local-control-plane/internal/store/`, `local-control-plane/internal/api/`, testing via `testing.T` + `testify` patterns already in the codebase.

**Epic context:** This is Phase 1 of 7. Phases 2-7 (workspace volume migration, sync script re-enable, force-upgrade endpoint, idle watcher, build script, TUI integration) each get their own detailed plan once the predecessor ships. Roadmap below.

---

## Plan strategy

This document covers Phase 1 only, in full TDD detail.

Reasons for not planning Phases 2-7 in this document:
- Each phase will reveal information that changes downstream phases (e.g. exactly how `compose.go` regenerates a YAML once we have an image_digest column shapes the upgrade orchestrator API)
- A 70+ task all-phases plan goes stale quickly; small, sequenced plans stay accurate
- Phase 1 is the smallest, most-additive, and unblocks everything else

Each subsequent phase should get its own plan written by re-invoking `superpowers:writing-plans` once the predecessor lands.

---

## File Structure

### Modified files
- `local-control-plane/internal/store/db.go` — add column migrations + update INSERT/SELECT/UPDATE queries
- `local-control-plane/internal/store/db_test.go` — tests for new columns
- `local-control-plane/internal/store/models.go` — add `ImageDigest` and `LifecycleState` fields to `App` struct
- `local-control-plane/internal/setup/template.go` — populate `image_digest` and `lifecycle_state` during provisioning
- `local-control-plane/internal/api/apps.go` — round-trip new fields through API responses
- `local-control-plane/internal/api/apps_test.go` (or equivalent) — assert new fields in API responses

### Why these files
- `db.go` owns schema and queries. The `migrate()` function already uses the duplicate-column-tolerant `ALTER TABLE` pattern (see `db.go:124-128`); we extend it.
- `models.go` already defines `LifecycleState*` constants. We connect them to apps for the first time.
- `template.go` is the only place that creates an app row. Lifecycle is set there as `provisioning` then transitions to `running`.
- `apps.go` is the only place that serializes `App` over HTTP.

---

## Conventions

- snake_case for SQL columns and structured log fields (`image_digest`, `lifecycle_state`)
- camelCase for JSON fields (`imageDigest`, `lifecycleState`) — matches existing `previewPort` etc.
- Keep changes additive — no breaking of existing API contracts
- TDD: failing test → minimal implementation → passing test → commit
- One commit per task

---

## Task 1: Add `image_digest` and `lifecycle_state` columns to apps schema

**Files:**
- Modify: `local-control-plane/internal/store/db.go` (after line 128, in the column-migration block)
- Test: `local-control-plane/internal/store/db_test.go`

- [ ] **Step 1: Write the failing test**

Open `local-control-plane/internal/store/db_test.go` and add (or extend the existing schema test):

```go
func TestMigrate_AddsImageDigestAndLifecycleStateColumns(t *testing.T) {
	db, err := New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	rows, err := db.db.Query(`PRAGMA table_info(apps)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	cols := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			t.Fatal(err)
		}
		cols[name] = true
	}

	if !cols["image_digest"] {
		t.Error("expected image_digest column on apps table")
	}
	if !cols["lifecycle_state"] {
		t.Error("expected lifecycle_state column on apps table")
	}
}
```

If `database/sql` and `testing` aren't already imported in the test file, add them.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd local-control-plane && go test ./internal/store/ -run TestMigrate_AddsImageDigestAndLifecycleStateColumns -v
```

Expected: FAIL with "expected image_digest column on apps table" and "expected lifecycle_state column on apps table".

- [ ] **Step 3: Add the column migrations**

In `local-control-plane/internal/store/db.go`, after the existing column migrations block (around line 128, right after the `publish_supervisor_port` migration), add:

```go
if _, err := d.db.Exec(`ALTER TABLE apps ADD COLUMN image_digest TEXT NOT NULL DEFAULT ''`); err != nil {
	if !strings.Contains(err.Error(), "duplicate column") {
		return fmt.Errorf("add image_digest column: %w", err)
	}
}

if _, err := d.db.Exec(`ALTER TABLE apps ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'running'`); err != nil {
	if !strings.Contains(err.Error(), "duplicate column") {
		return fmt.Errorf("add lifecycle_state column: %w", err)
	}
}
```

Default `lifecycle_state` to `'running'` so existing rows from older DBs come up in a sane state on first migration. New rows will be set explicitly to `'provisioning'` during template setup (Task 4).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd local-control-plane && go test ./internal/store/ -run TestMigrate_AddsImageDigestAndLifecycleStateColumns -v
```

Expected: PASS.

- [ ] **Step 5: Run full store tests to confirm no regression**

```bash
cd local-control-plane && go test ./internal/store/ -v
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add local-control-plane/internal/store/db.go local-control-plane/internal/store/db_test.go
git commit -m "feat(local-control-plane): add image_digest and lifecycle_state columns to apps table"
```

---

## Task 2: Add fields to `App` struct

**Files:**
- Modify: `local-control-plane/internal/store/models.go`

- [ ] **Step 1: Add fields to the App struct**

In `local-control-plane/internal/store/models.go`, update the `App` struct (currently lines 11-25) to add the two fields. Place them after `Status` for grouping:

```go
type App struct {
	ID                    string            `json:"id"`
	SubscriptionID        string            `json:"subscriptionId"`
	SystemID              string            `json:"systemId"`
	Status                string            `json:"status"`
	ImageDigest           string            `json:"imageDigest,omitempty"`
	LifecycleState        string            `json:"lifecycleState,omitempty"`
	Variables             map[string]any    `json:"variables,omitempty"`
	Variants              []string          `json:"variants,omitempty"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
	PreviewPort           int               `json:"previewPort,omitempty"`
	PublishPort           int               `json:"publishPort,omitempty"`
	SupervisorPort        int               `json:"supervisorPort,omitempty"`
	PublishSupervisorPort int               `json:"publishSupervisorPort,omitempty"`
	URLs                  map[string]string `json:"urls,omitempty"`
}
```

`omitempty` on the JSON tags so older API consumers that don't expect these fields don't see empty strings.

- [ ] **Step 2: Run typecheck**

```bash
cd local-control-plane && go build ./...
```

Expected: clean build. Code that creates `App` literals will still work because fields have zero-value defaults.

- [ ] **Step 3: Commit**

```bash
git add local-control-plane/internal/store/models.go
git commit -m "feat(local-control-plane): add ImageDigest and LifecycleState fields to App"
```

---

## Task 3: Update queries to round-trip new columns

**Files:**
- Modify: `local-control-plane/internal/store/db.go` (the existing `CreateApp`, `GetApp`/`FindApp`, `ListApps`, `UpdateApp`-equivalent functions — exact names depend on what's there; grep first)
- Test: `local-control-plane/internal/store/db_test.go`

- [ ] **Step 1: Identify the existing query functions**

```bash
cd local-control-plane && grep -n "INSERT INTO apps\|SELECT.*FROM apps\|UPDATE apps" internal/store/db.go
```

Note the function names that contain these queries. We'll update each to include the two new columns. They're typically named like `CreateApp`, `GetApp` (or `FindAppByID`), `ListApps`, and there may be an update path.

- [ ] **Step 2: Write the failing test for INSERT/SELECT round-trip**

Add to `internal/store/db_test.go`:

```go
func TestApp_RoundTripsImageDigestAndLifecycleState(t *testing.T) {
	db, err := New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	app := &App{
		ID:             "test-app-1",
		SubscriptionID: "sub-1",
		SystemID:       "sys-1",
		Status:         "running",
		ImageDigest:    "sha256:abc123",
		LifecycleState: LifecycleStateProvisioning,
		Variants:       []string{"preview", "publish"},
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := db.CreateApp(app); err != nil {
		t.Fatalf("CreateApp: %v", err)
	}

	got, err := db.GetApp("test-app-1") // adjust to actual function name from Step 1
	if err != nil {
		t.Fatalf("GetApp: %v", err)
	}

	if got.ImageDigest != "sha256:abc123" {
		t.Errorf("ImageDigest mismatch: got %q want %q", got.ImageDigest, "sha256:abc123")
	}
	if got.LifecycleState != LifecycleStateProvisioning {
		t.Errorf("LifecycleState mismatch: got %q want %q", got.LifecycleState, LifecycleStateProvisioning)
	}
}
```

Adjust `db.CreateApp(app)` and `db.GetApp("...")` to match the actual function names from Step 1.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd local-control-plane && go test ./internal/store/ -run TestApp_RoundTripsImageDigestAndLifecycleState -v
```

Expected: FAIL — either with empty `ImageDigest` and `LifecycleState` fields, or with a SQL error if column count in INSERT is enforced.

- [ ] **Step 4: Update the INSERT query**

Locate the function that inserts into the `apps` table (likely `CreateApp` or similar). Add `image_digest` and `lifecycle_state` to the column list and `?, ?` to the value placeholders. Pass `app.ImageDigest` and `app.LifecycleState` as bind parameters in the same order.

Example shape (adjust to actual code):

```go
_, err := d.db.Exec(`INSERT INTO apps
	(id, subscription_id, system_id, status, image_digest, lifecycle_state,
	 variables, variants, preview_port, publish_port, supervisor_port,
	 publish_supervisor_port, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	app.ID, app.SubscriptionID, app.SystemID, app.Status,
	app.ImageDigest, app.LifecycleState,
	variablesJSON, variantsJSON, app.PreviewPort, app.PublishPort,
	app.SupervisorPort, app.PublishSupervisorPort,
	app.CreatedAt.Format(time.RFC3339Nano),
	app.UpdatedAt.Format(time.RFC3339Nano))
```

- [ ] **Step 5: Update the SELECT queries**

Locate every `SELECT ... FROM apps` query (single-row, list, and any joins). Add `image_digest, lifecycle_state` to the column list. Update the corresponding `rows.Scan(...)` call to scan into `&app.ImageDigest` and `&app.LifecycleState` in the same order as the SELECT.

- [ ] **Step 6: Run test to verify it passes**

```bash
cd local-control-plane && go test ./internal/store/ -run TestApp_RoundTripsImageDigestAndLifecycleState -v
```

Expected: PASS.

- [ ] **Step 7: Run all store tests**

```bash
cd local-control-plane && go test ./internal/store/ -v
```

Expected: all existing tests still pass — no regressions in CreateApp/GetApp/ListApps for callers that don't populate the new fields (zero values round-trip correctly).

- [ ] **Step 8: Commit**

```bash
git add local-control-plane/internal/store/db.go local-control-plane/internal/store/db_test.go
git commit -m "feat(local-control-plane): persist ImageDigest and LifecycleState in apps queries"
```

---

## Task 4: Populate `image_digest` and `lifecycle_state` during provisioning

**Files:**
- Modify: `local-control-plane/internal/setup/template.go` (the function that creates the app row — likely the entry point called from `internal/api/apps.go` create handler)
- Test: existing test for template setup, or add a new one

- [ ] **Step 1: Identify the provisioning entry point**

```bash
cd local-control-plane && grep -n "CreateApp\|insert.*app\|provision\|setup.provision" internal/api/apps.go internal/setup/template.go | head -20
```

The provisioning entry point probably calls `db.CreateApp(...)` after `setup.Provision(...)` populates the workspace. Identify exactly where the App record is constructed and inserted.

- [ ] **Step 2: Identify how the image is resolved**

```bash
cd local-control-plane && grep -rn "image\|aab-template-v8\|aab-publish\|imageRef" internal/docker/ | head -20
```

The compose YAML generation in `compose.go` references image tags. We need the resolved image digest to write into the apps row. The simplest path: have `compose.go` expose a helper like `GetCurrentImageDigest(variant string) (string, error)` that calls `docker inspect` (or reads from the latest build's tag/digest mapping).

For Phase 1, **don't actually inspect the running container's digest** — just record the image NAME being used (e.g. `aab-template-v8:latest`). Phase 4 will replace this with proper digest tracking when we add the `/upgrade/notify` endpoint.

- [ ] **Step 3: Write the failing test**

Add to `local-control-plane/internal/store/db_test.go` (or wherever provisioning is tested):

```go
func TestProvision_SetsLifecycleStateAndImageDigest(t *testing.T) {
	db, err := New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	app := &App{
		ID:             "prov-test",
		SubscriptionID: "sub-1",
		SystemID:       "sys-1",
		Status:         "running",
		ImageDigest:    "aab-template-v8:latest",
		LifecycleState: LifecycleStateProvisioning,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := db.CreateApp(app); err != nil {
		t.Fatalf("CreateApp: %v", err)
	}

	got, err := db.GetApp("prov-test")
	if err != nil {
		t.Fatal(err)
	}

	if got.LifecycleState != LifecycleStateProvisioning {
		t.Errorf("LifecycleState: got %q want %q", got.LifecycleState, LifecycleStateProvisioning)
	}
	if got.ImageDigest == "" {
		t.Error("ImageDigest should be populated")
	}
}
```

- [ ] **Step 4: Run test to verify it fails**

This test will likely PASS because Task 3 already wired round-trip. The real test is that the *production code path* (provisioning) populates these fields. So this test is more of a sanity check; the meaningful change is in Step 5.

```bash
cd local-control-plane && go test ./internal/store/ -run TestProvision_SetsLifecycleStateAndImageDigest -v
```

Expected: PASS (round-trip works from Task 3).

- [ ] **Step 5: Update the provisioning code path**

In whichever file constructs the `App` literal before calling `db.CreateApp(...)` (identified in Step 1), set:

```go
app := &App{
	// ... existing fields ...
	ImageDigest:    "aab-template-v8:latest", // Phase 4 will replace with real digest
	LifecycleState: LifecycleStateProvisioning,
}
// ... after db.CreateApp succeeds AND containers come up healthy ...
// Update lifecycle to running:
if err := db.UpdateAppLifecycleState(app.ID, LifecycleStateRunning); err != nil {
	slog.Warn("provision.lifecycle_state.update_failed", "app_id", app.ID, "error", err)
}
```

You will need to add a new `UpdateAppLifecycleState` method to `db.go`:

```go
func (d *DB) UpdateAppLifecycleState(appID, state string) error {
	_, err := d.db.Exec(`UPDATE apps SET lifecycle_state = ?, updated_at = ? WHERE id = ?`,
		state, time.Now().Format(time.RFC3339Nano), appID)
	return err
}
```

- [ ] **Step 6: Add a focused integration test**

Add to `internal/store/db_test.go`:

```go
func TestUpdateAppLifecycleState(t *testing.T) {
	db, err := New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	app := &App{
		ID:             "lc-test",
		SubscriptionID: "sub-1",
		SystemID:       "sys-1",
		Status:         "running",
		LifecycleState: LifecycleStateProvisioning,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := db.CreateApp(app); err != nil {
		t.Fatal(err)
	}

	if err := db.UpdateAppLifecycleState("lc-test", LifecycleStateRunning); err != nil {
		t.Fatalf("UpdateAppLifecycleState: %v", err)
	}

	got, err := db.GetApp("lc-test")
	if err != nil {
		t.Fatal(err)
	}
	if got.LifecycleState != LifecycleStateRunning {
		t.Errorf("LifecycleState: got %q want %q", got.LifecycleState, LifecycleStateRunning)
	}
}
```

- [ ] **Step 7: Run the new tests**

```bash
cd local-control-plane && go test ./internal/store/ -run "TestUpdateAppLifecycleState|TestProvision_SetsLifecycleStateAndImageDigest" -v
```

Expected: both PASS.

- [ ] **Step 8: Run full test suite**

```bash
cd local-control-plane && make test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add local-control-plane/internal/store/db.go local-control-plane/internal/store/db_test.go local-control-plane/internal/setup/template.go
git commit -m "feat(local-control-plane): set ImageDigest and LifecycleState during app provisioning"
```

---

## Task 5: Expose new fields through API responses

**Files:**
- Modify: `local-control-plane/internal/api/apps.go` — wherever app records are serialized to JSON (most likely already automatic via the `App` struct's JSON tags)
- Test: `local-control-plane/internal/api/apps_test.go` (or whatever the API test file is called)

- [ ] **Step 1: Verify JSON serialization is automatic**

```bash
cd local-control-plane && grep -n "json.Marshal\|json.NewEncoder.*Encode" internal/api/apps.go | head -10
```

If `apps.go` returns the `App` struct directly via `json.NewEncoder(w).Encode(app)`, the new fields appear automatically thanks to the struct tags from Task 2. Skip to Step 4 if so.

If the response uses a separate DTO, update it to include `ImageDigest` and `LifecycleState`.

- [ ] **Step 2: Identify the API test file**

```bash
cd local-control-plane && find internal/api -name "*_test.go" | head -5
```

If no test file exists for `apps.go`, create `internal/api/apps_test.go`. Use existing patterns — look at `internal/api/secrets.go` and any existing test files in `internal/api/` for the table-driven HTTP test pattern.

- [ ] **Step 3: Write the failing test**

Add a test that creates an app via the API and asserts the response includes the new fields:

```go
func TestGetApp_IncludesImageDigestAndLifecycleState(t *testing.T) {
	// Setup: create server with in-memory DB + a test app
	srv, db := newTestServer(t)
	defer db.Close()

	app := &store.App{
		ID:             "api-test",
		SubscriptionID: "sub-1",
		SystemID:       "sys-1",
		Status:         "running",
		ImageDigest:    "aab-template-v8:latest",
		LifecycleState: store.LifecycleStateRunning,
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := db.CreateApp(app); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET",
		"/api/airo/v1/subscriptions/sub-1/systems/sys-1/apps/api-test", nil)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}

	if resp["imageDigest"] != "aab-template-v8:latest" {
		t.Errorf("imageDigest: got %v", resp["imageDigest"])
	}
	if resp["lifecycleState"] != "running" {
		t.Errorf("lifecycleState: got %v", resp["lifecycleState"])
	}
}
```

`newTestServer(t)` is the existing test helper for spinning up the API server with an in-memory DB. If one doesn't exist yet, look at how `internal/api/secrets.go` tests construct their server (or follow the same pattern as the closest existing API test file).

- [ ] **Step 4: Run the test**

```bash
cd local-control-plane && go test ./internal/api/ -run TestGetApp_IncludesImageDigestAndLifecycleState -v
```

Expected: if Step 1 confirmed automatic serialization → PASS. Otherwise → FAIL with missing field, then update the DTO and re-run.

- [ ] **Step 5: Run all API tests**

```bash
cd local-control-plane && go test ./internal/api/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add local-control-plane/internal/api/
git commit -m "feat(local-control-plane): expose ImageDigest and LifecycleState in app API responses"
```

---

## Task 6: Verify end-to-end

- [ ] **Step 1: Run full local-control-plane test suite**

```bash
cd local-control-plane && make check
```

Expected: fmt clean, vet clean, lint clean, all tests pass.

- [ ] **Step 2: Manual smoke test**

```bash
cd local-control-plane && rm -f local-control-plane.db && make run &
LCP_PID=$!
sleep 2

# Create an app via the dev runner / control plane API (use whatever real flow exists — look at app/ BFF or scripts/)
# Or: directly insert via SQLite to verify schema:
sqlite3 local-control-plane.db "PRAGMA table_info(apps);"

# Expect to see image_digest and lifecycle_state columns

# Then via API:
curl -s http://localhost:4100/api/airo/v1/subscriptions/local-sub-001/systems/$SYSTEM_ID/apps | jq '.apps[0] | {id, imageDigest, lifecycleState}'

kill $LCP_PID
```

Expected: schema includes both columns; provisioned apps return non-empty `imageDigest` and `lifecycleState: "running"` after provisioning completes.

- [ ] **Step 3: No regression with existing dev flow**

```bash
pnpm run dev
```

Open the local builder, create a new app, verify it provisions and runs successfully. Existing functionality should be unaffected by the new tracked state.

---

## Open questions for Phase 2+

These don't block Phase 1 but should be resolved before the corresponding phase:

- **Phase 2 (workspace volume migration):** What's the migration story for existing apps with bind-mounted workspaces? `docker cp` from old bind path → new named volume during a one-time `local-control-plane migrate-workspaces` command? Or expect users to delete and recreate apps? Lean toward the migration command — losing in-flight work is annoying for daily dev.
- **Phase 3 (sync script re-enable):** Confirm the disabled-at-line-1537 issue truly only affects pre-SSR production apps before flipping for local. Sanity test: create a fresh local app, manually run the sync script against it, verify nothing breaks.
- **Phase 4 (force-upgrade endpoint):** What's the source of truth for the "current" image digest? Two options: (a) build script POSTs digest after rebuild, (b) control plane runs `docker images aab-template-v8:current --format '{{.ID}}'` on demand. (b) is simpler if it works.
- **Phase 5 (idle watcher):** What counts as "idle"? Last HTTP request to dev-supervisor's preview port? Last WebSocket message? Need to instrument the dev-supervisor or proxy layer.
- **Phase 7 (TUI):** Where in the existing dev-runner TUI does the per-app status panel render? `dev-runner/internal/tui/probe_pane.go` looks relevant — investigate before designing the integration.

---

## Phase roadmap (full epic)

Each phase below should get its own detailed plan written via `superpowers:writing-plans` once the predecessor lands.

| # | Phase | Goal | Blocked by |
|---|---|---|---|
| 1 | Schema + state tracking (THIS PLAN) | Track image_digest and lifecycle_state per app | — |
| 2 | Workspace volume migration | Switch /app from bind mount to named volume; migrate existing apps | 1 |
| 3 | Re-enable sync-template-files.js for local | Layer template updates onto existing workspaces | 1, 2 |
| 4 | Force-upgrade endpoint + recreate orchestrator | Manual upgrade trigger; container recreate logic | 1, 2 |
| 5 | Idle watcher + auto-upgrade | Trigger upgrades opportunistically when apps go idle | 4 |
| 6 | Build script + pnpm command | `pnpm run dev:rebuild-preview` rebuilds image and notifies control plane | 4 |
| 7 | TUI integration | Show image_digest, lifecycle_state, force-upgrade keybind | 1, 4 |
| 8 | Documentation | Update CLAUDE.md, persistent-storage-architecture.md, GETTING_STARTED.md | All |

---

## Self-review

Spec coverage:
- [x] Schema columns added
- [x] Model struct updated
- [x] Queries round-trip new columns
- [x] Provisioning populates them
- [x] API exposes them
- [x] End-to-end verification

Placeholder scan:
- [x] No "TBD" or "implement later"
- [x] All test code written out
- [x] All commands shown with expected output
- One soft area: Task 3 Steps 4-5 say "adjust to actual function names from Step 1" because I haven't read the file yet. The implementer must do that quick grep before writing the SQL changes. Acceptable trade-off — the alternative is including stale verbatim code that may not match the codebase's actual function names.

Type consistency:
- [x] `ImageDigest` and `LifecycleState` consistent across all tasks
- [x] `LifecycleStateProvisioning` / `LifecycleStateRunning` constants match `models.go` (verified at lines 84, 80)
- [x] `UpdateAppLifecycleState` named consistently in Task 4 Step 5 and Task 4 Step 6
