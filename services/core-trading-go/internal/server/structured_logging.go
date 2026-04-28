package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync/atomic"
	"time"
)

var requestIDCounter atomic.Uint64

type responseStatusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (recorder *responseStatusRecorder) WriteHeader(status int) {
	if recorder.wroteHeader {
		return
	}
	recorder.status = status
	recorder.wroteHeader = true
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *responseStatusRecorder) Write(body []byte) (int, error) {
	if !recorder.wroteHeader {
		recorder.WriteHeader(http.StatusOK)
	}
	return recorder.ResponseWriter.Write(body)
}

func (recorder *responseStatusRecorder) Flush() {
	if !recorder.wroteHeader {
		recorder.WriteHeader(http.StatusOK)
	}
	if flusher, ok := recorder.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (recorder *responseStatusRecorder) Unwrap() http.ResponseWriter {
	return recorder.ResponseWriter
}

func WithStructuredRequestLogging(next http.Handler, writer io.Writer) http.Handler {
	if writer == nil {
		writer = io.Discard
	}
	logger := log.New(writer, "", 0)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		reqID := requestID(r)
		r.Header.Set("x-request-id", reqID)

		recorder := &responseStatusRecorder{
			ResponseWriter: w,
			status:         http.StatusOK,
		}
		recorder.Header().Set("x-request-id", reqID)

		defer func() {
			if recovered := recover(); recovered != nil {
				status := http.StatusInternalServerError
				if recorder.wroteHeader {
					status = recorder.status
				}
				writeRequestLog(logger, "error", r, reqID, startedAt, status, map[string]any{
					"error_message": fmt.Sprint(recovered),
					"error_type":    fmt.Sprintf("%T", recovered),
				})
				panic(recovered)
			}
		}()

		next.ServeHTTP(recorder, r)
		writeRequestLog(logger, "info", r, reqID, startedAt, recorder.status, nil)
	})
}

func requestID(r *http.Request) string {
	incoming := r.Header.Get("x-request-id")
	if incoming != "" {
		return incoming
	}
	return fmt.Sprintf("core-%d-%d", time.Now().UTC().UnixNano(), requestIDCounter.Add(1))
}

func writeRequestLog(
	logger *log.Logger,
	level string,
	r *http.Request,
	requestID string,
	startedAt time.Time,
	status int,
	extra map[string]any,
) {
	fields := requestContext(r)
	for key, value := range extra {
		fields[key] = value
	}
	fields["duration_ms"] = float64(time.Since(startedAt).Microseconds()) / 1000
	fields["event"] = "http_request"
	fields["level"] = level
	fields["method"] = r.Method
	fields["path"] = r.URL.Path
	fields["request_id"] = requestID
	fields["service"] = "core_trading"
	fields["status"] = status
	fields["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	payload, err := json.Marshal(fields)
	if err != nil {
		return
	}
	logger.Println(string(payload))
}

func requestContext(r *http.Request) map[string]any {
	fields := map[string]any{}
	for _, key := range []string{
		"session_id",
		"run_id",
		"experiment_id",
		"bot_id",
		"scenario_id",
		"status",
		"symbol",
	} {
		addQueryField(fields, r, key)
	}

	addPathValue(fields, r, "run_id", "runID")
	addPathValue(fields, r, "experiment_id", "experimentID")
	addPathValue(fields, r, "bot_id", "botID")
	return fields
}

func addQueryField(fields map[string]any, r *http.Request, key string) {
	values := make([]string, 0, len(r.URL.Query()[key]))
	for _, value := range r.URL.Query()[key] {
		if value != "" {
			values = append(values, value)
		}
	}
	switch len(values) {
	case 0:
		return
	case 1:
		fields[key] = values[0]
	default:
		fields[key] = values
	}
}

func addPathValue(fields map[string]any, r *http.Request, fieldName string, pathName string) {
	if value := r.PathValue(pathName); value != "" {
		fields[fieldName] = value
	}
}
