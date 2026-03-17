package api

import (
	"net/http"

	"github.com/gorilla/mux"
)

func (s *Server) GetJobApps(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	jobID := vars["jobId"]

	job, err := s.DB.GetJob(jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	// Mirror production behavior: only include app data once the job is
	// completed. While provisioning is in progress the apps array stays
	// empty so the client keeps polling with the job ID.
	if job.Status != "completed" {
		writeJSON(w, http.StatusOK, map[string]any{
			"statusJobId": jobID,
			"status":      job.Status,
			"apps":        []any{},
		})
		return
	}

	app, err := s.DB.GetApp(job.AppID)
	if err != nil || app == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"statusJobId": jobID,
			"status":      job.Status,
			"apps":        []any{},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"statusJobId": jobID,
		"status":      job.Status,
		"apps":        []any{appToResponse(app)},
	})
}
