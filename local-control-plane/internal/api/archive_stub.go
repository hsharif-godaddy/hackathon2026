// Package api provides archive/restore stub functionality for local development.
//
// ARCHIVE STATE MACHINE LIMITATIONS:
//
// This local stub uses a simplified binary archive model compared to the full
// hosting backend state machine. The hosting backend supports:
//   - archiving -> archived -> restoring -> restored -> failed (with retry)
//   - Complex state transitions with IsArchived(), CanRestore(), IsInProgress()
//   - Failed restore states that allow retry while keeping status=restoring
//
// The local stub only supports:
//   - Binary archive state: app is either archived or not
//   - In-flight restore tracking via goroutine (not queryable as a separate state)
//   - No failure simulation or retry scenarios
//   - No "restored" vs "archiving" vs "restoring" intermediate states
//
// This is sufficient for UI development but cannot exercise the full state machine
// that production systems encounter (archive failures, restore retries, etc.).
package api

import (
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

// LOCAL_CP_ARCHIVED_APP_IDS lists app IDs that simulate cold-archive for develop UX testing.
// After a successful stub restore, the app is cleared until the control plane restarts.
var (
	archiveStubMu          sync.Mutex
	archiveStubRestored    = map[string]struct{}{}
	archiveStubInFlightJob = map[string]string{} // appID -> jobId while stub restore goroutine runs
)

func archiveStubListed(appID string) bool {
	raw := os.Getenv("LOCAL_CP_ARCHIVED_APP_IDS")
	if raw == "" {
		return false
	}
	for _, id := range strings.Split(raw, ",") {
		if strings.TrimSpace(id) == appID {
			return true
		}
	}
	return false
}

func archiveStubIsArchived(appID string) bool {
	archiveStubMu.Lock()
	defer archiveStubMu.Unlock()
	if _, ok := archiveStubRestored[appID]; ok {
		return false
	}
	// During restore (in-flight job), app should still appear archived
	// until restore completes
	return archiveStubListed(appID)
}

func archiveStubCompleteRestore(appID string) {
	archiveStubMu.Lock()
	defer archiveStubMu.Unlock()
	delete(archiveStubInFlightJob, appID)
	archiveStubRestored[appID] = struct{}{}
}

// GetArchiveStatus implements GET .../apps/{appId}/archive-status
//
// Returns isArchived=true during the entire restore process until completion.
// The app remains "archived" from the API perspective while restore is in-flight.
func (s *Server) GetArchiveStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil || app.SubscriptionID != vars["subId"] || app.SystemID != vars["sysId"] {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	archived := archiveStubIsArchived(appID)
	writeJSON(w, http.StatusOK, map[string]bool{
		"isArchived": archived,
		"canRestore": archived,
	})
}

const archiveRestoreJobDelay = 4 * time.Second

// ArchiveRestore implements POST .../apps/{appId}/restore (202 + statusJobId)
func (s *Server) ArchiveRestore(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	appID := vars["appId"]

	app, err := s.DB.GetApp(appID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if app == nil || app.SubscriptionID != vars["subId"] || app.SystemID != vars["sysId"] {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}

	archiveStubMu.Lock()
	if _, ok := archiveStubRestored[appID]; ok {
		archiveStubMu.Unlock()
		writeError(w, http.StatusBadRequest, "app is not in cold archive (stub)")
		return
	}
	if !archiveStubListed(appID) {
		archiveStubMu.Unlock()
		writeError(w, http.StatusBadRequest, "app is not in cold archive (stub)")
		return
	}
	if existingJID := archiveStubInFlightJob[appID]; existingJID != "" {
		archiveStubMu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]any{
			"statusJobId": existingJID,
			"message":     "restore already in progress (local stub)",
		})
		return
	}

	job, err := s.DB.CreateJob(appID, "airo-archive-restore")
	if err != nil {
		archiveStubMu.Unlock()
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	jid := job.ID
	// Set in-flight job inside critical section to prevent TOCTOU race
	delete(archiveStubRestored, appID)
	archiveStubInFlightJob[appID] = jid
	archiveStubMu.Unlock()

	go func() {
		time.Sleep(archiveRestoreJobDelay / 2)
		_ = s.DB.UpdateJobStatus(jid, "running", "")
		time.Sleep(archiveRestoreJobDelay / 2)
		_ = s.DB.UpdateJobStatus(jid, "completed", "")
		archiveStubCompleteRestore(appID)
	}()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"statusJobId": jid,
		"message":     "Archive restore started (local stub)",
	})
}
