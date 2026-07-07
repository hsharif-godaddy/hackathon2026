package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// --- ID generation ---

func TestGenerateNanoid(t *testing.T) {
	id, err := generateNanoid(10)
	if err != nil {
		t.Fatalf("generateNanoid: %v", err)
	}
	if len(id) != 10 {
		t.Fatalf("expected length 10, got %d", len(id))
	}
	for _, c := range id {
		if (c < '0' || c > '9') && (c < 'a' || c > 'z') {
			t.Fatalf("unexpected character %q in nanoid", c)
		}
	}
}

func TestGenerateNanoidUniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id, err := generateNanoid(10)
		if err != nil {
			t.Fatalf("generateNanoid: %v", err)
		}
		if seen[id] {
			t.Fatalf("duplicate nanoid: %s", id)
		}
		seen[id] = true
	}
}

func TestGenerateAppID(t *testing.T) {
	id, err := generateAppID()
	if err != nil {
		t.Fatalf("generateAppID: %v", err)
	}
	if len(id) != 10 {
		t.Fatalf("expected length 10, got %d", len(id))
	}
}

func TestGenerateJobID(t *testing.T) {
	id, err := generateJobID()
	if err != nil {
		t.Fatalf("generateJobID: %v", err)
	}
	if len(id) != 8 {
		t.Fatalf("expected length 8, got %d", len(id))
	}
}

func TestGenerateDeploymentID(t *testing.T) {
	id, err := generateDeploymentID()
	if err != nil {
		t.Fatalf("generateDeploymentID: %v", err)
	}
	if len(id) != 10 {
		t.Fatalf("expected length 10, got %d", len(id))
	}
}

// --- App CRUD ---

func TestCreateApp(t *testing.T) {
	db := newTestDB(t)

	app, err := db.CreateApp("sub-1", "sys-1", map[string]any{"key": "val"}, []string{"preview"})
	if err != nil {
		t.Fatalf("CreateApp: %v", err)
	}
	if app.ID == "" {
		t.Fatal("expected non-empty app ID")
	}
	if app.SubscriptionID != "sub-1" {
		t.Fatalf("expected sub-1, got %s", app.SubscriptionID)
	}
	if app.SystemID != "sys-1" {
		t.Fatalf("expected sys-1, got %s", app.SystemID)
	}
	if app.Status != "provisioning" {
		t.Fatalf("expected provisioning, got %s", app.Status)
	}
	if app.Variables["key"] != "val" {
		t.Fatalf("expected variables key=val, got %v", app.Variables)
	}
	if len(app.Variants) != 1 || app.Variants[0] != "preview" {
		t.Fatalf("expected [preview], got %v", app.Variants)
	}
}

func TestCreateAppDefaultVariants(t *testing.T) {
	db := newTestDB(t)

	app, err := db.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("CreateApp: %v", err)
	}
	if len(app.Variants) != 1 || app.Variants[0] != "preview" {
		t.Fatalf("expected default [preview], got %v", app.Variants)
	}
}

func TestGetApp(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateApp("sub-1", "sys-1", nil, nil)

	app, err := db.GetApp(created.ID)
	if err != nil {
		t.Fatalf("GetApp: %v", err)
	}
	if app == nil {
		t.Fatal("expected app, got nil")
	}
	if app.ID != created.ID {
		t.Fatalf("expected %s, got %s", created.ID, app.ID)
	}
	if app.Status != "provisioning" {
		t.Fatalf("expected provisioning, got %s", app.Status)
	}
}

func TestGetAppNotFound(t *testing.T) {
	db := newTestDB(t)

	app, err := db.GetApp("nonexistent")
	if err != nil {
		t.Fatalf("GetApp: %v", err)
	}
	if app != nil {
		t.Fatal("expected nil for nonexistent app")
	}
}

func TestListApps(t *testing.T) {
	db := newTestDB(t)

	db.CreateApp("sub-1", "sys-1", nil, nil)
	db.CreateApp("sub-1", "sys-1", nil, nil)
	db.CreateApp("sub-2", "sys-1", nil, nil) // different subscription

	apps, err := db.ListApps("sub-1", "sys-1")
	if err != nil {
		t.Fatalf("ListApps: %v", err)
	}
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps for sub-1/sys-1, got %d", len(apps))
	}

	// Verify ordering: most recent first
	if apps[0].CreatedAt.Before(apps[1].CreatedAt) {
		t.Fatal("expected most recent app first")
	}
}

func TestListAllApps(t *testing.T) {
	db := newTestDB(t)

	db.CreateApp("sub-1", "sys-1", nil, nil)
	db.CreateApp("sub-2", "sys-2", nil, nil)

	apps, err := db.ListAllApps()
	if err != nil {
		t.Fatalf("ListAllApps: %v", err)
	}
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(apps))
	}
}

func TestUpdateAppStatus(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateApp("sub-1", "sys-1", nil, nil)
	status := "active"
	app, err := db.UpdateApp(created.ID, &status, nil, nil)
	if err != nil {
		t.Fatalf("UpdateApp: %v", err)
	}
	if app.Status != "active" {
		t.Fatalf("expected active, got %s", app.Status)
	}
}

func TestUpdateAppVariables(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateApp("sub-1", "sys-1", map[string]any{"a": "1"}, nil)
	app, err := db.UpdateApp(created.ID, nil, map[string]any{"b": "2"}, nil)
	if err != nil {
		t.Fatalf("UpdateApp: %v", err)
	}
	if app.Variables["a"] != "1" || app.Variables["b"] != "2" {
		t.Fatalf("expected merged variables, got %v", app.Variables)
	}
}

func TestUpdateAppVariants(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateApp("sub-1", "sys-1", nil, []string{"preview"})
	app, err := db.UpdateApp(created.ID, nil, nil, []string{"preview", "publish"})
	if err != nil {
		t.Fatalf("UpdateApp: %v", err)
	}
	if len(app.Variants) != 2 {
		t.Fatalf("expected 2 variants, got %d", len(app.Variants))
	}
}

func TestUpdateAppNotFound(t *testing.T) {
	db := newTestDB(t)

	status := "active"
	_, err := db.UpdateApp("nonexistent", &status, nil, nil)
	if err == nil {
		t.Fatal("expected error for nonexistent app")
	}
}

func TestUpdateAppPorts(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateApp("sub-1", "sys-1", nil, nil)
	err := db.UpdateAppPorts(created.ID, 5000, 5500, 8877, 9000)
	if err != nil {
		t.Fatalf("UpdateAppPorts: %v", err)
	}

	app, _ := db.GetApp(created.ID)
	if app.PreviewPort != 5000 {
		t.Fatalf("expected preview port 5000, got %d", app.PreviewPort)
	}
	if app.PublishPort != 5500 {
		t.Fatalf("expected publish port 5500, got %d", app.PublishPort)
	}
	if app.SupervisorPort != 8877 {
		t.Fatalf("expected supervisor port 8877, got %d", app.SupervisorPort)
	}
	if app.PublishSupervisorPort != 9000 {
		t.Fatalf("expected publish supervisor port 9000, got %d", app.PublishSupervisorPort)
	}
}

func TestDeleteApp(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateApp("sub-1", "sys-1", nil, nil)
	job, _ := db.CreateJob(created.ID, "airo-test")
	db.UpsertSecret(created.ID, "shared", "KEY", "VAL", false)

	err := db.DeleteApp(created.ID)
	if err != nil {
		t.Fatalf("DeleteApp: %v", err)
	}

	// Verify app is gone
	app, _ := db.GetApp(created.ID)
	if app != nil {
		t.Fatal("expected app to be deleted")
	}

	// Verify cascading delete of jobs
	j, _ := db.GetJob(job.ID)
	if j != nil {
		t.Fatal("expected job to be cascaded-deleted")
	}

	// Verify cascading delete of secrets
	secrets, _ := db.GetSecrets(created.ID, nil)
	if len(secrets) != 0 {
		t.Fatalf("expected secrets to be cascaded-deleted, got %d", len(secrets))
	}
}

// --- Jobs ---

func TestCreateJob(t *testing.T) {
	db := newTestDB(t)

	job, err := db.CreateJob("app-1", "airo-test")
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if job.ID == "" {
		t.Fatal("expected non-empty job ID")
	}
	if job.AppID != "app-1" {
		t.Fatalf("expected app-1, got %s", job.AppID)
	}
	if job.Status != "pending" {
		t.Fatalf("expected pending, got %s", job.Status)
	}
}

func TestGetJob(t *testing.T) {
	db := newTestDB(t)

	created, _ := db.CreateJob("app-1", "airo-test")
	job, err := db.GetJob(created.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if job == nil {
		t.Fatal("expected job, got nil")
	}
	if job.ID != created.ID {
		t.Fatalf("expected %s, got %s", created.ID, job.ID)
	}
}

func TestGetJobNotFound(t *testing.T) {
	db := newTestDB(t)

	job, err := db.GetJob("nonexistent")
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if job != nil {
		t.Fatal("expected nil for nonexistent job")
	}
}

func TestUpdateJobStatus(t *testing.T) {
	db := newTestDB(t)

	job, _ := db.CreateJob("app-1", "airo-test")
	err := db.UpdateJobStatus(job.ID, "completed", "")
	if err != nil {
		t.Fatalf("UpdateJobStatus: %v", err)
	}

	updated, _ := db.GetJob(job.ID)
	if updated.Status != "completed" {
		t.Fatalf("expected completed, got %s", updated.Status)
	}
}

func TestUpdateJobStatusWithError(t *testing.T) {
	db := newTestDB(t)

	job, _ := db.CreateJob("app-1", "airo-test")
	err := db.UpdateJobStatus(job.ID, "failed", "something broke")
	if err != nil {
		t.Fatalf("UpdateJobStatus: %v", err)
	}

	updated, _ := db.GetJob(job.ID)
	if updated.Status != "failed" {
		t.Fatalf("expected failed, got %s", updated.Status)
	}
	if updated.Error != "something broke" {
		t.Fatalf("expected 'something broke', got %q", updated.Error)
	}
}

// --- Secrets ---

func TestUpsertSecretInsert(t *testing.T) {
	db := newTestDB(t)

	err := db.UpsertSecret("app-1", "shared", "API_KEY", "secret123", false)
	if err != nil {
		t.Fatalf("UpsertSecret: %v", err)
	}

	secrets, _ := db.GetSecrets("app-1", nil)
	if len(secrets) != 1 {
		t.Fatalf("expected 1 secret, got %d", len(secrets))
	}
	if secrets[0].Name != "API_KEY" || secrets[0].Value != "secret123" {
		t.Fatalf("unexpected secret: %+v", secrets[0])
	}
}

func TestUpsertSecretUpdate(t *testing.T) {
	db := newTestDB(t)

	db.UpsertSecret("app-1", "shared", "API_KEY", "old", false)
	db.UpsertSecret("app-1", "shared", "API_KEY", "new", true)

	secrets, _ := db.GetSecrets("app-1", nil)
	if len(secrets) != 1 {
		t.Fatalf("expected 1 secret after upsert, got %d", len(secrets))
	}
	if secrets[0].Value != "new" {
		t.Fatalf("expected updated value 'new', got %q", secrets[0].Value)
	}
	if !secrets[0].SystemManaged {
		t.Fatal("expected systemManaged to be true after upsert")
	}
}

func TestGetSecretsVariantFilter(t *testing.T) {
	db := newTestDB(t)

	db.UpsertSecret("app-1", "shared", "SHARED_KEY", "s", false)
	db.UpsertSecret("app-1", "preview", "PREVIEW_KEY", "p", false)
	db.UpsertSecret("app-1", "publish", "PUBLISH_KEY", "pub", false)

	variant := "preview"
	secrets, err := db.GetSecrets("app-1", &variant)
	if err != nil {
		t.Fatalf("GetSecrets: %v", err)
	}

	// Should include shared + preview, but not publish
	if len(secrets) != 2 {
		t.Fatalf("expected 2 secrets (shared+preview), got %d", len(secrets))
	}

	names := map[string]bool{}
	for _, s := range secrets {
		names[s.Name] = true
	}
	if !names["SHARED_KEY"] || !names["PREVIEW_KEY"] {
		t.Fatalf("expected SHARED_KEY and PREVIEW_KEY, got %v", names)
	}
}

func TestGetSecretsNoFilter(t *testing.T) {
	db := newTestDB(t)

	db.UpsertSecret("app-1", "shared", "S", "s", false)
	db.UpsertSecret("app-1", "preview", "P", "p", false)
	db.UpsertSecret("app-1", "publish", "PB", "pb", false)

	secrets, _ := db.GetSecrets("app-1", nil)
	if len(secrets) != 3 {
		t.Fatalf("expected 3 secrets, got %d", len(secrets))
	}
}

func TestDeleteSecret(t *testing.T) {
	db := newTestDB(t)

	db.UpsertSecret("app-1", "shared", "KEY", "val", false)
	err := db.DeleteSecret("app-1", "shared", "KEY")
	if err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}

	secrets, _ := db.GetSecrets("app-1", nil)
	if len(secrets) != 0 {
		t.Fatalf("expected 0 secrets after delete, got %d", len(secrets))
	}
}

// --- Deployments ---

func TestCreateDeployment(t *testing.T) {
	db := newTestDB(t)

	dep, err := db.CreateDeployment("app-1", "job-1", "abc123")
	if err != nil {
		t.Fatalf("CreateDeployment: %v", err)
	}
	if dep.ID == "" {
		t.Fatal("expected non-empty deployment ID")
	}
	if dep.AppID != "app-1" {
		t.Fatalf("expected app-1, got %s", dep.AppID)
	}
	if dep.GitHash != "abc123" {
		t.Fatalf("expected abc123, got %s", dep.GitHash)
	}
	if dep.Variant != "publish" {
		t.Fatalf("expected publish, got %s", dep.Variant)
	}
	if dep.Status != "pending" {
		t.Fatalf("expected pending, got %s", dep.Status)
	}
}

func TestCreateDeploymentDefaultGitHash(t *testing.T) {
	db := newTestDB(t)

	dep, err := db.CreateDeployment("app-1", "job-1", "")
	if err != nil {
		t.Fatalf("CreateDeployment: %v", err)
	}
	if dep.GitHash != "local" {
		t.Fatalf("expected default 'local', got %s", dep.GitHash)
	}
}

func TestGetDeployments(t *testing.T) {
	db := newTestDB(t)

	db.CreateDeployment("app-1", "job-1", "hash1")
	db.CreateDeployment("app-1", "job-2", "hash2")
	db.CreateDeployment("app-2", "job-3", "hash3") // different app

	deps, err := db.GetDeployments("app-1", 10)
	if err != nil {
		t.Fatalf("GetDeployments: %v", err)
	}
	if len(deps) != 2 {
		t.Fatalf("expected 2 deployments for app-1, got %d", len(deps))
	}
}

func TestGetDeploymentsLimit(t *testing.T) {
	db := newTestDB(t)

	for i := 0; i < 5; i++ {
		db.CreateDeployment("app-1", "job", "hash")
	}

	deps, err := db.GetDeployments("app-1", 3)
	if err != nil {
		t.Fatalf("GetDeployments: %v", err)
	}
	if len(deps) != 3 {
		t.Fatalf("expected 3 deployments (limit), got %d", len(deps))
	}
}

func TestGetDeploymentsDefaultLimit(t *testing.T) {
	db := newTestDB(t)

	deps, err := db.GetDeployments("app-1", 0)
	if err != nil {
		t.Fatalf("GetDeployments: %v", err)
	}
	if deps != nil {
		t.Fatalf("expected nil for empty result, got %v", deps)
	}
}

// --- EnsureSubscription with BMS budget ID ---

func TestEnsureSubscription_ReadsBudgetIDFile(t *testing.T) {
	dir := t.TempDir()
	bmsDir := filepath.Join(dir, ".dev-bms")
	if err := os.MkdirAll(bmsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bmsDir, "budget-id"), []byte("a1b2c3d4-e5f6-7890-abcd-ef1234567890\n"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROJECT_ROOT", dir)

	db := newTestDB(t)
	sub, err := db.EnsureSubscription("test-sub-1", "cust-1")
	if err != nil {
		t.Fatalf("EnsureSubscription: %v", err)
	}
	if sub.BMSBudgetID != "a1b2c3d4-e5f6-7890-abcd-ef1234567890" {
		t.Fatalf("expected bmsBudgetId from file, got %q", sub.BMSBudgetID)
	}
}

func TestEnsureSubscription_MissingFile(t *testing.T) {
	t.Setenv("PROJECT_ROOT", t.TempDir())

	db := newTestDB(t)
	sub, err := db.EnsureSubscription("test-sub-2", "cust-1")
	if err != nil {
		t.Fatalf("EnsureSubscription: %v", err)
	}
	if sub.BMSBudgetID != "" {
		t.Fatalf("expected empty bmsBudgetId, got %q", sub.BMSBudgetID)
	}
}

func TestEnsureSubscription_InvalidUUID(t *testing.T) {
	dir := t.TempDir()
	bmsDir := filepath.Join(dir, ".dev-bms")
	if err := os.MkdirAll(bmsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bmsDir, "budget-id"), []byte("not-a-uuid\n"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROJECT_ROOT", dir)

	db := newTestDB(t)
	sub, err := db.EnsureSubscription("test-sub-3", "cust-1")
	if err != nil {
		t.Fatalf("EnsureSubscription: %v", err)
	}
	if sub.BMSBudgetID != "" {
		t.Fatalf("expected empty bmsBudgetId for invalid UUID, got %q", sub.BMSBudgetID)
	}
}

func TestEnsureSubscription_ReconcileOnFileChange(t *testing.T) {
	dir := t.TempDir()
	bmsDir := filepath.Join(dir, ".dev-bms")
	if err := os.MkdirAll(bmsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bmsDir, "budget-id"), []byte("a1b2c3d4-e5f6-7890-abcd-ef1234567890\n"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROJECT_ROOT", dir)

	db := newTestDB(t)
	sub1, err := db.EnsureSubscription("test-sub-4", "cust-1")
	if err != nil {
		t.Fatalf("first EnsureSubscription: %v", err)
	}
	if sub1.BMSBudgetID != "a1b2c3d4-e5f6-7890-abcd-ef1234567890" {
		t.Fatalf("expected initial bmsBudgetId, got %q", sub1.BMSBudgetID)
	}

	// Simulate budget recreate: file changes to new UUID
	if err := os.WriteFile(filepath.Join(bmsDir, "budget-id"), []byte("99999999-9999-9999-9999-999999999999\n"), 0644); err != nil {
		t.Fatal(err)
	}
	sub2, err := db.EnsureSubscription("test-sub-4", "cust-1")
	if err != nil {
		t.Fatalf("second EnsureSubscription: %v", err)
	}
	if sub2.BMSBudgetID != "99999999-9999-9999-9999-999999999999" {
		t.Fatalf("expected reconciled bmsBudgetId, got %q", sub2.BMSBudgetID)
	}
}

func TestApp_DefaultsForImageDigestAndLifecycleState(t *testing.T) {
	db := newTestDB(t)

	created, err := db.CreateApp("sub-1", "sys-1", nil, nil)
	if err != nil {
		t.Fatalf("CreateApp: %v", err)
	}

	got, err := db.GetApp(created.ID)
	if err != nil {
		t.Fatalf("GetApp: %v", err)
	}
	if got == nil {
		t.Fatal("expected app, got nil")
	}

	// CreateApp explicitly sets lifecycle_state = "provisioning"; image_digest defaults to empty.
	if got.ImageDigest != "" {
		t.Errorf("ImageDigest: got %q want %q", got.ImageDigest, "")
	}
	if got.LifecycleState != LifecycleStateProvisioning {
		t.Errorf("LifecycleState: got %q want %q", got.LifecycleState, LifecycleStateProvisioning)
	}
	// Returned struct must also reflect provisioning.
	if created.LifecycleState != LifecycleStateProvisioning {
		t.Errorf("created.LifecycleState: got %q want %q", created.LifecycleState, LifecycleStateProvisioning)
	}
}

func TestMigrate_AddsImageDigestAndLifecycleStateColumns(t *testing.T) {
	db, err := Open(":memory:")
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

func TestEnsureSubscription_ReconcileFromEmpty(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PROJECT_ROOT", dir)

	db := newTestDB(t)
	// Create subscription with no budget file (simulates first-run seed failure)
	sub1, err := db.EnsureSubscription("test-sub-5", "cust-1")
	if err != nil {
		t.Fatalf("first EnsureSubscription: %v", err)
	}
	if sub1.BMSBudgetID != "" {
		t.Fatalf("expected empty bmsBudgetId, got %q", sub1.BMSBudgetID)
	}

	// Simulate seed success: file now appears
	bmsDir := filepath.Join(dir, ".dev-bms")
	if err := os.MkdirAll(bmsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bmsDir, "budget-id"), []byte("a1b2c3d4-e5f6-7890-abcd-ef1234567890\n"), 0644); err != nil {
		t.Fatal(err)
	}

	sub2, err := db.EnsureSubscription("test-sub-5", "cust-1")
	if err != nil {
		t.Fatalf("second EnsureSubscription: %v", err)
	}
	if sub2.BMSBudgetID != "a1b2c3d4-e5f6-7890-abcd-ef1234567890" {
		t.Fatalf("expected reconciled bmsBudgetId, got %q", sub2.BMSBudgetID)
	}
}

func TestUpdateAppImageDigest(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	app, err := db.CreateApp("sub-1", "sys-1", nil, []string{"preview"})
	if err != nil {
		t.Fatal(err)
	}

	if err := db.UpdateAppImageDigest(app.ID, "sha256:abc123"); err != nil {
		t.Fatalf("UpdateAppImageDigest: %v", err)
	}

	got, err := db.GetApp(app.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ImageDigest != "sha256:abc123" {
		t.Errorf("ImageDigest: got %q want %q", got.ImageDigest, "sha256:abc123")
	}
}

func TestUpdateAppLifecycleState(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	app, err := db.CreateApp("sub-1", "sys-1", nil, []string{"preview"})
	if err != nil {
		t.Fatal(err)
	}

	if err := db.UpdateAppLifecycleState(app.ID, LifecycleStateProvisioning); err != nil {
		t.Fatalf("UpdateAppLifecycleState: %v", err)
	}

	got, err := db.GetApp(app.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LifecycleState != LifecycleStateProvisioning {
		t.Errorf("LifecycleState: got %q want %q", got.LifecycleState, LifecycleStateProvisioning)
	}
}

func TestUpdateAppImageDigest_NotFound(t *testing.T) {
	db := newTestDB(t)

	err := db.UpdateAppImageDigest("nonexistent-id", "sha256:abc")
	if err != ErrAppNotFound {
		t.Errorf("UpdateAppImageDigest on missing app: got %v, want ErrAppNotFound", err)
	}
}

func TestUpdateAppLifecycleState_NotFound(t *testing.T) {
	db := newTestDB(t)

	err := db.UpdateAppLifecycleState("nonexistent-id", LifecycleStateRunning)
	if err != ErrAppNotFound {
		t.Errorf("UpdateAppLifecycleState on missing app: got %v, want ErrAppNotFound", err)
	}
}

func TestList_RoundTripsImageDigestAndLifecycleState(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// ListAppsByCustomer JOINs with subscriptions; create the subscription first.
	if _, err := db.EnsureSubscription("sub-1", DefaultCustomerID); err != nil {
		t.Fatalf("EnsureSubscription: %v", err)
	}

	app, err := db.CreateApp("sub-1", "sys-1", nil, []string{"preview"})
	if err != nil {
		t.Fatal(err)
	}

	if err := db.UpdateAppImageDigest(app.ID, "sha256:test123"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateAppLifecycleState(app.ID, LifecycleStateRunning); err != nil {
		t.Fatal(err)
	}

	// ListApps
	apps, err := db.ListApps("sub-1", "sys-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 1 {
		t.Fatalf("ListApps returned %d apps, want 1", len(apps))
	}
	if apps[0].ImageDigest != "sha256:test123" {
		t.Errorf("ListApps[0].ImageDigest = %q, want %q", apps[0].ImageDigest, "sha256:test123")
	}
	if apps[0].LifecycleState != LifecycleStateRunning {
		t.Errorf("ListApps[0].LifecycleState = %q, want %q", apps[0].LifecycleState, LifecycleStateRunning)
	}

	// ListAllApps
	all, err := db.ListAllApps()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, a := range all {
		if a.ID == app.ID {
			if a.ImageDigest != "sha256:test123" || a.LifecycleState != LifecycleStateRunning {
				t.Errorf("ListAllApps: digest=%q state=%q", a.ImageDigest, a.LifecycleState)
			}
			found = true
		}
	}
	if !found {
		t.Errorf("ListAllApps did not return the test app")
	}

	// ListAppsByCustomer (JOIN path)
	byCustomer, err := db.ListAppsByCustomer(DefaultCustomerID)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, a := range byCustomer {
		if a.ID == app.ID {
			if a.ImageDigest != "sha256:test123" || a.LifecycleState != LifecycleStateRunning {
				t.Errorf("ListAppsByCustomer: digest=%q state=%q", a.ImageDigest, a.LifecycleState)
			}
			found = true
		}
	}
	if !found {
		t.Errorf("ListAppsByCustomer did not return the test app")
	}
}

// --- Automation CRUD ---

func TestCreateAndListAutomations(t *testing.T) {
	db := newTestDB(t)

	created, err := db.CreateAutomation("app-1", "SEO", "file", ".airo/jobs", "seo", "cron", "0 9 * * 1", true)
	if err != nil {
		t.Fatalf("CreateAutomation: %v", err)
	}
	if created.AppID != "app-1" || created.DefnRef != "seo" {
		t.Fatalf("unexpected created automation: %+v", created)
	}

	list, err := db.ListAutomations("app-1")
	if err != nil {
		t.Fatalf("ListAutomations: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 automation, got %d", len(list))
	}

	other, err := db.ListAutomations("app-2")
	if err != nil {
		t.Fatalf("ListAutomations other app: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("expected 0 automations for other app, got %d", len(other))
	}
}

func TestUpdateAutomationPartialFields(t *testing.T) {
	db := newTestDB(t)

	created, err := db.CreateAutomation("app-1", "SEO", "file", ".airo/jobs", "seo", "cron", "0 9 * * 1", true)
	if err != nil {
		t.Fatalf("CreateAutomation: %v", err)
	}

	newCron := "0 10 * * 1"
	updated, err := db.UpdateAutomation(created.ID, "app-1", nil, &newCron, nil)
	if err != nil {
		t.Fatalf("UpdateAutomation cron: %v", err)
	}
	if updated.CronExpr != newCron {
		t.Fatalf("expected cron %q, got %q", newCron, updated.CronExpr)
	}
	if !updated.Enabled {
		t.Fatal("expected enabled to remain true")
	}

	disabled := false
	updated, err = db.UpdateAutomation(created.ID, "app-1", nil, nil, &disabled)
	if err != nil {
		t.Fatalf("UpdateAutomation enabled: %v", err)
	}
	if updated.Enabled {
		t.Fatal("expected enabled false")
	}
	if updated.CronExpr != newCron {
		t.Fatalf("expected cron preserved as %q, got %q", newCron, updated.CronExpr)
	}
}

func TestUpdateAutomationNotFound(t *testing.T) {
	db := newTestDB(t)

	cron := "0 9 * * *"
	_, err := db.UpdateAutomation("missing", "app-1", nil, &cron, nil)
	if err == nil {
		t.Fatal("expected error for missing automation")
	}
}

func TestDeleteAutomationSoftDelete(t *testing.T) {
	db := newTestDB(t)

	created, err := db.CreateAutomation("app-1", "SEO", "file", ".airo/jobs", "seo", "cron", "0 9 * * 1", true)
	if err != nil {
		t.Fatalf("CreateAutomation: %v", err)
	}

	if err := db.DeleteAutomation(created.ID, "app-1"); err != nil {
		t.Fatalf("DeleteAutomation: %v", err)
	}

	list, err := db.ListAutomations("app-1")
	if err != nil {
		t.Fatalf("ListAutomations: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected soft-deleted automation to be hidden, got %d", len(list))
	}

	if err := db.DeleteAutomation(created.ID, "app-1"); err == nil {
		t.Fatal("expected error deleting already-deleted automation")
	}
}

func TestDeleteAutomationWrongApp(t *testing.T) {
	db := newTestDB(t)

	created, err := db.CreateAutomation("app-1", "SEO", "file", ".airo/jobs", "seo", "cron", "0 9 * * 1", true)
	if err != nil {
		t.Fatalf("CreateAutomation: %v", err)
	}

	if err := db.DeleteAutomation(created.ID, "app-2"); err == nil {
		t.Fatal("expected error deleting automation from wrong app")
	}
}
