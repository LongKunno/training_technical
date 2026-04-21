package simulation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultRunnerTimeout = 5 * time.Second

type HTTPRunnerClient struct {
	baseURL string
	client  *http.Client
}

func NewHTTPRunnerClient(baseURL string, client *http.Client) *HTTPRunnerClient {
	httpClient := client
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultRunnerTimeout}
	}

	return &HTTPRunnerClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  httpClient,
	}
}

func (c *HTTPRunnerClient) StartRun(ctx context.Context, request RunnerStartRequest) error {
	if strings.TrimSpace(c.baseURL) == "" {
		return ErrRunnerUnavailable
	}

	return c.postJSON(ctx, "/internal/runs/start", request)
}

func (c *HTTPRunnerClient) StopRun(ctx context.Context, runID string) error {
	if strings.TrimSpace(c.baseURL) == "" {
		return ErrRunnerUnavailable
	}
	if strings.TrimSpace(runID) == "" {
		return ErrRunNotFound
	}

	return c.postJSON(ctx, fmt.Sprintf("/internal/runs/%s/stop", runID), map[string]any{})
}

func (c *HTTPRunnerClient) postJSON(ctx context.Context, path string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrRunnerUnavailable, err)
	}
	defer func() {
		_ = response.Body.Close()
	}()

	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}

	rawBody, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
	if response.StatusCode == http.StatusNotFound {
		return ErrRunNotFound
	}

	message := strings.TrimSpace(string(rawBody))
	if message == "" {
		message = response.Status
	}

	return fmt.Errorf("%w: %s", ErrRunnerUnavailable, message)
}

func IsRunnerUnavailable(err error) bool {
	return errors.Is(err, ErrRunnerUnavailable)
}

type HTTPScenarioCatalogClient struct {
	baseURL string
	client  *http.Client
}

func NewHTTPScenarioCatalogClient(baseURL string, client *http.Client) *HTTPScenarioCatalogClient {
	httpClient := client
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultRunnerTimeout}
	}

	return &HTTPScenarioCatalogClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  httpClient,
	}
}

func (c *HTTPScenarioCatalogClient) GetScenario(ctx context.Context, scenarioID string) (ScenarioCatalogEntry, error) {
	if strings.TrimSpace(c.baseURL) == "" {
		return ScenarioCatalogEntry{}, ErrSimulationUnavailable
	}
	if strings.TrimSpace(scenarioID) == "" {
		return ScenarioCatalogEntry{}, ErrInvalidScenarioID
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("%s/api/data/market/quotes/replay/catalog/%s", c.baseURL, scenarioID),
		nil,
	)
	if err != nil {
		return ScenarioCatalogEntry{}, err
	}

	response, err := c.client.Do(request)
	if err != nil {
		return ScenarioCatalogEntry{}, fmt.Errorf("%w: %v", ErrSimulationUnavailable, err)
	}
	defer func() {
		_ = response.Body.Close()
	}()

	if response.StatusCode == http.StatusNotFound {
		return ScenarioCatalogEntry{}, ErrInvalidScenarioID
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ScenarioCatalogEntry{}, ErrSimulationUnavailable
	}

	var payload struct {
		Scenario ScenarioCatalogEntry `json:"scenario"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return ScenarioCatalogEntry{}, err
	}
	if strings.TrimSpace(payload.Scenario.ScenarioID) == "" {
		return ScenarioCatalogEntry{}, ErrInvalidScenarioID
	}
	return payload.Scenario, nil
}
