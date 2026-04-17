package handlers

import (
	"encoding/json"
	"net/http"
)

type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Message string `json:"message"`
}

func NewHealthHandler(serviceName string, message string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		response := HealthResponse{
			Status:  "ok",
			Service: serviceName,
			Message: message,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			http.Error(w, `{"status":"error","message":"failed to encode response"}`, http.StatusInternalServerError)
		}
	}
}
